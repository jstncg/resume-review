/**
 * Bulk Resume File Watcher
 */

import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { promises as fs, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  appendBulkPendingIfMissing,
  readBulkManifestLabels,
  cleanBulkOrphanEntries,
  getBulkUploadsDir,
} from '@/lib/bulkManifest';
import { enqueueBulkPdfAnalysis } from '@/lib/bulkAnalysisPipeline';
import { STATUS_IN_PROGRESS, STATUS_PENDING } from '@/lib/labels';
import { isPdf, toPosixPath } from '@/lib/utils';

export type BulkResumeAddedEvent = {
  type: 'added';
  filename: string;
  absPath: string;
  relPath: string;
  label: string | null;
  ts: number;
};

export type BulkResumeLabelEvent = {
  type: 'label';
  filename: string;
  relPath: string;
  label: string | null;
  ts: number;
};

export class BulkResumeWatcher {
  private emitter = new EventEmitter();
  private ready = false;
  private watchDir: string;
  private condition = '';

  constructor(watchDir: string) {
    this.watchDir = watchDir;
  }

  setCondition(condition: string): void { this.condition = condition; }
  getCondition(): string { return this.condition; }

  start(): void {
    if (!existsSync(this.watchDir)) {
      mkdirSync(this.watchDir, { recursive: true });
    }

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
      console.log(`[bulk-watch] Ready - dir=${this.watchDir}`);
    });
    watcher.on('error', (err) => console.error('[bulk-watch] Error:', err));
  }

  private async syncManifest(): Promise<void> {
    try {
      await cleanBulkOrphanEntries(this.watchDir);
      const names = await fs.readdir(this.watchDir);
      for (const n of names.filter(n => n.toLowerCase().endsWith('.pdf'))) {
        await appendBulkPendingIfMissing(n);
      }
    } catch (e) {
      console.error('[bulk-watch] Sync error:', e);
    }
  }

  private async handleAdd(absPath: string): Promise<void> {
    if (!isPdf(absPath) || !this.ready) return;

    const filename = path.basename(absPath);
    let label: string | null = null;

    try {
      label = await appendBulkPendingIfMissing(filename);
    } catch (e) {
      console.error('[bulk-watch] Manifest error:', e);
    }

    const relPath = toPosixPath(path.relative(process.cwd(), absPath));
    console.log(`[bulk-watch] NEW FILE: ${relPath}`);

    this.emitter.emit('added', { type: 'added', filename, absPath, relPath, label, ts: Date.now() });

    // Auto-analyze if condition set
    if (this.condition) {
      enqueueBulkPdfAnalysis({
        filename,
        relPath,
        absPath,
        condition: this.condition,
        onUpdate: (u) => this.emitLabel(u.filename, u.relPath, u.label),
      });
    }
  }

  private emitLabel(filename: string, relPath: string, label: string | null): void {
    this.emitter.emit('label', { type: 'label', filename, relPath, label, ts: Date.now() });
  }

  on(event: string, cb: (data: unknown) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  emitLabelUpdate(evt: Omit<BulkResumeLabelEvent, 'type' | 'ts'> & { ts?: number }): void {
    this.emitter.emit('label', { type: 'label', ...evt, ts: evt.ts ?? Date.now() });
  }

  isReady(): boolean { return this.ready; }
  getWatchDir(): string { return this.watchDir; }

  async analyzeAllPending(condition: string): Promise<number> {
    this.condition = condition;

    const names = await fs.readdir(this.watchDir);
    const pdfs = names.filter(n => n.toLowerCase().endsWith('.pdf'));
    const labels = await readBulkManifestLabels();

    let enqueued = 0;
    for (const filename of pdfs) {
      const label = labels.get(filename) ?? STATUS_PENDING;
      if (label !== STATUS_PENDING && label !== STATUS_IN_PROGRESS) continue;

      const absPath = path.join(this.watchDir, filename);
      enqueueBulkPdfAnalysis({
        filename,
        relPath: toPosixPath(path.relative(process.cwd(), absPath)),
        absPath,
        condition,
        onUpdate: (u) => this.emitLabel(u.filename, u.relPath, u.label),
      });
      enqueued++;
    }

    return enqueued;
  }
}

// Lazy singleton
let instance: BulkResumeWatcher | null = null;

function getInstance(): BulkResumeWatcher {
  if (instance) return instance;

  const g = globalThis as unknown as { __bulkWatcher?: BulkResumeWatcher };
  if (g.__bulkWatcher) {
    instance = g.__bulkWatcher;
    return instance;
  }

  const rw = new BulkResumeWatcher(getBulkUploadsDir());
  rw.start();
  g.__bulkWatcher = rw;
  instance = rw;
  return rw;
}

// Proxy for lazy initialization
export const bulkResumeWatcher = {
  get instance() { return getInstance(); },
  on: (event: string, cb: (data: unknown) => void) => getInstance().on(event, cb),
  analyzeAllPending: (condition: string) => getInstance().analyzeAllPending(condition),
  getWatchDir: () => getInstance().getWatchDir(),
  isReady: () => getInstance().isReady(),
  setCondition: (c: string) => getInstance().setCondition(c),
  getCondition: () => getInstance().getCondition(),
  emitLabelUpdate: (evt: Omit<BulkResumeLabelEvent, 'type' | 'ts'> & { ts?: number }) => getInstance().emitLabelUpdate(evt),
};

export function emitBulkResumeLabelUpdate(evt: Omit<BulkResumeLabelEvent, 'type' | 'ts'> & { ts?: number }): void {
  getInstance().emitLabelUpdate(evt);
}
