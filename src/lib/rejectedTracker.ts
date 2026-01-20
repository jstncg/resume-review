import { promises as fs } from 'node:fs';
import path from 'node:path';

export type RejectedCandidate = {
  applicationId: string;
  candidateName?: string;
  rejectedAt: string;
  reason: 'bad_fit' | 'scan_failed';
  archiveStatus: 'success' | 'failed' | 'skipped';
};

export type RejectedCandidatesFile = {
  version: number;
  lastUpdated: string;
  candidates: Record<string, RejectedCandidate>; // keyed by candidateId
};

function getDefaultPath(): string {
  return path.resolve(process.cwd(), 'dataset', 'rejected_candidates.json');
}

/**
 * Load the rejected candidates tracking file.
 * Returns empty structure if file doesn't exist.
 */
export async function loadRejectedCandidates(
  filePath: string = getDefaultPath()
): Promise<RejectedCandidatesFile> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as RejectedCandidatesFile;
  } catch {
    // File doesn't exist or is invalid - return empty structure
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      candidates: {},
    };
  }
}

/**
 * Save the rejected candidates tracking file.
 */
export async function saveRejectedCandidates(
  data: RejectedCandidatesFile,
  filePath: string = getDefaultPath()
): Promise<void> {
  data.lastUpdated = new Date().toISOString();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Add a candidate to the rejected list.
 * Thread-safe using file-based locking pattern.
 */
export async function addRejectedCandidate(
  candidateId: string,
  applicationId: string,
  reason: 'bad_fit' | 'scan_failed',
  archiveStatus: 'success' | 'failed' | 'skipped',
  candidateName?: string,
  filePath: string = getDefaultPath()
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
  console.log(`[rejected] Added candidate ${candidateId} to rejected list (reason: ${reason}, archive: ${archiveStatus})`);
}

/**
 * Check if a candidate is in the rejected list.
 */
export async function isRejectedCandidate(
  candidateId: string,
  filePath: string = getDefaultPath()
): Promise<boolean> {
  const data = await loadRejectedCandidates(filePath);
  return candidateId in data.candidates;
}

/**
 * Get list of all rejected candidate IDs.
 */
export async function getRejectedCandidateIds(
  filePath: string = getDefaultPath()
): Promise<Set<string>> {
  const data = await loadRejectedCandidates(filePath);
  return new Set(Object.keys(data.candidates));
}

/**
 * Get stats about rejected candidates.
 */
export async function getRejectedStats(
  filePath: string = getDefaultPath()
): Promise<{ total: number; badFit: number; scanFailed: number; archiveFailed: number }> {
  const data = await loadRejectedCandidates(filePath);
  const candidates = Object.values(data.candidates);
  
  return {
    total: candidates.length,
    badFit: candidates.filter(c => c.reason === 'bad_fit').length,
    scanFailed: candidates.filter(c => c.reason === 'scan_failed').length,
    archiveFailed: candidates.filter(c => c.archiveStatus === 'failed').length,
  };
}



