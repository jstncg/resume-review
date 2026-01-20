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
import type { Status } from '@/lib/labels';

// Updated to support 3-tier classification
export type TieredLabel = typeof STATUS_BAD_FIT | typeof STATUS_GOOD_FIT | typeof STATUS_VERY_GOOD | typeof STATUS_PERFECT;

export type AnalyzeDecision = {
  label: TieredLabel;
  reason: string;
  candidateName?: string; // Extracted candidate name from resume
};

// Legacy type for backwards compatibility
export type BasicDecision = {
  label: typeof STATUS_GOOD_FIT | typeof STATUS_BAD_FIT;
  reason: string;
};

function getModel() {
  // Default to a commonly available model; can be overridden via OPENAI_MODEL.
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
}

// Strict mode requires dual-pass verification at Stage 1
function isStrictMode(): boolean {
  return process.env.STRICT_MODE === 'true';
}

// Enable tiered classification (3-tier system)
function isTieredMode(): boolean {
  // Default to true - use 3-tier system
  return process.env.TIERED_MODE !== 'false';
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

function truncateForPrompt(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[TRUNCATED]';
}

export function isFinalLabel(label: string | undefined) {
  return label === STATUS_GOOD_FIT || label === STATUS_BAD_FIT || 
         label === STATUS_VERY_GOOD || label === STATUS_PERFECT;
}

export function isPassingLabel(label: string | undefined): boolean {
  return PASSING_STATUSES.includes(label as typeof PASSING_STATUSES[number]);
}

export function isInFlightLabel(label: string | undefined) {
  return label === STATUS_PENDING || label === STATUS_IN_PROGRESS;
}

// Minimum characters to consider a PDF as having meaningful text
const MIN_MEANINGFUL_TEXT_LENGTH = 100;

// Error class for scanned/image-based PDFs
export class ScannedPdfError extends Error {
  constructor(public extractedLength: number) {
    super(`PDF appears to be scanned/image-based. Extracted only ${extractedLength} characters.`);
    this.name = 'ScannedPdfError';
  }
}

export async function extractPdfText(absPath: string) {
  const buf = await fs.readFile(absPath);
  const data = await pdf(buf);
  const text = data.text || '';
  
  // Check if extraction got meaningful text
  // Remove whitespace and count actual characters
  const meaningfulLength = text.replace(/\s+/g, '').length;
  
  if (meaningfulLength < MIN_MEANINGFUL_TEXT_LENGTH) {
    // Likely a scanned/image-based PDF
    throw new ScannedPdfError(meaningfulLength);
  }
  
  return text;
}

// ============================================================================
// Name Extraction
// ============================================================================

const NAME_EXTRACTION_PROMPT = `Extract the candidate's full name from this resume.
Return ONLY JSON: {"name":string}
The name should be in "First Last" format (e.g., "John Smith").
If you cannot find a clear name, return {"name":"Unknown"}.`;

type NameExtractionResult = {
  name: string;
};

async function extractCandidateName(
  client: OpenAI,
  model: string,
  resumeText: string
): Promise<string> {
  try {
    // Only need the first part of the resume for name extraction
    const userPrompt = `Resume:\n${truncateForPrompt(resumeText, 3000)}`;
    const text = await callLLMWithPrompt(client, model, NAME_EXTRACTION_PROMPT, userPrompt);
    
    const result = parseJsonResponse<NameExtractionResult>(text);
    const name = result.name?.trim();
    
    if (!name || name === 'Unknown' || name.length === 0) {
      return 'Unknown';
    }
    
    return name;
  } catch (e) {
    console.warn('[llm-analyzer] Failed to extract candidate name:', e);
    return 'Unknown';
  }
}

/**
 * Extract candidate name from a PDF file (standalone function for batch extraction)
 */
export async function extractNameFromPdf(absPath: string): Promise<string> {
  try {
    const resumeText = await extractPdfText(absPath);
    const client = getClient();
    const model = getModel();
    return await extractCandidateName(client, model, resumeText);
  } catch (e) {
    console.warn('[llm-analyzer] Failed to extract name from PDF:', e);
    return 'Unknown';
  }
}

// ============================================================================
// Stage 1: Basic Pass/Fail Screening
// ============================================================================

const STAGE1_SYSTEM_PROMPT = `You are a strict resume screener. You must classify the resume against the condition.
Return ONLY JSON: {"label":"good_fit"|"bad_fit","reason":string}.
Do not include any extra keys or text.`;

async function callLLMWithPrompt(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  type ResponsesAPI = { responses: { create: (opts: unknown) => Promise<unknown> } };
  type ResponseResult = {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };

  try {
    const resp = await (client as unknown as ResponsesAPI).responses.create({
      model,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
    });

    const respObj = resp as ResponseResult;
    return respObj?.output_text ??
      respObj?.output
        ?.map((o) => o?.content?.map((c) => c?.text).join(''))
        .join('') ?? '';
  } catch {
    // Fallback to chat completions
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return completion.choices?.[0]?.message?.content ?? '';
  }
}

function parseJsonResponse<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM output was not valid JSON');
    return JSON.parse(m[0]) as T;
  }
}

