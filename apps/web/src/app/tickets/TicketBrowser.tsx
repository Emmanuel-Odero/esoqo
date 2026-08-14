'use client';
import { useMemo, useState } from 'react';
import { Icon } from '@esoko/ui';
import { useAnnounce } from '@esoko/a11y';

export interface ListingRow {
  slug: string;
  title: string;
  orgName: string;
  vertical: 'EVENTS' | 'TRANSPORT';
  where: string | null;
  county: string | null;
  fromKes: number | null;
  nextDepartAt: string | null;
  scheduleCount: number;
  detailUrl: string;
}

const VERTICAL_LABEL: Record<ListingRow['vertical'], string> = { EVENTS: 'Events', TRANSPORT: 'Transport' };

export function TicketBrowser({ listings }: { listings: ListingRow[] }) {
  const [q, setQ] = useState('');
  const [vertical, setVertical] = useState<'' | ListingRow['vertical']>('');
  const announce = useAnnounce();

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return listings.filter((l) => {
      if (vertical && l.vertical !== vertical) return false;
      if (t && !`${l.title} ${l.orgName} ${l.where ?? ''}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [listings, q, vertical]);

  return (
    <>
      <div className="row" style={{ marginBottom: 22 }}>
        <div className="fin-in" style={{ flex: 1, minWidth: 220 }}>
          <span className="mg"><Icon name="search" size={18} /></span>
          <input
            type="search" aria-label="Search an event, trip or organiser"
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Event, route or organiser name"
            style={{ padding: '11px 14px 11px 42px', fontSize: '.95rem', borderWidth: '1.5px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }} role="group" aria-label="Filter by kind">
        <button type="button" className="chip" aria-pressed={vertical === ''}
          onClick={() => { setVertical(''); announce('Showing all listings'); }}>
          All
        </button>
        <button type="button" className="chip" aria-pressed={vertical === 'EVENTS'}
          style={vertical === 'EVENTS' ? { borderColor: 'var(--green)', background: 'var(--green-t)', color: 'var(--green)' } : undefined}
          onClick={() => { setVertical('EVENTS'); announce('Filtered to events'); }}>
          <Icon name="calendar" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Events
        </button>
        <button type="button" className="chip" aria-pressed={vertical === 'TRANSPORT'}
          style={vertical === 'TRANSPORT' ? { borderColor: 'var(--green)', background: 'var(--green-t)', color: 'var(--green)' } : undefined}
          onClick={() => { setVertical('TRANSPORT'); announce('Filtered to transport'); }}>
          <Icon name="truck" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Transport
        </button>
      </div>

      <p className="sub" style={{ marginBottom: 16 }} aria-live="polite">
        {filtered.length} listing{filtered.length === 1 ? '' : 's'}
      </p>

      {filtered.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="icbox icbox-b" style={{ margin: '0 auto 14px' }}><Icon name="calendar" size={20} /></span>
          <h3 style={{ marginBottom: 6 }}>Nothing matches yet</h3>
          <p className="sub" style={{ margin: 0 }}>Try a different search — new listings are published often.</p>
        </div>
      ) : (
        <div className="grid g3">
          {filtered.map((l) => (
            <a key={l.slug} className="card" href={l.detailUrl} style={{ display: 'block' }}>
              <span className="icbox icbox-g" style={{ marginBottom: 13 }}>
                <Icon name={l.vertical === 'TRANSPORT' ? 'truck' : 'calendar'} size={20} />
              </span>
              <h3 style={{ marginBottom: 4 }}>{l.title}</h3>
              <p className="sub" style={{ margin: 0, fontSize: '.88rem' }}>{l.orgName}</p>
              <p className="sub mono" style={{ marginTop: 10, marginBottom: 0, fontSize: '.78rem' }}>
                {l.where ?? VERTICAL_LABEL[l.vertical]}
                {l.fromKes != null ? ` · from KES ${l.fromKes.toLocaleString('en-KE')}` : ''}
              </p>
              {l.nextDepartAt && (
                <p className="sub" style={{ margin: '8px 0 0', fontSize: '.78rem', fontWeight: 700, color: 'var(--green)' }}>
                  <Icon name="clock" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  Next: {new Date(l.nextDepartAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' })}
                </p>
              )}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
