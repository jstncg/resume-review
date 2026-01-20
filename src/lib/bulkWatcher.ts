import chokidar from 'chokidar';
import { EventEmitter } from 'node:events';
import { promises as fs, mkdirSync, existsSync } from 'node:fs';
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

type BulkResumeWatcherEvents = {
  added: (evt: BulkResumeAddedEvent) => void;
  label: (evt: BulkResumeLabelEvent) => void;
  ready: () => void;
};

export class BulkResumeWatcher {
  private emitter = new EventEmitter();
  private ready = false;
  private watchDir: string;
  private reconciled = false;
  private currentCondition: string = '';

  constructor(watchDir: string) {
    this.watchDir = watchDir;
  }

  setCondition(condition: string) {
    this.currentCondition = condition;
  }

  getCondition() {
    return this.currentCondition;
  }

  start() {
    // Ensure the directory exists (synchronous to avoid blocking issues)
    if (!existsSync(this.watchDir)) {
      mkdirSync(this.watchDir, { recursive: true });
    }

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
      void this.syncManifestFromDisk();
      this.emitter.emit('ready');
      console.log(
        `[bulk-watch] Bulk resume watcher ready - dir=${this.watchDir}`
      );
    });

    watcher.on('error', (err) => {
      console.error('[bulk-watch] watcher error', err);
    });
  }

  private async syncManifestFromDisk() {
    try {
      // Clean up orphan entries
      const cleanResult = await cleanBulkOrphanEntries(this.watchDir);
      if (cleanResult.removed.length > 0) {
        console.log(`[bulk-watch] Cleaned ${cleanResult.removed.length} orphan manifest entries`);
      }

      const names = await fs.readdir(this.watchDir);
      const pdfs = names.filter((n) => n.toLowerCase().endsWith('.pdf'));
      for (const filename of pdfs) {
        await appendBulkPendingIfMissing(filename);
      }

      // Re-enqueue pending/in_progress items on restart
      if (!this.reconciled) {
        this.reconciled = true;
        // Don't auto-analyze on startup - let user trigger manually
      }
    } catch (e) {
      console.error('[bulk-watch] failed to sync manifest from disk', e);
    }
  }

  private async handleAdd(absPath: string) {
    if (!isPdf(absPath)) return;
    if (!this.ready) return;

    const filename = path.basename(absPath);
    let label: string | null = null;
    try {
      label = await appendBulkPendingIfMissing(filename);
    } catch (e) {
      console.error('[bulk-watch] failed to update manifest', e);
    }

    const evt: BulkResumeAddedEvent = {
      type: 'added',
      filename,
      absPath,
      relPath: toPosixPath(path.relative(process.cwd(), absPath)),
      label,
      ts: Date.now(),
    };

    console.log(
      `[bulk-watch] NEW FILE ADDED: ${evt.relPath} (label=${label ?? 'null'})`
    );

    this.emitter.emit('added', evt);

    // Auto-start analysis if a condition is set
    if (this.currentCondition) {
      enqueueBulkPdfAnalysis({
        filename,
        relPath: evt.relPath,
        absPath: evt.absPath,
        condition: this.currentCondition,
        onUpdate: (u) => {
          this.emitter.emit('label', {
            type: 'label',
            filename: u.filename,
            relPath: u.relPath,
            label: u.label,
            ts: Date.now(),
          } satisfies BulkResumeLabelEvent);
        },
      });
    }
  }

  on<K extends keyof BulkResumeWatcherEvents>(
    event: K,
    cb: BulkResumeWatcherEvents[K]
  ) {
    this.emitter.on(event, cb as (...args: unknown[]) => void);
    return () => this.emitter.off(event, cb as (...args: unknown[]) => void);
  }

  emitLabelUpdate(
    evt: Omit<BulkResumeLabelEvent, 'type' | 'ts'> & { ts?: number }
  ) {
    this.emitter.emit('label', {
      type: 'label',
      filename: evt.filename,
      relPath: evt.relPath,
      label: evt.label,
      ts: evt.ts ?? Date.now(),
    } satisfies BulkResumeLabelEvent);
  }

  isReady() {
    return this.ready;
  }

  getWatchDir() {
    return this.watchDir;
  }

  // Trigger analysis for all pending items
  async analyzeAllPending(condition: string) {
    this.currentCondition = condition;
    
    const names = await fs.readdir(this.watchDir);
    const pdfs = names.filter((n) => n.toLowerCase().endsWith('.pdf'));
    const labels = await readBulkManifestLabels();
    
    let enqueued = 0;
    for (const filename of pdfs) {
      const label = labels.get(filename) ?? STATUS_PENDING;
      if (label !== STATUS_PENDING && label !== STATUS_IN_PROGRESS) continue;
      
      const absPath = path.join(this.watchDir, filename);
      const relPath = toPosixPath(path.relative(process.cwd(), absPath));
      
      enqueueBulkPdfAnalysis({
        filename,
        relPath,
        absPath,
        condition,
        onUpdate: (u) => {
          this.emitter.emit('label', {
            type: 'label',
            filename: u.filename,
            relPath: u.relPath,
            label: u.label,
            ts: Date.now(),
          } satisfies BulkResumeLabelEvent);
        },
      });
      enqueued++;
    }
    
    return enqueued;
  }
}

// Lazy singleton - only initialize when first accessed at runtime
let _bulkResumeWatcher: BulkResumeWatcher | null = null;

function getBulkResumeWatcher(): BulkResumeWatcher {
  if (_bulkResumeWatcher) return _bulkResumeWatcher;

  const g = globalThis as unknown as {
    __sentraBulkResumeWatcher?: BulkResumeWatcher;
  };

  if (g.__sentraBulkResumeWatcher) {
    _bulkResumeWatcher = g.__sentraBulkResumeWatcher;
    return _bulkResumeWatcher;
  }

  const watchDir = getBulkUploadsDir();
  const rw = new BulkResumeWatcher(watchDir);
  rw.start();
  g.__sentraBulkResumeWatcher = rw;
  _bulkResumeWatcher = rw;
  return rw;
}

// Export a getter instead of the instance directly
export const bulkResumeWatcher = {
  get instance() {
    return getBulkResumeWatcher();
  },
  on: (...args: Parameters<BulkResumeWatcher['on']>) => getBulkResumeWatcher().on(...args),
  analyzeAllPending: (...args: Parameters<BulkResumeWatcher['analyzeAllPending']>) => getBulkResumeWatcher().analyzeAllPending(...args),
  getWatchDir: () => getBulkResumeWatcher().getWatchDir(),
  isReady: () => getBulkResumeWatcher().isReady(),
  setCondition: (c: string) => getBulkResumeWatcher().setCondition(c),
  getCondition: () => getBulkResumeWatcher().getCondition(),
  emitLabelUpdate: (...args: Parameters<BulkResumeWatcher['emitLabelUpdate']>) => getBulkResumeWatcher().emitLabelUpdate(...args),
};

export function emitBulkResumeLabelUpdate(
  evt: Omit<BulkResumeLabelEvent, 'type' | 'ts'> & { ts?: number }
) {
  getBulkResumeWatcher().emitLabelUpdate(evt);
}
