'use client';
import { useEffect } from 'react';

/**
 * Applies display preferences to <html>.
 *
 * They are stored server-side rather than in localStorage deliberately:
 * someone who sets larger text on a borrowed phone should still have it
 * on the next handset, and eventually on the USSD and SMS channels too.
 */
export function PrefsApplier({ prefs }: { prefs: Record<string, string> }) {
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.textSize = prefs.textSize ?? '100';
    el.dataset.spacing = prefs.spacing ?? 'normal';
    el.dataset.font = prefs.font ?? 'system';
    el.dataset.contrast = prefs.contrast ?? 'standard';
    if (prefs.motion === 'reduced') el.dataset.motion = 'reduced';
    else delete el.dataset.motion;
  }, [prefs]);
  return null;
}
