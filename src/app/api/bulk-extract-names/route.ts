import { NextResponse } from 'next/server';
import path from 'node:path';
import { getBulkUploadsDir, readBulkManifestLabels, readBulkCandidateNames, setCandidateName } from '@/lib/bulkManifest';
import { PASSING_STATUSES } from '@/lib/labels';
import { extractNameFromPdf } from '@/lib/llmAnalyzer';

export const runtime = 'nodejs';

// Maximum concurrent extractions to avoid rate limiting
const MAX_CONCURRENCY = 5;

export async function POST() {
  try {
    const dir = getBulkUploadsDir();
    const labels = await readBulkManifestLabels();
    const existingNames = await readBulkCandidateNames();

    // Find all passing candidates that don't have names yet
    const needsExtraction: { filename: string; label: string }[] = [];
    
    for (const [filename, label] of labels) {
      if (PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number])) {
        const existingName = existingNames.get(filename);
        if (!existingName || existingName === 'Unknown') {
          needsExtraction.push({ filename, label });
        }
      }
    }

    if (needsExtraction.length === 0) {
      return NextResponse.json({
        ok: true,
        message: 'All passed candidates already have names extracted',
        extracted: 0,
        total: 0,
      });
    }

    console.log(`[bulk-extract-names] Starting extraction for ${needsExtraction.length} candidates`);

    // Process in batches for concurrency control
    let extracted = 0;
    let failed = 0;

    const processFile = async (file: { filename: string; label: string }) => {
      const absPath = path.join(dir, file.filename);
      try {
        console.log(`[bulk-extract-names] Extracting name from: ${file.filename}`);
        const name = await extractNameFromPdf(absPath);
        
        if (name && name !== 'Unknown') {
          await setCandidateName(file.filename, name);
          console.log(`[bulk-extract-names] Extracted: ${file.filename} -> ${name}`);
          extracted++;
        } else {
          console.log(`[bulk-extract-names] Could not extract name from: ${file.filename}`);
          failed++;
        }
      } catch (e) {
        console.error(`[bulk-extract-names] Error processing ${file.filename}:`, e);
        failed++;
      }
    };

    // Process with concurrency limit
    const queue = [...needsExtraction];
    const running: Promise<void>[] = [];

    while (queue.length > 0 || running.length > 0) {
      // Fill up to MAX_CONCURRENCY
      while (running.length < MAX_CONCURRENCY && queue.length > 0) {
        const file = queue.shift()!;
        const promise = processFile(file).then(() => {
          const index = running.indexOf(promise);
          if (index > -1) running.splice(index, 1);
        });
        running.push(promise);
      }

      // Wait for at least one to complete
      if (running.length > 0) {
        await Promise.race(running);
      }
    }

    console.log(`[bulk-extract-names] Completed: ${extracted} extracted, ${failed} failed`);

    return NextResponse.json({
      ok: true,
      message: `Extracted ${extracted} names`,
      extracted,
      failed,
      total: needsExtraction.length,
    });
  } catch (error) {
    console.error('[bulk-extract-names] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Extraction failed' },
      { status: 500 }
    );
  }
}

// GET endpoint to check how many need extraction
export async function GET() {
  try {
    const labels = await readBulkManifestLabels();
    const existingNames = await readBulkCandidateNames();

    let needsExtraction = 0;
    let hasNames = 0;
    
    for (const [filename, label] of labels) {
      if (PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number])) {
        const existingName = existingNames.get(filename);
        if (!existingName || existingName === 'Unknown') {
          needsExtraction++;
        } else {
          hasNames++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      needsExtraction,
      hasNames,
      total: needsExtraction + hasNames,
    });
  } catch (error) {
    console.error('[bulk-extract-names] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to check status' },
      { status: 500 }
    );
  }
}
