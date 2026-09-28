'use client';
import { useState } from 'react';
import { Icon } from '@esoqo/ui';
import { CreateGroupForm } from './CreateGroupForm';

export function GroupCreateToggle({
  kindOptions,
  hasGroups,
}: {
  kindOptions: readonly (readonly [string, string])[];
  hasGroups: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={hasGroups ? 'btn btn-o' : 'btn btn-p'}
        aria-expanded={open}
        aria-controls="create-group-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? 'close' : 'plus'} size={15} aria-hidden="true" />
        {open ? 'Close' : 'Start a group'}
      </button>
      {open && (
        <div id="create-group-panel" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
          <CreateGroupForm kindOptions={kindOptions} />
        </div>
      )}
    </>
  );
}
