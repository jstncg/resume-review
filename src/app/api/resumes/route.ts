import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';

export const runtime = 'nodejs';

function isPdf(name: string) {
  return path.extname(name).toLowerCase() === '.pdf';
}

function toPosixPath(p: string) {
  return p.split(path.sep).join('/');
}

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
