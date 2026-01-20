'use client';

import { useEffect, useState, useCallback } from 'react';
import { StageMappingConfig } from './StageMappingConfig';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Job = {
  id: string;
  title: string;
  status: string;
  location: string | null;
  department: string | null;
};

type PullResult = {
  ok: boolean;
  downloaded?: number;
  skipped?: number;
  failed?: number;
  error?: string;
};

type JobsResponse = {
  ok: boolean;
  configured: boolean;
  error?: string;
  jobs: Job[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function AshbyImport() {
  // Job data
  const [jobs, setJobs] = useState<Job[]>([]);
  const [configured, setConfigured] = useState(true);

  // Form state
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [limitInput, setLimitInput] = useState('50'); // Store as string for natural typing
  // Default to Application Review - only pull candidates in this stage
  const [stageTitleFilter, setStageTitleFilter] = useState('Application Review');

  // UI state
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PullResult | null>(null);

  // Rejected candidates state
  const [rejectedCount, setRejectedCount] = useState(0);
  const [clearingRejected, setClearingRejected] = useState(false);

  // ───────────────────────────────────────────────────────────────────────────
  // Persist settings in localStorage
  // ───────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const saved = localStorage.getItem('ashby-import-settings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        if (settings.limitInput) setLimitInput(settings.limitInput);
        else if (settings.limit) setLimitInput(String(settings.limit)); // backwards compat
        if (settings.selectedJobId) setSelectedJobId(settings.selectedJobId);
        if (settings.stageTitleFilter !== undefined) setStageTitleFilter(settings.stageTitleFilter);
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Fetch rejected candidates count on mount
  useEffect(() => {
    fetch('/api/clear-rejected')
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) setRejectedCount(data.count || 0);
      })
      .catch(() => {});
  }, []);

  const handleClearRejected = async () => {
    if (rejectedCount === 0) return;
    const confirmed = window.confirm(
      `Clear ${rejectedCount} previously rejected candidates?\n\nThis allows them to be re-pulled and re-analyzed.`
    );
    if (!confirmed) return;

    setClearingRejected(true);
    try {
      const res = await fetch('/api/clear-rejected', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setRejectedCount(0);
      }
    } catch {
      // Ignore errors
    } finally {
      setClearingRejected(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(
      'ashby-import-settings',
      JSON.stringify({ limitInput, selectedJobId, stageTitleFilter })
    );
    // Notify other components in the same tab about job changes
    window.dispatchEvent(new CustomEvent('ashby-job-changed'));
  }, [limitInput, selectedJobId, stageTitleFilter]);

  // ───────────────────────────────────────────────────────────────────────────
  // Fetch jobs from Ashby
  // ───────────────────────────────────────────────────────────────────────────

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/ashby-jobs');
      const data: JobsResponse = await res.json();

      setConfigured(data.configured);

      if (!data.ok) {
        setError(data.error || 'Failed to fetch jobs');
        setJobs([]);
        return;
      }

      setJobs(data.jobs);

      // Auto-select first job if none selected or selected job not in list
      if (data.jobs.length > 0) {
        const currentValid = data.jobs.some((j) => j.id === selectedJobId);
        if (!selectedJobId || !currentValid) {
          setSelectedJobId(data.jobs[0].id);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [selectedJobId]);

  useEffect(() => {
    fetchJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Pull resumes from Ashby
  // ───────────────────────────────────────────────────────────────────────────

  const handlePull = async () => {
    if (!selectedJobId) return;

    // Parse limit from input (default to 50 if invalid)
    const limit = parseInt(limitInput, 10) || 50;

    // Confirm for large pulls
    if (limit > 100) {
      const confirmed = window.confirm(
        `You're about to pull up to ${limit} resumes. This may take a few minutes. Continue?`
      );
      if (!confirmed) return;
    }

    setPulling(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch('/api/ashby-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: selectedJobId,
          limit,
          dryRun: false,
          // Always pull active (non-archived) candidates only
          onlyStatus: 'Active',
          stageTitleIncludes: stageTitleFilter || undefined,
        }),
      });

      const data: PullResult = await res.json();
      setResult(data);

      if (!data.ok) {
        setError(data.error || 'Pull failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPulling(false);
    }
  };

  const selectedJob = jobs.find((j) => j.id === selectedJobId);

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <section className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            📥 Import from Ashby
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Pull candidate resumes directly from your Ashby jobs
          </p>
        </div>
        <button
          type="button"
          onClick={fetchJobs}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm text-zinc-600 hover:bg-black/[.04] disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-white/[.06]"
        >
          <svg
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Not Configured State */}
      {!configured && (
        <div className="mt-4 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
            Ashby not configured
          </p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
            Add{' '}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs dark:bg-amber-900">
              ASHBY_API_KEY
            </code>{' '}
            to your{' '}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs dark:bg-amber-900">
              .env.local
            </code>{' '}
            file to enable Ashby integration.
          </p>
        </div>
      )}

      {/* Main Form */}
      {configured && !error && (
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          {/* Job Selector */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Select Job
            </label>
            <select
              value={selectedJobId}
              onChange={(e) => setSelectedJobId(e.target.value)}
              disabled={loading || pulling || jobs.length === 0}
              className="mt-1 w-full rounded-xl border border-black/[.12] bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] disabled:opacity-60 dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.20]"
            >
              {jobs.length === 0 ? (
                <option value="">No jobs available</option>
              ) : (
                jobs.map((job) => (
                  <option key={job.id} value={job.id}>
                    {job.title}
                    {job.status !== 'Open' ? ` (${job.status})` : ''}
                  </option>
                ))
              )}
            </select>
            {selectedJob && (
              <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                {selectedJob.department && `${selectedJob.department} • `}
                {selectedJob.location && `${selectedJob.location} • `}
                <code className="font-mono">{selectedJob.id.slice(0, 8)}...</code>
              </p>
            )}
          </div>

          {/* Limit Input */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Max candidates
            </label>
            <input
              type="text"
              inputMode="numeric"
              placeholder="50"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              disabled={pulling}
              className="mt-1 w-full rounded-xl border border-black/[.12] bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] disabled:opacity-60 dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.20]"
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Oldest applicants pulled first
            </p>
          </div>

          {/* Stage Filter */}
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Interview Stage
            </label>
            <input
              type="text"
              placeholder="Application Review"
              value={stageTitleFilter}
              onChange={(e) => setStageTitleFilter(e.target.value)}
              disabled={pulling}
              className="mt-1 w-full rounded-xl border border-black/[.12] bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] disabled:opacity-60 dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.20]"
            />
            <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              Only pulls from this stage
            </p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && configured && (
        <div className="mt-4 rounded-xl bg-red-50 p-4 dark:bg-red-950">
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          <button
            onClick={fetchJobs}
            className="mt-2 text-sm font-medium text-red-800 underline dark:text-red-200"
          >
            Try again
          </button>
        </div>
      )}

      {/* Action Buttons */}
      {configured && jobs.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handlePull}
            disabled={pulling || !selectedJobId || loading}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-emerald-600 px-5 text-sm font-medium text-white transition-all hover:bg-emerald-700 disabled:opacity-60"
          >
            {pulling ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Pulling resumes...
              </>
            ) : (
              <>
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                Pull Resumes
              </>
            )}
          </button>

          {/* Clear Rejected Button */}
          {rejectedCount > 0 && (
            <button
              type="button"
              onClick={handleClearRejected}
              disabled={clearingRejected}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-amber-500 bg-transparent px-4 text-sm font-medium text-amber-600 transition-all hover:bg-amber-50 disabled:opacity-60 dark:text-amber-400 dark:hover:bg-amber-950"
            >
              {clearingRejected ? 'Clearing...' : `Clear ${rejectedCount} rejected`}
            </button>
          )}

          {/* Result Message */}
          {result && (
            <span
              className={`text-sm ${
                result.ok
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {result.ok
                ? `✓ Downloaded ${result.downloaded}, skipped ${result.skipped}${
                    result.failed ? `, failed ${result.failed}` : ''
                  }${result.downloaded && result.downloaded > 0 ? ' — Analysis started automatically' : ''}`
                : `✗ ${result.error}`}
            </span>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && jobs.length === 0 && configured && (
        <div className="mt-5 space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
          <div className="h-10 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
        </div>
      )}
    </section>
  );
}

/**
 * Wrapper component that renders StageMappingConfig with job selection from localStorage.
 * Uses a custom event for same-tab updates since storage events only fire cross-tab.
 */
export function AshbyStageSync() {
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    const getJobId = (): string | null => {
      try {
        const saved = localStorage.getItem('ashby-import-settings');
        return saved ? JSON.parse(saved).selectedJobId || null : null;
      } catch {
        return null;
      }
    };

    // Initial load
    setJobId(getJobId());

    // Listen for cross-tab storage changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'ashby-import-settings') {
        setJobId(getJobId());
      }
    };
    
    // Listen for same-tab custom event (dispatched from AshbyImport)
    const handleCustomEvent = () => setJobId(getJobId());

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('ashby-job-changed', handleCustomEvent);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('ashby-job-changed', handleCustomEvent);
    };
  }, []);

  return <StageMappingConfig selectedJobId={jobId} />;
}
