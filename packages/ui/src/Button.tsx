import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({ variant = 'primary', style, ...props }: ButtonProps) {
  const base: React.CSSProperties = {
    padding: '0.5rem 1rem',
    borderRadius: 6,
    border: '1px solid transparent',
    fontSize: '0.9rem',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    opacity: props.disabled ? 0.6 : 1,
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: '#1d4ed8', color: '#fff' },
    secondary: { background: '#fff', color: '#1d4ed8', borderColor: '#1d4ed8' },
  };
  return <button {...props} style={{ ...base, ...variants[variant], ...style }} />;
}
