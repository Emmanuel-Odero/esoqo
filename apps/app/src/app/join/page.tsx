import type { Metadata } from 'next';
import { JoinFlow } from './JoinFlow';
import { JoinTopNav } from './JoinTopNav';
import { JoinMasthead } from './JoinMasthead';
import { WhyJoin } from './WhyJoin';
import { JoinCecfCrossLink } from './JoinCecfCrossLink';
import './join.css';

export const metadata: Metadata = {
  title: 'Join Esoqo',
  description:
    'Bring your group, MSME or yourself onto Esoqo, free — market prices, payments and receipts, and a record you can trade with.',
};

export default function JoinPage() {
  return (
    <div className="join-scope">
      <JoinTopNav />
      <JoinMasthead />

      {/* Form first in source order, "why join" second — on narrow screens
          (no grid) that's already "why join under the form"; on wide
          screens the grid places it beside the form instead. */}
      <div className="join-layout">
        <div className="wrap">
          <div className="jtop">
            <div>
              <h2 style={{ fontSize: 'clamp(1.35rem,2.6vw,1.7rem)', margin: 0 }}>
                Tell us about yourself
              </h2>
              <p style={{ color: 'var(--jn-ink-2)', margin: '4px 0 0' }}>
                Five questions, no documents. Your record flows straight into Esoqo&rsquo;s tools.
              </p>
            </div>
          </div>
          <JoinFlow />
        </div>

        <WhyJoin />
      </div>

      <JoinCecfCrossLink />
    </div>
  );
}
