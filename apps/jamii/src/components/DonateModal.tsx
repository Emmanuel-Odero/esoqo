'use client';

import { useEffect, useRef, useState } from 'react';
import { donate, checkDonationStatus } from '@/lib/donate-actions';

const PRESET_AMOUNTS = [500, 1000, 2500];

export function DonateModal({
  campaignId, campaignTitle, open, onClose,
}: { campaignId: string; campaignTitle: string; open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [amount, setAmount] = useState(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<{ receiptCode: string | null; mpesaReceiptCode: string | null } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  if (!open) return null;

  const effectiveAmount = customAmount ? Number(customAmount) : amount;

  async function submit() {
    setError(null);
    if (!/^\+254(7|1)\d{8}$/.test(phone) && !/^0(7|1)\d{8}$/.test(phone)) {
      setError('Enter a valid Kenyan mobile number');
      return;
    }
    if (!(effectiveAmount > 0)) {
      setError('Enter an amount above zero');
      return;
    }
    setPending(true);
    setStep(2);
    const normalisedPhone = phone.startsWith('0') ? `+254${phone.slice(1)}` : phone;
    const result = await donate({
      campaignId, donorName: anonymous ? '' : name, donorMsisdn: normalisedPhone,
      amountKes: effectiveAmount, anonymous,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      setStep(1);
      return;
    }
    if (result.data.status === 'CONFIRMED') {
      const r = await checkDonationStatus(result.data.donationId);
      setReceipt(r);
      setStep(3);
    } else {
      pollRef.current = setInterval(async () => {
        const r = await checkDonationStatus(result.data.donationId);
        if (r.status === 'CONFIRMED') {
          if (pollRef.current) clearInterval(pollRef.current);
          setReceipt(r);
          setStep(3);
        } else if (r.status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(r.failureReason || 'The M-Pesa payment was not completed. Please try again.');
          setStep(1);
        }
      }, 2500);
    }
  }

  function reset() {
    setStep(1); setError(null); setReceipt(null);
    if (pollRef.current) clearInterval(pollRef.current);
    onClose();
  }

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Support this campaign">
      <div className="modal">
        <button className="mclose" aria-label="Close" onClick={reset}>×</button>

        {step === 1 && (
          <>
            <h3>Support {campaignTitle}</h3>
            <p className="sub">100% goes to this campaign, minus standard M-Pesa transaction fees.</p>
            <div className="amtgrid">
              {PRESET_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  className="amtchip"
                  aria-pressed={!customAmount && amount === a}
                  onClick={() => { setAmount(a); setCustomAmount(''); }}
                >
                  KES {a.toLocaleString('en-KE')}
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="donateCustomAmt">Or enter your own amount</label>
              <input id="donateCustomAmt" type="number" min={1} placeholder="KES" value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="donateName">Your name (optional)</label>
              <input id="donateName" type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={anonymous} />
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '.85rem', marginBottom: 16 }}>
              <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
              Give anonymously
            </label>
            <div className="field">
              <label htmlFor="donatePhone">M-Pesa phone number</label>
              <input id="donatePhone" type="text" placeholder="07XX XXX XXX" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <div className="hint">We&rsquo;ll send an STK push to this number to confirm the payment.</div>
            </div>
            {error && <p className="field-err" style={{ color: 'var(--stamp)', fontSize: '.85rem', marginBottom: 12 }}>{error}</p>}
            <button className="btn btn-stamp btn-block" onClick={submit} disabled={pending}>
              Send M-Pesa request
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h3>Check your phone</h3>
            <p className="sub">Enter your M-Pesa PIN on the prompt to complete the payment.</p>
            <div className="spinner" role="status" aria-label="Waiting for confirmation" />
            <div className="mpesabadge">STK push sent to <span className="mono">{phone}</span></div>
          </>
        )}

        {step === 3 && (
          <>
            <div className="successwrap">
              <span className="stampmark" style={{ marginBottom: 16 }}>Received</span>
              <h3>Asante sana!</h3>
              <p className="sub">Your gift has been added to the ledger.</p>
            </div>
            <div className="receiptbox">
              <div className="rline"><span>Receipt</span><span>{receipt?.receiptCode ?? '—'}</span></div>
              <div className="rline"><span>Campaign</span><span>{campaignTitle}</span></div>
              {receipt?.mpesaReceiptCode && <div className="rline"><span>M-Pesa code</span><span>{receipt.mpesaReceiptCode}</span></div>}
              <div className="rline total"><span>Amount</span><span>KES {effectiveAmount.toLocaleString('en-KE')}</span></div>
            </div>
            <button className="btn btn-outline btn-block" onClick={reset}>Back to campaign</button>
          </>
        )}
      </div>
    </div>
  );
}
