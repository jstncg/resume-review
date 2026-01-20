import { NextResponse } from 'next/server';
import { getConditionState, setCondition } from '@/lib/conditionStore';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json(getConditionState());
}

export async function POST(req: Request) {
  let body: { condition?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (typeof body?.condition !== 'string') {
    return NextResponse.json({ error: 'condition string required' }, { status: 400 });
  }

  return NextResponse.json(setCondition(body.condition));
}
