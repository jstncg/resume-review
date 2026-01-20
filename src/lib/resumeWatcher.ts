/**
 * Resume File Watcher for Ashby Flow
 */

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

function defaultWatchDir(): string {
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

  start(): void {
    const watcher = chokidar.watch(this.watchDir, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 750, pollInterval: 100 },
      ignored: (p) => {
        const base = path.basename(p);
        return base.startsWith('.') || base.endsWith('~') || base.endsWith('.tmp') || base.endsWith('.crdownload');
      },
    });

    watcher.on('add', (absPath) => void this.handleAdd(absPath));
    watcher.on('ready', () => {
      this.ready = true;
      void this.syncManifest();
      this.emitter.emit('ready');
      console.log(`[watch] Resume watcher ready - dir=${this.watchDir}`);
    });
    watcher.on('error', (err) => console.error('[watch] Error:', err));
  }

  private async syncManifest(): Promise<void> {
    try {
      await cleanOrphanEntries(this.watchDir);

      const names = await fs.readdir(this.watchDir);
      const pdfs = names.filter(n => n.toLowerCase().endsWith('.pdf'));
      for (const filename of pdfs) {
        await appendPendingIfMissing(filename);
      }

      // Re-enqueue pending items on restart
      if (!this.reconciled) {
        this.reconciled = true;
        const labels = await readManifestLabels();
        const condition = getConditionState().condition;

        for (const filename of pdfs) {
          const label = labels.get(filename) ?? STATUS_PENDING;
          if (label !== STATUS_PENDING && label !== STATUS_IN_PROGRESS) continue;

          const absPath = path.join(this.watchDir, filename);
          enqueuePdfAnalysis({
            filename,
            relPath: toPosixPath(path.relative(process.cwd(), absPath)),
            absPath,
            condition,
            onUpdate: (u) => this.emitLabel(u.filename, u.relPath, u.label),
          });
        }
      }
    } catch (e) {
      console.error('[watch] Sync error:', e);
    }
  }

  private async handleAdd(absPath: string): Promise<void> {
    if (!isPdf(absPath) || !this.ready) return;

    const filename = path.basename(absPath);
    let label: string | null = null;

    try {
      label = await appendPendingIfMissing(filename);
    } catch (e) {
      console.error('[watch] Manifest error:', e);
    }

    const relPath = toPosixPath(path.relative(process.cwd(), absPath));
    console.log(`[watch] NEW FILE: ${relPath} (label=${label ?? 'null'})`);

    this.emitter.emit('added', { type: 'added', filename, absPath, relPath, label, ts: Date.now() });

    enqueuePdfAnalysis({
      filename,
      relPath,
      absPath,
      condition: getConditionState().condition,
      onUpdate: (u) => this.emitLabel(u.filename, u.relPath, u.label),
    });
  }

  private emitLabel(filename: string, relPath: string, label: string | null): void {
    this.emitter.emit('label', { type: 'label', filename, relPath, label, ts: Date.now() });
  }

  on(event: string, cb: (data: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  emitLabelUpdate(evt: Omit<ResumeLabelEvent, 'type' | 'ts'> & { ts?: number }): void {
    this.emitter.emit('label', { type: 'label', ...evt, ts: evt.ts ?? Date.now() });
  }

  isReady(): boolean { return this.ready; }
  getWatchDir(): string { return this.watchDir; }
}

// Singleton
function getSingleton(): ResumeWatcher {
  const g = globalThis as unknown as { __resumeWatcher?: ResumeWatcher };
  if (g.__resumeWatcher) return g.__resumeWatcher;

  const watchDir = process.env.RESUME_DIR || defaultWatchDir();
  const rw = new ResumeWatcher(watchDir);
  rw.start();
  g.__resumeWatcher = rw;
  return rw;
}

export const resumeWatcher = getSingleton();

export function emitResumeLabelUpdate(evt: Omit<ResumeLabelEvent, 'type' | 'ts'> & { ts?: number }): void {
  resumeWatcher.emitLabelUpdate(evt);
}
