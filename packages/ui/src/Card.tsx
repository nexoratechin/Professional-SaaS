import React from 'react';

export function Card({ children, style, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: '1.25rem',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
