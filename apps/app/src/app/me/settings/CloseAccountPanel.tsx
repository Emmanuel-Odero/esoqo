'use client';

import { useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { actionEraseMyData } from './actions';

/**
 * "Close my account" — DPA s.35 right to erasure, wired end to end.
 *
 * The flow is deliberately friction-ful: one confirmation step with a
 * required reason field and a typed-confirmation input. This is not
 * dark-pattern friction to prevent people leaving; it is:
 *
 * 1. Evidence. A typed reason is audit-logged on the erasure event.
 *    If the ODPC asks why a record was erased, the answer is on the
 *    chain rather than "user clicked a button".
 * 2. Informed consent. The consequences (the record is gone, documents
 *    cannot be restored, any active consents are revoked) are shown
 *    in plain text before the final button is reachable.
 *
 * The action itself calls erasePartyData in the DAL, which:
 * - sets deletedAt on the Party
 * - scrubs officialName → '[erased]', email → null, nationalIdHash → null,
 *   msisdn → 'erased:{partyId}'
 * - preserves the audit chain (it's a legal record)
 * - clears the session cookie
 * - redirects to esoqo.co.ke
 */
export function CloseAccountPanel() {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const CONFIRM_WORD = 'FUTA';

  function requestClose() {
    setOpen(true);
    setConfirmed('');
    setReason('');
    setError(null);
  }

  function cancel() {
    setOpen(false);
    setError(null);
  }

  function erase() {
    if (confirmed !== CONFIRM_WORD) {
      setError(`Type ${CONFIRM_WORD} exactly to continue.`);
      return;
    }
    setError(null);
    start(async () => {
      const result = await actionEraseMyData(reason.trim() || 'No reason given');
      // On success the server redirects — we only reach here on failure.
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="mcard" style={{ borderColor: 'var(--red, #c62828)' }}>
      <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="ban" size={18} style={{ color: 'var(--red, #c62828)' }} />
        Close my account
      </h2>

      {!open ? (
        <>
          <p style={{ margin: '0 0 14px', fontSize: '.9rem', color: 'var(--tx-2)' }}>
            You have the right to request deletion of your Esoqo record at any time — this is
            your right under the Data Protection Act, 2019.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: '.9rem', color: 'var(--tx-2)' }}>
            {/* Kiswahili */}
            Una haki ya kuomba kufutwa kwa rekodi yako ya Esoqo wakati wowote — hii ni haki
            yako chini ya Sheria ya Ulinzi wa Data, 2019.
          </p>
          <button
            type="button"
            className="btn btn-sm"
            style={{ border: '1.5px solid var(--red, #c62828)', color: 'var(--red, #c62828)', background: 'transparent' }}
            onClick={requestClose}
          >
            <Icon name="ban" size={14} /> Close my account and delete my data
          </button>
        </>
      ) : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div
            role="note"
            style={{
              padding: '10px 12px',
              borderRadius: 7,
              background: 'var(--red-t, #fff0f0)',
              border: '1px solid var(--red, #c62828)',
              fontSize: '.88rem',
              lineHeight: 1.5,
            }}
          >
            <strong>This cannot be undone.</strong>
            {' '}Your name, phone number, email and national ID will be scrubbed from Esoqo's
            records. Any active consent grants will stop working. Documents you uploaded cannot be
            recovered. The audit chain that proves who approved your registration is preserved,
            but it will no longer contain your name.
          </div>

          <div>
            <label className="lab" htmlFor="erase-reason" style={{ display: 'block', marginBottom: 6, fontSize: '.88rem' }}>
              Why are you closing your account? <span className="hint">(helps us improve)</span>
            </label>
            <textarea
              id="erase-reason"
              className="inp"
              rows={3}
              placeholder="Optional — you may leave this blank"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ resize: 'vertical', minHeight: 72 }}
            />
          </div>

          <div>
            <label className="lab" htmlFor="erase-confirm" style={{ display: 'block', marginBottom: 6, fontSize: '.88rem' }}>
              Type <strong className="mono">{CONFIRM_WORD}</strong> to confirm
            </label>
            <input
              id="erase-confirm"
              className="inp mono"
              value={confirmed}
              onChange={(e) => setConfirmed(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={!!error}
            />
          </div>

          {error && (
            <p role="alert" style={{ margin: 0, color: 'var(--red, #c62828)', fontSize: '.88rem', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="alert-circle" size={14} />{error}
            </p>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{ border: '1.5px solid var(--red, #c62828)', color: 'var(--red, #c62828)', background: 'transparent' }}
              disabled={pending || confirmed !== CONFIRM_WORD}
              onClick={erase}
            >
              {pending ? 'Erasing…' : 'Delete my account permanently'}
            </button>
            <button type="button" className="btn btn-o btn-sm" disabled={pending} onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
