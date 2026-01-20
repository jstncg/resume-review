import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import { STATUS_IN_PROGRESS, STATUS_PENDING } from '@/lib/labels';
import { isPdf, toPosixPath } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * Manual "kick" to start analysis for PDFs already on disk.
 *
 * Why we do a filesystem re-add instead of in-memory enqueue:
 * In Next.js dev, route handlers may run in separate workers, so in-memory queues
 * can be lost between requests. The chokidar watcher (long-lived) reliably reacts
 * to real filesystem add events.
 */
export async function POST() {
  const dir = resumeWatcher.getWatchDir();
  const names = await fs.readdir(dir);
  const pdfs = names.filter(isPdf).sort((a, b) => a.localeCompare(b));
  const labels = await readManifestLabels();

  const enqueued: { filename: string; relPath: string; prior: string | null }[] =
    [];
  const tmpDir = path.resolve(process.cwd(), 'dataset', '_reconcile_tmp');
  await fs.mkdir(tmpDir, { recursive: true });

  for (const filename of pdfs) {
    const prior = labels.get(filename) ?? null;
    if (prior && prior !== STATUS_PENDING && prior !== STATUS_IN_PROGRESS)
      continue;
    const absPath = path.join(dir, filename);
    const relPath = toPosixPath(path.relative(process.cwd(), absPath));

    // Trigger a real "add" event by moving out of the watched directory and back in.
    const tmpPath = path.join(tmpDir, `${Date.now()}-${filename}`);
    try {
      await fs.rename(absPath, tmpPath);
      await fs.rename(tmpPath, absPath);
      enqueued.push({ filename, relPath, prior });
    } catch {
      // If rename fails (e.g. file is locked), skip it and continue.
    }
  }

  return NextResponse.json({
    dir,
    totalPdfs: pdfs.length,
    enqueued: enqueued.length,
    items: enqueued,
  });
}
