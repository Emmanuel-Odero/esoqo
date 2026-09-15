import type { Metadata } from 'next';
import { requireStaff } from '@/lib/session';
import { SetPinForm } from './SetPinForm';
import '../signin/signin.css';

export const metadata: Metadata = { title: 'Set your PIN' };

export default async function SetPinPage() {
  await requireStaff();

  return (
    <div className="si-root">
      <div className="si-brand">
        <div className="si-brand-inner">
          <span className="si-mark">
            <svg viewBox="0 0 132 124" width="36" height="34" aria-hidden="true">
              <g fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round">
                <path d="M 118 62 A 40 40 0 1 0 110.8 84.9" />
                <path d="M 38 62 L 118 62" />
                <path d="M 38 62 L 8 45" />
              </g>
            </svg>
          </span>
          <strong>Esoqo</strong>
          <span className="si-brand-sub">Operations Dashboard</span>
        </div>
        <div className="si-brand-foot">
          <span className="si-badge">Staff access only</span>
        </div>
      </div>
      <div className="si-panel">
        <div className="si-card">
          <div className="si-card-hd">
            <h1>Set your PIN</h1>
            <p>You&apos;re signed in with a temporary PIN — choose your own before continuing.</p>
          </div>
          <SetPinForm />
          <p className="si-footnote">
            Protected by the Esoqo security framework.
          </p>
        </div>
      </div>
    </div>
  );
}
