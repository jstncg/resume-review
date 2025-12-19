import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import pdf from 'pdf-parse';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
} from '@/lib/labels';
import type { Status } from '@/lib/labels';

export type AnalyzeDecision = {
  label: Extract<Status, typeof STATUS_GOOD_FIT | typeof STATUS_BAD_FIT>;
  reason: string;
};

const DEFAULT_CONDITION =
  'Candidate should have 5+ years of experience working as a software engineer.';

function getCondition() {
  return process.env.ANALYSIS_CONDITION || DEFAULT_CONDITION;
}

function getModel() {
  // Default to a commonly available model; can be overridden via OPENAI_MODEL.
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

function getFallbackModels(primary: string) {
  const fallbacks = [primary, 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'].filter(
    Boolean
  );
  return [...new Set(fallbacks)];
}

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Missing OPENAI_API_KEY. Set it in your environment before running the dev server.'
    );
  }
  return new OpenAI({ apiKey });
}

function truncateForPrompt(text: string, maxChars: number) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[TRUNCATED]';
}

export function isFinalLabel(label: string | undefined) {
  return label === STATUS_GOOD_FIT || label === STATUS_BAD_FIT;
}

export function isInFlightLabel(label: string | undefined) {
  return label === STATUS_PENDING || label === STATUS_IN_PROGRESS;
}

export async function extractPdfText(absPath: string) {
  const buf = await fs.readFile(absPath);
  const data = await pdf(buf);
  return data.text || '';
}

async function decideWithResponsesApi(
  client: OpenAI,
  model: string,
  condition: string,
  resumeText: string
): Promise<AnalyzeDecision> {
  const prompt = [
    {
      role: 'system' as const,
      content:
        'You are a strict resume screener. You must classify the resume against the condition.\n' +
        'Return ONLY JSON: {"label":"good_fit"|"bad_fit","reason":string}.\n' +
        'Do not include any extra keys or text.',
    },
    {
      role: 'user' as const,
      content:
        `Condition:\n${condition}\n\nResume:\n` +
        truncateForPrompt(resumeText, 20_000),
    },
  ];

  // Prefer Responses API when available.
  const resp: any = await (client as any).responses.create({
    model,
    input: prompt,
    // keep it deterministic-ish for now
    temperature: 0,
  });

  const text =
    resp?.output_text ??
    resp?.output
      ?.map((o: any) => o?.content?.map((c: any) => c?.text).join(''))
      .join('') ??
    '';

  try {
    return JSON.parse(text) as AnalyzeDecision;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM output was not valid JSON');
    return JSON.parse(m[0]) as AnalyzeDecision;
  }
}

async function decideWithChatCompletions(
  client: OpenAI,
  model: string,
  condition: string,
  resumeText: string
): Promise<AnalyzeDecision> {
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict resume screener. Classify the resume against the condition.\n' +
          'Return ONLY JSON: {"label":"good_fit"|"bad_fit","reason":string}.',
      },
      {
        role: 'user',
        content:
          `Condition:\n${condition}\n\nResume:\n` +
          truncateForPrompt(resumeText, 20_000),
      },
    ],
  });

  const text = completion.choices?.[0]?.message?.content ?? '';
  try {
    return JSON.parse(text) as AnalyzeDecision;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM output was not valid JSON');
    return JSON.parse(m[0]) as AnalyzeDecision;
  }
}

export async function analyzeResumePdf(
  absPath: string
): Promise<AnalyzeDecision> {
  const condition = getCondition();
  const resumeText = await extractPdfText(absPath);

  const client = getClient();
  const primaryModel = getModel();
  const modelsToTry = getFallbackModels(primaryModel);

  const coerceDecision = (decision: AnalyzeDecision): AnalyzeDecision => {
    if (
      decision.label !== STATUS_GOOD_FIT &&
      decision.label !== STATUS_BAD_FIT
    ) {
      throw new Error(
        `LLM returned invalid label: ${String((decision as any)?.label)}`
      );
    }

    if (typeof decision.reason !== 'string' || decision.reason.length === 0) {
      decision.reason = 'No reason provided.';
    }

    return decision;
  };

  let lastErr: unknown = null;
  for (const model of modelsToTry) {
    try {
      const decision = await decideWithResponsesApi(
        client,
        model,
        condition,
        resumeText
      );
      return coerceDecision(decision);
    } catch (e: any) {
      lastErr = e;
      const code = e?.code || e?.error?.code;
      if (code === 'model_not_found') continue;
      try {
        const decision = await decideWithChatCompletions(
          client,
          model,
          condition,
          resumeText
        );
        return coerceDecision(decision);
      } catch (e2: any) {
        lastErr = e2;
        const code2 = e2?.code || e2?.error?.code;
        if (code2 === 'model_not_found') continue;
        break;
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));

  // unreachable
}
