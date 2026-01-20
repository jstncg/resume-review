import { resumeWatcher } from '@/lib/resumeWatcher';
import { createSSEStream } from '@/lib/sse';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return createSSEStream(
    resumeWatcher,
    ['added', 'label', 'ready'],
    { type: 'client-greeting' }
  );
}
