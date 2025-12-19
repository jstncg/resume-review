'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
} from '@/lib/labels';

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

  const grouped = useMemo(() => {
    const buckets = {
      [STATUS_PENDING]: [] as ResumeItem[],
      [STATUS_IN_PROGRESS]: [] as ResumeItem[],
      [STATUS_BAD_FIT]: [] as ResumeItem[],
      [STATUS_GOOD_FIT]: [] as ResumeItem[],
    };

    for (const it of items) {
      const label = it.label ?? STATUS_PENDING;
      if (label === STATUS_IN_PROGRESS) buckets[STATUS_IN_PROGRESS].push(it);
      else if (label === STATUS_BAD_FIT) buckets[STATUS_BAD_FIT].push(it);
      else if (label === STATUS_GOOD_FIT) buckets[STATUS_GOOD_FIT].push(it);
      else buckets[STATUS_PENDING].push(it); // unknown/unlabeled -> New Resume
    }

    return buckets;
  }, [items]);

  const columns = useMemo(
    () => [
      {
        title: 'New Resume',
        label: STATUS_PENDING,
        items: grouped[STATUS_PENDING],
        pill: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
      },
      {
        title: 'Analyzing',
        label: STATUS_IN_PROGRESS,
        items: grouped[STATUS_IN_PROGRESS],
        pill: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
      },
      {
        title: 'Rejected',
        label: STATUS_BAD_FIT,
        items: grouped[STATUS_BAD_FIT],
        pill: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
      },
      {
        title: 'Passed',
        label: STATUS_GOOD_FIT,
        items: grouped[STATUS_GOOD_FIT],
        pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
      },
    ],
    [grouped]
  );

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
            PDFs ({items.length})
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Cards move between columns as labels update
          </p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {columns.map((col) => (
            <div
              key={col.label}
              className="rounded-2xl border border-black/[.08] bg-zinc-50 p-3 dark:border-white/[.145] dark:bg-zinc-950"
            >
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {col.title}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    Label: <code className="font-mono">{col.label}</code>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${col.pill}`}
                >
                  {col.items.length}
                </span>
              </div>

              <ul className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-auto">
                {col.items.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-black/[.10] p-4 text-center text-xs text-zinc-500 dark:border-white/[.14] dark:text-zinc-400">
                    Empty
                  </li>
                ) : (
                  col.items.map((it) => (
                    <li
                      key={it.relPath}
                      className="rounded-xl border border-black/[.08] bg-white p-3 text-sm dark:border-white/[.145] dark:bg-black"
                    >
                      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {it.filename}
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {it.relPath}
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
