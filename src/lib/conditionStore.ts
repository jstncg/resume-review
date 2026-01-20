/**
 * In-memory condition state with global singleton pattern.
 */

type ConditionState = {
  condition: string;
  version: number;
  updatedAt: number;
};

const DEFAULT_CONDITION =
  'Candidate must have 3+ years of impactful backend experience at FAANG (Google, Meta, Apple, Amazon, Netflix), FAANG-equivalent companies (Microsoft, Stripe, Airbnb, Uber, Lyft), or top-tier startups (Ramp, Databricks, Figma, Notion, etc.). Experience must be building customer-facing products, NOT internal tooling. Candidate must NOT have worked in India within the last 3 years.';

type GlobalState = { __sentraCondition?: ConditionState; __sentraConditionInit?: boolean };
const getGlobal = (): GlobalState => globalThis as unknown as GlobalState;

const createInitialState = (): ConditionState => ({
  condition: process.env.ANALYSIS_CONDITION || DEFAULT_CONDITION,
  version: 1,
  updatedAt: Date.now(),
});

export function getConditionState(): ConditionState {
  const g = getGlobal();

  if (!g.__sentraCondition || (g.__sentraCondition.version === 1 && !g.__sentraConditionInit)) {
    g.__sentraCondition = createInitialState();
    g.__sentraConditionInit = true;
  }

  return g.__sentraCondition;
}

export function setCondition(nextCondition: string): ConditionState {
  const trimmed = nextCondition.trim();
  const g = getGlobal();
  const prev = getConditionState();

  g.__sentraCondition = {
    condition: trimmed || prev.condition,
    version: prev.version + 1,
    updatedAt: Date.now(),
  };

  return g.__sentraCondition;
}
