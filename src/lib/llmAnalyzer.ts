import OpenAI from 'openai';
import { promises as fs } from 'node:fs';
import pdf from 'pdf-parse';
import {
  STATUS_BAD_FIT,
  STATUS_GOOD_FIT,
  STATUS_VERY_GOOD,
  STATUS_PERFECT,
  STATUS_IN_PROGRESS,
  STATUS_PENDING,
  PASSING_STATUSES,
} from '@/lib/labels';

export type TieredLabel = typeof STATUS_BAD_FIT | typeof STATUS_GOOD_FIT | typeof STATUS_VERY_GOOD | typeof STATUS_PERFECT;

export type AnalyzeDecision = {
  label: TieredLabel;
  reason: string;
  candidateName?: string;
};

// Configuration
const getModel = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const isStrictMode = () => process.env.STRICT_MODE === 'true';
const isTieredMode = () => process.env.TIERED_MODE !== 'false';
const MIN_TEXT_LENGTH = 100;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey });
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(0, maxChars) + '\n\n[TRUNCATED]';
}

// Label helpers
export const isFinalLabel = (label: string | undefined) =>
  label === STATUS_GOOD_FIT || label === STATUS_BAD_FIT ||
  label === STATUS_VERY_GOOD || label === STATUS_PERFECT;

export const isPassingLabel = (label: string | undefined): boolean =>
  PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number]);

export const isInFlightLabel = (label: string | undefined) =>
  label === STATUS_PENDING || label === STATUS_IN_PROGRESS;

// PDF Error
export class ScannedPdfError extends Error {
  constructor(public extractedLength: number) {
    super(`PDF appears to be scanned/image-based. Only ${extractedLength} characters extracted.`);
    this.name = 'ScannedPdfError';
  }
}

export async function extractPdfText(absPath: string): Promise<string> {
  const buf = await fs.readFile(absPath);
  const data = await pdf(buf);
  const text = data.text || '';
  const meaningfulLength = text.replace(/\s+/g, '').length;

  if (meaningfulLength < MIN_TEXT_LENGTH) {
    throw new ScannedPdfError(meaningfulLength);
  }
  return text;
}

// ============================================================================
// LLM Calls
// ============================================================================

type LLMResponse = { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };

async function callLLM(
  client: OpenAI,
  model: string,
  system: string,
  user: string
): Promise<string> {
  try {
    // Try Responses API first
    const resp = await (client as unknown as { responses: { create: (opts: unknown) => Promise<unknown> } })
      .responses.create({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
      });

    const r = resp as LLMResponse;
    return r?.output_text ?? r?.output?.map(o => o?.content?.map(c => c?.text).join('')).join('') ?? '';
  } catch {
    // Fallback to Chat Completions
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return completion.choices?.[0]?.message?.content ?? '';
  }
}

function parseJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM output was not valid JSON');
    return JSON.parse(m[0]) as T;
  }
}

// ============================================================================
// Evaluation Stages
// ============================================================================

const STAGE1_PROMPT = `You are a strict resume screener. Classify the resume against the condition.
Return ONLY JSON: {"label":"good_fit"|"bad_fit","reason":string}`;

const STAGE2_PROMPT = `You are an elite talent evaluator. This candidate passed basic screening.
Evaluate if they EXCEED expectations (top 20-30% of passing candidates).
Criteria: impact beyond role, leadership, prestigious companies, technical depth, side projects.
Be STRICT. Return ONLY JSON: {"exceeds":true|false,"reason":string}`;

const STAGE3_PROMPT = `You are evaluating for ELITE status (top 1%).
Reserved for: AI labs (OpenAI, Anthropic), top quant firms (Jane Street, Citadel), elite startups (Ramp, Figma).
Indicators: startup founder, published research, major OSS contributor, competition winner (ICPC, IOI), 10x impact.
Be EXTREMELY selective. Return ONLY JSON: {"elite":true|false,"reason":string}`;

const NAME_PROMPT = `Extract the candidate's full name from this resume.
Return ONLY JSON: {"name":string}. If unclear, return {"name":"Unknown"}.`;

type Stage1Result = { label: 'good_fit' | 'bad_fit'; reason: string };
type Stage2Result = { exceeds: boolean; reason: string };
type Stage3Result = { elite: boolean; reason: string };

