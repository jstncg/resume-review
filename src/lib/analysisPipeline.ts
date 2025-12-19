import { readManifestLabels, upsertManifestLabel } from '@/lib/manifest';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
} from '@/lib/labels';
import type { Status } from '@/lib/labels';
import { analyzeResumePdf } from '@/lib/llmAnalyzer';

export type AnalyzeUpdate = {
  filename: string;
  relPath: string;
  label: Status;
};

type AnalyzeJob = {
  filename: string;
  relPath: string;
  absPath: string;
  onUpdate?: (u: AnalyzeUpdate) => void;
};

let queue: AnalyzeJob[] = [];
let runningCount = 0;

const MAX_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.ANALYSIS_MAX_CONCURRENCY ?? '2', 10) || 2
);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function runJob(job: AnalyzeJob) {
  const { filename, relPath, absPath, onUpdate } = job;
  try {
    const labels = await readManifestLabels();
    const current = labels.get(filename);

    // Only analyze files that are newly discovered (pending) or already in progress.
    // Never overwrite final labels.
    if (current && current !== STATUS_PENDING && current !== STATUS_IN_PROGRESS)
      return;

    await upsertManifestLabel(filename, STATUS_IN_PROGRESS);
    onUpdate?.({ filename, relPath, label: STATUS_IN_PROGRESS });
    // eslint-disable-next-line no-console
    console.log(`PDF ${filename} is ${STATUS_IN_PROGRESS} of being analyzed`);

    // LLM workflow (real analysis)
    const decision = await analyzeResumePdf(absPath);

    // Requirement: pop out after 3 seconds (simulate pipeline duration / pacing)
    await sleep(3000);

    const finalLabel: Status =
      decision.label === STATUS_GOOD_FIT ? STATUS_GOOD_FIT : STATUS_BAD_FIT;
    await upsertManifestLabel(filename, finalLabel);
    onUpdate?.({ filename, relPath, label: finalLabel });
    // eslint-disable-next-line no-console
    console.log(
      `PDF ${filename} analysis finished: ${finalLabel} (reason: ${decision.reason})`
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[analysis] job error', e);
  }
}

export function enqueuePdfAnalysis(job: AnalyzeJob) {
  queue.push(job);
  drain();
}
