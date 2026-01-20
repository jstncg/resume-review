'use client';

import { useState, useEffect, useCallback } from 'react';

type InterviewStage = {
  id: string;
  title: string;
  type: string;
  order: number;
};

type StageMappingConfig = {
  version: number;
  lastUpdated: string;
  jobId: string | null;
  mappings: {
    userReviewed?: { stageId: string; stageName: string };
    archived?: { stageId: string; stageName: string };
  };
};

type Props = {
  selectedJobId: string | null;
  onPermissionCheck?: (hasPermission: boolean) => void;
};

export function StageMappingConfig({ selectedJobId, onPermissionCheck }: Props) {
  const [stages, setStages] = useState<InterviewStage[]>([]);
  const [config, setConfig] = useState<StageMappingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [permissionChecking, setPermissionChecking] = useState(false);
  const [userReviewedStageId, setUserReviewedStageId] = useState('');
  const [archivedStageId, setArchivedStageId] = useState('');

  // Check API permission on mount
  useEffect(() => {
    let mounted = true;
    
    (async () => {
      setPermissionChecking(true);
      try {
        const res = await fetch('/api/ashby-move-stage');
        const data = await res.json();
        if (mounted) {
          setHasPermission(data.hasPermission);
          onPermissionCheck?.(data.hasPermission);
        }
      } catch {
        if (mounted) {
          setHasPermission(false);
          onPermissionCheck?.(false);
        }
      } finally {
        if (mounted) setPermissionChecking(false);
      }
    })();
    
    return () => { mounted = false; };
  }, [onPermissionCheck]);

  // Load stages and config when job changes
  useEffect(() => {
    if (!selectedJobId) {
      setStages([]);
      setUserReviewedStageId('');
      setArchivedStageId('');
      return;
    }

    let mounted = true;
    
    const loadData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Load stages and config in parallel
        const [stagesRes, configRes] = await Promise.all([
          fetch(`/api/ashby-stages?jobId=${selectedJobId}`),
          fetch('/api/stage-mappings'),
        ]);
        
        const [stagesData, configData] = await Promise.all([
          stagesRes.json(),
          configRes.json(),
        ]);
        
        if (!mounted) return;
        
        if (stagesData.ok) {
          setStages(stagesData.stages);
        } else {
          setError(stagesData.error || 'Failed to load stages');
        }
        
        if (configData.ok && configData.config) {
          setConfig(configData.config);
          // Pre-populate dropdowns if config matches current job
          if (configData.config.jobId === selectedJobId) {
            setUserReviewedStageId(configData.config.mappings.userReviewed?.stageId || '');
            setArchivedStageId(configData.config.mappings.archived?.stageId || '');
          } else {
            setUserReviewedStageId('');
            setArchivedStageId('');
          }
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadData();
    return () => { mounted = false; };
  }, [selectedJobId]);

  const handleSave = useCallback(async () => {
    if (!selectedJobId) return;
    
    setSaving(true);
    setError(null);
    setSuccess(null);
    
    try {
      const mappings: StageMappingConfig['mappings'] = {};
      
      const userStage = stages.find(s => s.id === userReviewedStageId);
      if (userStage) {
        mappings.userReviewed = { stageId: userStage.id, stageName: userStage.title };
      }
      
      const archiveStage = stages.find(s => s.id === archivedStageId);
      if (archiveStage) {
        mappings.archived = { stageId: archiveStage.id, stageName: archiveStage.title };
      }

      const res = await fetch('/api/stage-mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: selectedJobId, mappings }),
      });
      
      const data = await res.json();
      
      if (data.ok) {
        setConfig(data.config);
        setSuccess('Stage mappings saved!');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [selectedJobId, userReviewedStageId, archivedStageId, stages]);

  // Don't render if no job selected
  if (!selectedJobId) {
    return null;
  }

  return (
    <section className="w-full rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-black">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-lg font-semibold text-black dark:text-zinc-50">
            ⚙️ Ashby Stage Sync
          </h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Automatically move candidates in Ashby when you drag them to different columns
          </p>
        </div>
        {permissionChecking ? (
          <span className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            Checking...
          </span>
        ) : hasPermission === false ? (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            ⚠️ API permission needed
          </span>
        ) : hasPermission === true ? (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            ✓ Connected
          </span>
        ) : null}
      </div>

      {!hasPermission && !permissionChecking && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/50">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            <strong>Permission Required:</strong> To enable automatic stage syncing, your Ashby API key needs the{' '}
            <code className="rounded bg-amber-100 px-1 font-mono text-xs dark:bg-amber-900">Candidates: Write</code>{' '}
            permission.
          </p>
          <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
            Go to <strong>Ashby → Admin → Integrations → API Keys</strong> and enable write access.
          </p>
        </div>
      )}

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-zinc-500">
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading interview stages...
        </div>
      ) : stages.length === 0 ? (
        <div className="mt-5 text-sm text-zinc-500 dark:text-zinc-400">
          No interview stages found for this job
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {/* User Reviewed mapping */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <label className="min-w-[200px] text-sm font-medium text-zinc-700 dark:text-zinc-300">
              When moved to &quot;User Reviewed&quot;:
            </label>
            <select
              value={userReviewedStageId}
              onChange={(e) => setUserReviewedStageId(e.target.value)}
              disabled={!hasPermission}
              className="flex-1 rounded-xl border border-black/[.12] bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.20]"
            >
              <option value="">Do not sync to Ashby</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.title} ({stage.type})
                </option>
              ))}
            </select>
          </div>

          {/* Archived mapping */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <label className="min-w-[200px] text-sm font-medium text-zinc-700 dark:text-zinc-300">
              When archived/rejected:
            </label>
            <select
              value={archivedStageId}
              onChange={(e) => setArchivedStageId(e.target.value)}
              disabled={!hasPermission}
              className="flex-1 rounded-xl border border-black/[.12] bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:ring-2 focus:ring-black/[.15] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.18] dark:bg-black dark:text-zinc-50 dark:focus:ring-white/[.20]"
            >
              <option value="">Do not sync to Ashby</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.title} ({stage.type})
                </option>
              ))}
            </select>
          </div>

          {/* Save button */}
          <div className="flex items-center justify-between gap-4 pt-2">
            <div className="text-sm">
              {error && <span className="text-red-600 dark:text-red-400">{error}</span>}
              {success && <span className="text-emerald-600 dark:text-emerald-400">{success}</span>}
              {config?.jobId === selectedJobId && !error && !success && (
                <span className="text-zinc-500 dark:text-zinc-400">
                  Last saved: {new Date(config.lastUpdated).toLocaleString()}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !hasPermission}
              className="inline-flex h-10 items-center justify-center rounded-full bg-black px-4 text-sm font-medium text-white transition-opacity disabled:opacity-60 dark:bg-white dark:text-black"
            >
              {saving ? 'Saving...' : 'Save mappings'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

