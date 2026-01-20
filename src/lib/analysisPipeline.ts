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

const queue: AnalyzeJob[] = [];
let runningCount = 0;

const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.ANALYSIS_MAX_CONCURRENCY ?? '5', 10) || 5
);

function drain() {
  while (runningCount < MAX_CONCURRENCY && queue.length > 0) {
    const job = queue.shift()!;
    runningCount++;
    void runJob(job).finally(() => {
      runningCount--;
      drain();
    });
  }
}

/**
 * Track rejected candidate for "don't re-pull" purposes.
 * NOTE: We NO LONGER delete files here - rejected candidates should stay visible in the UI.
 */
async function trackRejectedCandidate(
  filename: string,
  reason: 'bad_fit' | 'scan_failed'
): Promise<void> {
  const ids = parseIdsFromFilename(filename);
  const candidateId = ids?.candidateId;
  const applicationId = ids?.applicationId;

  // Skip tracking if we can't extract IDs (shouldn't happen with Ashby downloads)
  if (!candidateId || !applicationId) {
    console.warn(`[rejected] Could not extract IDs from filename: ${filename}. Skipping tracking.`);
    return;
  }

  const autoArchiveEnabled = process.env.AUTO_ARCHIVE_REJECTED === 'true';
  let archiveStatus: 'success' | 'failed' | 'skipped' = 'skipped';

  // Try to archive in Ashby (optional - only if AUTO_ARCHIVE_REJECTED is enabled)
  if (autoArchiveEnabled) {
    try {
      const archiveSucceeded = await archiveInAshby(filename);
      archiveStatus = archiveSucceeded ? 'success' : 'failed';
      if (archiveSucceeded) {
        console.log(`[archive] Archived candidate in Ashby: ${filename}`);
      } else {
        console.warn(`[archive] archiveInAshby returned false for: ${filename}`);
      }
    } catch (archiveErr) {
      console.error(`[archive] Failed to archive in Ashby:`, archiveErr);
      archiveStatus = 'failed';
    }
  }

  // Add to rejected tracking so we don't re-pull this candidate
  try {
    await addRejectedCandidate(
      candidateId,
      applicationId,
      reason,
      archiveStatus,
      filename.split('__')[0] // Extract name part
    );
  } catch (trackErr) {
    console.error(`[rejected] Failed to add to rejected list:`, trackErr);
  }
}

async function runJob(job: AnalyzeJob) {
  const { filename, relPath, absPath, condition, onUpdate } = job;
  try {
    const labels = await readManifestLabels();
    const current = labels.get(filename);

    // Only analyze files that are newly discovered (pending) or already in progress.
    // Never overwrite final labels or special statuses.
    const processableStatuses: string[] = [STATUS_PENDING, STATUS_IN_PROGRESS];
    if (current && !processableStatuses.includes(current))
      return;

    await upsertManifestLabel(filename, STATUS_IN_PROGRESS);
    onUpdate?.({ filename, relPath, label: STATUS_IN_PROGRESS });
    console.log(`PDF ${filename} is ${STATUS_IN_PROGRESS} of being analyzed`);

    // LLM workflow (real analysis)
    const decision = await analyzeResumePdf(absPath, condition);

    const finalLabel: Status =
      decision.label === STATUS_GOOD_FIT ? STATUS_GOOD_FIT : STATUS_BAD_FIT;
    
    // Update manifest with the final label (both good_fit and bad_fit)
    await upsertManifestLabel(filename, finalLabel);
    onUpdate?.({ filename, relPath, label: finalLabel });
    console.log(`PDF ${filename} analysis finished: ${finalLabel} (reason: ${decision.reason})`);

    // For bad_fit, also track for "don't re-pull" purposes (but keep the file!)
    if (finalLabel === STATUS_BAD_FIT) {
      await trackRejectedCandidate(filename, 'bad_fit');
    }
  } catch (e) {
    // Check if this is a scanned PDF error
    if (e instanceof ScannedPdfError) {
      console.warn(`[analysis] ${filename} appears to be a scanned/image PDF (only ${e.extractedLength} chars extracted). Marking as bad_fit.`);
      // Mark as bad_fit so it shows in the Rejected column
      await upsertManifestLabel(filename, STATUS_BAD_FIT);
      onUpdate?.({ filename, relPath, label: STATUS_BAD_FIT });
      await trackRejectedCandidate(filename, 'scan_failed');
      return; // Don't retry - it won't work
    }

    console.error('[analysis] job error', e);

    // Don't leave items stuck in "in_progress" forever if analysis fails.
    try {
      await upsertManifestLabel(filename, STATUS_PENDING);
      onUpdate?.({ filename, relPath, label: STATUS_PENDING });
    } catch (e2) {
      console.error('[analysis] failed to reset label after error', e2);
    }
  }
}

export function enqueuePdfAnalysis(job: AnalyzeJob) {
  queue.push(job);
  drain();
}

export function getAnalysisQueueStatus() {
  return {
    queued: queue.length,
    running: runningCount,
    maxConcurrency: MAX_CONCURRENCY,
  };
}
