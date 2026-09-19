'use client';

import { Icon } from '@esoqo/ui';
import { DEMO_NOTE, phoneHref, smsHref } from '@/lib/demo-mode';

/**
 * Demo-aware call/message affordances.
 *
 * Every outgoing call or text on the parcel-org portal funnels through
 * one of these. In a real deployment they are plain tel:/sms: links; in
 * DEMO_MODE (see lib/demo-mode.ts) they become disabled controls that
 * say why, so a sales demo can never ring a real number by accident.
 */

/** A phone number: tappable when live, a lock-and-number hint in demo. */
export function DemoPhoneSpan({ msisdn, className }: { msisdn: string; className?: string }) {
  const href = phoneHref(msisdn);
  if (href) {
    return (
      <a className={className} href={href}>
        {msisdn}
      </a>
    );
  }
  return (
    <span
      className={className}
      title={DEMO_NOTE}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
    >
      <Icon name="lock" size={12} />
      {msisdn}
      <span className="sub">(demo)</span>
    </span>
  );
}

/** "Call" button — a real link when live, disabled with a lock in demo. */
export function DemoCallButton({
  msisdn, label = 'Call', primary = false,
}: { msisdn: string; label?: string; primary?: boolean }) {
  const href = phoneHref(msisdn);
  const cls = `btn ${primary ? 'btn-p' : 'btn-o'} btn-sm`;
  if (href) {
    return (
      <a className={cls} href={href}>
        <Icon name="phone-call" size={14} />
        {label}
      </a>
    );
  }
  return (
    <button className={cls} disabled title={DEMO_NOTE}>
      <Icon name="lock" size={14} />
      {label}
    </button>
  );
}

/** "Message" button — same rule, sms: side. */
export function DemoMessageButton({ msisdn, label = 'Message' }: { msisdn: string; label?: string }) {
  const href = smsHref(msisdn);
  if (href) {
    return (
      <a className="btn btn-o btn-sm" href={href}>
        <Icon name="message" size={14} />
        {label}
      </a>
    );
  }
  return (
    <button className="btn btn-o btn-sm" disabled title={DEMO_NOTE}>
      <Icon name="lock" size={14} />
      {label}
    </button>
  );
}