async function evaluateStage1(
  client: OpenAI,
  model: string,
  condition: string,
  resumeText: string
): Promise<BasicDecision> {
  const userPrompt = `Condition:\n${condition}\n\nResume:\n${truncateForPrompt(resumeText, 20_000)}`;
  const text = await callLLMWithPrompt(client, model, STAGE1_SYSTEM_PROMPT, userPrompt);
  
  const decision = parseJsonResponse<BasicDecision>(text);
  
  if (decision.label !== STATUS_GOOD_FIT && decision.label !== STATUS_BAD_FIT) {
    throw new Error(`Stage 1: Invalid label: ${String(decision?.label)}`);
  }
  
  if (typeof decision.reason !== 'string' || decision.reason.length === 0) {
    decision.reason = 'No reason provided.';
  }
  
  return decision;
}

// ============================================================================
// Stage 2: Exceeds Expectations (STRICTER)
// ============================================================================

const STAGE2_SYSTEM_PROMPT = `You are an elite talent evaluator. This candidate has already passed basic screening.
Now evaluate if they EXCEED expectations - not just meet the bar, but clearly surpass it.

Criteria for "exceeds" (must demonstrate multiple):
- Impact beyond their role/level (promoted, led initiatives, measurable results)
- Leadership, mentorship, or architectural ownership
- Experience at well-respected companies (not just any company - ones known for engineering excellence)
- Technical depth beyond typical candidates (systems design, scaling, complex problem-solving)
- Impressive side projects or open source contributions

Be STRICT. Most candidates who "pass" should NOT reach this tier.
Only the top 20-30% of passing candidates should qualify as "exceeds".

Return ONLY JSON: {"exceeds":true|false,"reason":string}`;

type Stage2Decision = {
  exceeds: boolean;
  reason: string;
};

async function evaluateStage2(
  client: OpenAI,
  model: string,
  condition: string,
  resumeText: string
): Promise<Stage2Decision> {
  const userPrompt = `Original condition:\n${condition}\n\nResume (already passed basic screening):\n${truncateForPrompt(resumeText, 20_000)}`;
  const text = await callLLMWithPrompt(client, model, STAGE2_SYSTEM_PROMPT, userPrompt);
  
  const decision = parseJsonResponse<Stage2Decision>(text);
  
  if (typeof decision.exceeds !== 'boolean') {
    throw new Error(`Stage 2: Invalid exceeds value: ${String(decision?.exceeds)}`);
  }
  
  return {
    exceeds: decision.exceeds,
    reason: decision.reason || 'No reason provided.',
  };
}

// ============================================================================
// Stage 3: Elite/Perfect Evaluation (STRICTEST)
// ============================================================================

const STAGE3_SYSTEM_PROMPT = `You are evaluating for ELITE status - reserved for truly exceptional engineers.
This candidate has already passed TWO screening stages. Now determine if they belong in the top 1%.

Elite status is reserved for candidates comparable to engineers at:
- AI labs: OpenAI, Anthropic, DeepMind, Google Brain
- Top quant firms: Jane Street, Citadel, Two Sigma, DE Shaw, HRT
- Elite startups: Ramp, Figma (early), Stripe, Databricks
- Principal+ engineers at FAANG with exceptional track records

Indicators of elite status (must demonstrate at least 2-3):
- Founded or was early engineer at successful startup (Series B+ or acquired)
- Published research at top venues (NeurIPS, ICML, OSDI, SOSP) or significant patents
- Core contributor to major open source projects used industry-wide
- Competition winners: ICPC World Finals, IOI medals, Putnam Fellow, Kaggle Grandmaster
- 10x impact: Built systems serving millions, led org-wide technical initiatives
- Experience at the absolute top-tier (OpenAI, Jane Street, early Stripe, etc.)
- Stanford/MIT/CMU PhD or equivalent demonstrated excellence

Be EXTREMELY selective. When in doubt, return false.
This tier should capture only ~5-10% of "very good" candidates.

Return ONLY JSON: {"elite":true|false,"reason":string}`;