async function evaluateStage1(client: OpenAI, model: string, condition: string, text: string): Promise<Stage1Result> {
  const user = `Condition:\n${condition}\n\nResume:\n${truncate(text, 20_000)}`;
  const result = parseJSON<Stage1Result>(await callLLM(client, model, STAGE1_PROMPT, user));

  if (result.label !== STATUS_GOOD_FIT && result.label !== STATUS_BAD_FIT) {
    throw new Error(`Invalid label: ${result?.label}`);
  }
  return { label: result.label, reason: result.reason || 'No reason provided.' };
}

async function evaluateStage2(client: OpenAI, model: string, condition: string, text: string): Promise<Stage2Result> {
  const user = `Original condition:\n${condition}\n\nResume:\n${truncate(text, 20_000)}`;
  const result = parseJSON<Stage2Result>(await callLLM(client, model, STAGE2_PROMPT, user));
  return { exceeds: Boolean(result.exceeds), reason: result.reason || 'No reason provided.' };
}

async function evaluateStage3(client: OpenAI, model: string, condition: string, text: string): Promise<Stage3Result> {
  const user = `Original condition:\n${condition}\n\nResume:\n${truncate(text, 20_000)}`;
  const result = parseJSON<Stage3Result>(await callLLM(client, model, STAGE3_PROMPT, user));
  return { elite: Boolean(result.elite), reason: result.reason || 'No reason provided.' };
}

async function extractName(client: OpenAI, model: string, text: string): Promise<string> {
  try {
    const result = parseJSON<{ name: string }>(await callLLM(client, model, NAME_PROMPT, `Resume:\n${truncate(text, 3000)}`));
    const name = result.name?.trim();
    return name && name !== 'Unknown' ? name : 'Unknown';
  } catch {
    return 'Unknown';
  }
}

/**
 * Extract candidate name from a PDF file (standalone function).
 */
export async function extractNameFromPdf(absPath: string): Promise<string> {
  try {
    const text = await extractPdfText(absPath);
    return await extractName(getClient(), getModel(), text);
  } catch {
    return 'Unknown';
  }
}

// ============================================================================
// Main Analysis Pipeline
// ============================================================================

export async function analyzeResumePdf(absPath: string, condition: string): Promise<AnalyzeDecision> {
  const text = await extractPdfText(absPath);
  const client = getClient();
  const model = getModel();

  // Stage 1: Basic Pass/Fail
  console.log('[llm] Stage 1: Basic screening...');
  const stage1 = await evaluateStage1(client, model, condition, text);

  // Strict mode: dual-pass verification
  if (isStrictMode() && stage1.label === STATUS_GOOD_FIT) {
    console.log('[llm] Strict mode: Running verification...');
    const verify = await evaluateStage1(client, model, condition, text);
    if (verify.label !== STATUS_GOOD_FIT) {
      return { label: STATUS_BAD_FIT, reason: `Failed strict verification: ${verify.reason}` };
    }
  }

  if (stage1.label === STATUS_BAD_FIT) {
    console.log('[llm] Stage 1: Rejected');
    return { label: STATUS_BAD_FIT, reason: stage1.reason };
  }

  // Extract name for passing candidates
  console.log('[llm] Extracting candidate name...');
  const candidateName = await extractName(client, model, text);

  // Non-tiered mode: return good_fit
  if (!isTieredMode()) {
    return { label: STATUS_GOOD_FIT, reason: stage1.reason, candidateName };
  }

  // Stage 2: Exceeds Expectations
  console.log('[llm] Stage 2: Evaluating exceeds...');
  const stage2 = await evaluateStage2(client, model, condition, text);

  if (!stage2.exceeds) {
    console.log('[llm] Stage 2: Passed (meets criteria)');
    return { label: STATUS_GOOD_FIT, reason: `Meets criteria. ${stage2.reason}`, candidateName };
  }

  // Stage 3: Elite Evaluation
  console.log('[llm] Stage 3: Evaluating elite...');
  const stage3 = await evaluateStage3(client, model, condition, text);

  if (!stage3.elite) {
    console.log('[llm] Stage 3: Very Good');
    return { label: STATUS_VERY_GOOD, reason: `Exceeds expectations. ${stage2.reason}`, candidateName };
  }

  console.log('[llm] Stage 3: ELITE candidate!');
  return { label: STATUS_PERFECT, reason: `Exceptional. ${stage3.reason}`, candidateName };
}
