type ConditionState = {
  condition: string;
  version: number;
  updatedAt: number;
};

const DEFAULT_CONDITION =
  'Candidate must have 3+ years of impactful backend experience at FAANG (Google, Meta, Apple, Amazon, Netflix), FAANG-equivalent companies (Microsoft, Stripe, Airbnb, Uber, Lyft), or top-tier startups (Ramp, Databricks, Figma, Notion, etc.). Experience must be building customer-facing products, NOT internal tooling. Candidate must NOT have worked in India within the last 3 years.';

/**
 * Get the default condition from environment or code default.
 * This is the condition that should be used on every fresh start.
 */
function getDefaultCondition(): string {
  return process.env.ANALYSIS_CONDITION || DEFAULT_CONDITION;
}

function initialState(): ConditionState {
  return { condition: getDefaultCondition(), version: 1, updatedAt: Date.now() };
}

function getGlobal(): { __sentraConditionState?: ConditionState; __sentraConditionInitialized?: boolean } {
  return globalThis as unknown as { __sentraConditionState?: ConditionState; __sentraConditionInitialized?: boolean };
}

export function getConditionState(): ConditionState {
  const g = getGlobal();
  
  // Always initialize fresh on server start (version 1 means never saved by user)
  if (!g.__sentraConditionState || (g.__sentraConditionState.version === 1 && !g.__sentraConditionInitialized)) {
    g.__sentraConditionState = initialState();
    g.__sentraConditionInitialized = true;
  }
  
  return g.__sentraConditionState;
}

export function setCondition(nextCondition: string): ConditionState {
  const trimmed = nextCondition.trim();
  const g = getGlobal();
  const prev = getConditionState();
  g.__sentraConditionState = {
    condition: trimmed.length ? trimmed : prev.condition,
    version: prev.version + 1,
    updatedAt: Date.now(),
  };
  return g.__sentraConditionState;
}
