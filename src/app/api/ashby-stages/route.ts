import { NextRequest, NextResponse } from 'next/server';
import { getInterviewStagesForJob, isAshbyConfigured } from '@/lib/ashbyClient';

export const runtime = 'nodejs';

/**
 * GET /api/ashby-stages?jobId=xxx
 * Returns the interview stages for a specific job.
 */
export async function GET(req: NextRequest) {
  if (!isAshbyConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Ashby API not configured' },
      { status: 500 }
    );
  }

  const jobId = req.nextUrl.searchParams.get('jobId');
  
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: 'Missing jobId parameter' },
      { status: 400 }
    );
  }

  try {
    const stages = await getInterviewStagesForJob(jobId);
    
    return NextResponse.json({
      ok: true,
      jobId,
      stages: stages.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        order: s.orderInInterviewPlan,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to fetch stages: ${message}` },
      { status: 500 }
    );
  }
}

