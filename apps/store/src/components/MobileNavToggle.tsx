'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@esoqo/ui';

/**
 * Hamburger shown in the top bar on small screens. State lives in the
 * sidebar drawer (DashSidebar); this button just opens/closes it and
 * mirrors the open state so its icon and aria-expanded stay correct.
 */
export function MobileNavToggle() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onState = (e: Event) => setOpen(Boolean((e as CustomEvent<{ open: boolean }>).detail?.open));
    window.addEventListener('esoqo:nav-state', onState);
    return () => window.removeEventListener('esoqo:nav-state', onState);
  }, []);

  return (
    <button
      type="button"
      className="nav-toggle"
      aria-expanded={open}
      aria-controls="dash-side"
      aria-label={open ? 'Close menu' : 'Open menu'}
      onClick={() => window.dispatchEvent(new CustomEvent('esoqo:nav-toggle'))}
    >
      <Icon name={open ? 'close' : 'menu'} size={18} />
    </button>
  );
}