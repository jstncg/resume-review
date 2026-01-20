import { NextRequest, NextResponse } from 'next/server';
import { bulkResumeWatcher } from '@/lib/bulkWatcher';
import { getBulkAnalysisQueueStatus } from '@/lib/bulkAnalysisPipeline';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { condition } = body as { condition?: string };
    
    if (!condition || typeof condition !== 'string' || condition.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Condition is required' },
        { status: 400 }
      );
    }
    
    const enqueued = await bulkResumeWatcher.analyzeAllPending(condition.trim());
    const status = getBulkAnalysisQueueStatus();
    
    return NextResponse.json({
      ok: true,
      enqueued,
      queueStatus: status,
    });
  } catch (err) {
    console.error('[bulk-analyze] Error:', err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Analysis failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  const status = getBulkAnalysisQueueStatus();
  return NextResponse.json({
    ok: true,
    queueStatus: status,
  });
}



