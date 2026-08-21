import { listMySupportTickets } from '@esoko/db';
import { SUPPORT_TICKET_CATEGORY_LABELS, SUPPORT_TICKET_STATUS_LABELS } from '@esoko/domain';
import { requireMyPage } from '@/lib/session';
import { SupportTicketForm } from './SupportTicketForm';

const STATUS_COLOR: Record<string, string> = {
  OPEN: '#8a8368', IN_PROGRESS: '#B8720F', RESOLVED: 'var(--ledger)', CLOSED: '#8a8368',
};

export default async function SupportScreen() {
  const { ctx, page } = await requireMyPage();
  const tickets = await listMySupportTickets(ctx);

  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Support</h1>
      <p className="sub">Hit a bug, have a question, or something not working as expected? Raise it here.</p>

      <SupportTicketForm pageId={page.organisationId} />

      <h2 style={{ fontSize: '1.05rem', marginBottom: 8 }}>Your tickets</h2>
      {tickets.length === 0 ? (
        <p className="sub">Nothing raised yet.</p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'auto', maxWidth: 760 }}>
          <table className="dtable">
            <thead><tr><th>Subject</th><th>Category</th><th>Status</th><th>Raised</th></tr></thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id}>
                  <td><b>{t.subject}</b><div style={{ fontSize: '.8rem', color: '#6b6552' }}>{t.message.slice(0, 100)}{t.message.length > 100 ? '…' : ''}</div></td>
                  <td>{t.category === 'OTHER' ? t.categoryOther || 'Other' : SUPPORT_TICKET_CATEGORY_LABELS[t.category]}</td>
                  <td style={{ color: STATUS_COLOR[t.status], fontWeight: 700 }}>{SUPPORT_TICKET_STATUS_LABELS[t.status]}</td>
                  <td className="mono">{t.createdAt.toLocaleDateString('en-KE')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