type Stage3Decision = {
  elite: boolean;
  reason: string;
};

async function evaluateStage3(
  client: OpenAI,
  model: string,
  condition: string,
  resumeText: string
): Promise<Stage3Decision> {
  const userPrompt = `Original condition:\n${condition}\n\nResume (already passed as "exceeds expectations"):\n${truncateForPrompt(resumeText, 20_000)}`;
  const text = await callLLMWithPrompt(client, model, STAGE3_SYSTEM_PROMPT, userPrompt);
  
  const decision = parseJsonResponse<Stage3Decision>(text);
  
  if (typeof decision.elite !== 'boolean') {
    throw new Error(`Stage 3: Invalid elite value: ${String(decision?.elite)}`);
  }
  
  return {
    elite: decision.elite,
    reason: decision.reason || 'No reason provided.',
  };
}

// ============================================================================
// Main Analysis Pipeline
// ============================================================================

export async function analyzeResumePdf(
  absPath: string,
  condition: string
): Promise<AnalyzeDecision> {
  const resumeText = await extractPdfText(absPath);

  const client = getClient();
  const primaryModel = getModel();
  const modelsToTry = getFallbackModels(primaryModel);
  const model = modelsToTry[0]; // Use primary model for tiered analysis

  // -------------------------------------------------------------------------
  // Stage 1: Basic Pass/Fail
  // -------------------------------------------------------------------------
  console.log('[llm-analyzer] Stage 1: Basic screening...');
  let stage1Result = await evaluateStage1(client, model, condition, resumeText);

  // If strict mode, run dual-pass verification at Stage 1
  if (isStrictMode() && stage1Result.label === STATUS_GOOD_FIT) {
    console.log('[llm-analyzer] Strict mode: Running Stage 1 verification pass...');
    const stage1Verify = await evaluateStage1(client, model, condition, resumeText);
    
    if (stage1Verify.label !== STATUS_GOOD_FIT) {
      console.log('[llm-analyzer] Strict mode: Verification failed, marking as bad_fit');
      return {
        label: STATUS_BAD_FIT,
        reason: `Failed strict verification. Pass 1: good_fit. Pass 2: ${stage1Verify.label} - ${stage1Verify.reason}`,
      };
    }
  }

  // If bad_fit, stop here (no name extraction needed)
  if (stage1Result.label === STATUS_BAD_FIT) {
    console.log('[llm-analyzer] Stage 1: Rejected');
    return {
      label: STATUS_BAD_FIT,
      reason: stage1Result.reason,
    };
  }

  // -------------------------------------------------------------------------
  // Extract candidate name (for passing candidates only)
  // -------------------------------------------------------------------------
  console.log('[llm-analyzer] Extracting candidate name...');
  const candidateName = await extractCandidateName(client, model, resumeText);
  console.log(`[llm-analyzer] Candidate name: ${candidateName}`);

  // If tiered mode is disabled, return good_fit with name
  if (!isTieredMode()) {
    console.log('[llm-analyzer] Tiered mode disabled, returning good_fit');
    return {
      label: STATUS_GOOD_FIT,
      reason: stage1Result.reason,
      candidateName,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 2: Exceeds Expectations
  // -------------------------------------------------------------------------
  console.log('[llm-analyzer] Stage 2: Evaluating if exceeds expectations...');
  const stage2Result = await evaluateStage2(client, model, condition, resumeText);

  if (!stage2Result.exceeds) {
    console.log('[llm-analyzer] Stage 2: Does not exceed - marking as good_fit (Passed)');
    return {
      label: STATUS_GOOD_FIT,
      reason: `Meets criteria. ${stage2Result.reason}`,
      candidateName,
    };
  }

  // -------------------------------------------------------------------------
  // Stage 3: Elite Evaluation
  // -------------------------------------------------------------------------
  console.log('[llm-analyzer] Stage 3: Evaluating for elite status...');
  const stage3Result = await evaluateStage3(client, model, condition, resumeText);

  if (!stage3Result.elite) {
    console.log('[llm-analyzer] Stage 3: Not elite - marking as very_good (Very Good)');
    return {
      label: STATUS_VERY_GOOD,
      reason: `Exceeds expectations. ${stage2Result.reason}`,
      candidateName,
    };
  }

  // -------------------------------------------------------------------------
  // Elite/Perfect Candidate!
  // -------------------------------------------------------------------------
  console.log('[llm-analyzer] Stage 3: ELITE candidate - marking as perfect!');
  return {
    label: STATUS_PERFECT,
    reason: `Exceptional candidate. ${stage3Result.reason}`,
    candidateName,
  };
}
