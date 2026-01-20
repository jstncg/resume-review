import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import { STATUS_IN_PROGRESS, STATUS_PENDING } from '@/lib/labels';
import { isPdf, toPosixPath } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Re-trigger analysis for pending PDFs by moving them out and back in.
 */
export async function POST() {
  const dir = resumeWatcher.getWatchDir();
  const names = await fs.readdir(dir);
  const pdfs = names.filter(isPdf).sort();
  const labels = await readManifestLabels();

  const enqueued: { filename: string; relPath: string; prior: string | null }[] = [];
  const tmpDir = path.resolve(process.cwd(), 'dataset', '_reconcile_tmp');
  await fs.mkdir(tmpDir, { recursive: true });

  for (const filename of pdfs) {
    const prior = labels.get(filename) ?? null;
    if (prior && prior !== STATUS_PENDING && prior !== STATUS_IN_PROGRESS) continue;

    const absPath = path.join(dir, filename);
    const tmpPath = path.join(tmpDir, `${Date.now()}-${filename}`);

    try {
      await fs.rename(absPath, tmpPath);
      await fs.rename(tmpPath, absPath);
      enqueued.push({ filename, relPath: toPosixPath(path.relative(process.cwd(), absPath)), prior });
    } catch {
      // Skip if file locked
    }
  }

  return NextResponse.json({ dir, totalPdfs: pdfs.length, enqueued: enqueued.length, items: enqueued });
}
