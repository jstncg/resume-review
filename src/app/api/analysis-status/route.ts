import { NextResponse } from 'next/server';
import { getAnalysisQueueStatus } from '@/lib/analysisPipeline';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(getAnalysisQueueStatus());
}




