import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Field({ label, hint, error, className = '', children }: FieldProps) {
  return (
    <div className={`fld ${className}`}>
      <label className="lab">{label}</label>
      {children}
      {hint && <p className="hint">{hint}</p>}
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="inp" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="inp" {...props} />;
}
