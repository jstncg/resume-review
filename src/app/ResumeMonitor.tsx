'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type ResumeItem = {
  filename: string;
  relPath: string;
  label: string | null;
};

type ResumeListResponse = {
  dir: string;
  items: ResumeItem[];
};

type AddedEvent = {
  type: 'added';
  filename: string;
  relPath: string;
  label: string | null;
  ts: number;
};

type LabelEvent = {
  type: 'label';
  filename: string;
  relPath: string;
  label: string | null;
  ts: number;
};

export function ResumeMonitor() {
  const [dir, setDir] = useState<string>('');
  const [items, setItems] = useState<ResumeItem[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const esRef = useRef<EventSource | null>(null);

  const countLabel = useMemo(() => `PDFs (${items.length})`, [items.length]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await fetch('/api/resumes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load resumes: ${res.status}`);
      const json = (await res.json()) as ResumeListResponse;
      if (cancelled) return;
      setDir(json.dir);
      setItems(json.items);
    };

    load().catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e);
    });

    const es = new EventSource('/api/resume-events');
    esRef.current = es;

    es.addEventListener('open', () => setConnected(true));
    es.addEventListener('error', () => setConnected(false));

    es.addEventListener('added', (msg) => {
      try {
        const evt = JSON.parse((msg as MessageEvent).data) as AddedEvent;
        if (!evt?.relPath || !evt?.filename) return;
        setItems((prev) =>
          prev.some((x) => x.relPath === evt.relPath)
            ? prev
            : [
                {
                  filename: evt.filename,
                  relPath: evt.relPath,
                  label: evt.label,
                },
                ...prev,
              ]
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Bad SSE message', e);
      }
    });

    es.addEventListener('label', (msg) => {
      try {
        const evt = JSON.parse((msg as MessageEvent).data) as LabelEvent;
        if (!evt?.relPath || !evt?.filename) return;
        setItems((prev) =>
          prev.map((it) =>
            it.relPath === evt.relPath ? { ...it, label: evt.label } : it
          )
        );
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Bad SSE label message', e);
      }
    });

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  return (
    <section className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            Live resume directory
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {dir || 'Loading...'}
          </p>
        </div>
        <div
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            connected
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
          }`}
        >
          {connected ? 'connected' : 'disconnected'}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {countLabel}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            New files appear instantly
          </p>
        </div>

        <ul className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-black/[.08] bg-zinc-50 p-3 text-sm dark:border-white/[.145] dark:bg-zinc-950">
          {items.length === 0 ? (
            <li className="py-6 text-center text-zinc-500 dark:text-zinc-400">
              No PDFs found.
            </li>
          ) : (
            items.map((it) => (
              <li
                key={it.relPath}
                className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-black/[.04] dark:hover:bg-white/[.06]"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                    {it.filename}
                  </div>
                  <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                    {it.relPath}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-black/[.06] px-2 py-1 text-xs font-medium text-zinc-800 dark:bg-white/[.10] dark:text-zinc-200">
                  {it.label ?? 'unlabeled'}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </section>
  );
}
