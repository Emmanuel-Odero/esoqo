import { Icon } from '@esoko/ui';
import { VisuallyHidden } from '@esoko/a11y';
import { spellMoney } from '@esoko/a11y';

export interface Quote {
  commodity: string; unit: string; market: string; county: string;
  price: number | null; change: number | null; collectedAt?: string;
}

/**
 * The price board.
 *
 * Absence is data: a market that has not reported says so, rather than
 * repeating yesterday's figure. A board that quietly goes stale destroys
 * the trust everything else on this site depends on.
 */
export function Board({ rows, title = 'Market prices' }: { rows: Quote[]; title?: string }) {
  return (
    <div className="board">
      <div className="bh">
        <span className="dot" />
        <span>{title} · today {new Date().toTimeString().slice(0, 5)}</span>
      </div>
      {rows.map((r) => (
        <div className="br" key={`${r.commodity}-${r.market}`}>
          <div>
            <span>{r.commodity}</span>
            <span className="m">{r.unit.toUpperCase()} · {r.market.toUpperCase()}</span>
          </div>
          {r.price === null ? (
            <span className="p" style={{ color: 'var(--amber)', fontSize: '.84rem' }}>
              Not submitted today
            </span>
          ) : (
            <span className="p">
              KES {r.price.toLocaleString('en-KE')}
              <VisuallyHidden>{spellMoney(r.price)}</VisuallyHidden>
            </span>
          )}
          {r.change !== null && (
            <span className={`c ${r.change > 0 ? 'up' : r.change < 0 ? 'dn' : 'fl'}`}>
              <Icon name={r.change > 0 ? 'trend-up' : r.change < 0 ? 'trend-down' : 'trend-flat'} size={15} />
              {r.change > 0 ? '+' : ''}{r.change.toFixed(1)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
