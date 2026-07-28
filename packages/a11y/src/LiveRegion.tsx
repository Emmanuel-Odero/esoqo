'use client';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Politeness = 'polite' | 'assertive';
const Ctx = createContext<(msg: string, p?: Politeness) => void>(() => {});

/**
 * Announces async state. Every loading, empty, error and offline state
 * must be perceivable — silent failure is an accessibility defect, not
 * just poor UX.
 */
export function LiveRegion({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const announce = useCallback((msg: string, p: Politeness = 'polite') => {
    if (p === 'assertive') { setAssertive(''); setTimeout(() => setAssertive(msg), 60); }
    else { setPolite(''); setTimeout(() => setPolite(msg), 60); }
  }, []);

  const sr = useMemo(
    () => ({
      position: 'absolute' as const, width: 1, height: 1, padding: 0, margin: -1,
      overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' as const, border: 0,
    }),
    [],
  );

  return (
    <Ctx.Provider value={announce}>
      {children}
      <div aria-live="polite" aria-atomic="true" style={sr}>{polite}</div>
      <div aria-live="assertive" aria-atomic="true" style={sr}>{assertive}</div>
    </Ctx.Provider>
  );
}

export const useAnnounce = () => useContext(Ctx);
