/**
 * Bulk Upload Manifest Operations
 * 
 * Thin wrapper around csvManifest for the bulk upload workflow,
 * plus additional candidate name storage.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as csv from '@/lib/csvManifest';

export type BulkManifestLabels = csv.ManifestLabels;
export type BulkCandidateNames = Map<string, string>;

// Paths
function defaultBulkManifestPath(): string {
  return path.resolve(process.cwd(), 'dataset', 'manifest_bulk.csv');
}

function defaultBulkUploadsDir(): string {
  return path.resolve(process.cwd(), 'dataset', 'bulk_uploads');
}

function defaultBulkNamesPath(): string {
  return path.resolve(process.cwd(), 'dataset', 'bulk_names.json');
}

export function getBulkUploadsDir(): string {
  return process.env.BULK_UPLOADS_DIR || defaultBulkUploadsDir();
}

export function getBulkNamesPath(): string {
  return process.env.BULK_NAMES_PATH || defaultBulkNamesPath();
}

function getBulkManifestPath(): string {
  return process.env.BULK_MANIFEST_PATH || defaultBulkManifestPath();
}

// CSV operations (delegated to shared module)
export async function readBulkManifestLabels(
  manifestPath: string = getBulkManifestPath()
): Promise<BulkManifestLabels> {
  return csv.readLabels(manifestPath);
}

export async function appendBulkPendingIfMissing(
  filename: string,
  manifestPath: string = getBulkManifestPath()
): Promise<string> {
  return csv.appendIfMissing(filename, manifestPath);
}

export async function upsertBulkManifestLabel(
  filename: string,
  label: string,
  manifestPath: string = getBulkManifestPath()
): Promise<string> {
  return csv.upsertLabel(filename, label, manifestPath);
}

export async function removeBulkManifestEntry(
  filename: string,
  manifestPath: string = getBulkManifestPath()
): Promise<boolean> {
  return csv.removeEntry(filename, manifestPath);
}

export async function clearBulkManifest(
  manifestPath: string = getBulkManifestPath()
): Promise<void> {
  return csv.clearAll(manifestPath);
}

export async function cleanBulkOrphanEntries(
  uploadsDir: string = getBulkUploadsDir(),
  manifestPath: string = getBulkManifestPath()
): Promise<{ removed: string[]; kept: number }> {
  return csv.cleanOrphans(uploadsDir, manifestPath);
}

// Clear all bulk uploads (PDFs + manifest + names)
export async function clearBulkUploadsDir(): Promise<number> {
  const dir = getBulkUploadsDir();
  let deleted = 0;

  try {
    const files = await fs.readdir(dir);
    await Promise.all(
      files
        .filter(f => f.toLowerCase().endsWith('.pdf'))
        .map(async f => {
          await fs.unlink(path.join(dir, f));
          deleted++;
        })
    );
  } catch {
    // Directory might not exist
  }

  await clearBulkManifest();
  await clearBulkCandidateNames();
  return deleted;
}

// ============================================================================
// Candidate Names Store (JSON-based)
// ============================================================================

let namesWriteQueue: Promise<void> = Promise.resolve();

function enqueueNamesWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = namesWriteQueue.then(fn, fn);
  namesWriteQueue = next.then(() => undefined, () => undefined);
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
    await fs.writeFile(namesPath, JSON.stringify(Object.fromEntries(names), null, 2), 'utf8');
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
