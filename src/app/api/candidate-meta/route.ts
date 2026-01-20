import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { parseIdsFromFilename, getAshbyProfileUrl } from '@/lib/utils';

export const runtime = 'nodejs';

type CandidateMetadata = {
  candidate?: { name: string };
  jobId?: string;
  raw?: {
    status?: string;
    currentInterviewStage?: { title: string };
  };
};

/**
 * GET /api/candidate-meta?filename=...
 * Returns metadata for a candidate including their Ashby profile URL.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const filename = url.searchParams.get('filename');

  if (!filename) {
    return NextResponse.json(
      { error: 'Missing filename parameter' },
      { status: 400 }
    );
  }

  const { candidateId, applicationId } = parseIdsFromFilename(filename);

  if (!candidateId || !applicationId) {
    return NextResponse.json(
      { error: 'Invalid filename format' },
      { status: 400 }
    );
  }

  // Try to load metadata file
  const metadataDir = path.resolve(process.cwd(), 'dataset', 'ashby_metadata');
  const metadataPath = path.join(metadataDir, `${candidateId}.json`);

  let metadata: CandidateMetadata | null = null;
  try {
    const raw = await fs.readFile(metadataPath, 'utf8');
    metadata = JSON.parse(raw);
  } catch {
    // Metadata file doesn't exist
  }

  return NextResponse.json({
    filename,
    candidateId,
    applicationId,
    ashbyProfileUrl: getAshbyProfileUrl(candidateId),
    candidateName: metadata?.candidate?.name || null,
    jobId: metadata?.jobId || null,
    applicationStatus: metadata?.raw?.status || null,
    currentStage: metadata?.raw?.currentInterviewStage?.title || null,
  });
}
