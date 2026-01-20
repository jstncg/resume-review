import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import { isPdf, toPosixPath } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET() {
  const dir = resumeWatcher.getWatchDir();
  const names = await fs.readdir(dir);
  const pdfs = names.filter(isPdf).sort((a, b) => a.localeCompare(b));
  const labels = await readManifestLabels();

  const rootRel = path.relative(process.cwd(), dir);

  return NextResponse.json({
    dir,
    items: pdfs.map((filename) => ({
      filename,
      relPath: toPosixPath(path.join(rootRel, filename)),
      label: labels.get(filename) ?? null,
    })),
  });
}
