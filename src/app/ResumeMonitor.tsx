'use client';

import { useEffect, useMemo, useRef, useState, DragEvent } from 'react';
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

// Columns that support drag-and-drop (for dragging items OUT)
const DRAGGABLE_COLUMNS = [STATUS_BAD_FIT, STATUS_GOOD_FIT, 'user_reviewed'];

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
  const [enqueueLoading, setEnqueueLoading] = useState(false);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<string | null>(null);
  const [removedItems, setRemovedItems] = useState<ResumeItem[]>([]);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clearAllLoading, setClearAllLoading] = useState(false);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveResult, setArchiveResult] = useState<string | null>(null);

  // Drag and drop state
  const [draggedItem, setDraggedItem] = useState<ResumeItem | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Extract candidateId from filename pattern: Name__candidateId__applicationId.pdf
  const getCandidateId = (filename: string) => {
    const match = filename.match(/__([a-f0-9-]+)__[a-f0-9-]+\.pdf$/i);
    return match ? match[1] : null;
  };

  // Extract applicationId from filename pattern: Name__candidateId__applicationId.pdf
  const getApplicationId = (filename: string) => {
    const match = filename.match(/__[a-f0-9-]+__([a-f0-9-]+)\.pdf$/i);
    return match ? match[1] : null;
  };

  const getAshbyProfileUrl = (filename: string) => {
    const candidateId = getCandidateId(filename);
    return candidateId
      ? `https://app.ashbyhq.com/candidate-searches/new/right-side/candidates/${candidateId}`
      : null;
  };

  // Sync candidate stage to Ashby when moving to User Reviewed
  const syncStageToAshby = async (applicationId: string, action: 'userReviewed' | 'archived') => {
    try {
      // First get the current stage mapping configuration
      const configRes = await fetch('/api/stage-mappings');
      const configData = await configRes.json();
      
      if (!configData.ok || !configData.config?.mappings?.[action]) {
        // No mapping configured for this action, skip silently
        return { synced: false, reason: 'no_mapping' };
      }

      const { stageId } = configData.config.mappings[action];
      
      // Move the candidate in Ashby
      const moveRes = await fetch('/api/ashby-move-stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, interviewStageId: stageId }),
      });
      
      const moveData = await moveRes.json();
      
      if (!moveData.ok) {
        console.warn('[stage-sync] Failed to move stage in Ashby:', moveData.error);
        return { synced: false, reason: moveData.error };
      }
      
      return { synced: true };
    } catch (err) {
      console.error('[stage-sync] Error syncing to Ashby:', err);
      return { synced: false, reason: err instanceof Error ? err.message : 'Unknown error' };
    }
  };

  const handleRemoveItem = (item: ResumeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // Add to removed list
    setRemovedItems((prev) => [...prev, item]);
    // Remove from items
    setItems((prev) => prev.filter((it) => it.relPath !== item.relPath));
    // Clear any existing timeout
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
    }
    // Auto-clear undo after 10 seconds
    undoTimeoutRef.current = setTimeout(() => {
      setRemovedItems([]);
    }, 10000);
  };

  const handleUndoRemove = () => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
    }
    // Restore all removed items
    setItems((prev) => [...removedItems, ...prev]);
    setRemovedItems([]);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Drag and Drop Handlers
  // ─────────────────────────────────────────────────────────────────────────

  const handleDragStart = (e: DragEvent<HTMLLIElement>, item: ResumeItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', item.relPath);
    // Add drag styling
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

    // Determine the new label based on target column
    let newLabel: string;
    let ashbyAction: 'userReviewed' | 'archived' | null = null;
    
    if (targetColumnLabel === STATUS_BAD_FIT) {
      newLabel = STATUS_BAD_FIT;
      // Moving to rejected - could trigger archived stage sync
      ashbyAction = 'archived';
    } else if (targetColumnLabel === STATUS_GOOD_FIT) {
      newLabel = STATUS_GOOD_FIT;
    } else if (targetColumnLabel === 'user_reviewed') {
      // Keep existing user_reviewed label or create a default one
      if (isUserReviewedLabel(draggedItem.label)) {
        newLabel = draggedItem.label;
      } else {
        newLabel = `${STATUS_USER_REVIEWED_PREFIX}Moved via drag`;
      }
      // Moving to user_reviewed - trigger stage sync
      ashbyAction = 'userReviewed';
    } else {
      return;
    }

    const itemToSync = draggedItem;
    
    // Update the item's label locally (optimistic update)
    setItems((prev) =>
      prev.map((it) =>
        it.relPath === draggedItem.relPath ? { ...it, label: newLabel } : it
      )
    );

    setDraggedItem(null);

    // Sync to Ashby in background if there's an action configured
    if (ashbyAction) {
      const applicationId = getApplicationId(itemToSync.filename);
      if (applicationId) {
        // Don't await - let it run in background
        syncStageToAshby(applicationId, ashbyAction).then((result) => {
          if (result.synced) {
            console.log(`[stage-sync] Synced ${itemToSync.filename} to Ashby (${ashbyAction})`);
          }
        });
      }
    }
  };

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
        title: 'Rejected',
        label: STATUS_BAD_FIT,
        items: grouped[STATUS_BAD_FIT],
        pill: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-200',
        draggable: true,
        droppable: true,
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
        title: 'User Reviewed',
        label: 'user_reviewed',
        items: grouped.user_reviewed,
        pill: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200',
        draggable: true,
        droppable: true,
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
        console.error('Bad SSE label message', e);
      }
    });

    return () => {
      cancelled = true;
      es.close();
      esRef.current = null;
    };
  }, []);

  const triggerAnalysis = async () => {
    setEnqueueLoading(true);
    setEnqueueError(null);
    try {
      const res = await fetch('/api/reconcile', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to enqueue (${res.status})`);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to enqueue analysis.';
      setEnqueueError(message);
    } finally {
      setEnqueueLoading(false);
    }
  };

  const triggerCleanup = async () => {
    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/cleanup', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `Failed to cleanup (${res.status})`);
      }
      const data = await res.json();
      setCleanupResult(`Deleted ${data.deleted} rejected resume${data.deleted === 1 ? '' : 's'}`);
      // Remove deleted items from local state
      setItems((prev) =>
        prev.filter((it) => it.label !== STATUS_BAD_FIT)
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to cleanup';
      setCleanupResult(`Error: ${message}`);
    } finally {
      setCleanupLoading(false);
    }
  };

  const triggerArchiveRejected = async () => {
    const rejectedCount = grouped[STATUS_BAD_FIT].length;
    const confirmed = window.confirm(
      `Archive ${rejectedCount} rejected candidate${rejectedCount === 1 ? '' : 's'} in Ashby?\n\nThis will:\n• Archive them in Ashby\n• Delete local files\n\nContinue?`
    );
    if (!confirmed) return;

    setArchiveLoading(true);
    setArchiveResult(null);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/archive-rejected', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to archive');
      }
      setArchiveResult(`Archived ${data.archived} in Ashby${data.failed > 0 ? `, ${data.failed} failed` : ''}`);
      // Remove archived items from local state
      setItems((prev) =>
        prev.filter((it) => it.label !== STATUS_BAD_FIT)
      );
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to archive';
      setArchiveResult(`Error: ${message}`);
    } finally {
      setArchiveLoading(false);
    }
  };

  const triggerClearAll = async () => {
    const confirmed = window.confirm(
      `⚠️ This will DELETE ALL ${items.length} PDFs and reset the manifest.\n\nThis cannot be undone. Continue?`
    );
    if (!confirmed) return;

    setClearAllLoading(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/clear-all', { method: 'POST' });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || 'Failed to clear all');
      }
      setCleanupResult(`Cleared ${data.deleted} PDFs. Ready for fresh import.`);
      // Clear all items from local state
      setItems([]);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to clear all';
      setCleanupResult(`Error: ${message}`);
    } finally {
      setClearAllLoading(false);
    }
  };

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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to submit review.';
      setReviewError(message);
    } finally {
      setReviewSaving(false);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Render helper for action buttons (Resume, Ashby link, Remove)
  // ─────────────────────────────────────────────────────────────────────────

  const renderActionButtons = (item: ResumeItem, columnLabel: string) => {
    const ashbyUrl = getAshbyProfileUrl(item.filename);
    // All actionable columns
    const actionColumns = [STATUS_BAD_FIT, STATUS_GOOD_FIT, 'user_reviewed'];
    const showActions = actionColumns.includes(columnLabel);
    
    // Resume button: show for Passed and User Reviewed
    const showResume = [STATUS_GOOD_FIT, 'user_reviewed'].includes(columnLabel);
    // Ashby button: show only for User Reviewed (for manual follow-up)
    const showAshby = columnLabel === 'user_reviewed';
    // Remove button: show for all action columns
    const showRemove = showActions;

    if (!showActions) return null;

    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Resume button - opens PDF viewer */}
        {showResume && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPdfTarget(item);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:hover:bg-emerald-900"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Resume
          </button>
        )}
        {/* Ashby button - for User Reviewed only */}
        {showAshby && ashbyUrl && (
          <a
            href={ashbyUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Ashby
          </a>
        )}
        {showRemove && (
          <button
            type="button"
            onClick={(e) => handleRemoveItem(item, e)}
            className="inline-flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Remove
          </button>
        )}
      </div>
    );
  };

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
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={enqueueLoading}
              onClick={triggerAnalysis}
              className="inline-flex h-9 items-center justify-center rounded-full bg-black px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {enqueueLoading ? 'Starting…' : 'Start analysis'}
            </button>
            <button
              type="button"
              disabled={cleanupLoading || grouped[STATUS_BAD_FIT].length === 0}
              onClick={triggerCleanup}
              className="inline-flex h-9 items-center justify-center rounded-full bg-red-600 px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 hover:bg-red-700"
            >
              {cleanupLoading ? 'Deleting…' : `Delete rejected (${grouped[STATUS_BAD_FIT].length})`}
            </button>
            <button
              type="button"
              disabled={archiveLoading || grouped[STATUS_BAD_FIT].length === 0}
              onClick={triggerArchiveRejected}
              className="inline-flex h-9 items-center justify-center rounded-full bg-amber-600 px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 hover:bg-amber-700"
            >
              {archiveLoading ? 'Archiving…' : `Archive in Ashby (${grouped[STATUS_BAD_FIT].length})`}
            </button>
            <button
              type="button"
              disabled={clearAllLoading || items.length === 0}
              onClick={triggerClearAll}
              className="inline-flex h-9 items-center justify-center rounded-full border-2 border-red-600 bg-transparent px-4 text-sm font-medium text-red-600 transition-opacity disabled:opacity-60 hover:bg-red-50 dark:hover:bg-red-950"
            >
              {clearAllLoading ? 'Clearing…' : `Clear All (${items.length})`}
            </button>
            {enqueueError ? (
              <span className="text-xs text-red-600 dark:text-red-400">
                {enqueueError}
              </span>
            ) : cleanupResult ? (
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {cleanupResult}
              </span>
            ) : archiveResult ? (
              <span className="text-xs text-zinc-600 dark:text-zinc-400">
                {archiveResult}
              </span>
            ) : (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">
                Analysis auto-starts after pull. Use &quot;Start analysis&quot; to re-process pending items.
              </span>
            )}
          </div>
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
            Drag cards between Rejected, Passed &amp; User Reviewed
          </p>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
          {columns.map((col) => (
            <div
              key={col.label}
              className={`rounded-2xl border bg-zinc-50 p-3 transition-all dark:bg-zinc-950 ${
                dragOverColumn === col.label && col.droppable
                  ? 'border-2 border-dashed border-blue-400 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-950/30'
                  : 'border-black/[.08] dark:border-white/[.145]'
              }`}
              onDragOver={(e) => col.droppable ? handleDragOver(e, col.label) : undefined}
              onDragLeave={col.droppable ? handleDragLeave : undefined}
              onDrop={(e) => col.droppable ? handleDrop(e, col.label) : undefined}
            >
              <div className="flex items-center justify-between gap-3 px-1">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                    {col.title}
                    {col.draggable && (
                      <span className="ml-1 text-xs font-normal text-zinc-400">
                        ↔
                      </span>
                    )}
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
                  <li className={`rounded-xl border border-dashed p-4 text-center text-xs ${
                    dragOverColumn === col.label && col.droppable
                      ? 'border-blue-400 text-blue-600 dark:border-blue-500 dark:text-blue-400'
                      : 'border-black/[.10] text-zinc-500 dark:border-white/[.14] dark:text-zinc-400'
                  }`}>
                    {dragOverColumn === col.label && col.droppable
                      ? 'Drop here'
                      : 'Empty'}
                  </li>
                ) : (
                  col.items.map((it) => {
                    const candidateName = it.filename.split('__')[0].replace(/_/g, ' ');
                    const isDragging = draggedItem?.relPath === it.relPath;
                    
                    return (
                      <li
                        key={it.relPath}
                        draggable={col.draggable}
                        onDragStart={col.draggable ? (e) => handleDragStart(e, it) : undefined}
                        onDragEnd={col.draggable ? handleDragEnd : undefined}
                        className={`rounded-xl border border-black/[.08] bg-white p-3 text-sm transition-all dark:border-white/[.145] dark:bg-black ${
                          col.draggable
                            ? 'cursor-grab active:cursor-grabbing'
                            : ''
                        } ${
                          col.label === STATUS_GOOD_FIT || col.label === 'user_reviewed'
                            ? 'hover:bg-black/[.02] dark:hover:bg-white/[.04]'
                            : ''
                        } ${
                          isDragging ? 'opacity-50 ring-2 ring-blue-400' : ''
                        }`}
                        onClick={
                          col.label === STATUS_GOOD_FIT
                            ? () => setReviewTarget(it)  // Passed: click opens review modal
                            : col.label === 'user_reviewed'
                            ? () => setPdfTarget(it)     // User Reviewed: click opens PDF
                            : undefined
                        }
                      >
                        <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                          {candidateName || it.filename}
                        </div>
                        <div className="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
                          {it.relPath}
                        </div>
                        {col.label === 'user_reviewed' && (
                          <div className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
                            <span className="font-medium">Review:</span>{' '}
                            <span className="break-words">
                              {getUserReviewText(it.label) || '(empty)'}
                            </span>
                          </div>
                        )}
                        {renderActionButtons(it, col.label)}
                      </li>
                    );
                  })
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

      {/* Undo toast for removed candidates */}
      {removedItems.length > 0 ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
          <div className="flex items-center gap-4 rounded-xl border border-black/[.10] bg-zinc-900 px-5 py-3 shadow-2xl dark:border-white/[.20] dark:bg-zinc-800">
            <span className="text-sm text-white">
              Removed {removedItems.length} candidate{removedItems.length > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={handleUndoRemove}
              className="inline-flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Undo
            </button>
            <button
              type="button"
              onClick={() => setRemovedItems([])}
              className="text-zinc-400 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
