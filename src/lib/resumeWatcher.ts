import chokidar from "chokidar";
import { EventEmitter } from "node:events";
import path from "node:path";

export type ResumeAddedEvent = {
  type: "added";
  absPath: string;
  relPath: string;
  ts: number;
};

type ResumeWatcherEvents = {
  added: (evt: ResumeAddedEvent) => void;
  ready: () => void;
};

function isPdf(filePath: string) {
  return path.extname(filePath).toLowerCase() === ".pdf";
}

function defaultWatchDir() {
  return path.resolve(process.cwd(), "dataset", "sentra_test_resumes");
}

function toPosixPath(p: string) {
  return p.split(path.sep).join("/");
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
          base.startsWith(".") ||
          base.endsWith("~") ||
          base.endsWith(".tmp") ||
          base.endsWith(".crdownload")
        );
      },
    });

    watcher.on("add", (absPath) => {
      if (!isPdf(absPath)) return;

      // ignore all initial adds; clients should use /api/resumes for initial state
      if (!this.ready) return;

      const evt: ResumeAddedEvent = {
        type: "added",
        absPath,
        relPath: toPosixPath(path.relative(process.cwd(), absPath)),
        ts: Date.now(),
      };

      // Server-side visibility for debugging
      // eslint-disable-next-line no-console
      console.log(`[watch] NEW FILE ADDED: ${evt.relPath}`);

      this.emitter.emit("added", evt);
    });

    watcher.on("ready", () => {
      this.ready = true;
      this.emitter.emit("ready");
      // eslint-disable-next-line no-console
      console.log(
        `[watch] Resume watcher ready (SSE events enabled) - dir=${this.watchDir}`
      );
    });

    watcher.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("[watch] watcher error", err);
    });
  }

  on<K extends keyof ResumeWatcherEvents>(event: K, cb: ResumeWatcherEvents[K]) {
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


