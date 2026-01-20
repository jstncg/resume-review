import { NextRequest, NextResponse } from 'next/server';
import { changeApplicationStage, canChangeStage, isAshbyConfigured } from '@/lib/ashbyClient';

export const runtime = 'nodejs';

/**
 * POST /api/ashby-move-stage
 * Move a candidate to a different interview stage in Ashby.
 * 
 * Request body:
 * {
 *   applicationId: string;      // Ashby application ID
 *   interviewStageId: string;   // Target stage ID
 * }
 */
export async function POST(req: NextRequest) {
  if (!isAshbyConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'Ashby API not configured' },
      { status: 500 }
    );
  }

  let body: { applicationId?: string; interviewStageId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { applicationId, interviewStageId } = body;

  if (!applicationId || !interviewStageId) {
    return NextResponse.json(
      { ok: false, error: 'Missing applicationId or interviewStageId' },
      { status: 400 }
    );
  }

  try {
    const result = await changeApplicationStage(applicationId, interviewStageId);
    
    if (!result.success) {
      // Check if it's a permission error
      if (result.error?.includes('missing_endpoint_permission')) {
        return NextResponse.json({
          ok: false,
          error: 'Missing Ashby API permission. Please enable "Candidates: Write" permission for your API key.',
          permissionError: true,
        }, { status: 403 });
      }
      
      return NextResponse.json(
        { ok: false, error: result.error || 'Failed to change stage' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      applicationId,
      interviewStageId,
      message: 'Successfully moved candidate to new stage',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to move stage: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ashby-move-stage
 * Check if the API key has permission to change stages.
 */
export async function GET() {
  if (!isAshbyConfigured()) {
    return NextResponse.json({
      ok: true,
      hasPermission: false,
      reason: 'Ashby API not configured',
    });
  }

  try {
    const hasPermission = await canChangeStage();
    return NextResponse.json({
      ok: true,
      hasPermission,
      reason: hasPermission ? undefined : 'API key lacks "Candidates: Write" permission',
    });
  } catch (error) {
    return NextResponse.json({
      ok: true,
      hasPermission: false,
      reason: error instanceof Error ? error.message : 'Check failed',
    });
  }
}

