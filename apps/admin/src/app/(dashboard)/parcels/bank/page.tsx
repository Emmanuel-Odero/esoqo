import Link from 'next/link';
import { Icon } from '@esoqo/ui';
import { requireStaff } from '@/lib/session';
import {
  actionGetBankBalance,
  actionGetBankStatement,
  actionListParcelOrgPayoutOverview,
} from '../actions';
import { StatementFilter } from './StatementFilter';

export const dynamic = 'force-dynamic';

/**
 * The admin "bank account" overview.
 *
 * Two different kinds of "balance" live on this page, and they are
 * never the same number: the Co-op balance at the top is real money
 * sitting in Esoqo's own settlement account, read straight from the
 * bank. The per-company rollup below it is an internal ledger
 * liability — what Esoqo owes each courier company out of that same
 * account, not a bank account of their own. See core-go's
 * dbx.ListParcelOrgPayoutOverview.
 */
export default async function BankAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string; end?: string }>;
}) {
  await requireStaff();
  const sp = await searchParams;

  const [balanceResult, statementResult, companies] = await Promise.all([
    actionGetBankBalance(),
    actionGetBankStatement(sp.start ?? '', sp.end ?? ''),
    actionListParcelOrgPayoutOverview(),
  ]);

  const needsActionCompanies = companies.filter((c) => c.needsActionCount > 0);
  const totalPaid = companies.reduce((n, c) => n + c.paidKes, 0);
  const totalInFlight = companies.reduce((n, c) => n + c.inFlightKes, 0);
  const totalNeedsAction = companies.reduce((n, c) => n + c.needsActionKes, 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Bank account</h1>
          <p>
            Esoqo&apos;s own Co-op settlement account — balance and statement straight from the
            bank — alongside what every courier company is owed, in flight, or stuck waiting on.
          </p>
        </div>
      </div>

      {!balanceResult.ok ? (
        <div
          className="chain"
          style={{ background: 'var(--red-t)', border: '1px solid #E8B4B4', color: 'var(--red)', marginBottom: 16 }}
        >
          <Icon name="alert-triangle" size={18} />
          <span>Could not load the Co-op balance: {balanceResult.error}</span>
        </div>
      ) : (
        <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div className="kpi g">
            <span className="l">Available balance</span>
            <span className="n">
              KES {balanceResult.balance.AvailableBalance.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
            </span>
            <span className="sub">
              {balanceResult.balance.AccountName} · {balanceResult.balance.AccountNumber}
            </span>
          </div>
          <div className="kpi">
            <span className="l">Cleared balance</span>
            <span className="n">
              KES {balanceResult.balance.ClearedBalance.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
            </span>
            <span className="sub">{balanceResult.balance.ProductName}</span>
          </div>
          <div className="kpi">
            <span className="l">Blocked</span>
            <span className="n">
              KES {balanceResult.balance.BlockedBalance.toLocaleString('en-KE', { maximumFractionDigits: 2 })}
            </span>
            <span className="sub">{balanceResult.balance.BranchName}</span>
          </div>
        </div>
      )}

      <div className="kpis" style={{ marginBottom: 22, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="kpi">
          <span className="l">Paid to companies</span>
          <span className="n">KES {totalPaid.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
          <span className="sub">
            Across {companies.length} {companies.length === 1 ? 'company' : 'companies'}
          </span>
        </div>
        <div className="kpi">
          <span className="l">In flight</span>
          <span className="n">KES {totalInFlight.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</span>
          <span className="sub">A payout is already out with Daraja/Co-op</span>
        </div>
        <div className={`kpi ${totalNeedsAction > 0 ? 'a' : ''}`}>
          <span className="l">Needs action</span>
          <span className="n" style={{ color: totalNeedsAction > 0 ? 'var(--amber)' : undefined }}>
            KES {totalNeedsAction.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
          </span>
          <span className="sub">
            {needsActionCompanies.length > 0 ? (
              <Link href="/parcels/companies/payouts">See manual payouts →</Link>
            ) : (
              'Nothing stuck right now'
            )}
          </span>
        </div>
      </div>

      <div className="card" style={{ padding: 0, marginBottom: 22 }}>
        <div style={{ padding: '14px 16px 0' }}>
          <h2 style={{ marginBottom: 10 }}>
            <Icon name="document" size={17} />
            Statement
          </h2>
          <StatementFilter
            start={statementResult.ok ? statementResult.statement.startDate : sp.start ?? ''}
            end={statementResult.ok ? statementResult.statement.endDate : sp.end ?? ''}
          />
        </div>
        {!statementResult.ok ? (
          <p className="sub" style={{ padding: 16 }}>Could not load the statement: {statementResult.error}</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Date</th><th>Narration</th>
                  <th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th>
                </tr>
              </thead>
              <tbody>
                {statementResult.statement.transactions.map((t, i) => (
                  <tr key={`${t.TransactionID}-${i}`}>
                    <td className="mono" style={{ fontSize: '.82rem', whiteSpace: 'nowrap' }}>
                      {t.TransactionDate.slice(0, 10)}
                    </td>
                    <td>{t.Narration}</td>
                    <td className="num mono">
                      {t.DebitAmount > 0 ? t.DebitAmount.toLocaleString('en-KE', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="num mono">
                      {t.CreditAmount > 0 ? t.CreditAmount.toLocaleString('en-KE', { maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="num mono">{t.RunningBalance.toLocaleString('en-KE', { maximumFractionDigits: 2 })}</td>
                  </tr>
                ))}
                {statementResult.statement.transactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                      No transactions in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <h2 style={{ padding: '14px 16px 0' }}>
          <Icon name="building" size={17} />
          Companies
        </h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Company</th><th className="num">Commission</th>
                <th className="num">Paid</th><th className="num">In flight</th><th className="num">Needs action</th>
                <th>Last payout</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.parcelOrgId}>
                  <td>{c.parcelOrgName}</td>
                  <td className="num mono">{c.commissionPct}%</td>
                  <td className="num mono">{c.paidKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
                  <td className="num mono">{c.inFlightKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}</td>
                  <td className="num mono">
                    {c.needsActionCount > 0 ? (
                      <Link href="/parcels/companies/payouts" style={{ color: 'var(--amber)' }}>
                        {c.needsActionKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })} ({c.needsActionCount})
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="sub" style={{ fontSize: '.82rem' }}>
                    {c.lastPayoutAt ? c.lastPayoutAt.slice(0, 10) : 'Never'}
                  </td>
                </tr>
              ))}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={6} className="sub" style={{ textAlign: 'center', padding: 24 }}>
                    No courier companies onboarded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
