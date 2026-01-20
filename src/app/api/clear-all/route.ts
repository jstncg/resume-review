import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resumeWatcher } from '@/lib/resumeWatcher';

export const runtime = 'nodejs';

function getManifestPath() {
  return process.env.MANIFEST_PATH || path.resolve(process.cwd(), 'dataset', 'manifest.csv');
}

/**
 * POST /api/clear-all
 * Deletes all PDF files in the resume directory and resets manifest.csv
 * This is a destructive operation - use with caution!
 * 
 * NOTE: This intentionally PRESERVES rejected_candidates.json so that
 * previously rejected candidates won't be re-downloaded on future pulls.
 */
export async function POST() {
  const resumeDir = resumeWatcher.getWatchDir();
  const manifestPath = getManifestPath();

  const deleted: string[] = [];
  const errors: string[] = [];

  try {
    // 1. Get all PDF files in the resume directory
    const files = await fs.readdir(resumeDir);
    const pdfFiles = files.filter((f) => f.toLowerCase().endsWith('.pdf'));

    // 2. Delete each PDF file
    for (const filename of pdfFiles) {
      try {
        const filePath = path.join(resumeDir, filename);
        await fs.unlink(filePath);
        deleted.push(filename);
      } catch (err) {
        errors.push(`Failed to delete ${filename}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    // 3. Reset manifest.csv to just the header
    try {
      await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
    } catch (err) {
      errors.push(`Failed to reset manifest: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 4. Delete metadata files (optional cleanup)
    const metadataDir = path.join(path.dirname(resumeDir), 'ashby_metadata');
    try {
      const metaFiles = await fs.readdir(metadataDir);
      for (const metaFile of metaFiles) {
        if (metaFile.endsWith('.json')) {
          try {
            await fs.unlink(path.join(metadataDir, metaFile));
          } catch {
            // Ignore metadata deletion errors
          }
        }
      }
    } catch {
      // Metadata dir may not exist, that's fine
    }

    return NextResponse.json({
      ok: true,
      deleted: deleted.length,
      deletedFiles: deleted,
      errors: errors.length > 0 ? errors : undefined,
      message: `Cleared ${deleted.length} PDFs and reset manifest`,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        deleted: deleted.length,
        deletedFiles: deleted,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clear-all
 * Returns current count of PDFs (for confirmation dialog)
 */
export async function GET() {
  const resumeDir = resumeWatcher.getWatchDir();

  try {
    const files = await fs.readdir(resumeDir);
    const pdfFiles = files.filter((f) => f.toLowerCase().endsWith('.pdf'));

    return NextResponse.json({
      ok: true,
      count: pdfFiles.length,
      directory: resumeDir,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown error',
        count: 0,
      },
      { status: 500 }
    );
  }
}

