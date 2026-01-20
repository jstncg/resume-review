import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ashbyRpc, isAshbyConfigured } from '@/lib/ashbyClient';
import { parseIdsFromFilename } from '@/lib/utils';

/**
 * Get applicationId from filename or by looking up metadata file.
 */
async function getApplicationId(filename: string): Promise<string | null> {
  const { candidateId, applicationId } = parseIdsFromFilename(filename);

  if (applicationId) {
    return applicationId;
  }

  // Fallback: look up from metadata using candidateId
  if (candidateId) {
    const metaPath = path.join(
      process.cwd(),
      'dataset',
      'ashby_metadata',
      `${candidateId}.json`
    );
    try {
      const raw = await fs.readFile(metaPath, 'utf8');
      const meta = JSON.parse(raw);
      return meta.application?.id || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Archive a candidate's application in Ashby.
 *
 * @param filename - The PDF filename (used to extract applicationId)
 * @returns true if archived successfully, false otherwise
 */
export async function archiveInAshby(filename: string): Promise<boolean> {
  // Check if archiving is enabled
  if (process.env.AUTO_ARCHIVE_REJECTED !== 'true') {
    return false;
  }

  // Check if we have Ashby credentials
  if (!isAshbyConfigured()) {
    console.warn('[ashby-archive] ASHBY_API_KEY not set, skipping archive');
    return false;
  }

  const applicationId = await getApplicationId(filename);
  if (!applicationId) {
    console.warn(
      `[ashby-archive] No applicationId found for ${filename}, skipping archive`
    );
    return false;
  }

  const archiveReasonId = process.env.ASHBY_ARCHIVE_REASON_ID;

  // Build the payload
  const payload: Record<string, string> = { applicationId };
  if (archiveReasonId) {
    payload.archiveReasonId = archiveReasonId;
  }

  // Try application.setArchiveReason first (most reliable for archiving)
  try {
    const result = await ashbyRpc('application.setArchiveReason', payload);

    if (result?.success) {
      console.log(
        `[ashby-archive] Successfully archived application ${applicationId}`
      );
      return true;
    }

    if (result?.error) {
      console.warn(
        `[ashby-archive] application.setArchiveReason failed: ${result.error}`
      );
    }
  } catch (err) {
    console.error('[ashby-archive] application.setArchiveReason error:', err);
  }

  // Fallback: try application.changeStage to an archived stage
  try {
    const fallbackResult = await ashbyRpc('application.changeStage', {
      applicationId,
      stageType: 'Archived',
    });

    if (fallbackResult?.success) {
      console.log(
        `[ashby-archive] Successfully archived via changeStage: ${applicationId}`
      );
      return true;
    }
  } catch (err) {
    console.error('[ashby-archive] application.changeStage error:', err);
  }

  console.error(
    `[ashby-archive] Failed to archive application ${applicationId}`
  );
  return false;
}
