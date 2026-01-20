import { bulkResumeWatcher } from '@/lib/bulkWatcher';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let isClosed = false;
      let cleanupCalled = false;

      // Unsubscribe functions
      let offAdded: (() => void) | null = null;
      let offLabel: (() => void) | null = null;

      const cleanup = () => {
        if (cleanupCalled) return;
        cleanupCalled = true;
        isClosed = true;
        offAdded?.();
        offLabel?.();
      };

      const send = (event: string, data: unknown) => {
        if (isClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller is closed, clean up listeners
          cleanup();
        }
      };

      // Send initial connection confirmation
      send('connected', { ts: Date.now() });

      // Subscribe to added events
      offAdded = bulkResumeWatcher.on('added', (evt) => {
        send('added', evt);
      });

      // Subscribe to label events
      offLabel = bulkResumeWatcher.on('label', (evt) => {
        send('label', evt);
      });

      // Store cleanup function for cancel callback
      (controller as unknown as { _cleanup?: () => void })._cleanup = cleanup;
    },
    cancel(controller) {
      const cleanup = (controller as unknown as { _cleanup?: () => void })._cleanup;
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
