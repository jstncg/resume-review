'use client';

import { useState, useCallback, useEffect } from 'react';
import { BulkDropZone } from './BulkDropZone';
import { BulkConditionForm } from './BulkConditionForm';
import { BulkResumeMonitor } from './BulkResumeMonitor';

type Stats = {
  pending: number;
  inProgress: number;
  passed: number;
  veryGood: number;
  perfect: number;
  rejected: number;
};

export function BulkUploadTab() {
  const [stats, setStats] = useState<Stats>({
    pending: 0,
    inProgress: 0,
    passed: 0,
    veryGood: 0,
    perfect: 0,
    rejected: 0,
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeResult, setAnalyzeResult] = useState<string | null>(null);
  const [clearLoading, setClearLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [extractNamesLoading, setExtractNamesLoading] = useState(false);
  const [pdfExportLoading, setPdfExportLoading] = useState(false);
  const [namesNeedExtraction, setNamesNeedExtraction] = useState(0);

  // Refresh data when uploads complete
  const handleUploadComplete = useCallback(() => {
    // The SSE connection should automatically update the monitor
    // But we can force a refresh if needed
  }, []);

  const handleStatsChange = useCallback((newStats: Stats) => {
    setStats(newStats);
    // If we have items in_progress, we're still analyzing
    setIsAnalyzing(newStats.inProgress > 0);
  }, []);

  // Check how many names need extraction
  const checkNamesStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bulk-extract-names');
      const data = await res.json();
      if (data.ok) {
        setNamesNeedExtraction(data.needsExtraction);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Check names status when stats change
  useEffect(() => {
    const totalPassed = stats.passed + stats.veryGood + stats.perfect;
    if (totalPassed > 0) {
      checkNamesStatus();
    }
  }, [stats.passed, stats.veryGood, stats.perfect, checkNamesStatus]);

  const handleAnalyzeAll = async (condition: string) => {
    setIsAnalyzing(true);
    setAnalyzeResult(null);

    try {
      const res = await fetch('/api/bulk-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ condition }),
      });

      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAnalyzeResult(`Started analysis for ${data.enqueued} resumes`);
    } catch (err) {
      setAnalyzeResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setIsAnalyzing(false);
    }
  };

  const handleClearAll = async () => {
    const total = stats.pending + stats.inProgress + stats.passed + stats.veryGood + stats.perfect + stats.rejected;
    const confirmed = window.confirm(
      `⚠️ This will DELETE ALL ${total} uploaded PDFs.\n\nThis cannot be undone. Continue?`
    );
    if (!confirmed) return;

    setClearLoading(true);
    try {
      const res = await fetch('/api/bulk-clear', { method: 'POST' });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Clear failed');
      }

      // Force page refresh to reset state
      window.location.reload();
    } catch (err) {
      alert(`Failed to clear: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setClearLoading(false);
    }
  };

  const handleExportPassed = async () => {
    setExportLoading(true);
    try {
      const res = await fetch('/api/bulk-resumes');
      const data = await res.json();

      if (!data.items) {
        throw new Error('No data to export');
      }

      // Export all passing tiers with their tier labels
      const passingLabels = ['good_fit', 'very_good', 'perfect'];
      const passedItems = data.items.filter(
        (item: { label: string }) => passingLabels.includes(item.label)
      );

      if (passedItems.length === 0) {
        alert('No passed resumes to export');
        return;
      }

      // Create CSV content with tier and candidate name information
      const getTierName = (label: string) => {
        switch (label) {
          case 'perfect': return 'Perfect';
          case 'very_good': return 'Very Good';
          case 'good_fit': return 'Passed';
          default: return label;
        }
      };

      const csvContent = [
        'name,tier,label,filename',
        ...passedItems.map((item: { filename: string; label: string; candidateName?: string }) => 
          `"${item.candidateName || 'Unknown'}","${getTierName(item.label)}","${item.label}","${item.filename}"`
        ),
      ].join('\n');

      // Download
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `passed-candidates-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExportLoading(false);
    }
  };

  const handleDownloadPdfs = async () => {
    setDownloadLoading(true);
    try {
      const res = await fetch('/api/bulk-download');
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Download failed');
      }

      // Get the blob and create download link
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `passed-candidates-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Download failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleExtractNames = async () => {
    setExtractNamesLoading(true);
    try {
      const res = await fetch('/api/bulk-extract-names', { method: 'POST' });
      const data = await res.json();

      if (!data.ok) {
        throw new Error(data.error || 'Name extraction failed');
      }

      alert(`Successfully extracted ${data.extracted} names${data.failed > 0 ? ` (${data.failed} failed)` : ''}`);
      
      // Refresh the page to show updated names
      window.location.reload();
    } catch (err) {
      alert(`Name extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setExtractNamesLoading(false);
    }
  };

  const handleExportNamesPdf = async () => {
    setPdfExportLoading(true);
    try {
      const res = await fetch('/api/bulk-names-pdf');
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'PDF export failed');
      }

      // Get the blob and create download link
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `passed-candidates-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`PDF export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setPdfExportLoading(false);
    }
  };

  const totalResumes = stats.pending + stats.inProgress + stats.passed + stats.veryGood + stats.perfect + stats.rejected;
  const totalPassed = stats.passed + stats.veryGood + stats.perfect;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Section */}
      <section className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
              📁 Bulk Resume Upload
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Upload multiple PDF resumes at once, analyze them with AI, and review results in 3 tiers
            </p>
          </div>

          {/* Stats badges */}
          {totalResumes > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {stats.pending > 0 && (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {stats.pending} queued
                </span>
              )}
              {stats.inProgress > 0 && (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  {stats.inProgress} analyzing
                </span>
              )}
              {stats.perfect > 0 && (
                <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                  {stats.perfect} perfect ⭐
                </span>
              )}
              {stats.veryGood > 0 && (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  {stats.veryGood} very good
                </span>
              )}
              {stats.passed > 0 && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {stats.passed} passed
                </span>
              )}
              {stats.rejected > 0 && (
                <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                  {stats.rejected} rejected
                </span>
              )}
            </div>
          )}
        </div>

        {/* Drop Zone */}
        <div className="mt-5">
          <BulkDropZone onUploadComplete={handleUploadComplete} />
        </div>

        {/* Action buttons */}
        {totalResumes > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-black/[.06] pt-5 dark:border-white/[.1]">
            <button
              type="button"
              onClick={handleDownloadPdfs}
              disabled={downloadLoading || totalPassed === 0}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-purple-500 bg-transparent px-4 text-sm font-medium text-purple-600 transition-opacity hover:bg-purple-50 disabled:opacity-60 dark:text-purple-400 dark:hover:bg-purple-950"
            >
              {downloadLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Creating ZIP...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                    />
                  </svg>
                  Download PDFs ({totalPassed})
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleExportPassed}
              disabled={exportLoading || totalPassed === 0}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-emerald-500 bg-transparent px-4 text-sm font-medium text-emerald-600 transition-opacity hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-400 dark:hover:bg-emerald-950"
            >
              {exportLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Export CSV ({totalPassed})
                </>
              )}
            </button>

            {/* Extract Names button - only show if there are names to extract */}
            {namesNeedExtraction > 0 && (
              <button
                type="button"
                onClick={handleExtractNames}
                disabled={extractNamesLoading}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-amber-500 bg-amber-50 px-4 text-sm font-medium text-amber-700 transition-opacity hover:bg-amber-100 disabled:opacity-60 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
              >
                {extractNamesLoading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Extracting Names...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    Extract Names ({namesNeedExtraction})
                  </>
                )}
              </button>
            )}

            {/* Export Names PDF button */}
            <button
              type="button"
              onClick={handleExportNamesPdf}
              disabled={pdfExportLoading || totalPassed === 0}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-blue-500 bg-transparent px-4 text-sm font-medium text-blue-600 transition-opacity hover:bg-blue-50 disabled:opacity-60 dark:text-blue-400 dark:hover:bg-blue-950"
            >
              {pdfExportLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Generating PDF...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  Names PDF
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleClearAll}
              disabled={clearLoading}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-red-500 bg-transparent px-4 text-sm font-medium text-red-600 transition-opacity hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950"
            >
              {clearLoading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Clearing...
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Clear All ({totalResumes})
                </>
              )}
            </button>

            {analyzeResult && (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">{analyzeResult}</span>
            )}
          </div>
        )}
      </section>

      {/* Tier Legend */}
      <section className="w-full rounded-2xl border border-black/[.08] bg-white p-4 dark:border-white/[.145] dark:bg-black">
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Classification Tiers:</span>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            <span className="text-zinc-600 dark:text-zinc-400">Passed - Meets criteria</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-blue-500" />
            <span className="text-zinc-600 dark:text-zinc-400">Very Good - Exceeds expectations</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-purple-500" />
            <span className="text-zinc-600 dark:text-zinc-400">Perfect ⭐ - Elite (top 1%)</span>
          </div>
        </div>
      </section>

      {/* Analysis Criteria */}
      <BulkConditionForm
        onAnalyzeAll={handleAnalyzeAll}
        pendingCount={stats.pending}
        isAnalyzing={isAnalyzing}
      />

      {/* Results Monitor */}
      <BulkResumeMonitor onStatsChange={handleStatsChange} />
    </div>
  );
}
