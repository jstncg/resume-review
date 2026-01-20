/**
 * Rejected Candidates Tracker
 * 
 * Tracks candidates that have been rejected to prevent re-downloading.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export type RejectedCandidate = {
  applicationId: string;
  candidateName?: string;
  rejectedAt: string;
  reason: 'bad_fit' | 'scan_failed';
  archiveStatus: 'success' | 'failed' | 'skipped';
};

type RejectedFile = {
  version: number;
  lastUpdated: string;
  candidates: Record<string, RejectedCandidate>;
};

const getPath = () => path.resolve(process.cwd(), 'dataset', 'rejected_candidates.json');

export async function loadRejectedCandidates(filePath = getPath()): Promise<RejectedFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as RejectedFile;
  } catch {
    return { version: 1, lastUpdated: new Date().toISOString(), candidates: {} };
  }
}

export async function saveRejectedCandidates(data: RejectedFile, filePath = getPath()): Promise<void> {
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function addRejectedCandidate(
  candidateId: string,
  applicationId: string,
  reason: 'bad_fit' | 'scan_failed',
  archiveStatus: 'success' | 'failed' | 'skipped',
  candidateName?: string,
  filePath = getPath()
): Promise<void> {
  const data = await loadRejectedCandidates(filePath);

  data.candidates[candidateId] = {
    applicationId,
    candidateName,
    rejectedAt: new Date().toISOString(),
    reason,
    archiveStatus,
  };

  await saveRejectedCandidates(data, filePath);
  console.log(`[rejected] Added ${candidateId} (reason: ${reason}, archive: ${archiveStatus})`);
}

export async function isRejectedCandidate(candidateId: string, filePath = getPath()): Promise<boolean> {
  const data = await loadRejectedCandidates(filePath);
  return candidateId in data.candidates;
}

export async function getRejectedCandidateIds(filePath = getPath()): Promise<Set<string>> {
  const data = await loadRejectedCandidates(filePath);
  return new Set(Object.keys(data.candidates));
}

export async function getRejectedStats(filePath = getPath()): Promise<{
  total: number;
  badFit: number;
  scanFailed: number;
  archiveFailed: number;
}> {
  const data = await loadRejectedCandidates(filePath);
  const candidates = Object.values(data.candidates);

  return {
    total: candidates.length,
    badFit: candidates.filter(c => c.reason === 'bad_fit').length,
    scanFailed: candidates.filter(c => c.reason === 'scan_failed').length,
    archiveFailed: candidates.filter(c => c.archiveStatus === 'failed').length,
  };
}
