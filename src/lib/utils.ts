import path from 'node:path';

/**
 * Check if a filename is a PDF file.
 */
export function isPdf(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.pdf';
}

/**
 * Convert a path to POSIX format (forward slashes).
 */
export function toPosixPath(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Truncate a string to a maximum length.
 */
export function truncate(s: string, maxLength: number): string {
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength) + '...[truncated]';
}

/**
 * Check if a filename is safe (no path traversal, must be PDF).
 */
export function isSafeFilename(filename: string): boolean {
  if (!filename) return false;
  if (filename.includes('/') || filename.includes('\\')) return false;
  if (filename.includes('..')) return false;
  if (!isPdf(filename)) return false;
  return true;
}

/**
 * Extract candidate and application IDs from filename.
 * Filename format: Name__candidateId__applicationId.pdf
 */
export function parseIdsFromFilename(filename: string): {
  candidateId: string | null;
  applicationId: string | null;
} {
  const match = filename.match(
    /__([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})__([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.pdf$/i
  );

  if (match) {
    return {
      candidateId: match[1],
      applicationId: match[2],
    };
  }

  return { candidateId: null, applicationId: null };
}

/**
 * Get the Ashby profile URL for a candidate.
 */
export function getAshbyProfileUrl(candidateId: string): string {
  return `https://app.ashbyhq.com/candidate-searches/new/right-side/candidates/${candidateId}`;
}



