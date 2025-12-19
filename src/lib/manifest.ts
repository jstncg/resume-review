import { promises as fs } from 'node:fs';
import path from 'node:path';

export type ManifestLabels = Map<string, string>;

function defaultManifestPath() {
  return path.resolve(process.cwd(), 'dataset', 'manifest.csv');
}

async function ensureManifestHeader(manifestPath: string) {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    if (raw.trim().length === 0) {
      await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
      return;
    }
    // If it doesn't look like it has the expected header, leave it alone.
  } catch {
    await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
  }
}

async function fileEndsWithNewline(filePath: string): Promise<boolean> {
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const stat = await fh.stat();
      if (stat.size === 0) return false;
      const buf = Buffer.alloc(1);
      await fh.read(buf, 0, 1, stat.size - 1);
      return buf.toString('utf8') === '\n';
    } finally {
      await fh.close();
    }
  } catch {
    return false;
  }
}

export async function readManifestLabels(
  manifestPath: string = process.env.MANIFEST_PATH || defaultManifestPath()
): Promise<ManifestLabels> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return new Map();
  }

  const labels = new Map<string, string>();
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return labels;

  // Expect header: filename,label
  const startIdx = lines[0].toLowerCase().startsWith('filename,') ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const comma = line.indexOf(',');
    if (comma === -1) continue;
    const filename = line.slice(0, comma).trim();
    const label = line.slice(comma + 1).trim();
    if (!filename || !label) continue;
    labels.set(filename, label);
  }

  return labels;
}

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function appendPendingIfMissing(
  filename: string,
  manifestPath: string = process.env.MANIFEST_PATH || defaultManifestPath()
): Promise<string> {
  return enqueueWrite(async () => {
    const labels = await readManifestLabels(manifestPath);
    const existing = labels.get(filename);
    if (existing) return existing;

    await ensureManifestHeader(manifestPath);
    const needsLeadingNewline = !(await fileEndsWithNewline(manifestPath));
    const line = `${filename},pending\n`;
    await fs.appendFile(
      manifestPath,
      `${needsLeadingNewline ? '\n' : ''}${line}`,
      'utf8'
    );
    return 'pending';
  });
}
