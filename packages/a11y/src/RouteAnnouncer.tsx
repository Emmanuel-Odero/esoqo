'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Announces route changes to screen readers, and moves focus.
 *
 * In a single-page app there is no page load, so a screen reader says
 * nothing when the view changes and focus is left stranded on the link
 * that was clicked. Both are WCAG failures and both are invisible to
 * sighted testing. This component is why the fix cannot be forgotten:
 * it lives in the root layout, not in each page.
 */
export function RouteAnnouncer() {
  const pathname = usePathname();
  const [message, setMessage] = useState('');
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const title = document.title || 'Page';
    setMessage(`${title} — page loaded`);

    // Move focus to the main landmark so the next Tab starts in content.
    const main = document.querySelector<HTMLElement>('main[tabindex="-1"], main');
    if (main) {
      main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    }
  }, [pathname]);

  return (
    <p
      aria-live="assertive"
      aria-atomic="true"
      style={{
        position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
        overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
      }}
    >
      {message}
    </p>
  );
}
