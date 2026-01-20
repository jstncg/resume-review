import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import { STATUS_BAD_FIT } from '@/lib/labels';
import { isPdf } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * POST /api/cleanup
 * Deletes all PDFs marked as bad_fit from the resume folder.
 */
export async function POST() {
  const dir = resumeWatcher.getWatchDir();
  const labels = await readManifestLabels();

  const deleted: string[] = [];
  const failed: { filename: string; error: string }[] = [];

  for (const [filename, label] of labels.entries()) {
    if (label === STATUS_BAD_FIT) {
      const absPath = path.join(dir, filename);
      try {
        await fs.unlink(absPath);
        deleted.push(filename);
        console.log(`[cleanup] Deleted rejected resume: ${filename}`);
      } catch (err) {
        const error = err as NodeJS.ErrnoException;
        // File might already be deleted or not exist
        if (error?.code === 'ENOENT') {
          deleted.push(filename);
        } else {
          failed.push({ filename, error: error?.message || String(err) });
        }
      }
    }
  }

  return NextResponse.json({
    deleted: deleted.length,
    failed: failed.length,
    deletedFiles: deleted,
    failedFiles: failed,
  });
}

/**
 * GET /api/cleanup
 * Returns count of bad_fit files that would be deleted.
 */
export async function GET() {
  const dir = resumeWatcher.getWatchDir();
  const labels = await readManifestLabels();

  const badFitFiles: string[] = [];
  for (const [filename, label] of labels.entries()) {
    if (label === STATUS_BAD_FIT && isPdf(filename)) {
      badFitFiles.push(filename);
    }
  }

  // Check which ones still exist on disk
  const existingBadFit: string[] = [];
  for (const filename of badFitFiles) {
    try {
      await fs.access(path.join(dir, filename));
      existingBadFit.push(filename);
    } catch {
      // File doesn't exist
    }
  }

  return NextResponse.json({
    count: existingBadFit.length,
    files: existingBadFit,
  });
}
