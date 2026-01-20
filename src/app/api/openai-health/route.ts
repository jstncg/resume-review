import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { truncate } from '@/lib/utils';

export const runtime = 'nodejs';

export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: 'Missing OPENAI_API_KEY', model },
      { status: 500 }
    );
  }

  const client = new OpenAI({ apiKey });

  try {
    // Ultra-small request just to validate auth + model access.
    const resp = await (client as unknown as { responses: { create: (opts: unknown) => Promise<unknown> } }).responses.create({
      model,
      input: 'Reply with the single word: ok',
      temperature: 0,
      max_output_tokens: 5,
    });

    const respObj = resp as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const text =
      respObj?.output_text ??
      respObj?.output
        ?.map((o) => o?.content?.map((c) => c?.text).join(''))
        .join('') ??
      '';

    return NextResponse.json({
      ok: true,
      model,
      output: truncate(String(text || ''), 80),
    });
  } catch (e) {
    const err = e as { code?: string; error?: { code?: string }; message?: string };
    const code = err?.code || err?.error?.code || null;
    const message = err?.message || String(e);
    return NextResponse.json(
      { ok: false, model, code, error: truncate(message, 500) },
      { status: 500 }
    );
  }
}
