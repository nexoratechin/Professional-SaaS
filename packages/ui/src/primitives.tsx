import React from 'react';

type Gap = number | string;

function toGap(gap: Gap | undefined): string | undefined {
  if (gap === undefined) return undefined;
  return typeof gap === 'number' ? `${gap * 4}px` : gap;
}

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Vertical rhythm between children. A number is multiplied by 4px. */
  gap?: Gap;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  as?: keyof JSX.IntrinsicElements;
}

/** Vertical flex stack — the default page/section layout primitive. */
export function Stack({ gap = 4, align, justify, as, style, children, ...props }: StackProps) {
  const Tag = (as ?? 'div') as React.ElementType;
  return (
    <Tag
      {...props}
      style={{ display: 'flex', flexDirection: 'column', gap: toGap(gap), alignItems: align, justifyContent: justify, ...style }}
    >
      {children}
    </Tag>
  );
}

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: React.CSSProperties['alignItems'];
  justify?: React.CSSProperties['justifyContent'];
  wrap?: boolean;
  as?: keyof JSX.IntrinsicElements;
}

/** Horizontal flex row that wraps by default — for toolbars, action groups, meta rows. */
export function Inline({ gap = 2, align = 'center', justify, wrap = true, as, style, children, ...props }: InlineProps) {
  const Tag = (as ?? 'div') as React.ElementType;
  return (
    <Tag
      {...props}
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: wrap ? 'wrap' : 'nowrap',
        gap: toGap(gap),
        alignItems: align,
        justifyContent: justify,
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Fixed column count. Omit to use the auto-responsive min-width grid. */
  columns?: number;
  /** Minimum column width for the auto-responsive grid (default 220px). */
  min?: number | string;
  gap?: Gap;
}

/** Responsive CSS grid — a fixed column count, or auto-fit columns no narrower than `min`. */
export function Grid({ columns, min = 220, gap = 4, style, children, ...props }: GridProps) {
  const templateColumns = columns
    ? `repeat(${columns}, minmax(0, 1fr))`
    : `repeat(auto-fill, minmax(${typeof min === 'number' ? `${min}px` : min}, 1fr))`;
  return (
    <div {...props} style={{ display: 'grid', gridTemplateColumns: templateColumns, gap: toGap(gap), ...style }}>
      {children}
    </div>
  );
}

/** A responsive page/section container with consistent max width and gutters. */
export function Container({ size = 1200, style, children, ...props }: React.HTMLAttributes<HTMLDivElement> & { size?: number }) {
  return (
    <div {...props} style={{ width: '100%', maxWidth: size, margin: '0 auto', padding: '0 16px', ...style }}>
      {children}
    </div>
  );
}
