import { DEMO_MODE, DEMO_NOTE } from '@/lib/demo-mode';
import { Icon } from '@esoqo/ui';

/**
 * The sandbox notice that sits above the portal in DEMO_MODE.
 *
 * Rendered server-side from the same NEXT_PUBLIC_DEMO_MODE flag whose
 * client-side half disables the call/message buttons (see
 * components/DemoContact.tsx) — the banner exists so the switched-off
 * affordances read as intended rather than as bugs. Nothing to render
 * (and none of the markup) when the flag is off.
 */
export function DemoBanner() {
  if (!DEMO_MODE) return null;
  return (
    <div
      role="note"
      style={{
        background: '#FFF8E1',
        borderBottom: '1px solid #F9E3A0',
        color: '#7A5C00',
        fontSize: '.82rem',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 18px', maxWidth: 1100, margin: '0 auto' }}>
        <Icon name="lock" size={14} />
        <span>
          <strong>Sandbox demo</strong> — {DEMO_NOTE}. Everything else is live against the demo
          database.
        </span>
      </div>
    </div>
  );
}