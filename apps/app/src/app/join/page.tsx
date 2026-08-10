import type { Metadata } from 'next';
import { JoinFlow } from './JoinFlow';
import { CecfTopNav } from './CecfTopNav';
import { CecfMasthead } from './CecfMasthead';
import { WhyJoin } from './WhyJoin';
import { CecfPartnershipBand } from './CecfPartnershipBand';
import './join-cecf.css';

export const metadata: Metadata = {
  title: 'Join CECF',
  description:
    'Join the Child Elder Care Foundation free — five questions, no documents. Esoko powers the tools behind your membership.',
};

export default function JoinPage() {
  return (
    <div className="cecf-scope">
      <CecfTopNav />
      <CecfMasthead />

      {/* Form first in source order, "why join" second — on narrow screens
          (no grid) that's already "why join under the form"; on wide
          screens the grid places it beside the form instead. */}
      <div className="cecf-layout">
        <div className="wrap">
          <div className="jtop">
            <div>
              <h2 style={{ fontSize: 'clamp(1.35rem,2.6vw,1.7rem)', margin: 0 }}>
                Tell us about yourself
              </h2>
              <p style={{ color: 'var(--cecf-ink-2)', margin: '4px 0 0' }}>
                Five questions, no documents. Your record flows to Esoko so the tools can work.
              </p>
            </div>
          </div>
          <JoinFlow />
        </div>

        <WhyJoin />
      </div>

      <CecfPartnershipBand />
    </div>
  );
}