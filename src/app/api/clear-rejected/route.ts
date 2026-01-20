import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const runtime = 'nodejs';

const REJECTED_PATH = path.join(process.cwd(), 'dataset', 'rejected_candidates.json');

export async function POST() {
  try {
    let count = 0;
    try {
      const raw = await fs.readFile(REJECTED_PATH, 'utf8');
      count = Object.keys(JSON.parse(raw).candidates || {}).length;
    } catch {
      return NextResponse.json({ ok: true, cleared: 0, message: 'No rejected candidates file' });
    }

    await fs.writeFile(
      REJECTED_PATH,
      JSON.stringify({ version: 1, lastUpdated: new Date().toISOString(), candidates: {} }, null, 2),
      'utf8'
    );

    return NextResponse.json({ ok: true, cleared: count, message: `Cleared ${count} rejected candidate(s)` });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}

export async function GET() {
  try {
    const raw = await fs.readFile(REJECTED_PATH, 'utf8');
    const data = JSON.parse(raw);
    const candidates = data.candidates || {};
    const count = Object.keys(candidates).length;

    return NextResponse.json({
      ok: true,
      count,
      candidates: Object.entries(candidates).map(([id, info]) => ({ candidateId: id, ...(info as object) })),
    });
  } catch {
    return NextResponse.json({ ok: true, count: 0, candidates: [] });
  }
}
