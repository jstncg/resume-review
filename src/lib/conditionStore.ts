type ConditionState = {
  condition: string;
  version: number;
  updatedAt: number;
};

const DEFAULT_CONDITION =
  "Candidate should have 5+ years of experience working as a software engineer.";

function initialState(): ConditionState {
  const condition = process.env.ANALYSIS_CONDITION || DEFAULT_CONDITION;
  return { condition, version: 1, updatedAt: Date.now() };
}

function getGlobal(): { __sentraConditionState?: ConditionState } {
  return globalThis as unknown as { __sentraConditionState?: ConditionState };
}

export function getConditionState(): ConditionState {
  const g = getGlobal();
  if (!g.__sentraConditionState) g.__sentraConditionState = initialState();
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


