'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { QRCodeSVG } from 'qrcode.react';
import { buildPayLink } from '@esoqo/domain';
import {
  actionLookupBusiness, actionStartPayment, actionPaymentStatus,
  type BusinessLookup, type PayeeView, type PaymentStatusView,
} from './actions';

/**
 * The /pay screen, in the order a customer standing at a counter
 * actually needs it.
 *
 * The QR comes first and the typing is the fallback, which is the
 * reverse of the obvious build order and the whole point of the page.
 * A business prints a stand; the customer points a phone at it; the
 * page opens already knowing which business is being paid. Somebody
 * who arrives without a printed stand — or whose camera is too old to
 * read a QR — types an Esoqo ID, a phone number or a name, and gets
 * the identical screen.
 *
 * The QR encodes a *link*, never the JSON the first version of this
 * page emitted. A phone camera has no idea what `{"type":"esoqo-
 * payment"}` is and will helpfully offer to Google it; a link opens a
 * page, which then does the one thing a camera genuinely cannot do —
 * take an amount and a phone number and push an STK prompt.
 */

const POLL_INTERVAL_MS = 2500;
/** How long to keep asking before saying something honest and stopping.
 *  Long enough for a customer who fumbled their PIN, short enough that
 *  the tab is not a browser-full-of-open-tabs. */
const POLL_GIVE_UP_MS = 5 * 60 * 1000;

/** What to say when a code resolves to nothing payable.
 *
 *  The distinction matters more than it looks. The commonest way to
 *  arrive at /pay with a `?to=` that cannot be paid is a phone camera
 *  reading something that is not a payable business at all — most often
 *  somebody's *own* Esoqo ID, or a business that registered but never
 *  activated one. Landing on an empty search box with no explanation
 *  reads as a broken page; saying so is the difference between a dead
 *  end and an answer. */
function noPayeeMessage(lookup: BusinessLookup): string {
  switch (lookup.status) {
    case 'NOT_PAYABLE':
      return 'That Esoqo ID is not a business that can take payments. A business needs an active Esoqo ID before customers can pay it.';
    case 'EMPTY':
      return 'Enter an Esoqo business ID, a phone number, or a business name.';
    case 'NOT_FOUND':
      return 'No business matches that. Check the code, or try the business name.';
    case 'FOUND':
      return '';
  }
}

type Step = 'lookup' | 'pay' | 'waiting' | 'done' | 'failed' | 'unresolved';

