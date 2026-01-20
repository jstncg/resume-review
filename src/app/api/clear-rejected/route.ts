import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

/**
 * POST /api/clear-rejected
 * Clears the rejected candidates tracking file so they can be re-pulled and re-analyzed.
 */
export async function POST() {
  const rejectedPath = path.join(process.cwd(), 'dataset', 'rejected_candidates.json');

  try {
    // Check if file exists
    try {
      await fs.stat(rejectedPath);
    } catch {
      return NextResponse.json({
        ok: true,
        cleared: 0,
        message: 'No rejected candidates file found',
      });
    }

    // Read current file to get count
    const raw = await fs.readFile(rejectedPath, 'utf8');
    const data = JSON.parse(raw);
    const count = Object.keys(data.candidates || {}).length;

    // Reset the file to empty state
    const emptyData = {
      version: 1,
      lastUpdated: new Date().toISOString(),
      candidates: {},
    };
    await fs.writeFile(rejectedPath, JSON.stringify(emptyData, null, 2), 'utf8');

    return NextResponse.json({
      ok: true,
      cleared: count,
      message: `Cleared ${count} rejected candidate(s). They can now be re-pulled.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: `Failed to clear rejected candidates: ${message}` },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clear-rejected
 * Returns the count of currently rejected candidates.
 */
export async function GET() {
  const rejectedPath = path.join(process.cwd(), 'dataset', 'rejected_candidates.json');

  try {
    const raw = await fs.readFile(rejectedPath, 'utf8');
    const data = JSON.parse(raw);
    const candidates = data.candidates || {};
    const count = Object.keys(candidates).length;

    return NextResponse.json({
      ok: true,
      count,
      candidates: Object.entries(candidates).map(([id, info]) => ({
        candidateId: id,
        ...(info as object),
      })),
    });
  } catch {
    return NextResponse.json({
      ok: true,
      count: 0,
      candidates: [],
    });
  }
}

