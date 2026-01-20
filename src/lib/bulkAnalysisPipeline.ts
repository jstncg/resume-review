/**
 * Analysis Pipeline for Bulk Upload Flow
 * 
 * Handles queuing, tiered analysis, and candidate name extraction.
 */

import { readBulkManifestLabels, upsertBulkManifestLabel, setCandidateName } from '@/lib/bulkManifest';
import {
  STATUS_BAD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
  PASSING_STATUSES,
} from '@/lib/labels';
import type { Status } from '@/lib/labels';
import { analyzeResumePdf, ScannedPdfError } from '@/lib/llmAnalyzer';

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

// Global queue state (persists across Next.js API requests)
type QueueState = { queue: BulkAnalyzeJob[]; running: number };

function getState(): QueueState {
  const g = globalThis as unknown as { __bulkQueueState?: QueueState };
  if (!g.__bulkQueueState) {
    g.__bulkQueueState = { queue: [], running: 0 };
  }
  return g.__bulkQueueState;
}

const MAX_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.BULK_ANALYSIS_MAX_CONCURRENCY ?? process.env.ANALYSIS_MAX_CONCURRENCY ?? '5', 10) || 5
);

function drain(): void {
  const state = getState();

  while (state.running < MAX_CONCURRENCY && state.queue.length > 0) {
    const job = state.queue.shift()!;
    state.running++;
    console.log(`[bulk] Starting ${job.filename} (running: ${state.running}, queued: ${state.queue.length})`);

    void runJob(job).finally(() => {
      state.running--;
      drain();
    });
  }
}

async function runJob(job: BulkAnalyzeJob): Promise<void> {
  const { filename, relPath, absPath, condition, onUpdate } = job;

  const safeUpdate = (update: BulkAnalyzeUpdate) => {
    try {
      onUpdate?.(update);
    } catch {
      // SSE may have disconnected
    }
  };

  try {
    const labels = await readBulkManifestLabels();
    const current = labels.get(filename);

    if (current && current !== STATUS_PENDING && current !== STATUS_IN_PROGRESS) {
      console.log(`[bulk] Skipping ${filename} - already has label: ${current}`);
      return;
    }

    await upsertBulkManifestLabel(filename, STATUS_IN_PROGRESS);
    safeUpdate({ filename, relPath, label: STATUS_IN_PROGRESS });

    const decision = await analyzeResumePdf(absPath, condition);
    const finalLabel = decision.label as Status;

    await upsertBulkManifestLabel(filename, finalLabel);

    // Store candidate name for passing candidates
    if (PASSING_STATUSES.includes(finalLabel as typeof PASSING_STATUSES[number]) && decision.candidateName) {
      await setCandidateName(filename, decision.candidateName);
    }

    safeUpdate({ filename, relPath, label: finalLabel, candidateName: decision.candidateName });
    console.log(`[bulk] ${filename}: ${finalLabel}${decision.candidateName ? ` (${decision.candidateName})` : ''}`);
  } catch (e) {
    if (e instanceof ScannedPdfError) {
      console.warn(`[bulk] ${filename}: scanned PDF`);
      await upsertBulkManifestLabel(filename, STATUS_BAD_FIT);
      safeUpdate({ filename, relPath, label: STATUS_BAD_FIT });
      return;
    }

    console.error('[bulk] Error:', e);
    try {
      await upsertBulkManifestLabel(filename, STATUS_PENDING);
      safeUpdate({ filename, relPath, label: STATUS_PENDING });
    } catch {
      // Ignore
    }
  }
}

export function enqueueBulkPdfAnalysis(job: BulkAnalyzeJob): void {
  const state = getState();
  state.queue.push(job);
  console.log(`[bulk] Enqueued ${job.filename} (total: ${state.queue.length})`);
  drain();
}

export function getBulkAnalysisQueueStatus(): { queued: number; running: number; maxConcurrency: number } {
  const state = getState();
  return { queued: state.queue.length, running: state.running, maxConcurrency: MAX_CONCURRENCY };
}