export function PayClient({
  initialLookup,
  prefillAmount,
}: {
  /** Server-resolved from ?to=…, so a scanned link never flashes an
   *  empty form. Null when the page was opened with no code. */
  initialLookup: BusinessLookup | null;
  prefillAmount: string | null;
}) {
  const [step, setStep] = useState<Step>(initialLookup?.status === 'FOUND' ? 'pay' : 'lookup');
  const [identifier, setIdentifier] = useState('');
  const [lookup, setLookup] = useState<BusinessLookup | null>(initialLookup);
  const [payee, setPayee] = useState<PayeeView | null>(
    initialLookup?.status === 'FOUND' ? initialLookup.businesses[0] ?? null : null,
  );

  const [amount, setAmount] = useState(prefillAmount ?? '');
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [payerEsoqoId, setPayerEsoqoId] = useState('');
  const [note, setNote] = useState('');

  // A code that arrived in the URL and could not be paid is a dead end
  // the customer did not choose, so it is explained on arrival rather
  // than waiting for them to press Find and be told again.
  const [error, setError] = useState(() => {
    if (!initialLookup || initialLookup.status === 'FOUND') return '';
    if (initialLookup.status === 'NOT_FOUND') {
      // A code-shaped thing that resolves to nothing at all is most
      // often a typo'd sticker or a personal ID, so name the possibility
      // rather than leaving them to guess.
      return 'No business matches that code. If it is a business, check the characters — and remember it is an Esoqo *business* ID, not a personal one.';
    }
    return noPayeeMessage(initialLookup);
  });
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PaymentStatusView | null>(null);
  const [pending, startTransition] = useTransition();

  // The shareable link the QR encodes. Built after mount because it
  // needs the browser's origin, which the server doesn't reliably know
  // behind a proxy — and a QR that encodes the wrong host is worse than
  // one that appears a moment later.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const payLink = payee && origin ? buildPayLink(origin, payee.esoqoId, null) : null;

  const reset = useCallback(() => {
    setStep('lookup');
    setIdentifier('');
    setLookup(null);
    setPayee(null);
    setAmount(prefillAmount ?? '');
    setPayerName('');
    setPayerPhone('');
    setPayerEsoqoId('');
    setNote('');
    setError('');
    setPaymentId(null);
    setOutcome(null);
  }, [prefillAmount]);

  const handleLookup = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLookup(null);
    startTransition(async () => {
      const result = await actionLookupBusiness(identifier);
      setLookup(result);
      const only = result.status === 'FOUND' && result.businesses.length === 1
        ? result.businesses.at(0)
        : null;
      if (only) {
        setPayee(only);
        setStep('pay');
      } else if (result.status === 'FOUND') {
        setError('More than one business matches — pick the right one below.');
      } else {
        setError(result.status === 'NOT_FOUND'
          ? 'No business matches that. Check the code, or try the business name.'
          : noPayeeMessage(result));
      }
    });
  }, [identifier]);

  const handlePay = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!payee) return;
    setError('');

    const amountKes = Number(amount);
    if (!Number.isFinite(amountKes) || amountKes <= 0) {
      setError('Enter an amount above zero.');
      return;
    }
    if (!payerPhone.trim()) {
      setError('Enter the M-Pesa number you are paying from.');
      return;
    }

    startTransition(async () => {
      const res = await actionStartPayment({
        payeePartyId: payee.partyId,
        amountKes,
        payerMsisdn: payerPhone.trim(),
        payerName: payerName.trim() || undefined,
        payerEsoqoId: payerEsoqoId.trim() || undefined,
        note: note.trim() || undefined,
      });
      if (res.status === 'REJECTED' || res.status === 'ERROR') {
        setError(res.message);
        return;
      }
      setPaymentId(res.paymentId);
      setStep('waiting');
      if (res.alreadyConfirmed) {
        // The console provider confirms inline rather than calling the
        // webhook, so there is nothing to wait for. Re-read the row
        // instead of assuming — the receipt codes come from the DAL,
        // not from the push response.
        const settled = await actionPaymentStatus(res.paymentId);
        setOutcome(settled);
        setStep(settled.status === 'CONFIRMED' ? 'done' : settled.status === 'FAILED' ? 'failed' : 'waiting');
      }
    });
  }, [payee, amount, payerPhone, payerName, payerEsoqoId, note]);

  // Poll while waiting on Safaricom. Stops on a terminal status and
  // gives up after five minutes, because a customer staring at a
  // spinner for longer than that is a worse answer than being told to
  // check their M-Pesa messages — their receipt SMS still lands either
  // way, and the business is still alerted.
  const waitingSince = useRef<number | null>(null);
  // A customer told to wait should not have to re-enter the payment to
  // hear how it went, and a stale tab that was asleep for an hour should
  // not have already used up its five minutes. Both start the clock over.
  const recheck = useCallback(() => {
    waitingSince.current = null;
    setStep('waiting');
  }, []);
  useEffect(() => {
    if (step !== 'waiting' || !paymentId) return;
    waitingSince.current ??= Date.now();
    let cancelled = false;

    const poll = async () => {
      const status = await actionPaymentStatus(paymentId);
      if (cancelled) return;
      // Keep the latest view even while pending: it carries the payment
      // reference, which the unresolved card needs.
      setOutcome(status);
      if (status.status === 'PENDING') {
        const waited = Date.now() - waitingSince.current!;
        if (waited < POLL_GIVE_UP_MS) {
          setTimeout(poll, POLL_INTERVAL_MS);
        } else {
          // Not 'failed', and not a lie by omission either. Every poll
          // above already asked Safaricom what happened and it has not
          // said, so the honest answer is that nobody knows yet — and
          // telling a customer their payment failed when it may have
          // succeeded is how they pay the same bill twice.
          setStep('unresolved');
        }
        return;
      }
      setStep(status.status === 'CONFIRMED' ? 'done' : 'failed');
    };

    const timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, paymentId]);

  const onPayee = payee;
  const confirmed = outcome?.status === 'CONFIRMED' ? outcome : null;
  const failure = outcome?.status === 'FAILED' ? outcome : null;

  return (
    <div className="pay-page">
      <section className="phead">
        <div className="wrap" style={{ textAlign: 'center' }}>
          <span className="icbox" style={{ background: 'rgba(255,255,255,.12)', color: '#fff', width: 52, height: 52, borderRadius: 13, margin: '0 auto 16px' }}>
            <Icon name="coins" size={28} />
          </span>
          <p className="kicker" style={{ justifyContent: 'center' }}>Pay</p>
          <h1 style={{ margin: '0 auto' }}>
            {onPayee ? `Pay ${onPayee.name}` : 'Pay an Esoqo Business'}
          </h1>
          <p className="lead" style={{ margin: '12px auto 0', maxWidth: 480 }}>
            {onPayee
              ? 'Enter the amount and your M-Pesa number, and confirm the prompt on your phone.'
              : 'Enter the Esoqo business ID, phone number, or business name to pay with M-Pesa.'}
          </p>
        </div>
      </section>

      <section className="sec">
        <div className="wrap" style={{ maxWidth: 560 }}>
          {step === 'lookup' && (
            <form onSubmit={handleLookup}>
              <div className="card" style={{ padding: 28 }}>
                <h2 style={{ marginBottom: 6 }}>Find a business</h2>
                <p className="sub" style={{ marginBottom: 18 }}>
                  Enter the Esoqo business ID, phone number, or business name
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="Esoqo business ID or name"
                    className="mono"
                    style={{
                      flex: 1, minWidth: 0, padding: '12px 14px', minHeight: 50,
                      border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.05rem',
                      background: 'var(--paper)',
                    }}
                    aria-label="Business identifier"
                    required
                  />
                  <button type="submit" className="btn btn-p" disabled={pending || !identifier.trim()}>
                    {pending ? <span className="spin" aria-hidden /> : <Icon name="arrow-right" size={16} />}
                    {pending ? 'Searching…' : 'Find'}
                  </button>
                </div>
                {error && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
                    {error}
                  </div>
                )}
                {lookup?.status === 'FOUND' && lookup.businesses.length > 1 && (
                  <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 8 }}>
                    {lookup.businesses.map((b) => (
                      <li key={b.partyId}>
                        <button
                          type="button"
                          className="btn btn-b btn-block"
                          style={{ textAlign: 'left', justifyContent: 'space-between' }}
                          onClick={() => { setPayee(b); setError(''); setStep('pay'); }}
                        >
                          <span>
                            <span style={{ display: 'block', fontWeight: 600 }}>{b.name}</span>
                            <span className="mono" style={{ fontSize: '.78rem', color: 'var(--tx-3)' }}>{b.esoqoId}</span>
                          </span>
                          <Icon name="arrow-right" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div style={{ marginTop: 16 }}>
                  <p className="sub" style={{ marginBottom: 8, fontSize: '.82rem', color: 'var(--tx-3)' }}>Accepted identifiers:</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                    <span className="chip mono">Business ID</span>
                    <span className="chip mono">Phone number</span>
                    <span className="chip mono">Business name</span>
                    <span className="chip mono">Email</span>
                  </div>
                </div>
              </div>
            </form>
          )}

          {onPayee && step !== 'done' && step !== 'failed' && step !== 'unresolved' && (
            <div className="card" style={{ padding: 28 }}>
              <div style={{ marginBottom: 18, padding: 14, background: 'var(--green-t)', borderRadius: 8 }}>
                <p className="sub" style={{ margin: 0, fontSize: '.82rem', color: 'var(--green)' }}>BUSINESS FOUND</p>
                <p style={{ margin: '4px 0 0', fontWeight: 700, fontSize: '1.1rem' }}>{onPayee.name}</p>
                <p className="mono" style={{ margin: '2px 0 0', fontSize: '.82rem', color: 'var(--tx-2)' }}>
                  {onPayee.esoqoId}
                  {onPayee.registrationNo ? ` · ${onPayee.registrationNo}` : ''}
                </p>
              </div>

              <form onSubmit={handlePay}>
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="amount" style={{ display: 'block', fontWeight: 600, fontSize: '.88rem', marginBottom: 6 }}>
                    Amount (KES)
                  </label>
                  <input
                    id="amount"
                    type="number"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    min="1"
                    step="0.01"
                    required
                    style={{
                      width: '100%', padding: '12px 14px', minHeight: 50,
                      border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.2rem',
                      fontFamily: 'var(--font-mono)', background: 'var(--paper)',
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="payer-phone" style={{ display: 'block', fontWeight: 600, fontSize: '.88rem', marginBottom: 6 }}>
                    Your M-Pesa number
                  </label>
                  <input
                    id="payer-phone"
                    type="tel"
                    inputMode="tel"
                    value={payerPhone}
                    onChange={(e) => setPayerPhone(e.target.value)}
                    placeholder="07XX XXX XXX"
                    autoComplete="tel"
                    required
                    style={{
                      width: '100%', padding: '12px 14px', minHeight: 50,
                      border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '1.05rem',
                      fontFamily: 'var(--font-mono)', background: 'var(--paper)',
                    }}
                  />
                </div>

                <details style={{ marginBottom: 18 }}>
                  <summary style={{ cursor: 'pointer', fontSize: '.86rem', color: 'var(--tx-2)' }}>
                    Add your details (optional)
                  </summary>
                  <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                    <input
                      type="text"
                      value={payerName}
                      onChange={(e) => setPayerName(e.target.value)}
                      placeholder="Your name"
                      aria-label="Your name"
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={payerEsoqoId}
                      onChange={(e) => setPayerEsoqoId(e.target.value.toUpperCase())}
                      placeholder="Your Esoqo ID"
                      className="mono"
                      aria-label="Your Esoqo ID"
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="What this is for"
                      aria-label="Note"
                      style={inputStyle}
                    />
                  </div>
                </details>

                <button
                  type="submit"
                  className="btn btn-p btn-block"
                  disabled={pending || step === 'waiting' || !amount || !payerPhone.trim()}
                >
                  {pending || step === 'waiting' ? <span className="spin" aria-hidden /> : <Icon name="coins" size={18} />}
                  {step === 'waiting'
                    ? 'Waiting for M-Pesa…'
                    : pending
                      ? 'Sending…'
                      : `Pay KES ${Number(amount).toLocaleString('en-KE')}`}
                </button>
              </form>

              {error && (
                <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--red-t)', borderRadius: 8, color: 'var(--red)', fontSize: '.9rem' }}>
                  {error}
                </div>
              )}

              {step === 'waiting' && (
                <p className="sub" style={{ marginTop: 14, textAlign: 'center' }}>
                  Approve the M-Pesa prompt on your phone. This page updates on its own.
                </p>
              )}

              {payLink && step !== 'waiting' && (
                <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid var(--line)', textAlign: 'center' }}>
                  <p className="sub" style={{ margin: '0 0 12px', fontSize: '.82rem', color: 'var(--tx-2)' }}>
                    Pay on another phone, or share this payment
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {origin ? (
                      <QRCodeSVG
                        value={payLink}
                        size={176}
                        level="M"
                        includeMargin
                        fgColor="#0A2E4D"
                        bgColor="#ffffff"
                      />
                    ) : (
                      <div style={{ width: 176, height: 176 }} aria-hidden />
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-b"
                    style={{ marginTop: 12 }}
                    onClick={() => navigator.clipboard?.writeText(payLink)}
                  >
                    <Icon name="link" size={16} />
                    Copy link
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={reset}
                style={{ background: 'none', border: 0, color: 'var(--tx-3)', fontSize: '.84rem', cursor: 'pointer', padding: '12px 0 0', textDecoration: 'underline', display: 'block', margin: '12px auto 0' }}
              >
                Pay a different business
              </button>
            </div>
          )}

          {step === 'done' && confirmed && (
            <div className="card" style={{ padding: 28, textAlign: 'center' }}>
              <div style={{ marginBottom: 18 }}>
                <span className="icbox" style={{ background: 'var(--green-t)', color: 'var(--green)', width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', margin: '0 auto' }}>
                  <Icon name="check-circle" size={28} />
                </span>
                <h2 style={{ margin: '12px 0 4px' }}>Payment received</h2>
                <p className="sub">
                  {onPayee ? `KES ${confirmed.amountKes.toLocaleString('en-KE')} paid to ${confirmed.payeeName}.` : null}
                </p>
              </div>

              <div style={{ marginBottom: 20, padding: 16, background: 'var(--paper)', borderRadius: 10, border: '1px solid var(--line)', textAlign: 'left' }}>
                {confirmed.receiptCode && (
                  <>
                    <p className="sub" style={{ marginBottom: 4, fontSize: '.82rem', color: 'var(--tx-2)' }}>ESOQO RECEIPT</p>
                    <p className="mono" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{confirmed.receiptCode}</p>
                  </>
                )}
                {confirmed.mpesaReceiptCode && (
                  <>
                    <p className="sub" style={{ margin: '10px 0 4px', fontSize: '.82rem', color: 'var(--tx-2)' }}>M-PESA RECEIPT</p>
                    <p className="mono" style={{ margin: 0 }}>{confirmed.mpesaReceiptCode}</p>
                  </>
                )}
                <p className="sub" style={{ margin: '12px 0 0', fontSize: '.8rem' }}>
                  Your M-Pesa confirmation SMS and ours are both on their way.
                </p>
              </div>

              <button type="button" onClick={reset} className="btn btn-p" style={{ width: '100%' }}>
                Make another payment
              </button>
            </div>
          )}

          {step === 'failed' && failure && (
            <div className="card" style={{ padding: 28, textAlign: 'center' }}>
              <div style={{ marginBottom: 18 }}>
                <span className="icbox" style={{ background: 'var(--red-t)', color: 'var(--red)', width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', margin: '0 auto' }}>
                  <Icon name="alert-circle" size={28} />
                </span>
                <h2 style={{ margin: '12px 0 4px' }}>Payment didn&apos;t go through</h2>
                <p className="sub">{failure.reason ?? 'The payment was not completed.'}</p>
              </div>
              <p className="sub" style={{ marginBottom: 16 }}>
                Nothing was charged. You can try again, or check your M-Pesa messages if you approved a prompt.
              </p>
              <button type="button" onClick={reset} className="btn btn-p" style={{ width: '100%' }}>
                Try again
              </button>
            </div>
          )}

          {step === 'unresolved' && (
            <div className="card" style={{ padding: 28, textAlign: 'center' }}>
              <div style={{ marginBottom: 18 }}>
                <span className="icbox" style={{ background: 'var(--amber-t, #FEF3C7)', color: 'var(--amber, #B45309)', width: 56, height: 56, borderRadius: 14, display: 'grid', placeItems: 'center', margin: '0 auto' }}>
                  <Icon name="clock" size={28} />
                </span>
                <h2 style={{ margin: '12px 0 4px' }}>Still waiting on M-Pesa</h2>
                <p className="sub">We haven&apos;t heard back from M-Pesa about this payment yet.</p>
              </div>
              <p className="sub" style={{ marginBottom: 16 }}>
                <strong>Please don&apos;t pay again.</strong> If you approved the prompt, the money has
                left your M-Pesa and your confirmation SMS is the receipt — this page is just
                waiting to hear about it. If you did not approve anything, nothing was charged.
              </p>
              <p className="sub" style={{ marginBottom: 16, fontSize: '.82rem' }}>
                {outcome?.status === 'PENDING' && outcome.reference && (
                  <>Quote <span className="mono">{outcome.reference}</span> if you need to chase
                  this with the business.</>
                )}
              </p>
              <button type="button" onClick={recheck} className="btn btn-p" style={{ width: '100%' }}>
                <Icon name="refresh" size={18} /> Check again
              </button>
              <button type="button" onClick={reset} className="btn btn-b" style={{ width: '100%', marginTop: 8 }}>
                Back
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 14px', minHeight: 46,
  border: '1.5px solid var(--line)', borderRadius: 8, fontSize: '.94rem',
  fontFamily: 'var(--font-mono)', background: 'var(--paper)',
};
