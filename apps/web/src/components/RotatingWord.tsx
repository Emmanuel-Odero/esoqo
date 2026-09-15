'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The headline word — cycles through who Esoqo is for, one word at a
 * time. Static under prefers-reduced-motion (same rule ScrollSpy
 * follows): it just shows the first word and stops there.
 */
export function RotatingWord({ words, intervalMs = 2200 }: { words: readonly string[]; intervalMs?: number }) {
  const [i, setI] = useState(0);
  const reducedRef = useRef(false);

  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedRef.current || words.length < 2) return;
    const id = setInterval(() => setI((v) => (v + 1) % words.length), intervalMs);
    return () => clearInterval(id);
  }, [words, intervalMs]);

  return (
    // key remount drives the fade-in — swapping text on the same node
    // wouldn't restart a CSS animation.
    <span className="rot" key={i}>{words[i]}</span>
  );
}
