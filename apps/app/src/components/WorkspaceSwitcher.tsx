'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { enterParcelOrg } from '@/app/workspace-actions';
import type { Workspace, WorkspaceKind } from '@/lib/workspaces';
import './workspace-switcher.css';

/**
 * The one control that says "where am I, and where else can I be".
 *
 * It sits in the same place in every shell — /me, the organiser console
 * and the courier portal — because the whole point is that it doesn't
 * move. Crossing between your own record and a company you work for
 * used to mean signing out of one thing to reach the other; now it's the
 * same two taps from anywhere, and the sessions are independent so
 * neither hop discards the other.
 *
 * Presentation follows the destination, not the source:
 *   personal / ticket organiser → a Link (the subject session already
 *                                 covers it, so it's plain navigation)
 *   courier company             → a form (a company-scoped session has
 *                                 to be minted first; see
 *                                 enterParcelOrg)
 *
 * Rendering nothing when there is only one workspace is deliberate: a
 * chevron that opens a menu of one is noise, and most people have
 * exactly one.
 */

const KIND_LABEL: Record<WorkspaceKind, string> = {
  personal: 'Your record',
  ticket: 'Organisers',
  courier: 'Courier companies',
};

const KIND_ORDER: WorkspaceKind[] = ['personal', 'ticket', 'courier'];

/** Two letters, so a company with a long name still gets a fixed mark. */
function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return '··';
  if (!second) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

export function WorkspaceSwitcher({
  workspaces,
  currentKey,
  /** Shown when the person has no switchable workspaces — a staff-only
   *  login still needs to see whose console it is standing in. */
  fallbackName,
  fallbackSubtitle,
}: {
  workspaces: Workspace[];
  currentKey: string;
  fallbackName: string;
  fallbackSubtitle: string;
}) {
  const [open, setOpen] = useState(false);
  const announce = useAnnounce();
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const current = workspaces.find((w) => w.key === currentKey);
  const name = current?.name ?? fallbackName;
  const subtitle = current?.subtitle ?? fallbackSubtitle;
  const kind = current?.kind ?? 'courier';

  // Close on outside click. Escape is handled separately so it can also
  // return focus to the trigger, which a click-away must not do (the
  // pointer has already moved focus somewhere the person chose).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(
      () => popRef.current?.querySelector<HTMLElement>('a,button')?.focus(),
      0,
    );
    return () => window.clearTimeout(t);
  }, [open]);

  // One workspace (or none, for a staff-only login) — show the identity,
  // skip the menu. Still a real element so the bar's layout never shifts
  // between a person who has companies and one who doesn't.
  if (workspaces.length < 2) {
    return (
      <div className="wsw wsw-static">
        <span className={`wsw-mark wsw-${kind}`} aria-hidden="true">{monogram(name)}</span>
        <span className="wsw-id">
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </span>
      </div>
    );
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    announce(next ? 'Workspace menu opened' : 'Workspace menu closed', 'polite');
    if (!next) btnRef.current?.focus();
  }

  const groups = KIND_ORDER.map((k) => [k, workspaces.filter((w) => w.kind === k)] as const)
    .filter(([, list]) => list.length > 0);

  return (
    <div className="wsw-root">
      <button
        type="button"
        ref={btnRef}
        className="wsw wsw-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls="wsw-menu"
        onClick={toggle}
      >
        <span className={`wsw-mark wsw-${kind}`} aria-hidden="true">{monogram(name)}</span>
        <span className="wsw-id">
          <strong>{name}</strong>
          <small>{subtitle}</small>
        </span>
        <Icon name="chevron-down" size={15} className="wsw-chev" />
        <span className="sr-only">Switch workspace</span>
      </button>

      {open && (
        <div className="wsw-menu" id="wsw-menu" role="menu" ref={popRef}>
          <p className="wsw-lede">
            Switch between your own record and the companies you work for. Both stay
            signed in — nothing is lost on the way across.
          </p>
          {groups.map(([groupKind, list]) => (
            <div className="wsw-group" key={groupKind}>
              <p className="wsw-group-h">{KIND_LABEL[groupKind]}</p>
              {list.map((w) => (
                <WorkspaceRow
                  key={w.key}
                  ws={w}
                  isCurrent={w.key === currentKey}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkspaceRow(
  { ws, isCurrent, onNavigate }:
  { ws: Workspace; isCurrent: boolean; onNavigate: () => void },
) {
  const inner = (
    <>
      <span className={`wsw-mark wsw-${ws.kind}`} aria-hidden="true">{monogram(ws.name)}</span>
      <span className="wsw-row-id">
        <strong>{ws.name}</strong>
        <small>{ws.note ? `${ws.subtitle} · ${ws.note}` : ws.subtitle}</small>
      </span>
    </>
  );

  if (isCurrent) {
    return (
      <div className="wsw-row is-current" role="menuitem" aria-current="true">
        {inner}
        <span className="wsw-here">Here</span>
      </div>
    );
  }

  if (!ws.enterable) {
    return (
      <div className="wsw-row is-locked" role="menuitem" aria-disabled="true">
        {inner}
        <Icon name="lock" size={15} className="wsw-go" />
      </div>
    );
  }

  if (ws.href) {
    return (
      <Link href={ws.href as Route} className="wsw-row" role="menuitem" onClick={onNavigate}>
        {inner}
        <Icon name="arrow-right" size={16} className="wsw-go" />
      </Link>
    );
  }

  // Courier company: entering mints a company-scoped session first, so
  // this row runs the action rather than navigating.
  return <WorkspaceEnter orgId={ws.id}>{inner}</WorkspaceEnter>;
}

/** Entering a company is a round trip to core-go to mint the shift
 *  session. Without a pending state the row sat inert for a second and
 *  got tapped twice — which is two activations, not one. */
function WorkspaceEnter({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="wsw-row"
      role="menuitem"
      disabled={pending}
      onClick={() => start(async () => { await enterParcelOrg(orgId); })}
    >
      {children}
      {pending
        ? <span className="wsw-go wsw-pending" aria-hidden="true">···</span>
        : <Icon name="arrow-right" size={16} className="wsw-go" />}
      {pending && <span className="sr-only">Opening</span>}
    </button>
  );
}
