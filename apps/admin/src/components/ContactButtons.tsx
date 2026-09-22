'use client';

import { Icon } from '@esoqo/ui';

/**
 * Call/Text placeholders next to a phone number.
 *
 * Staff want these visible now — so the eventual real integration
 * (click-to-call, in-app SMS) has an obvious slot to land in — without
 * pretending either one works today. Always disabled, not gated by any
 * flag: unlike apps/app's DemoContact (which toggles a *working*
 * tel:/sms: link off for a sandboxed demo), there is nothing live to
 * toggle here yet. Swap the disabled state for a real onClick/href
 * when the integration ships.
 */
export function ContactButtons({ msisdn }: { msisdn?: string | null }) {
  if (!msisdn) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
      <button type="button" className="btn btn-o btn-sm" disabled title="Calling from Esoqo admin isn't available yet — coming soon">
        <Icon name="phone-call" size={13} />Call
      </button>
      <button type="button" className="btn btn-o btn-sm" disabled title="Texting from Esoqo admin isn't available yet — coming soon">
        <Icon name="message" size={13} />Text
      </button>
    </span>
  );
}
