/**
 * Analysis Pipeline for Ashby Resume Flow
 * 
 * Handles queuing, analysis, rejected tracking, and optional archiving.
 */

import { readManifestLabels, upsertManifestLabel } from '@/lib/manifest';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
} from '@/lib/labels';
import type { Status } from '@/lib/labels';
import { analyzeResumePdf, ScannedPdfError } from '@/lib/llmAnalyzer';
import { archiveInAshby } from '@/lib/ashbyArchive';
import { addRejectedCandidate } from '@/lib/rejectedTracker';
import { parseIdsFromFilename } from '@/lib/utils';

export type AnalyzeUpdate = {
  filename: string;
  relPath: string;
  label: Status;
};

type AnalyzeJob = {
  filename: string;
  relPath: string;
  absPath: string;
  condition: string;
  onUpdate?: (u: AnalyzeUpdate) => void;
};

// Queue state
const queue: AnalyzeJob[] = [];
let running = 0;
const MAX_CONCURRENCY = Math.max(1, parseInt(process.env.ANALYSIS_MAX_CONCURRENCY ?? '5', 10) || 5);

function drain(): void {
  while (running < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    running++;
    void runJob(job).finally(() => {
      running--;
      drain();
    });
  }
}

async function trackRejected(filename: string, reason: 'bad_fit' | 'scan_failed'): Promise<void> {
  const ids = parseIdsFromFilename(filename);
  if (!ids?.candidateId || !ids?.applicationId) {
    console.warn(`[rejected] Could not extract IDs from: ${filename}`);
    return;
  }

  let archiveStatus: 'success' | 'failed' | 'skipped' = 'skipped';

  if (process.env.AUTO_ARCHIVE_REJECTED === 'true') {
    try {
      const ok = await archiveInAshby(filename);
      archiveStatus = ok ? 'success' : 'failed';
    } catch (err) {
      console.error('[archive] Failed:', err);
      archiveStatus = 'failed';
    }
  }

  try {
    await addRejectedCandidate(
      ids.candidateId,
      ids.applicationId,
      reason,
      archiveStatus,
      filename.split('__')[0]
    );
  } catch (err) {
    console.error('[rejected] Failed to track:', err);
  }
}

async function runJob(job: AnalyzeJob): Promise<void> {
  const { filename, relPath, absPath, condition, onUpdate } = job;

  try {
    const labels = await readManifestLabels();
    const current = labels.get(filename);

    // Only process pending or in_progress
    if (current && current !== STATUS_PENDING && current !== STATUS_IN_PROGRESS) return;

    await upsertManifestLabel(filename, STATUS_IN_PROGRESS);
    onUpdate?.({ filename, relPath, label: STATUS_IN_PROGRESS });

    const decision = await analyzeResumePdf(absPath, condition);
    const finalLabel: Status = decision.label === STATUS_GOOD_FIT ? STATUS_GOOD_FIT : STATUS_BAD_FIT;

    await upsertManifestLabel(filename, finalLabel);
    onUpdate?.({ filename, relPath, label: finalLabel });
    console.log(`[analysis] ${filename}: ${finalLabel} (${decision.reason})`);

    if (finalLabel === STATUS_BAD_FIT) {
      await trackRejected(filename, 'bad_fit');
    }
  } catch (e) {
    if (e instanceof ScannedPdfError) {
      console.warn(`[analysis] ${filename}: scanned PDF, marking bad_fit`);
      await upsertManifestLabel(filename, STATUS_BAD_FIT);
      onUpdate?.({ filename, relPath, label: STATUS_BAD_FIT });
      await trackRejected(filename, 'scan_failed');
      return;
    }

    console.error('[analysis] Error:', e);
    try {
      await upsertManifestLabel(filename, STATUS_PENDING);
      onUpdate?.({ filename, relPath, label: STATUS_PENDING });
    } catch {
      // Ignore reset errors
    }
  }
}

export function enqueuePdfAnalysis(job: AnalyzeJob): void {
  queue.push(job);
  drain();
}

export function getAnalysisQueueStatus(): { queued: number; running: number; maxConcurrency: number } {
  return { queued: queue.length, running, maxConcurrency: MAX_CONCURRENCY };
}
