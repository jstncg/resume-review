import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

export const runtime = 'nodejs';

// Maximum time to wait for download (5 minutes)
const TIMEOUT_MS = 5 * 60 * 1000;

type PullRequest = {
  jobId: string;
  limit?: number;
  dryRun?: boolean;
  outputDir?: string;
  onlyStatus?: string;
  stageTitleIncludes?: string;
};

/**
 * POST /api/ashby-pull
 * Triggers the Ashby download script to pull resumes for a specific job.
 */
export async function POST(req: Request) {
  let body: PullRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { jobId, limit = 50, dryRun = false, outputDir, onlyStatus, stageTitleIncludes } = body;

  // Validation
  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'jobId is required' },
      { status: 400 }
    );
  }

  if (limit < 1) {
    return NextResponse.json(
      { ok: false, error: 'limit must be at least 1' },
      { status: 400 }
    );
  }

  // Build command arguments
  const scriptPath = path.join(
    process.cwd(),
    'scripts',
    'ashby-download-resumes.mjs'
  );
  const args = [scriptPath, '--jobId', jobId, '--limit', String(limit)];

  if (dryRun) {
    args.push('--dry-run');
  }

  if (outputDir) {
    args.push('--outputDir', outputDir);
  }

  if (onlyStatus) {
    args.push('--onlyStatus', onlyStatus);
  }

  if (stageTitleIncludes) {
    args.push('--stageTitleIncludes', stageTitleIncludes);
  }

  return new Promise<NextResponse>((resolve) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;

    const child = spawn('node', args, {
      env: { ...process.env },
      cwd: process.cwd(),
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (resolved) return;
      resolved = true;

      if (code === 0) {
        // Parse output for statistics
        const downloadedMatch = stdout.match(/downloaded=(\d+)/);
        const skippedMatch = stdout.match(/skipped=(\d+)/);
        const failedMatch = stdout.match(/failed=(\d+)/);
        const outputDirMatch = stdout.match(/resumes saved to: (.+)/);

        const downloaded = downloadedMatch ? parseInt(downloadedMatch[1], 10) : 0;

        // AUTO-TRIGGER ANALYSIS after successful pull with downloads
        if (downloaded > 0) {
          // Dynamically build the base URL from headers or use localhost
          const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
          // Trigger reconcile in background (don't await - let it run async)
          fetch(`${baseUrl}/api/reconcile`, {
            method: 'POST',
          }).catch((err) => {
            console.error('[ashby-pull] Failed to auto-trigger analysis:', err);
          });
        }

        resolve(
          NextResponse.json({
            ok: true,
            jobId,
            limit,
            dryRun,
            downloaded,
            skipped: skippedMatch ? parseInt(skippedMatch[1], 10) : 0,
            failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
            outputDir: outputDirMatch
              ? outputDirMatch[1].trim()
              : 'dataset/sentra_test_resumes',
          })
        );
      } else {
        resolve(
          NextResponse.json(
            {
              ok: false,
              error: stderr || stdout || `Script exited with code ${code}`,
              code,
            },
            { status: 500 }
          )
        );
      }
    });

    child.on('error', (err) => {
      if (resolved) return;
      resolved = true;

      resolve(
        NextResponse.json(
          {
            ok: false,
            error: `Failed to start download: ${err.message}`,
          },
          { status: 500 }
        )
      );
    });

    // Timeout handler
    setTimeout(() => {
      if (resolved) return;
      resolved = true;

      child.kill('SIGTERM');

      resolve(
        NextResponse.json(
          {
            ok: false,
            error: 'Download timed out after 5 minutes',
          },
          { status: 504 }
        )
      );
    }, TIMEOUT_MS);
  });
}

