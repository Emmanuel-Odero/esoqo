'use client';

import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { wlFontVariables } from './whitelabel-fonts';

/**
 * The theme/appearance state behind the accessibility toolbar (see
 * OrgTopNav) — text scale, high contrast, reduced motion, and
 * dark/light — ported from the template's main.js, just as React
 * state + a Context instead of direct DOM manipulation, since several
 * independent controls (the toolbar buttons, the header's own
 * dark-mode button) all need to read and flip the same state.
 *
 * Persisted to localStorage exactly like the template did, so a
 * visitor's own choice survives a reload; JamiiPage.themeDefaultMode
 * only decides what a *first-time* visitor sees, before any of that
 * exists on their device.
 */

const SCALES = [0.9, 1, 1.1, 1.25, 1.4];

interface WhitelabelThemeState {
  theme: 'dark' | 'light';
  setTheme(t: 'dark' | 'light'): void;
  toggleTheme(): void;
  contrast: boolean;
  setContrast(v: boolean): void;
  motionOff: boolean;
  setMotionOff(v: boolean): void;
  scaleIdx: number;
  setScaleIdx(i: number): void;
}

const WhitelabelThemeContext = createContext<WhitelabelThemeState | null>(null);

export function useWhitelabelTheme(): WhitelabelThemeState {
  const ctx = useContext(WhitelabelThemeContext);
  if (!ctx) throw new Error('useWhitelabelTheme must be used within WhitelabelThemeRoot');
  return ctx;
}

function readStored(key: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing / storage disabled — the toggle still works for
    // this page load, it just won't be remembered next time.
  }
}

export function WhitelabelThemeRoot({
  defaultMode, brandAccent, brandAccentTwo, brandAccentThree, children,
}: {
  defaultMode: 'DARK' | 'LIGHT';
  brandAccent?: string | null;
  brandAccentTwo?: string | null;
  brandAccentThree?: string | null;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<'dark' | 'light'>(defaultMode === 'LIGHT' ? 'light' : 'dark');
  const [contrast, setContrastState] = useState(false);
  const [motionOff, setMotionOffState] = useState(false);
  const [scaleIdx, setScaleIdxState] = useState(1);

  // One-time read of this visitor's own stored preference, after the
  // page's own default has already painted server-side — see
  // suppressHydrationWarning below for why that order is fine here.
  useEffect(() => {
    setThemeState((readStored('wl-theme', defaultMode.toLowerCase()) as 'dark' | 'light'));
    setContrastState(readStored('wl-contrast', 'off') === 'on');
    setMotionOffState(readStored('wl-motion', 'off') === 'on');
    setScaleIdxState(parseInt(readStored('wl-scale-idx', '1'), 10));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setTheme(t: 'dark' | 'light') { setThemeState(t); writeStored('wl-theme', t); }
  function toggleTheme() { setTheme(theme === 'dark' ? 'light' : 'dark'); }
  function setContrast(v: boolean) { setContrastState(v); writeStored('wl-contrast', v ? 'on' : 'off'); }
  function setMotionOff(v: boolean) { setMotionOffState(v); writeStored('wl-motion', v ? 'on' : 'off'); }
  function setScaleIdx(i: number) {
    const clamped = Math.max(0, Math.min(SCALES.length - 1, i));
    setScaleIdxState(clamped);
    writeStored('wl-scale-idx', String(clamped));
  }

  const style: CSSProperties & Record<string, string | undefined> = {
    '--wl-scale': String(SCALES[scaleIdx]),
  };
  if (brandAccent) style['--brand-1'] = brandAccent;
  if (brandAccentTwo) style['--brand-2'] = brandAccentTwo;
  if (brandAccentThree) style['--brand-3'] = brandAccentThree;

  return (
    <div
      className={`wl-theme ${wlFontVariables}`}
      style={style}
      data-theme={theme}
      data-contrast={contrast ? 'high' : undefined}
      data-motion={motionOff ? 'off' : 'on'}
      // The client corrects this from localStorage a tick after the
      // server-rendered default paints (see the effect above) — an
      // intentional, brief default-appearance flash rather than a
      // blocking inline script, and suppressHydrationWarning keeps
      // React quiet about the attributes changing once, right after mount.
      suppressHydrationWarning
    >
      <WhitelabelThemeContext.Provider value={{ theme, setTheme, toggleTheme, contrast, setContrast, motionOff, setMotionOff, scaleIdx, setScaleIdx }}>
        {children}
      </WhitelabelThemeContext.Provider>
    </div>
  );
}
