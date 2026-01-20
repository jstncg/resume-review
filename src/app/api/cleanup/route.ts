import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import { STATUS_BAD_FIT } from '@/lib/labels';
import { isPdf } from '@/lib/utils';

export const runtime = 'nodejs';

export async function POST() {
  const dir = resumeWatcher.getWatchDir();
  const labels = await readManifestLabels();
  const deleted: string[] = [];
  const failed: { filename: string; error: string }[] = [];

  for (const [filename, label] of labels) {
    if (label !== STATUS_BAD_FIT) continue;

    try {
      await fs.unlink(path.join(dir, filename));
      deleted.push(filename);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error?.code === 'ENOENT') {
        deleted.push(filename);
      } else {
        failed.push({ filename, error: error?.message || String(err) });
      }
    }
  }

  return NextResponse.json({ deleted: deleted.length, failed: failed.length, deletedFiles: deleted, failedFiles: failed });
}

export async function GET() {
  const dir = resumeWatcher.getWatchDir();
  const labels = await readManifestLabels();

  const badFitFiles = [...labels.entries()].filter(([f, l]) => l === STATUS_BAD_FIT && isPdf(f)).map(([f]) => f);

  const existing: string[] = [];
  for (const f of badFitFiles) {
    try {
      await fs.access(path.join(dir, f));
      existing.push(f);
    } catch {
      // File doesn't exist
    }
  }

  return NextResponse.json({ count: existing.length, files: existing });
}
