/**
 * Shared CSV Manifest Operations
 * 
 * Provides a unified interface for CSV-based manifest files.
 * Used by both regular (Ashby) and bulk upload flows.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { STATUS_PENDING } from '@/lib/labels';

export type ManifestLabels = Map<string, string>;

// Write queue to prevent race conditions
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
}

async function ensureHeader(manifestPath: string): Promise<void> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    if (raw.trim().length === 0) {
      await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
    }
  } catch {
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
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

/**
 * Read all labels from a CSV manifest file.
 */
export async function readLabels(manifestPath: string): Promise<ManifestLabels> {
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch {
    return new Map();
  }

  const labels = new Map<string, string>();
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return labels;

  const startIdx = lines[0].toLowerCase().startsWith('filename,') ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const comma = lines[i].indexOf(',');
    if (comma === -1) continue;
    const filename = lines[i].slice(0, comma).trim();
    const label = lines[i].slice(comma + 1).trim();
    if (filename && label) {
      labels.set(filename, label);
    }
  }

  return labels;
}

/**
 * Append a pending entry if the filename doesn't exist in manifest.
 */
export async function appendIfMissing(
  filename: string,
  manifestPath: string
): Promise<string> {
  return enqueueWrite(async () => {
    const labels = await readLabels(manifestPath);
    const existing = labels.get(filename);
    if (existing) return existing;

    await ensureHeader(manifestPath);
    const needsNewline = !(await fileEndsWithNewline(manifestPath));
    const line = `${filename},${STATUS_PENDING}\n`;
    await fs.appendFile(manifestPath, `${needsNewline ? '\n' : ''}${line}`, 'utf8');
    return STATUS_PENDING;
  });
}

/**
 * Update or insert a label for a filename.
 */
export async function upsertLabel(
  filename: string,
  label: string,
  manifestPath: string
): Promise<string> {
  return enqueueWrite(async () => {
    await ensureHeader(manifestPath);

    let raw = '';
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      raw = 'filename,label\n';
    }

    const lines = raw.split(/\r?\n/);
    const out: string[] = ['filename,label'];
    let found = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('filename,')) continue;

      const comma = trimmed.indexOf(',');
      if (comma === -1) continue;

      const f = trimmed.slice(0, comma).trim();
      const l = trimmed.slice(comma + 1).trim();
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

/**
 * Remove a specific entry from the manifest.
 */
export async function removeEntry(
  filename: string,
  manifestPath: string
): Promise<boolean> {
  return enqueueWrite(async () => {
    let raw = '';
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      return false;
    }

    const lines = raw.split(/\r?\n/);
    const out: string[] = ['filename,label'];
    let found = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.toLowerCase().startsWith('filename,')) continue;

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

/**
 * Remove entries for files that no longer exist on disk.
 */
export async function cleanOrphans(
  resumeDir: string,
  manifestPath: string
): Promise<{ removed: string[]; kept: number }> {
  return enqueueWrite(async () => {
    const labels = await readLabels(manifestPath);
    const removed: string[] = [];
    const kept: string[] = [];

    for (const [filename, label] of labels) {
      const filePath = path.join(resumeDir, filename);
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
      console.log(`[manifest] Cleaned ${removed.length} orphan entries`);
    }

    return { removed, kept: kept.length };
  });
}

/**
 * Clear all entries from manifest (reset to header only).
 */
export async function clearAll(manifestPath: string): Promise<void> {
  return enqueueWrite(async () => {
    await fs.writeFile(manifestPath, 'filename,label\n', 'utf8');
  });
}
