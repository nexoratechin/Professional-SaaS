import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, id, style, ...props }: InputProps) {
  const inputId = id ?? props.name;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: '0.85rem', color: '#374151' }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        {...props}
        style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', ...style }}
      />
    </div>
  );
}
