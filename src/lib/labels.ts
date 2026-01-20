export const STATUS_PENDING = 'pending' as const;
export const STATUS_IN_PROGRESS = 'in_progress' as const;
export const STATUS_GOOD_FIT = 'good_fit' as const;
export const STATUS_BAD_FIT = 'bad_fit' as const;
export const STATUS_USER_REVIEWED_PREFIX = 'user_reviewed#' as const;

// New tier statuses for 3-tier classification
export const STATUS_VERY_GOOD = 'very_good' as const;
export const STATUS_PERFECT = 'perfect' as const;

export const STATUSES = {
  pending: STATUS_PENDING,
  in_progress: STATUS_IN_PROGRESS,
  good_fit: STATUS_GOOD_FIT,
  bad_fit: STATUS_BAD_FIT,
  user_reviewed: STATUS_USER_REVIEWED_PREFIX,
  very_good: STATUS_VERY_GOOD,
  perfect: STATUS_PERFECT,
} as const;

export type Status = (typeof STATUSES)[keyof typeof STATUSES];

// Tier hierarchy for sorting/comparison (higher = better)
export const TIER_ORDER: Record<string, number> = {
  [STATUS_BAD_FIT]: 0,
  [STATUS_GOOD_FIT]: 1,
  [STATUS_VERY_GOOD]: 2,
  [STATUS_PERFECT]: 3,
};

// All "passing" statuses (used for filtering)
export const PASSING_STATUSES = [STATUS_GOOD_FIT, STATUS_VERY_GOOD, STATUS_PERFECT] as const;
