'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { JAMII_CAUSES } from '@esoko/domain';
import { Icon } from '@esoko/ui';

export function DiscoverFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [, startTransition] = useTransition();
  const activeCause = params.get('cause') ?? 'all';

  function push(next: URLSearchParams) {
    startTransition(() => router.push(`/?${next.toString()}`));
  }

  function onSearch(value: string) {
    setQ(value);
    const next = new URLSearchParams(params.toString());
    if (value) next.set('q', value); else next.delete('q');
    push(next);
  }

  function onCause(cause: string) {
    const next = new URLSearchParams(params.toString());
    if (cause === 'all') next.delete('cause'); else next.set('cause', cause);
    push(next);
  }

  return (
    <div className="filters">
      <div className="wrap">
        <div className="bar">
          <div className="search">
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search by organisation or county…"
              value={q}
              onChange={(e) => onSearch(e.target.value)}
              aria-label="Search organisations"
            />
          </div>
          <button type="button" className="chip" aria-pressed={activeCause === 'all'} onClick={() => onCause('all')}>
            All causes
          </button>
          {JAMII_CAUSES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              aria-pressed={activeCause === key}
              onClick={() => onCause(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
