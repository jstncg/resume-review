import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readManifestLabels, removeManifestEntry } from '@/lib/manifest';
import { STATUS_BAD_FIT } from '@/lib/labels';
import { archiveInAshby } from '@/lib/ashbyArchive';
import { parseIdsFromFilename } from '@/lib/utils';

export const runtime = 'nodejs';

/**
 * POST /api/archive-rejected
 * Archives all rejected candidates in Ashby and removes them from local storage.
 */
export async function POST() {
  const resumeDir = path.join(process.cwd(), 'dataset', 'sentra_test_resumes');
  
  try {
    // Get all files with bad_fit label
    const labels = await readManifestLabels();
    const rejectedFiles: string[] = [];
    
    for (const [filename, label] of labels.entries()) {
      if (label === STATUS_BAD_FIT) {
        rejectedFiles.push(filename);
      }
    }

    if (rejectedFiles.length === 0) {
      return NextResponse.json({
        ok: true,
        archived: 0,
        failed: 0,
        message: 'No rejected candidates to archive',
      });
    }

    let archived = 0;
    let failed = 0;
    const results: { filename: string; status: 'archived' | 'failed'; error?: string }[] = [];

    for (const filename of rejectedFiles) {
      const ids = parseIdsFromFilename(filename);
      
      if (!ids?.applicationId) {
        results.push({ filename, status: 'failed', error: 'Could not extract application ID' });
        failed++;
        continue;
      }

      try {
        // Archive in Ashby
        const success = await archiveInAshby(filename);
        
        if (success) {
          // Delete local file
          const filePath = path.join(resumeDir, filename);
          try {
            await fs.unlink(filePath);
          } catch {
            // File might already be deleted, ignore
          }
          
          // Remove from manifest
          await removeManifestEntry(filename);
          
          archived++;
          results.push({ filename, status: 'archived' });
        } else {
          failed++;
          results.push({ filename, status: 'failed', error: 'archiveInAshby returned false' });
        }
      } catch (err) {
        failed++;
        results.push({ 
          filename, 
          status: 'failed', 
          error: err instanceof Error ? err.message : 'Unknown error' 
        });
      }
    }

    return NextResponse.json({
      ok: true,
      archived,
      failed,
      total: rejectedFiles.length,
      message: `Archived ${archived} candidates${failed > 0 ? `, ${failed} failed` : ''}`,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to archive rejected candidates: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/archive-rejected
 * Returns count of rejected candidates that can be archived.
 */
export async function GET() {
  try {
    const labels = await readManifestLabels();
    let count = 0;
    
    for (const label of labels.values()) {
      if (label === STATUS_BAD_FIT) {
        count++;
      }
    }

    return NextResponse.json({
      ok: true,
      count,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      count: 0,
    });
  }
}

