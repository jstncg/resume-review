'use client';

import { useEffect, useMemo, useRef, useState, DragEvent } from 'react';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_VERY_GOOD,
  STATUS_PERFECT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
} from '@/lib/labels';

type ResumeItem = {
  filename: string;
  relPath: string;
  label: string | null;
  candidateName?: string | null;
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
  candidateName?: string | null;
  ts: number;
};

type LabelEvent = {
  type: 'label';
  filename: string;
  relPath: string;
  label: string | null;
  candidateName?: string | null;
  ts: number;
};

// Passing labels that should show candidate names
const PASSING_LABELS: string[] = [STATUS_GOOD_FIT, STATUS_VERY_GOOD, STATUS_PERFECT];

// All columns that support drag-and-drop between them
const DRAGGABLE_COLUMNS: string[] = [STATUS_BAD_FIT, STATUS_GOOD_FIT, STATUS_VERY_GOOD, STATUS_PERFECT];

type BulkResumeMonitorProps = {
  onStatsChange?: (stats: {
    pending: number;
    inProgress: number;
    passed: number;
    veryGood: number;
    perfect: number;
    rejected: number;
  }) => void;
};

export function BulkResumeMonitor({ onStatsChange }: BulkResumeMonitorProps) {
  const [dir, setDir] = useState<string>('');
  const [items, setItems] = useState<ResumeItem[]>([]);
  const [connected, setConnected] = useState<boolean>(false);
  const esRef = useRef<EventSource | null>(null);
  const [pdfTarget, setPdfTarget] = useState<ResumeItem | null>(null);

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<ResumeItem | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const buckets = {
      [STATUS_PENDING]: [] as ResumeItem[],
      [STATUS_IN_PROGRESS]: [] as ResumeItem[],
      [STATUS_BAD_FIT]: [] as ResumeItem[],
      [STATUS_GOOD_FIT]: [] as ResumeItem[],
      [STATUS_VERY_GOOD]: [] as ResumeItem[],
      [STATUS_PERFECT]: [] as ResumeItem[],
    };

    for (const it of items) {
      const label = it.label ?? STATUS_PENDING;
      if (label === STATUS_IN_PROGRESS) buckets[STATUS_IN_PROGRESS].push(it);
      else if (label === STATUS_BAD_FIT) buckets[STATUS_BAD_FIT].push(it);
      else if (label === STATUS_GOOD_FIT) buckets[STATUS_GOOD_FIT].push(it);
      else if (label === STATUS_VERY_GOOD) buckets[STATUS_VERY_GOOD].push(it);
      else if (label === STATUS_PERFECT) buckets[STATUS_PERFECT].push(it);
      else buckets[STATUS_PENDING].push(it);
    }

    return buckets;
  }, [items]);

  // Report stats to parent
  useEffect(() => {
    onStatsChange?.({
      pending: grouped[STATUS_PENDING].length,
      inProgress: grouped[STATUS_IN_PROGRESS].length,
      passed: grouped[STATUS_GOOD_FIT].length,
      veryGood: grouped[STATUS_VERY_GOOD].length,
      perfect: grouped[STATUS_PERFECT].length,
      rejected: grouped[STATUS_BAD_FIT].length,
    });
  }, [grouped, onStatsChange]);

  const columns = useMemo(
    () => [
      {
        title: 'Queued',
        label: STATUS_PENDING,
        items: grouped[STATUS_PENDING],
        pill: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300',
        draggable: false,
        droppable: false,
      },
      {
        title: 'Analyzing',
        label: STATUS_IN_PROGRESS,
        items: grouped[STATUS_IN_PROGRESS],
        pill: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
        draggable: false,
        droppable: false,
      },
      {
        title: 'Passed',
        label: STATUS_GOOD_FIT,
        items: grouped[STATUS_GOOD_FIT],
        pill: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200',
        draggable: true,
        droppable: true,
      },
      {
        title: 'Very Good',
        label: STATUS_VERY_GOOD,
        items: grouped[STATUS_VERY_GOOD],
        pill: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200',
        draggable: true,
        droppable: true,
      },
      {
        title: 'Perfect ⭐',
        label: STATUS_PERFECT,
        items: grouped[STATUS_PERFECT],
        pill: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-200',
        draggable: true,
        droppable: true,
      },
      {
        title: 'Rejected',
        label: STATUS_BAD_FIT,
        items: grouped[STATUS_BAD_FIT],
        pill: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
        draggable: true,
        droppable: true,
      },
    ],
    [grouped]
  );

  // Load initial data and set up SSE
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const res = await fetch('/api/bulk-resumes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load resumes: ${res.status}`);
      const json = (await res.json()) as ResumeListResponse;
      if (cancelled) return;
      setDir(json.dir);
      setItems(json.items);
    };

    load().catch((e) => {
      console.error(e);
    });

    const es = new EventSource('/api/bulk-events');
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
                  candidateName: evt.candidateName,
                },
                ...prev,
              ]
        );
      } catch (e) {
        console.error('Bad SSE message', e);
      }
    });

    es.addEventListener('label', (msg) => {
      try {
        const evt = JSON.parse((msg as MessageEvent).data) as LabelEvent;
        if (!evt?.relPath || !evt?.filename) return;
        setItems((prev) =>
          prev.map((it) =>
            it.relPath === evt.relPath 
              ? { ...it, label: evt.label, candidateName: evt.candidateName ?? it.candidateName } 
              : it
          )
        );
      } catch (e) {
        console.error('Bad SSE label message', e);
      }
    });

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  // Drag and Drop Handlers
  const handleDragStart = (e: DragEvent<HTMLLIElement>, item: ResumeItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.relPath);
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '0.5';
    }
  };

  const handleDragEnd = (e: DragEvent<HTMLLIElement>) => {
    setDraggedItem(null);
    setDragOverColumn(null);
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '1';
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, columnLabel: string) => {
    e.preventDefault();
    if (DRAGGABLE_COLUMNS.includes(columnLabel)) {
      e.dataTransfer.dropEffect = 'move';
      setDragOverColumn(columnLabel);
    }
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>, targetColumnLabel: string) => {
    e.preventDefault();
    setDragOverColumn(null);

    if (!draggedItem || !DRAGGABLE_COLUMNS.includes(targetColumnLabel)) {
      return;
    }

    // Update locally (optimistic)
    setItems((prev) =>
      prev.map((it) =>
        it.relPath === draggedItem.relPath ? { ...it, label: targetColumnLabel } : it
      )
    );

    setDraggedItem(null);
  };

  // Extract display name from filename
  const getDisplayName = (filename: string) => {
    // Remove .pdf extension
    const withoutExt = filename.replace(/\.pdf$/i, '');
    // Replace underscores with spaces
    return withoutExt.replace(/_/g, ' ');
  };

  // Get status display info
  const getStatusDisplay = (label: string | null) => {
    switch (label) {
      case STATUS_PERFECT:
        return { text: 'Perfect ⭐', className: 'text-purple-600 dark:text-purple-400' };
      case STATUS_VERY_GOOD:
        return { text: 'Very Good', className: 'text-blue-600 dark:text-blue-400' };
      case STATUS_GOOD_FIT:
        return { text: 'Passed', className: 'text-emerald-600 dark:text-emerald-400' };
      case STATUS_BAD_FIT:
        return { text: 'Rejected', className: 'text-red-600 dark:text-red-400' };
      case STATUS_IN_PROGRESS:
        return { text: 'Analyzing...', className: 'text-amber-600 dark:text-amber-400' };
      default:
        return { text: 'Pending', className: 'text-zinc-600 dark:text-zinc-400' };
    }
  };

  if (items.length === 0) {
    return (
      <div className="w-full rounded-2xl border border-black/[.08] bg-white p-8 text-center dark:border-white/[.145] dark:bg-black">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-900">
          <svg
            className="h-8 w-8 text-zinc-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          No resumes uploaded yet
        </h3>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Drag and drop PDF files above to get started
        </p>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50">
            Results ({items.length} resumes)
          </h3>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {dir || 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Drag cards between tiers
          </span>
          <div
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              connected
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200'
                : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
            }`}
          >
            {connected ? 'live' : 'offline'}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {columns.map((col) => (
          <div
            key={col.label}
            className={`rounded-2xl border bg-zinc-50 p-3 transition-all dark:bg-zinc-950 ${
              dragOverColumn === col.label && col.droppable
                ? 'border-2 border-dashed border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
                : 'border-black/[.08] dark:border-white/[.145]'
            }`}
            onDragOver={(e) => (col.droppable ? handleDragOver(e, col.label) : undefined)}
            onDragLeave={col.droppable ? handleDragLeave : undefined}
            onDrop={(e) => (col.droppable ? handleDrop(e, col.label) : undefined)}
          >
            <div className="flex items-center justify-between gap-3 px-1">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {col.title}
                  {col.draggable && (
                    <span className="ml-1 text-xs font-normal text-zinc-400">↔</span>
                  )}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${col.pill}`}
              >
                {col.items.length}
              </span>
            </div>

            <ul className="mt-3 flex max-h-[400px] flex-col gap-2 overflow-auto">
              {col.items.length === 0 ? (
                <li
                  className={`rounded-xl border border-dashed p-4 text-center text-xs ${
                    dragOverColumn === col.label && col.droppable
                      ? 'border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400'
                      : 'border-black/[.10] text-zinc-500 dark:border-white/[.14] dark:text-zinc-400'
                  }`}
                >
                  {dragOverColumn === col.label && col.droppable ? 'Drop here' : 'Empty'}
                </li>
              ) : (
                col.items.map((it) => {
                  const displayName = getDisplayName(it.filename);
                  const isDragging = draggedItem?.relPath === it.relPath;
                  const isPassing = it.label && PASSING_LABELS.includes(it.label);
                  const showName = isPassing && it.candidateName && it.candidateName !== 'Unknown';

                  return (
                    <li
                      key={it.relPath}
                      draggable={col.draggable}
                      onDragStart={col.draggable ? (e) => handleDragStart(e, it) : undefined}
                      onDragEnd={col.draggable ? handleDragEnd : undefined}
                      onClick={() => setPdfTarget(it)}
                      className={`rounded-xl border border-black/[.08] bg-white p-3 text-sm transition-all dark:border-white/[.145] dark:bg-black ${
                        col.draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                      } hover:bg-black/[.02] dark:hover:bg-white/[.04] ${
                        isDragging ? 'opacity-50 ring-2 ring-blue-400' : ''
                      }`}
                    >
                      {showName ? (
                        <>
                          <div className="truncate font-semibold text-zinc-900 dark:text-zinc-100">
                            {it.candidateName}
                          </div>
                          <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {it.filename}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                            {displayName}
                          </div>
                          <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                            {it.filename}
                          </div>
                        </>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ))}
      </div>

      {/* PDF Viewer Modal */}
      {pdfTarget && (
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
                  {pdfTarget.candidateName && pdfTarget.candidateName !== 'Unknown' 
                    ? pdfTarget.candidateName 
                    : 'View PDF'}
                </h3>
                <p className="mt-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
                  {pdfTarget.filename}
                </p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Status:{' '}
                  <span className={getStatusDisplay(pdfTarget.label).className}>
                    {getStatusDisplay(pdfTarget.label).text}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  className="rounded-full px-3 py-1 text-sm text-zinc-600 hover:bg-black/[.04] dark:text-zinc-300 dark:hover:bg-white/[.06]"
                  href={`/api/bulk-pdf?filename=${encodeURIComponent(pdfTarget.filename)}&download=1`}
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
                src={`/api/bulk-pdf?filename=${encodeURIComponent(pdfTarget.filename)}`}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
