'use client';

import { useEffect, useState, useTransition } from 'react';
import { Icon } from '@esoqo/ui';
import { useAnnounce } from '@esoqo/a11y';
import { actionSetPrefs } from './actions';

type Prefs = {
  textSize: string; spacing: string; font: string; contrast: string; motion: string;
};

const OPTIONS: { key: keyof Prefs; title: string; help: string; opts: [string, string][] }[] = [
  { key: 'textSize', title: 'Text size', help: 'Everything gets bigger, and nothing gets cut off.',
    opts: [['100', 'Normal'], ['125', 'Large'], ['150', 'Larger'], ['200', 'Largest']] },
  { key: 'spacing', title: 'Space between lines', help: 'More space can make long text easier to follow.',
    opts: [['normal', 'Normal'], ['relaxed', 'Relaxed'], ['loose', 'Loose']] },
  { key: 'font', title: 'Lettering', help: 'A high-legibility face designed for low vision and dyslexia.',
    opts: [['system', 'Standard'], ['legible', 'High legibility']] },
  { key: 'contrast', title: 'Contrast', help: 'Stronger contrast helps in bright sunlight.',
    opts: [['standard', 'Standard'], ['high', 'High contrast']] },
  { key: 'motion', title: 'Movement', help: 'Turn off animations if movement is uncomfortable.',
    opts: [['full', 'Normal'], ['reduced', 'Reduced']] },
];

export function PrefsPanel({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const announce = useAnnounce();

  // Apply immediately so the change is visible while it saves.
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.textSize = prefs.textSize;
    el.dataset.spacing = prefs.spacing;
    el.dataset.font = prefs.font;
    el.dataset.contrast = prefs.contrast;
    if (prefs.motion === 'reduced') el.dataset.motion = 'reduced';
    else delete el.dataset.motion;
  }, [prefs]);

  function set(key: keyof Prefs, value: string, label: string, title: string) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    setSaved(false);
    start(async () => {
      const r = await actionSetPrefs(next as never);
      if (r.ok) { setSaved(true); announce(`${title} set to ${label}`, 'polite'); }
    });
  }

  return (
    <>
      <div className="mcard">
        {OPTIONS.map((o) => (
          <div className="prefrow" key={o.key}>
            <div className="lbl">
              <strong>{o.title}</strong>
              <span className="hint" style={{ margin: '3px 0 0' }}>{o.help}</span>
            </div>
            <div className="prefopts" role="group" aria-label={o.title}>
              {o.opts.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={prefs[o.key] === value}
                  onClick={() => set(o.key, value, label, o.title)} disabled={pending}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mcard" aria-live="polite">
        <h2>
          <Icon name={saved ? 'check-circle' : 'eye'} size={18}
            style={{ color: saved ? 'var(--green)' : undefined }} />
          {saved ? 'Saved to your record' : 'How it looks now'}
        </h2>
        <p style={{ margin: '0 0 10px' }}>
          Sukuma wiki is <strong className="mono">KES 32</strong> at Wakulima this morning, up
          4.2% from yesterday.
        </p>
        <p className="hint" style={{ margin: 0 }}>
          This paragraph uses the settings above. If it is comfortable to read here, it will be
          comfortable everywhere in Esoqo.
        </p>
      </div>
    </>
  );
}
