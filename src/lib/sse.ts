/**
 * Server-Sent Events Utility
 */

export type SSESubscriber = {
  on: (event: string, callback: (data: unknown) => void) => () => void;
  isReady: () => boolean;
};

/**
 * Create an SSE Response with proper headers and cleanup.
 */
export function createSSEStream(
  subscriber: SSESubscriber,
  events: string[],
  greeting?: { type: string; [key: string]: unknown }
): Response {
  const encoder = new TextEncoder();
  const unsubscribers: (() => void)[] = [];
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribers.forEach(unsub => unsub());
        if (keepAlive) clearInterval(keepAlive);
      };

      // Send greeting
      if (greeting) {
        send(greeting.type, { ...greeting, ready: subscriber.isReady(), ts: Date.now() });
      } else {
        send('connected', { ts: Date.now(), ready: subscriber.isReady() });
      }

      // Subscribe to events
      for (const event of events) {
        const unsub = subscriber.on(event, (data) => send(event, data));
        unsubscribers.push(unsub);
      }

      // Keep-alive ping every 25 seconds
      keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);

      // Store cleanup for cancel
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
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
