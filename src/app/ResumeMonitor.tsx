'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
  STATUS_USER_REVIEWED_PREFIX,
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

function isUserReviewedLabel(label: string | null): label is string {
  return (
    typeof label === 'string' && label.startsWith(STATUS_USER_REVIEWED_PREFIX)
  );
}

function getUserReviewText(label: string | null) {
  if (!isUserReviewedLabel(label)) return null;
  return label.slice(STATUS_USER_REVIEWED_PREFIX.length);
}

export function ResumeMonitor() {
  const [dir, setDir] = useState<string>('');
  const [items, setItems] = useState<ResumeItem[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const esRef = useRef<EventSource | null>(null);
  const [reviewTarget, setReviewTarget] = useState<ResumeItem | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [pdfTarget, setPdfTarget] = useState<ResumeItem | null>(null);

  const {
    register: registerReview,
    handleSubmit: handleSubmitReview,
    reset: resetReview,
    watch: watchReview,
    formState: reviewFormState,
  } = useForm<{ review: string }>({ defaultValues: { review: '' } });

  const grouped = useMemo(() => {
    const buckets = {
      [STATUS_PENDING]: [] as ResumeItem[],
      [STATUS_IN_PROGRESS]: [] as ResumeItem[],
      [STATUS_BAD_FIT]: [] as ResumeItem[],
      [STATUS_GOOD_FIT]: [] as ResumeItem[],
      user_reviewed: [] as ResumeItem[],
    };

    for (const it of items) {
      const label = it.label ?? STATUS_PENDING;
      if (isUserReviewedLabel(label)) buckets.user_reviewed.push(it);
      else if (label === STATUS_IN_PROGRESS)
        buckets[STATUS_IN_PROGRESS].push(it);
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
      {
        title: 'User Reviewed',
        label: 'user_reviewed',
        items: grouped.user_reviewed,
        pill: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200',
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

  useEffect(() => {
    if (!reviewTarget) return;
    setReviewError(null);
    resetReview({ review: '' });
  }, [reviewTarget, resetReview]);

  useEffect(() => {
    if (!pdfTarget) return;
    // close review modal if open
    setReviewTarget(null);
  }, [pdfTarget]);

  const onSubmitReview = handleSubmitReview(async (values) => {
    if (!reviewTarget) return;
    setReviewSaving(true);
    setReviewError(null);
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: reviewTarget.filename,
          relPath: reviewTarget.relPath,
          review: values.review,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to submit review (${res.status})`);
      }
      setReviewTarget(null);
    } catch (e: any) {
      setReviewError(e?.message || 'Failed to submit review.');
    } finally {
      setReviewSaving(false);
    }
  });

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

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
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
                      className={`rounded-xl border border-black/[.08] bg-white p-3 text-sm dark:border-white/[.145] dark:bg-black ${
                        col.label === STATUS_GOOD_FIT ||
                        col.label === 'user_reviewed'
                          ? 'cursor-pointer hover:bg-black/[.02] dark:hover:bg-white/[.04]'
                          : ''
                      }`}
                      onClick={
                        col.label === STATUS_GOOD_FIT
                          ? () => setReviewTarget(it)
                          : col.label === 'user_reviewed'
                          ? () => setPdfTarget(it)
                          : undefined
                      }
                    >
                      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                        {it.filename}
                      </div>
                      <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {it.relPath}
                      </div>
                      {col.label === 'user_reviewed' ? (
                        <div className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
                          <span className="font-medium">Review:</span>{' '}
                          <span className="break-words">
                            {getUserReviewText(it.label) || '(empty)'}
                          </span>
                        </div>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {reviewTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => (reviewSaving ? null : setReviewTarget(null))}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-black/[.10] bg-white p-6 shadow-xl dark:border-white/[.145] dark:bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-black dark:text-zinc-50">
                  Submit review
                </h3>
                <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                  {reviewTarget.filename}
                </p>
              </div>
              <button
                type="button"
                disabled={reviewSaving}
                className="rounded-full px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/[.06]"
                onClick={() => setReviewTarget(null)}
              >
                Close
              </button>
            </div>

            <form
              onSubmit={onSubmitReview}
              className="mt-4 flex flex-col gap-3"
            >
              <textarea
                className="min-h-[110px] w-full resize-y rounded-xl border border-black/[.12] bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.18]"
                placeholder="Write a short review…"
                {...registerReview('review', {
                  required: true,
                  maxLength: 255,
                  validate: (v) => v.trim().length > 0,
                })}
              />
              <div className="flex items-center justify-between gap-4">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {reviewError ? (
                    <span className="text-red-600 dark:text-red-400">
                      {reviewError}
                    </span>
                  ) : reviewFormState.errors.review?.type === 'required' ||
                    reviewFormState.errors.review?.type === 'validate' ? (
                    <span className="text-red-600 dark:text-red-400">
                      Review is required.
                    </span>
                  ) : reviewFormState.errors.review?.type === 'maxLength' ? (
                    <span className="text-red-600 dark:text-red-400">
                      Review must be ≤ 255 characters.
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {(watchReview('review') || '').length}/255
                  </span>
                  <button
                    type="submit"
                    disabled={reviewSaving}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-black px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 dark:bg-white dark:text-black"
                  >
                    {reviewSaving ? 'Submitting…' : 'Submit review'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {pdfTarget ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setPdfTarget(null)}
        >
          <div
            className="w-full max-w-6xl rounded-2xl border border-black/[.10] bg-white p-6 shadow-xl dark:border-white/[.145] dark:bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <h3 className="truncate text-lg font-semibold text-black dark:text-zinc-50">
                  View PDF
                </h3>
                <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                  {pdfTarget.filename}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Review: {getUserReviewText(pdfTarget.label) || '(empty)'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className="rounded-full px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                  href={`/api/resume-pdf?filename=${encodeURIComponent(
                    pdfTarget.filename
                  )}&download=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
                <button
                  type="button"
                  className="rounded-full px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                  onClick={() => setPdfTarget(null)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="mt-4 h-[75vh] overflow-hidden rounded-xl border border-black/[.08] bg-zinc-50 dark:border-white/[.145] dark:bg-zinc-950">
              <iframe
                title={pdfTarget.filename}
                className="h-full w-full"
                src={`/api/resume-pdf?filename=${encodeURIComponent(
                  pdfTarget.filename
                )}`}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
