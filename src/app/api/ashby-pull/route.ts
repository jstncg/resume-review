import { NextResponse } from 'next/server';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

export const runtime = 'nodejs';

const execAsync = promisify(exec);
const TIMEOUT_MS = 5 * 60 * 1000;

type PullRequest = {
  jobId: string;
  limit?: number;
  dryRun?: boolean;
  outputDir?: string;
  onlyStatus?: string;
  stageTitleIncludes?: string;
};

function getBaseUrl(req: Request): string {
  const proto = req.headers.get('x-forwarded-proto') ?? 'http';
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) return `${proto}://${host}`;
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

function escapeArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export async function POST(req: Request) {
  let body: PullRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { jobId, limit = 50, dryRun = false, outputDir, onlyStatus, stageTitleIncludes } = body;

  if (!jobId || typeof jobId !== 'string') {
    return NextResponse.json({ ok: false, error: 'jobId required' }, { status: 400 });
  }

  const parsedLimit = parseInt(String(limit), 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
    return NextResponse.json({ ok: false, error: 'limit must be ≥ 1' }, { status: 400 });
  }

  // Build shell command
  let cmd = `node scripts/ashby-download-resumes.mjs --jobId ${escapeArg(jobId)} --limit ${parsedLimit}`;
  if (dryRun) cmd += ' --dry-run';
  if (outputDir?.trim()) cmd += ` --outputDir ${escapeArg(outputDir)}`;
  if (onlyStatus?.trim()) cmd += ` --onlyStatus ${escapeArg(onlyStatus.trim())}`;
  if (stageTitleIncludes?.trim()) cmd += ` --stageTitleIncludes ${escapeArg(stageTitleIncludes.trim())}`;

  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: process.cwd(),
      timeout: TIMEOUT_MS,
      env: process.env,
    });

    const downloaded = parseInt(stdout.match(/downloaded=(\d+)/)?.[1] || '0', 10);
    const skipped = parseInt(stdout.match(/skipped=(\d+)/)?.[1] || '0', 10);
    const failed = parseInt(stdout.match(/failed=(\d+)/)?.[1] || '0', 10);
    const dir = stdout.match(/resumes saved to: (.+)/)?.[1]?.trim() || 'dataset/sentra_test_resumes';

    if (downloaded > 0) {
      fetch(`${getBaseUrl(req)}/api/reconcile`, { method: 'POST' }).catch(console.error);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      limit: parsedLimit,
      dryRun,
      downloaded,
      skipped,
      failed,
      outputDir: dir,
      debug: stderr ? { stderr } : undefined,
    });
  } catch (err) {
    const e = err as { killed?: boolean; code?: number; stdout?: string; stderr?: string; message?: string };

    if (e.killed) {
      return NextResponse.json({ ok: false, error: 'Timed out after 5 minutes' }, { status: 504 });
    }

    return NextResponse.json({
      ok: false,
      error: e.stderr || e.stdout || e.message || 'Unknown error',
      code: e.code,
    }, { status: 500 });
  }
}
