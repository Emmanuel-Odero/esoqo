'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { FORM_ACTIVE_EVENT } from './form-activity';

/**
 * The dashboard's only concession to "the company should see it
 * immediately" — this is a server-rendered page with no websocket/SSE
 * channel, so "immediately" means "within one refresh interval" rather
 * than true push. A front desk screen sits on a tablet all day with
 * nobody hitting reload, so a silent periodic refresh is the pragmatic
 * fix; building a live channel for one low-traffic screen would be a
 * lot of new infrastructure for a problem 30 seconds already solves.
 * Renders nothing — it only exists to call router.refresh().
 *
 * The refresh deliberately stands down while somebody is working: a
 * panel (custom parcel, cash count) reports itself via
 * parcel-org:form-active, a hidden tab never refreshes, and a tick that
 * lands mid-keystroke (focus inside any field) is skipped. Refreshing
 * under an open form is what made the dashboard look like it was
 * "loading all the time" and wiped what had already been typed.
 */
export function DropoffPoll({ intervalMs = 30000 }: { intervalMs?: number }) {
  const router = useRouter();
  const formActive = useRef(false);
  useEffect(() => {
    const onActivity = (e: Event) => {
      formActive.current =
        (e as CustomEvent<{ active: boolean }>).detail?.active ?? false;
    };
    window.addEventListener(FORM_ACTIVE_EVENT, onActivity);
    const id = setInterval(() => {
      if (formActive.current) return;
      if (document.visibilityState === 'hidden') return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => {
      window.removeEventListener(FORM_ACTIVE_EVENT, onActivity);
      clearInterval(id);
    };
  }, [router, intervalMs]);
  return null;
}
