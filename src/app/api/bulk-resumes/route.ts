import { NextResponse } from 'next/server';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getBulkUploadsDir, readBulkManifestLabels, readBulkCandidateNames } from '@/lib/bulkManifest';
import { isPdf, toPosixPath } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET() {
  const dir = getBulkUploadsDir();
  await fs.mkdir(dir, { recursive: true });

  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    // Directory might not exist
  }

  const pdfs = names.filter(isPdf).sort((a, b) => a.localeCompare(b));
  const labels = await readBulkManifestLabels();
  const candidateNames = await readBulkCandidateNames();
  const rootRel = path.relative(process.cwd(), dir);

  return NextResponse.json({
    dir,
    items: pdfs.map(filename => ({
      filename,
      relPath: toPosixPath(path.join(rootRel, filename)),
      label: labels.get(filename) ?? null,
      candidateName: candidateNames.get(filename) ?? null,
    })),
  });
}
