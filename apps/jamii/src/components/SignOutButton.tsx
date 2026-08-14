'use client';

import { useTransition } from 'react';
import { signOut } from '@/app/dashboard/signout-actions';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => startTransition(() => signOut())}
      style={{ background: 'none', border: 0, color: 'var(--stamp)', fontWeight: 700, fontSize: '.82rem', cursor: 'pointer', padding: 0 }}>
      {pending ? 'Signing out…' : 'Log out'}
    </button>
  );
}
