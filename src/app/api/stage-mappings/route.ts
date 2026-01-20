import { NextRequest, NextResponse } from 'next/server';
import {
  loadStageMappings,
  saveStageMappings,
  StageMappingConfig,
} from '@/lib/stageMappings';

export const runtime = 'nodejs';

/**
 * GET /api/stage-mappings
 * Returns the current stage mapping configuration.
 */
export async function GET() {
  try {
    const config = await loadStageMappings();
    return NextResponse.json({
      ok: true,
      config,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to load stage mappings: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/stage-mappings
 * Save stage mapping configuration.
 * 
 * Request body: StageMappingConfig
 */
export async function POST(req: NextRequest) {
  let body: Partial<StageMappingConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate required fields
  if (!body.jobId) {
    return NextResponse.json(
      { ok: false, error: 'Missing jobId in configuration' },
      { status: 400 }
    );
  }

  try {
    // Load existing config and merge
    const existing = await loadStageMappings();
    
    const newConfig: StageMappingConfig = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      jobId: body.jobId,
      mappings: {
        ...existing.mappings,
        ...body.mappings,
      },
    };

    await saveStageMappings(newConfig);

    return NextResponse.json({
      ok: true,
      config: newConfig,
      message: 'Stage mappings saved successfully',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to save stage mappings: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/stage-mappings
 * Clear all stage mappings.
 */
export async function DELETE() {
  try {
    const defaultConfig: StageMappingConfig = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      jobId: null,
      mappings: {},
    };
    
    await saveStageMappings(defaultConfig);
    
    return NextResponse.json({
      ok: true,
      message: 'Stage mappings cleared',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to clear stage mappings: ${message}` },
      { status: 500 }
    );
  }
}

