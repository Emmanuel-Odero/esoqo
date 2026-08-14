'use client';

import { useTransition } from 'react';
import { Icon } from '@esoko/ui';
import { signOut } from '@/app/dashboard/(shell)/signout/actions';

export function SignOutButton() {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-o btn-sm"
      disabled={pending}
      onClick={() => startTransition(() => signOut())}
      title="Sign out"
    >
      <Icon name="ban" size={13} />{pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}