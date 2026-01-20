import { readBulkManifestLabels, upsertBulkManifestLabel, setCandidateName } from '@/lib/bulkManifest';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_VERY_GOOD,
  STATUS_PERFECT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
  PASSING_STATUSES,
} from '@/lib/labels';
import type { Status } from '@/lib/labels';
import { analyzeResumePdf, ScannedPdfError, type TieredLabel } from '@/lib/llmAnalyzer';

export type BulkAnalyzeUpdate = {
  filename: string;
  relPath: string;
  label: Status;
  candidateName?: string;
};

type BulkAnalyzeJob = {
  filename: string;
  relPath: string;
  absPath: string;
  condition: string;
  onUpdate?: (u: BulkAnalyzeUpdate) => void;
};

// Store queue state in globalThis to persist across Next.js API requests
type BulkQueueState = {
  queue: BulkAnalyzeJob[];
  runningCount: number;
};

function getGlobalState(): BulkQueueState {
  const g = globalThis as unknown as { __sentraBulkQueueState?: BulkQueueState };
  if (!g.__sentraBulkQueueState) {
    g.__sentraBulkQueueState = {
      queue: [],
      runningCount: 0,
    };
  }
  return g.__sentraBulkQueueState;
}

const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.BULK_ANALYSIS_MAX_CONCURRENCY ?? process.env.ANALYSIS_MAX_CONCURRENCY ?? '5', 10) || 5
);

function drain() {
  const state = getGlobalState();
  
  while (state.runningCount < MAX_CONCURRENCY && state.queue.length > 0) {
    const job = state.queue.shift()!;
    state.runningCount++;
    console.log(`[bulk-analysis] Starting job for ${job.filename} (running: ${state.runningCount}, queued: ${state.queue.length})`);
    
    void runJob(job).finally(() => {
      state.runningCount--;
      console.log(`[bulk-analysis] Finished job (running: ${state.runningCount}, queued: ${state.queue.length})`);
      drain();
    });
  }
}

async function runJob(job: BulkAnalyzeJob) {
  const { filename, relPath, absPath, condition, onUpdate } = job;

  // Wrap onUpdate in try-catch to prevent SSE errors from crashing analysis
  const safeOnUpdate = (update: BulkAnalyzeUpdate) => {
    try {
      onUpdate?.(update);
    } catch (err) {
      // SSE notification failed (e.g., client disconnected), but continue processing
      console.warn(`[bulk-analysis] Failed to send SSE update for ${filename}:`, err instanceof Error ? err.message : 'unknown');
    }
  };

  try {
    const labels = await readBulkManifestLabels();
    const current = labels.get(filename);

    // Only analyze files that are pending or in_progress
    const processableStatuses: string[] = [STATUS_PENDING, STATUS_IN_PROGRESS];
    if (current && !processableStatuses.includes(current)) {
      console.log(`[bulk-analysis] Skipping ${filename} - already has label: ${current}`);
      return;
    }

    await upsertBulkManifestLabel(filename, STATUS_IN_PROGRESS);
    safeOnUpdate({ filename, relPath, label: STATUS_IN_PROGRESS });
    console.log(`[bulk-analysis] ${filename} is ${STATUS_IN_PROGRESS}`);

    // LLM analysis with 3-tier classification
    console.log(`[bulk-analysis] Calling OpenAI for ${filename}...`);
    const decision = await analyzeResumePdf(absPath, condition);

    // The analyzer now returns tiered labels: bad_fit, good_fit, very_good, or perfect
    const finalLabel: Status = decision.label as Status;
    
    await upsertBulkManifestLabel(filename, finalLabel);
    
    // Store candidate name for passing candidates
    const isPassing = PASSING_STATUSES.includes(finalLabel as typeof PASSING_STATUSES[number]);
    if (isPassing && decision.candidateName) {
      await setCandidateName(filename, decision.candidateName);
      console.log(`[bulk-analysis] Stored candidate name: ${decision.candidateName}`);
    }
    
    safeOnUpdate({ filename, relPath, label: finalLabel, candidateName: decision.candidateName });
    
    // Log with tier information
    const tierName = finalLabel === STATUS_PERFECT ? 'PERFECT ⭐' :
                     finalLabel === STATUS_VERY_GOOD ? 'VERY GOOD' :
                     finalLabel === STATUS_GOOD_FIT ? 'PASSED' : 'REJECTED';
    const nameInfo = decision.candidateName ? ` (${decision.candidateName})` : '';
    console.log(`[bulk-analysis] ${filename}${nameInfo} finished: ${tierName} (${finalLabel}) - ${decision.reason}`);
  } catch (e) {
    // Handle scanned PDF error
    if (e instanceof ScannedPdfError) {
      console.warn(`[bulk-analysis] ${filename} appears to be a scanned/image PDF. Marking as bad_fit.`);
      await upsertBulkManifestLabel(filename, STATUS_BAD_FIT);
      safeOnUpdate({ filename, relPath, label: STATUS_BAD_FIT });
      return;
    }

    console.error('[bulk-analysis] job error for', filename, ':', e);
    console.error('[bulk-analysis] Error stack:', e instanceof Error ? e.stack : 'no stack');

    // Reset to pending on error
    try {
      await upsertBulkManifestLabel(filename, STATUS_PENDING);
      safeOnUpdate({ filename, relPath, label: STATUS_PENDING });
    } catch (e2) {
      console.error('[bulk-analysis] failed to reset label after error', e2);
    }
  }
}

export function enqueueBulkPdfAnalysis(job: BulkAnalyzeJob) {
  const state = getGlobalState();
  state.queue.push(job);
  console.log(`[bulk-analysis] Enqueued ${job.filename} (total queued: ${state.queue.length})`);
  drain();
}

export function getBulkAnalysisQueueStatus() {
  const state = getGlobalState();
  return {
    queued: state.queue.length,
    running: state.runningCount,
    maxConcurrency: MAX_CONCURRENCY,
  };
}
