'use client';

import { useTransition } from 'react';
import { updateRoomStatus } from './actions';

interface Props {
  orgId: string;
  roomNumber: string;
  currentStatus: string;
}

export function RoomStatusForm({ orgId, roomNumber, currentStatus }: Props) {
  const [isPending, startTransition] = useTransition();

  const STATUSES = ['available', 'occupied', 'maintenance'] as const;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const status = fd.get('status') as string;
        startTransition(() => updateRoomStatus(orgId, roomNumber, status));
      }}
      className="status-form"
    >
      <select name="status" defaultValue={currentStatus} className="status-select">
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </option>
        ))}
      </select>
      <button type="submit" disabled={isPending} className="status-btn">
        {isPending ? '…' : 'Update'}
      </button>

      <style jsx>{`
        .status-form { display: flex; gap: .5rem; margin-top: .5rem; }
        .status-select { flex: 1; padding: .25rem .5rem; font-size: .8rem; border: 1px solid #d1d5db; border-radius: .25rem; }
        .status-btn { padding: .25rem .75rem; font-size: .8rem; background: #374151; color: white; border: none; border-radius: .25rem; cursor: pointer; }
        .status-btn:disabled { opacity: .6; cursor: not-allowed; }
      `}</style>
    </form>
  );
}
