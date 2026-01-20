import { bulkResumeWatcher } from '@/lib/bulkWatcher';
import { createSSEStream } from '@/lib/sse';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return createSSEStream(
    bulkResumeWatcher,
    ['added', 'label']
  );
}
