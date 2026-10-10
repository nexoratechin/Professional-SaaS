import React from 'react';
import { cx } from './theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'danger' | 'warning' | 'info';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

/** Small status/label pill. */
export function Badge({ tone = 'neutral', className, children, ...props }: BadgeProps) {
  return (
    <span {...props} className={cx('ui-badge', tone !== 'neutral' && `ui-badge--${tone}`, className)}>
      {children}
    </span>
  );
}

/** Maps a free-form status/enum string to a stable tone so lists render consistent colours. */
export function statusTone(value: string | null | undefined): BadgeTone {
  const v = (value ?? '').toUpperCase();
  if (!v) return 'neutral';
  if (/ACTIVE|APPROVED|PAID|COMPLETED|SUCCESS|PRESENT|ENABLED|VERIFIED|PUBLISHED|ISSUED|ADMITTED|ENROLLED|RESOLVED|CLOSED/.test(v)) return 'success';
  if (/PENDING|PROVISIONAL|DRAFT|IN_PROGRESS|SCHEDULED|PARTIAL|WAITING|OPEN|REVIEW|SUBMITTED|PROCESSING/.test(v)) return 'warning';
  if (/FAILED|ERROR|REJECTED|SUSPENDED|WITHDRAWN|CANCELLED|CANCELED|OVERDUE|EXPIRED|ABSENT|INACTIVE|DISABLED|LOST|BLOCKED|DECLINED/.test(v)) return 'danger';
  if (/APPLICANT|NEW|INFO|NOTICE/.test(v)) return 'info';
  return 'neutral';
}
