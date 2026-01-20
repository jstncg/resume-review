import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { truncate } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY', model }, { status: 500 });
  }

  const client = new OpenAI({ apiKey });

  try {
    type ResponsesAPI = { responses: { create: (opts: unknown) => Promise<unknown> } };
    type ResponseResult = { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };

    const resp = await (client as unknown as ResponsesAPI).responses.create({
      model,
      input: 'Reply with the single word: ok',
      temperature: 0,
      max_output_tokens: 5,
    });

    const r = resp as ResponseResult;
    const text = r?.output_text ?? r?.output?.map(o => o?.content?.map(c => c?.text).join('')).join('') ?? '';

    return NextResponse.json({ ok: true, model, output: truncate(String(text || ''), 80) });
  } catch (e) {
    const err = e as { code?: string; error?: { code?: string }; message?: string };
    return NextResponse.json({
      ok: false,
      model,
      code: err?.code || err?.error?.code || null,
      error: truncate(err?.message || String(e), 500),
    }, { status: 500 });
  }
}
