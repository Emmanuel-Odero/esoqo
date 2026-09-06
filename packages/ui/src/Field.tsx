import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children?: React.ReactNode;
}

export function Field({ label, hint, error, id, className = '', children }: FieldProps & { id?: string }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`fld ${className}`}>
      <label className="lab" htmlFor={id}>{label}</label>
      {childrenWithProps(children, { id, describedBy, invalid: !!error })}
      {hint && <p className="hint" id={id ? `${id}-hint` : undefined}>{hint}</p>}
      {error && <p className="err" role="alert" id={id ? `${id}-err` : undefined}>{error}</p>}
    </div>
  );
}

function childrenWithProps(children: React.ReactNode, extra: { id?: string; describedBy?: string; invalid?: boolean }) {
  // Attach id / aria-describedby to the single field control when possible.
  if (!children || Array.isArray(children)) return children;
  if (typeof children !== 'object' || !('props' in (children as object))) return children;
  const child = children as React.ReactElement<Record<string, unknown>>;
  const patch: Record<string, unknown> = {};
  if (extra.id && child.props.id === undefined) patch.id = extra.id;
  if (extra.describedBy && child.props['aria-describedby'] === undefined) patch['aria-describedby'] = extra.describedBy;
  if (extra.invalid && child.props['aria-invalid'] === undefined) patch['aria-invalid'] = 'true';
  return Object.keys(patch).length ? { ...child, props: { ...child.props, ...patch } } : child;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="inp" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="inp" {...props} />;
}
