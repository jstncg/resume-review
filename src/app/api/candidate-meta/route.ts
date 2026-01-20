import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { parseIdsFromFilename, getAshbyProfileUrl } from '@/lib/utils';

export const runtime = 'nodejs';

type Metadata = {
  candidate?: { name: string };
  jobId?: string;
  raw?: { status?: string; currentInterviewStage?: { title: string } };
};

export async function GET(req: Request) {
  const filename = new URL(req.url).searchParams.get('filename');

  if (!filename) {
    return NextResponse.json({ error: 'Missing filename' }, { status: 400 });
  }

  const { candidateId, applicationId } = parseIdsFromFilename(filename);

  if (!candidateId || !applicationId) {
    return NextResponse.json({ error: 'Invalid filename format' }, { status: 400 });
  }

  let metadata: Metadata | null = null;
  try {
    const metaPath = path.join(process.cwd(), 'dataset', 'ashby_metadata', `${candidateId}.json`);
    metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
  } catch {
    // No metadata
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
