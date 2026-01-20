import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendPendingIfMissing, readManifestLabels, cleanOrphanEntries } from '@/lib/manifest';
import { enqueuePdfAnalysis } from '@/lib/analysisPipeline';
import { getConditionState } from '@/lib/conditionStore';
import { STATUS_IN_PROGRESS, STATUS_PENDING } from '@/lib/labels';
import { isPdf, toPosixPath } from '@/lib/utils';

export type ResumeAddedEvent = {
  type: 'added';
  filename: string;
  absPath: string;
  relPath: string;
  label: string | null;
  ts: number;
};

export type ResumeLabelEvent = {
  type: 'label';
  filename: string;
  relPath: string;
  label: string | null;
  ts: number;
};

type ResumeWatcherEvents = {
  added: (evt: ResumeAddedEvent) => void;
  label: (evt: ResumeLabelEvent) => void;
  ready: () => void;
};

function defaultWatchDir() {
  return path.resolve(process.cwd(), 'dataset', 'sentra_test_resumes');
}

export class ResumeWatcher {
  private emitter = new EventEmitter();
  private ready = false;
  private watchDir: string;
  private reconciled = false;

  constructor(watchDir: string) {
    this.watchDir = watchDir;
  }

  start() {
    const watcher = chokidar.watch(this.watchDir, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 750,
        pollInterval: 100,
      },
      ignored: (p) => {
        const base = path.basename(p);
        return (
          base.startsWith('.') ||
          base.endsWith('~') ||
          base.endsWith('.tmp') ||
          base.endsWith('.crdownload')
        );
      },
    });

    watcher.on('add', (absPath) => void this.handleAdd(absPath));

    watcher.on('ready', () => {
      this.ready = true;
      // Best-effort reconciliation: if any PDFs exist in the directory but not in
      // manifest.csv (e.g. added while the server was down), add them as pending.
      void this.syncManifestFromDisk();
      this.emitter.emit('ready');
      console.log(
        `[watch] Resume watcher ready (SSE events enabled) - dir=${this.watchDir}`
      );
    });

    watcher.on('error', (err) => {
      console.error('[watch] watcher error', err);
    });
  }

  private async syncManifestFromDisk() {
    try {
      // First, clean up orphan entries (files that no longer exist)
      const cleanResult = await cleanOrphanEntries(this.watchDir);
      if (cleanResult.removed.length > 0) {
        console.log(`[watch] Cleaned ${cleanResult.removed.length} orphan manifest entries`);
      }

      const names = await fs.readdir(this.watchDir);
      const pdfs = names.filter((n) => n.toLowerCase().endsWith('.pdf'));
      for (const filename of pdfs) {
        await appendPendingIfMissing(filename);
      }

      // If the server restarted while there were pending/in_progress items,
      // re-enqueue them so they continue/finish analysis without requiring a new file add.
      if (!this.reconciled) {
        this.reconciled = true;
        const labels = await readManifestLabels();
        const conditionSnapshot = getConditionState().condition;
        for (const filename of pdfs) {
          const label = labels.get(filename) ?? STATUS_PENDING;
          if (label !== STATUS_PENDING && label !== STATUS_IN_PROGRESS) continue;
          const absPath = path.join(this.watchDir, filename);
          enqueuePdfAnalysis({
            filename,
            relPath: toPosixPath(path.relative(process.cwd(), absPath)),
            absPath,
            condition: conditionSnapshot,
            onUpdate: (u) => {
              this.emitter.emit('label', {
                type: 'label',
                filename: u.filename,
                relPath: u.relPath,
                label: u.label,
                ts: Date.now(),
              } satisfies ResumeLabelEvent);
            },
          });
        }
      }
    } catch (e) {
      console.error('[watch] failed to sync manifest.csv from disk', e);
    }
  }

  private async handleAdd(absPath: string) {
    if (!isPdf(absPath)) return;

    // ignore all initial adds; clients should use /api/resumes for initial state
    if (!this.ready) return;

    const filename = path.basename(absPath);
    let label: string | null = null;
    try {
      label = await appendPendingIfMissing(filename);
    } catch (e) {
      console.error('[watch] failed to update manifest.csv', e);
    }

    const evt: ResumeAddedEvent = {
      type: 'added',
      filename,
      absPath,
      relPath: toPosixPath(path.relative(process.cwd(), absPath)),
      label,
      ts: Date.now(),
    };

    // Server-side visibility for debugging
    console.log(
      `[watch] NEW FILE ADDED: ${evt.relPath} (label=${label ?? 'null'})`
    );

    this.emitter.emit('added', evt);

    // Kick off analysis line: pending -> in_progress, and emit label update.
    const conditionSnapshot = getConditionState().condition;
    enqueuePdfAnalysis({
      filename,
      relPath: evt.relPath,
      absPath: evt.absPath,
      condition: conditionSnapshot,
      onUpdate: (u) => {
        this.emitter.emit('label', {
          type: 'label',
          filename: u.filename,
          relPath: u.relPath,
          label: u.label,
          ts: Date.now(),
        } satisfies ResumeLabelEvent);
      },
    });
  }

  on<K extends keyof ResumeWatcherEvents>(
    event: K,
    cb: ResumeWatcherEvents[K]
  ) {
    this.emitter.on(event, cb as (...args: unknown[]) => void);
    return () => this.emitter.off(event, cb as (...args: unknown[]) => void);
  }

  emitLabelUpdate(
    evt: Omit<ResumeLabelEvent, 'type' | 'ts'> & { ts?: number }
  ) {
    this.emitter.emit('label', {
      type: 'label',
      filename: evt.filename,
      relPath: evt.relPath,
      label: evt.label,
      ts: evt.ts ?? Date.now(),
    } satisfies ResumeLabelEvent);
  }

  isReady() {
    return this.ready;
  }

  getWatchDir() {
    return this.watchDir;
  }
}

function getSingleton(): ResumeWatcher {
  const g = globalThis as unknown as {
    __sentraResumeWatcher?: ResumeWatcher;
  };

  if (g.__sentraResumeWatcher) return g.__sentraResumeWatcher;

  const watchDir = process.env.RESUME_DIR || defaultWatchDir();
  const rw = new ResumeWatcher(watchDir);
  rw.start();
  g.__sentraResumeWatcher = rw;
  return rw;
}

export const resumeWatcher = getSingleton();

export function emitResumeLabelUpdate(
  evt: Omit<ResumeLabelEvent, 'type' | 'ts'> & { ts?: number }
) {
  resumeWatcher.emitLabelUpdate(evt);
}
