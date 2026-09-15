'use client';
import { useCallback, useRef, useState } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { searchSegments, PAPER_LABELS, type Segment } from '@esoqo/domain';

const EXAMPLES = ['carpentry', 'food handling', 'chama', 'fbo', 'cbo', 'ngo', 'boda', 'mama mboga'];

/**
 * "Is Esoqo for me?"
 *
 * The inclusion problem, solved without a wall of text: 92 segments and
 * 595 aliases live in @esoqo/domain, and the word only appears when
 * someone asks for it. In Kenya, if a platform does not name your trade
 * you assume it is not for you — so this search can never say no.
 */
export function Finder() {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Segment[] | null>(null);
  const announce = useAnnounce();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const run = useCallback((v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    if (v.trim().length < 2) { setHits(null); return; }
    timer.current = setTimeout(() => {
      const res = searchSegments(v, 4);
      setHits(res);
      announce(res.length ? `${res.length} matches for ${v}` : `${v} is not listed yet — Esoqo is still for you`);
    }, 180);
  }, [announce]);

  return (
    <div className="finder" id="for-me">
      <p className="kicker">Is Esoqo for me?</p>
      <h2 style={{ marginBottom: 8 }}>Type what you do.</h2>
      <p className="lead" style={{ marginBottom: 20, fontSize: '1rem' }}>
        Search in English or Kiswahili — <em>seremala</em>, <em>fundi</em>, <em>mama mboga</em>,{' '}
        <em>boda</em>, <em>chama</em>, <em>kanisa</em>. Every kind of work is included. The result
        shows which papers apply to yours.
      </p>

      <div className="fin-in">
        <span className="mg"><Icon name="search" size={21} /></span>
        <input
          type="search" value={q} autoComplete="off"
          aria-label="Search what you do"
          aria-describedby="finder-result"
          onChange={(e) => run(e.target.value)}
          placeholder="e.g. carpentry, chama, food handling, CBO, matatu…"
        />
      </div>

      <div className="chips">
        <span style={{ fontSize: '.83rem', color: 'var(--tx-3)' }}>Try:</span>
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="chip" onClick={() => run(e)}>{e}</button>
        ))}
      </div>

      <div id="finder-result" aria-live="polite">
        {hits !== null && hits.length > 0 && hits.map((s) => (
          <div className="hit" key={s.key}>
            <div className="y">Yes — you are on Esoqo</div>
            <h3>{s.name}</h3>
            <div className="pp">
              {s.papers.map((p) => <span key={p}>{PAPER_LABELS[p]}</span>)}
            </div>
          </div>
        ))}

        {hits !== null && hits.length === 0 && (
          <div className="hit">
            <div className="y">Yes — you are on Esoqo</div>
            <h3>Esoqo is for you too</h3>
            <p style={{ margin: '0 0 12px', color: 'var(--tx-2)', fontSize: '.94rem' }}>
              We have not listed “{q.trim()}” yet, and that changes nothing. Esoqo is for anyone
              running anything in Kenya, registered or not.
            </p>
            <div className="pp">
              <span>Trading record</span><span>Business registration</span><span>KRA PIN and eTIMS</span>
            </div>
          </div>
        )}

        {hits !== null && (
          <p style={{ fontSize: '.9rem', color: 'var(--tx-2)', padding: '10px 2px 0' }}>
            Showing what usually applies. Dial <strong>*483*77#</strong> and Esoqo will ask two
            questions to get it exact.
          </p>
        )}
      </div>
    </div>
  );
}
