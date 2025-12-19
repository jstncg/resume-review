export const STATUS_PENDING = 'pending' as const;
export const STATUS_IN_PROGRESS = 'in_progress' as const;
export const STATUS_GOOD_FIT = 'good_fit' as const;
export const STATUS_BAD_FIT = 'bad_fit' as const;

export const STATUSES = {
  pending: STATUS_PENDING,
  in_progress: STATUS_IN_PROGRESS,
  good_fit: STATUS_GOOD_FIT,
  bad_fit: STATUS_BAD_FIT,
} as const;

export type Status = (typeof STATUSES)[keyof typeof STATUSES];
