import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resumeWatcher } from '@/lib/resumeWatcher';

export const runtime = 'nodejs';

const getManifestPath = () => process.env.MANIFEST_PATH || path.resolve(process.cwd(), 'dataset', 'manifest.csv');

export async function POST() {
  const resumeDir = resumeWatcher.getWatchDir();
  const manifestPath = getManifestPath();
  const deleted: string[] = [];
  const errors: string[] = [];

  try {
    const files = await fs.readdir(resumeDir);
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));

    for (const filename of pdfs) {
      try {
        await fs.unlink(path.join(resumeDir, filename));
        deleted.push(filename);
      } catch (err) {
        errors.push(`${filename}: ${err instanceof Error ? err.message : 'Unknown'}`);
      }
    }

    await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');

    // Clean metadata
    try {
      const metaDir = path.join(path.dirname(resumeDir), 'ashby_metadata');
      const metaFiles = await fs.readdir(metaDir);
      await Promise.all(
        metaFiles.filter(f => f.endsWith('.json')).map(f => fs.unlink(path.join(metaDir, f)).catch(() => {}))
      );
    } catch {
      // Metadata dir may not exist
    }

    return NextResponse.json({
      ok: true,
      deleted: deleted.length,
      deletedFiles: deleted,
      errors: errors.length > 0 ? errors : undefined,
      message: `Cleared ${deleted.length} PDFs`,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      deleted: deleted.length,
      deletedFiles: deleted,
    }, { status: 500 });
  }
}

export async function GET() {
  const resumeDir = resumeWatcher.getWatchDir();

  try {
    const files = await fs.readdir(resumeDir);
    const pdfs = files.filter(f => f.toLowerCase().endsWith('.pdf'));
    return NextResponse.json({ ok: true, count: pdfs.length, directory: resumeDir });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown', count: 0 }, { status: 500 });
  }
}
