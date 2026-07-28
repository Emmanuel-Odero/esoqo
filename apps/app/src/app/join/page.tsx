import type { Metadata } from 'next';
import { JoinFlow } from './JoinFlow';

export const metadata: Metadata = {
  title: 'Join',
  description: 'Join Esoko free. Five questions, no documents.',
};

export default function JoinPage() {
  return (
    <div className="wrap">
      <div className="jtop">
        <div>
          <h1 style={{ fontSize: 'clamp(1.6rem,3vw,2.05rem)' }}>Join Esoko</h1>
          <p style={{ color: 'var(--tx-2)', margin: '4px 0 0' }}>Free, and it stays free.</p>
        </div>
      </div>
      <JoinFlow />
    </div>
  );
}
