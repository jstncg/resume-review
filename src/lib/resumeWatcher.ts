import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { appendPendingIfMissing } from '@/lib/manifest';
import { enqueuePdfAnalysis } from '@/lib/analysisPipeline';
import { getConditionState } from '@/lib/conditionStore';

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

function isPdf(filePath: string) {
  return path.extname(filePath).toLowerCase() === '.pdf';
}

function defaultWatchDir() {
  return path.resolve(process.cwd(), 'dataset', 'sentra_test_resumes');
}

function toPosixPath(p: string) {
  return p.split(path.sep).join('/');
}

export class ResumeWatcher {
  private emitter = new EventEmitter();
  private ready = false;
  private watchDir: string;

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
      // eslint-disable-next-line no-console
      console.log(
        `[watch] Resume watcher ready (SSE events enabled) - dir=${this.watchDir}`
      );
    });

    watcher.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[watch] watcher error', err);
    });
  }

  private async syncManifestFromDisk() {
    try {
      const names = await fs.readdir(this.watchDir);
      const pdfs = names.filter((n) => n.toLowerCase().endsWith('.pdf'));
      for (const filename of pdfs) {
        await appendPendingIfMissing(filename);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
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
      // eslint-disable-next-line no-console
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
    // eslint-disable-next-line no-console
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
    this.emitter.on(event, cb as (...args: any[]) => void);
    return () => this.emitter.off(event, cb as (...args: any[]) => void);
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
