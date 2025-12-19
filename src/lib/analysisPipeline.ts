import { readManifestLabels, upsertManifestLabel } from '@/lib/manifest';
import { STATUS_IN_PROGRESS, STATUS_PENDING } from '@/lib/labels';

type AnalyzeJob = {
  filename: string;
  resolve: (label: string | null) => void;
  reject: (err: unknown) => void;
};

let queue: AnalyzeJob[] = [];
let running = false;

async function runNext() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  try {
    const labels = await readManifestLabels();
    const current = labels.get(job.filename);

    // Only transition pending -> in_progress for new files.
    if (current !== STATUS_PENDING) {
      job.resolve(null);
      return;
    }

    await upsertManifestLabel(job.filename, STATUS_IN_PROGRESS);
    // eslint-disable-next-line no-console
    console.log(`PDF ${job.filename} is in_progress of being analyzed`);
    job.resolve(STATUS_IN_PROGRESS);
  } catch (e) {
    job.reject(e);
  } finally {
    running = false;
    // keep draining
    void runNext();
  }
}

export function enqueuePdfAnalysis(filename: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    queue.push({ filename, resolve, reject });
    void runNext();
  });
}
