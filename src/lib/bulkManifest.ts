import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STATUS_PENDING } from '@/lib/labels';

export type BulkManifestLabels = Map<string, string>;
export type BulkCandidateNames = Map<string, string>;

function defaultBulkManifestPath() {
  return path.resolve(process.cwd(), 'dataset', 'manifest_bulk.csv');
}

function defaultBulkUploadsDir() {
  return path.resolve(process.cwd(), 'dataset', 'bulk_uploads');
}

function defaultBulkNamesPath() {
  return path.resolve(process.cwd(), 'dataset', 'bulk_names.json');
}

export function getBulkUploadsDir() {
  return process.env.BULK_UPLOADS_DIR || defaultBulkUploadsDir();
}

export function getBulkNamesPath() {
  return process.env.BULK_NAMES_PATH || defaultBulkNamesPath();
}

async function ensureBulkManifestHeader(manifestPath: string) {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    if (raw.trim().length === 0) {
      await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
      return;
    }
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

export async function readBulkManifestLabels(
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<BulkManifestLabels> {
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

export async function appendBulkPendingIfMissing(
  filename: string,
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<string> {
  return enqueueWrite(async () => {
    const labels = await readBulkManifestLabels(manifestPath);
    const existing = labels.get(filename);
    if (existing) return existing;

    await ensureBulkManifestHeader(manifestPath);
    const needsLeadingNewline = !(await fileEndsWithNewline(manifestPath));
    const line = `${filename},${STATUS_PENDING}\n`;
    await fs.appendFile(
      manifestPath,
      `${needsLeadingNewline ? '\n' : ''}${line}`,
      'utf8'
    );
    return STATUS_PENDING;
  });
}

export async function upsertBulkManifestLabel(
  filename: string,
  label: string,
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<string> {
  return enqueueWrite(async () => {
    await ensureBulkManifestHeader(manifestPath);

    let raw = '';
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      raw = 'filename,label\n';
    }

    const lines = raw.split(/\r?\n/);
    const out: string[] = [];

    out.push('filename,label');

    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.toLowerCase().startsWith('filename,')) continue;

      const comma = line.indexOf(',');
      if (comma === -1) continue;
      const f = line.slice(0, comma).trim();
      const l = line.slice(comma + 1).trim();
      if (!f) continue;

      if (f === filename) {
        out.push(`${filename},${label}`);
        found = true;
      } else {
        out.push(`${f},${l}`);
      }
    }

    if (!found) out.push(`${filename},${label}`);

    await fs.writeFile(manifestPath, `${out.join('\n')}\n`, 'utf8');
    return label;
  });
}

export async function removeBulkManifestEntry(
  filename: string,
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<boolean> {
  return enqueueWrite(async () => {
    let raw = '';
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      return false;
    }

    const lines = raw.split(/\r?\n/);
    const out: string[] = [];
    let found = false;

    out.push('filename,label');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.toLowerCase().startsWith('filename,')) continue;

      const comma = trimmed.indexOf(',');
      if (comma === -1) continue;
      const f = trimmed.slice(0, comma).trim();
      const l = trimmed.slice(comma + 1).trim();
      if (!f) continue;

      if (f === filename) {
        found = true;
      } else {
        out.push(`${f},${l}`);
      }
    }

    if (found) {
      await fs.writeFile(manifestPath, `${out.join('\n')}\n`, 'utf8');
    }
    return found;
  });
}

export async function clearBulkManifest(
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<void> {
  return enqueueWrite(async () => {
    await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
  });
}

export async function clearBulkUploadsDir(): Promise<number> {
  const dir = getBulkUploadsDir();
  let deleted = 0;
  
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (file.toLowerCase().endsWith('.pdf')) {
        await fs.unlink(path.join(dir, file));
        deleted++;
      }
    }
  } catch {
    // Directory might not exist
  }
  
  await clearBulkManifest();
  await clearBulkCandidateNames();
  return deleted;
}

export async function cleanBulkOrphanEntries(
  uploadsDir: string = getBulkUploadsDir(),
  manifestPath: string = process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath()
): Promise<{ removed: string[]; kept: number }> {
  return enqueueWrite(async () => {
    const labels = await readBulkManifestLabels(manifestPath);
    const removed: string[] = [];
    const kept: string[] = [];

    for (const [filename, label] of labels) {
      const filePath = path.join(uploadsDir, filename);
      try {
        await fs.access(filePath);
        kept.push(`${filename},${label}`);
      } catch {
        removed.push(filename);
      }
    }

    if (removed.length > 0) {
      const out = ['filename,label', ...kept];
      await fs.writeFile(manifestPath, `${out.join('\n')}\n`, 'utf8');
      console.log(`[bulk-manifest] Cleaned ${removed.length} orphan entries`);
    }

    return { removed, kept: kept.length };
  });
}

// ============================================================================
// Candidate Names Store (JSON-based)
// ============================================================================

let namesWriteQueue: Promise<void> = Promise.resolve();

function enqueueNamesWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = namesWriteQueue.then(fn, fn);
  namesWriteQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function readBulkCandidateNames(
  namesPath: string = getBulkNamesPath()
): Promise<BulkCandidateNames> {
  try {
    const raw = await fs.readFile(namesPath, 'utf8');
    const data = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

export async function setCandidateName(
  filename: string,
  name: string,
  namesPath: string = getBulkNamesPath()
): Promise<void> {
  return enqueueNamesWrite(async () => {
    const names = await readBulkCandidateNames(namesPath);
    names.set(filename, name);
    
    const data = Object.fromEntries(names);
    await fs.writeFile(namesPath, JSON.stringify(data, null, 2), 'utf8');
  });
}

export async function getCandidateName(
  filename: string,
  namesPath: string = getBulkNamesPath()
): Promise<string | null> {
  const names = await readBulkCandidateNames(namesPath);
  return names.get(filename) ?? null;
}

export async function clearBulkCandidateNames(
  namesPath: string = getBulkNamesPath()
): Promise<void> {
  return enqueueNamesWrite(async () => {
    await fs.writeFile(namesPath, '{}', 'utf8');
  });
}



