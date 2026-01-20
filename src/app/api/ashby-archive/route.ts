import { NextResponse } from 'next/server';
import { ashbyRpc, isAshbyConfigured } from '@/lib/ashbyClient';
import { parseIdsFromFilename } from '@/lib/utils';
import { upsertManifestLabel } from '@/lib/manifest';
import { STATUS_BAD_FIT } from '@/lib/labels';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

type ArchiveRequest = {
  applicationId?: string;
  archiveReasonId?: string;
  filename?: string; // Alternative to applicationId - parse from filename
};

function getResumeDir() {
  return process.env.RESUME_DIR || path.resolve(process.cwd(), 'dataset', 'sentra_test_resumes');
}

/**
 * POST /api/ashby-archive
 * Archives a candidate's application in Ashby.
 * Body: { applicationId: string, archiveReasonId?: string }
 * OR: { filename: string } - extracts applicationId from filename
 */
export async function POST(req: Request) {
  let body: ArchiveRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let { applicationId } = body;
  const { archiveReasonId } = body;
  const { filename } = body;

  // If filename provided, extract applicationId from it
  if (!applicationId && filename) {
    const ids = parseIdsFromFilename(filename);
    applicationId = ids?.applicationId ?? undefined;
  }

  if (!applicationId) {
    return NextResponse.json(
      { error: 'Missing applicationId or valid filename' },
      { status: 400 }
    );
  }

  if (!isAshbyConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Ashby API key not configured',
        applicationId,
      },
      { status: 500 }
    );
  }

  // Try multiple potential archive methods
  const methodsToTry: Array<{ method: string; body: Record<string, string> }> = [
    {
      method: 'application.changeStage',
      body: { applicationId, interviewStageId: 'archived' },
    },
    {
      method: 'application.update',
      body: { applicationId, status: 'Archived' },
    },
  ];

  // If archiveReasonId is provided, try setArchiveReason first
  if (archiveReasonId) {
    methodsToTry.unshift({
      method: 'application.setArchiveReason',
      body: { applicationId, archiveReasonId },
    });
  }

  for (const attempt of methodsToTry) {
    const result = await ashbyRpc(attempt.method, attempt.body);

    if (result.success) {
      // Archive succeeded - clean up local file if it exists
      if (filename) {
        try {
          const filePath = path.join(getResumeDir(), filename);
          await fs.unlink(filePath);
          console.log(`[archive] Deleted local file after successful archive: ${filename}`);
          // Update manifest to bad_fit (will be removed on next cleanup)
          await upsertManifestLabel(filename, STATUS_BAD_FIT);
        } catch (cleanupErr) {
          console.error(`[archive] Failed to delete local file ${filename}:`, cleanupErr);
          // Continue anyway - archive succeeded
        }
      }
      
      return NextResponse.json({
        ok: true,
        applicationId,
        method: attempt.method,
        cleaned: !!filename,
      });
    }

    if (result.error?.includes('403') || result.error?.includes('permission')) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'API key lacks write permissions. Update your Ashby API key to include write access for Applications.',
          applicationId,
        },
        { status: 403 }
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error:
        'Failed to archive application in Ashby. The archive API may require specific permissions.',
      applicationId,
    },
    { status: 500 }
  );
}

/**
 * GET /api/ashby-archive
 * Lists available archive reasons from Ashby.
 */
export async function GET() {
  if (!isAshbyConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'Ashby API key not configured',
      reasons: [],
    });
  }

  try {
    const result = await ashbyRpc<Array<{ id: string; text: string }>>(
      'archiveReason.list',
      {}
    );

    if (result.success) {
      return NextResponse.json({
        ok: true,
        reasons: result.results || [],
      });
    }

    return NextResponse.json(
      {
        ok: false,
        error: result.error || 'Failed to fetch archive reasons',
        reasons: [],
      },
      { status: 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        ok: false,
        error: message,
        reasons: [],
      },
      { status: 500 }
    );
  }
}
