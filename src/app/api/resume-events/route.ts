import { resumeWatcher } from '@/lib/resumeWatcher';
import { readManifestLabels } from '@/lib/manifest';
import path from 'node:path';

export const runtime = 'nodejs';

export async function GET() {
  const encoder = new TextEncoder();

  let unsubscribeAdded: null | (() => void) = null;
  let unsubscribeReady: null | (() => void) = null;
  let keepAlive: null | ReturnType<typeof setInterval> = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown, eventName?: string) => {
        if (eventName) {
          controller.enqueue(encoder.encode(`event: ${eventName}\n`));
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };

      // Initial hello so the client knows it connected
      send(
        {
          type: 'client-greeting',
          ready: resumeWatcher.isReady(),
          ts: Date.now(),
        },
        'client-greeting'
      );

      unsubscribeAdded = resumeWatcher.on('added', (evt) => {
        void (async () => {
          const filename = path.posix.basename(evt.relPath);
          const labels = await readManifestLabels();
          send(
            {
              ...evt,
              filename,
              label: labels.get(filename) ?? null,
            },
            'added'
          );
        })();
      });

      if (!resumeWatcher.isReady()) {
        unsubscribeReady = resumeWatcher.on('ready', () => {
          send({ type: 'ready', ts: Date.now() }, 'ready');
        });
      }

      // Keep the connection from going idle through proxies
      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, 25_000);
    },
    cancel() {
      unsubscribeAdded?.();
      unsubscribeReady?.();
      if (keepAlive) clearInterval(keepAlive);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
