import { listDonationsForPage } from '@esoqo/db';
import { requireMyPage } from '@/lib/session';

export default async function DonorsScreen() {
  const { page } = await requireMyPage();
  const donations = await listDonationsForPage(page.organisationId);

  return (
    <>
      <h1>Donors</h1>
      <p className="sub">Everyone who has given to a campaign, most recent first.</p>
      <div className="card" style={{ padding: 0, overflow: 'auto' }}>
        <table className="dtable">
          <thead><tr><th>Supporter</th><th>Amount</th><th>Campaign</th><th>Receipt</th><th>Date</th></tr></thead>
          <tbody>
            {donations.length === 0 ? (
              <tr><td colSpan={5} style={{ color: '#8a8368' }}>No donations yet.</td></tr>
            ) : donations.map((d) => (
              <tr key={d.id}>
                <td>{d.anonymous ? 'Anonymous' : d.donorName}</td>
                <td className="mono">KES {Number(d.amountKes).toLocaleString('en-KE')}</td>
                <td>{d.campaign.title}</td>
                <td className="mono">{d.receiptCode ?? '—'}</td>
                <td>{d.confirmedAt?.toLocaleDateString('en-KE') ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
