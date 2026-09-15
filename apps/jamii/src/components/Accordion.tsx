'use client';

import { useState } from 'react';
import { Icon, type IconName } from '@esoqo/ui';

export function Accordion({
  items, defaultOpen = 0,
}: { items: { title: string; icon?: string; body: React.ReactNode }[]; defaultOpen?: number | null }) {
  const [open, setOpen] = useState<number | null>(defaultOpen);

  return (
    <div>
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="accitem">
            <button
              type="button"
              className="acchead"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : i)}
            >
              {/* item.icon is an @esoqo/ui IconName (see
                  JAMII_PROGRAM_ICONS) — never emoji/free text. */}
              {item.icon && <Icon name={item.icon as IconName} size={17} />}
              <span className="acctitle">{item.title}</span>
              <span className="accplus">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <div className="accbody-inner">{item.body}</div>}
          </div>
        );
      })}
    </div>
  );
}
