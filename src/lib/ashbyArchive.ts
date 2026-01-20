/**
 * Ashby Archive Operations
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ashbyRpc, isAshbyConfigured } from '@/lib/ashbyClient';
import { parseIdsFromFilename } from '@/lib/utils';

async function getApplicationId(filename: string): Promise<string | null> {
  const { candidateId, applicationId } = parseIdsFromFilename(filename);

  if (applicationId) return applicationId;

  // Fallback: lookup from metadata
  if (candidateId) {
    try {
      const metaPath = path.join(process.cwd(), 'dataset', 'ashby_metadata', `${candidateId}.json`);
      const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      return meta.application?.id || null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function archiveInAshby(filename: string): Promise<boolean> {
  if (process.env.AUTO_ARCHIVE_REJECTED !== 'true') return false;
  if (!isAshbyConfigured()) {
    console.warn('[archive] ASHBY_API_KEY not set');
    return false;
  }

  const applicationId = await getApplicationId(filename);
  if (!applicationId) {
    console.warn(`[archive] No applicationId for ${filename}`);
    return false;
  }

  const payload: Record<string, string> = { applicationId };
  if (process.env.ASHBY_ARCHIVE_REASON_ID) {
    payload.archiveReasonId = process.env.ASHBY_ARCHIVE_REASON_ID;
  }

  // Try setArchiveReason first
  try {
    const result = await ashbyRpc('application.setArchiveReason', payload);
    if (result?.success) {
      console.log(`[archive] Archived ${applicationId}`);
      return true;
    }
  } catch (err) {
    console.error('[archive] setArchiveReason failed:', err);
  }

  // Fallback: changeStage to Archived
  try {
    const fallback = await ashbyRpc('application.changeStage', {
      applicationId,
      stageType: 'Archived',
    });
    if (fallback?.success) {
      console.log(`[archive] Archived via changeStage: ${applicationId}`);
      return true;
    }
  } catch (err) {
    console.error('[archive] changeStage failed:', err);
  }

  console.error(`[archive] Failed to archive ${applicationId}`);
  return false;
}
