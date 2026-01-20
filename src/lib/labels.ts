// Status constants
export const STATUS_PENDING = 'pending' as const;
export const STATUS_IN_PROGRESS = 'in_progress' as const;
export const STATUS_GOOD_FIT = 'good_fit' as const;
export const STATUS_BAD_FIT = 'bad_fit' as const;
export const STATUS_USER_REVIEWED_PREFIX = 'user_reviewed#' as const;
export const STATUS_VERY_GOOD = 'very_good' as const;
export const STATUS_PERFECT = 'perfect' as const;

export type Status =
  | typeof STATUS_PENDING
  | typeof STATUS_IN_PROGRESS
  | typeof STATUS_GOOD_FIT
  | typeof STATUS_BAD_FIT
  | typeof STATUS_USER_REVIEWED_PREFIX
  | typeof STATUS_VERY_GOOD
  | typeof STATUS_PERFECT;

// Tier hierarchy (higher = better)
export const TIER_ORDER: Record<string, number> = {
  [STATUS_BAD_FIT]: 0,
  [STATUS_GOOD_FIT]: 1,
  [STATUS_VERY_GOOD]: 2,
  [STATUS_PERFECT]: 3,
};

// All "passing" statuses
export const PASSING_STATUSES = [STATUS_GOOD_FIT, STATUS_VERY_GOOD, STATUS_PERFECT] as const;
