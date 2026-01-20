/**
 * Regular (Ashby) Manifest Operations
 * 
 * Thin wrapper around csvManifest for the regular resume workflow.
 */

import path from 'node:path';
import * as csv from '@/lib/csvManifest';

export type ManifestLabels = csv.ManifestLabels;

function defaultManifestPath(): string {
  return path.resolve(process.cwd(), 'dataset', 'manifest.csv');
}

function getManifestPath(): string {
  return process.env.MANIFEST_PATH || defaultManifestPath();
}

export async function readManifestLabels(
  manifestPath: string = getManifestPath()
): Promise<ManifestLabels> {
  return csv.readLabels(manifestPath);
}

export async function appendPendingIfMissing(
  filename: string,
  manifestPath: string = getManifestPath()
): Promise<string> {
  return csv.appendIfMissing(filename, manifestPath);
}

export async function upsertManifestLabel(
  filename: string,
  label: string,
  manifestPath: string = getManifestPath()
): Promise<string> {
  return csv.upsertLabel(filename, label, manifestPath);
}

export async function removeManifestEntry(
  filename: string,
  manifestPath: string = getManifestPath()
): Promise<boolean> {
  return csv.removeEntry(filename, manifestPath);
}

export async function cleanOrphanEntries(
  resumeDir: string,
  manifestPath: string = getManifestPath()
): Promise<{ removed: string[]; kept: number }> {
  return csv.cleanOrphans(resumeDir, manifestPath);
}
