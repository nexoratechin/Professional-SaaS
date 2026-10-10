import React from 'react';
import { cx } from './theme';

/** Surface container. Backwards compatible with the original `Card` API; compose with the header /
 *  body / footer parts for structured panels. */
export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('ui-card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cx('ui-card__header', className)}>
      <div>
        {title != null && <h3 className="ui-card__title">{title}</h3>}
        {subtitle != null && <p className="ui-card__subtitle">{subtitle}</p>}
        {children}
      </div>
      {actions && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

export function CardBody({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('ui-card__body', className)}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx('ui-card__footer', className)}>
      {children}
    </div>
  );
}

export function Divider({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return <hr {...props} className={cx('ui-divider', className)} />;
}
