import type { ReactNode } from 'react';

export function PageHeader({
  kicker,
  title,
  lead,
  actions,
  className = '',
}: {
  kicker?: string;
  title: string;
  lead?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`phead-ui ${className}`}>
      <div className="ui-wrap">
        {kicker && <p className="ui-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {lead && <p className="ui-lead">{lead}</p>}
        {actions && <div className="ui-row" style={{ marginTop: 18 }}>{actions}</div>}
      </div>
    </div>
  );
}
