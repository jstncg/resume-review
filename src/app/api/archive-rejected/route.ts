import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readManifestLabels, removeManifestEntry } from '@/lib/manifest';
import { STATUS_BAD_FIT } from '@/lib/labels';
import { archiveInAshby } from '@/lib/ashbyArchive';
import { parseIdsFromFilename } from '@/lib/utils';

export const runtime = 'nodejs';

const RESUME_DIR = path.join(process.cwd(), 'dataset', 'sentra_test_resumes');

export async function POST() {
  try {
    const labels = await readManifestLabels();
    const rejected = [...labels.entries()].filter(([, l]) => l === STATUS_BAD_FIT).map(([f]) => f);

    if (rejected.length === 0) {
      return NextResponse.json({ ok: true, archived: 0, failed: 0, message: 'No rejected candidates' });
    }

    let archived = 0, failed = 0;
    const results: { filename: string; status: 'archived' | 'failed'; error?: string }[] = [];

    for (const filename of rejected) {
      const ids = parseIdsFromFilename(filename);
      if (!ids?.applicationId) {
        results.push({ filename, status: 'failed', error: 'No application ID' });
        failed++;
        continue;
      }

      try {
        if (await archiveInAshby(filename)) {
          await fs.unlink(path.join(RESUME_DIR, filename)).catch(() => {});
          await removeManifestEntry(filename);
          results.push({ filename, status: 'archived' });
          archived++;
        } else {
          results.push({ filename, status: 'failed', error: 'Archive returned false' });
          failed++;
        }
      } catch (err) {
        results.push({ filename, status: 'failed', error: err instanceof Error ? err.message : 'Unknown' });
        failed++;
      }
    }

    return NextResponse.json({
      ok: true,
      archived,
      failed,
      total: rejected.length,
      message: `Archived ${archived}${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const labels = await readManifestLabels();
    const count = [...labels.values()].filter(l => l === STATUS_BAD_FIT).length;
    return NextResponse.json({ ok: true, count });
  } catch {
    return NextResponse.json({ ok: true, count: 0 });
  }
}
