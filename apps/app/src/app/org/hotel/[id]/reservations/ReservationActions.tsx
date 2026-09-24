'use client';

import { useTransition } from 'react';
import { checkInGuest, checkOutGuest } from './actions';

export function CheckInButton({ orgId, reservationId }: { orgId: string; reservationId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => checkInGuest(orgId, reservationId))}
      className="action-btn check-in"
    >
      {pending ? '…' : 'Check In'}
      <style jsx>{`
        .action-btn { padding: .3rem .75rem; border: none; border-radius: .25rem; font-size: .8rem; font-weight: 500; cursor: pointer; }
        .action-btn:disabled { opacity: .6; cursor: not-allowed; }
        .check-in { background: #d1fae5; color: #065f46; }
      `}</style>
    </button>
  );
}

export function CheckOutButton({ orgId, reservationId }: { orgId: string; reservationId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => start(() => checkOutGuest(orgId, reservationId))}
      className="action-btn check-out"
    >
      {pending ? '…' : 'Check Out'}
      <style jsx>{`
        .action-btn { padding: .3rem .75rem; border: none; border-radius: .25rem; font-size: .8rem; font-weight: 500; cursor: pointer; }
        .action-btn:disabled { opacity: .6; cursor: not-allowed; }
        .check-out { background: #fef3c7; color: #92400e; }
      `}</style>
    </button>
  );
}
