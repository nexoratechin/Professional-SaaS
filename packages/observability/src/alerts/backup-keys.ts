/**
 * Redis keys recording the last successful backup per kind — the cross-process signal the API's
 * alert engine reads to page when backups stop running (rule `backup_stale`).
 *
 * The worker writes them with a 90-day TTL: long enough that "never recorded" versus "very stale"
 * are distinguishable, short enough that a decommissioned worker fleet eventually stops looking
 * like a fresh backup.
 */
export const BACKUP_LAST_SUCCESS_KEYS = {
  postgres: 'obs:backup:last_success:postgres',
  redis: 'obs:backup:last_success:redis',
} as const;

export type BackupKindKey = keyof typeof BACKUP_LAST_SUCCESS_KEYS;

/** 90 days, in seconds. */
export const BACKUP_LAST_SUCCESS_TTL_SECONDS = 90 * 24 * 60 * 60;
