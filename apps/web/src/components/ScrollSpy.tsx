'use client';
import { useEffect } from 'react';

/** Highlights the active section and tracks scroll depth. Disabled under
 *  prefers-reduced-motion, where the smooth centring would be unwelcome. */
export function ScrollSpy() {
  useEffect(() => {
    const nav = document.getElementById('snav');
    if (!nav) return;
    const links = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
    const secs = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute('href')!));
    const prog = document.getElementById('sprog');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const spy = () => {
      const y = window.scrollY + 150;
      let cur = -1;
      secs.forEach((s, i) => { if (s && s.offsetTop <= y) cur = i; });
      links.forEach((l) => l.classList.remove('on'));
      if (cur > -1 && links[cur]) {
        links[cur].classList.add('on');
        if (!reduced && nav.scrollWidth > nav.clientWidth) {
          const l = links[cur];
          nav.scrollTo({ left: Math.max(0, l.offsetLeft - nav.clientWidth / 2 + l.offsetWidth / 2), behavior: 'smooth' });
        }
      }
      const d = document.documentElement;
      if (prog) prog.style.width = `${Math.min(100, Math.max(0, (window.scrollY / (d.scrollHeight - d.clientHeight || 1)) * 100))}%`;
    };

    window.addEventListener('scroll', spy, { passive: true });
    window.addEventListener('resize', spy);
    spy();
    return () => { window.removeEventListener('scroll', spy); window.removeEventListener('resize', spy); };
  }, []);
  return null;
}
