import path from 'node:path';

const UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

export const isPdf = (filename: string): boolean =>
  path.extname(filename).toLowerCase() === '.pdf';

export const toPosixPath = (p: string): string =>
  p.split(path.sep).join('/');

export const truncate = (s: string, maxLength: number): string =>
  s.length <= maxLength ? s : s.slice(0, maxLength) + '...[truncated]';

export const isSafeFilename = (filename: string): boolean =>
  Boolean(filename) &&
  !filename.includes('/') &&
  !filename.includes('\\') &&
  !filename.includes('..') &&
  isPdf(filename);

/**
 * Extract candidate and application IDs from filename.
 * Format: Name__candidateId__applicationId.pdf
 */
export function parseIdsFromFilename(filename: string): {
  candidateId: string | null;
  applicationId: string | null;
} {
  const match = filename.match(
    new RegExp(`__(${UUID_REGEX.source})__(${UUID_REGEX.source})\\.pdf$`, 'i')
  );

  return match
    ? { candidateId: match[1], applicationId: match[2] }
    : { candidateId: null, applicationId: null };
}

export const getAshbyProfileUrl = (candidateId: string): string =>
  `https://app.ashbyhq.com/candidate-searches/new/right-side/candidates/${candidateId}`;
