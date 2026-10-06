'use client';

import { Icon } from '@esoqo/ui';
import type { OrgLabelSearchRow } from '@/lib/parcel-org-session';
import { ScanButton } from './ScanButton';

/**
 * The sticker picker: hold a pre-printed label, read off its last few
 * characters, and the full code builds itself from behind. Only the
 * company's own unused stickers are ever offered — matching by tail
 * (case-insensitive, any consecutive run), because that's what
 * disambiguates a sticker held at arm's length.
 *
 * Shared between CustomParcelPanel (booking a parcel against one of
 * the company's own labels) and ServeTicketPanel (a clerk attaching a
 * label at the counter) — same register, same search, same picker.
 */
export function LabelPicker({
  tail, onTail, onFocus, results, searching, pickerOpen, selected, onSelect, onScan,
  checking, checkError, onClear, onClose,
  title = 'Parcel label',
  hint = "Sticking one of your pre-printed labels on this box? Type any characters from its code, or scan it.",
}: {
  tail: string;
  onTail: (v: string) => void;
  onFocus: () => void;
  results: OrgLabelSearchRow[] | null;
  searching: boolean;
  pickerOpen: boolean;
  selected: string;
  onSelect: (code: string) => void;
  /** A scan hands back a raw code that hasn't been checked against the
   *  register yet — kept apart from onSelect (a dropdown pick, already
   *  known-good) so a scanned code gets verified before it's accepted. */
  onScan: (code: string) => void;
  checking: boolean;
  checkError: string | null;
  onClear: () => void;
  onClose: () => void;
  title?: string;
  hint?: string;
}) {
  const browsing = tail.trim().length === 0;
  return (
    <fieldset className="psection is-boxed">
      <h3 className="psection-title">{title}</h3>
      <p className="sub" style={{ margin: '6px 0 0' }}>{hint}</p>
      {selected ? (
        <div className="chain ok" style={{ marginTop: 8 }}>
          <Icon name="tag" size={16} />
          <span>Label <strong className="mono">{selected}</strong> confirmed</span>
          <button className="btn btn-o btn-sm" style={{ marginLeft: 'auto' }} onClick={onClear}>
            <Icon name="close" size={14} />Remove
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative', marginTop: 8 }}>
          <div className="row" style={{ gap: 8, alignItems: 'stretch' }}>
            <input
              className="pinput mono" value={tail}
              placeholder="Tap to browse, or type any characters, e.g. YZN…"
              aria-label="Browse or find a label by any characters in its code"
              autoComplete="off"
              style={{ flex: 1 }}
              onChange={(e) => onTail(e.target.value)}
              onFocus={onFocus}
              onBlur={() => window.setTimeout(onClose, 150)}
            />
            <ScanButton onScan={onScan} />
          </div>
          {checking && (
            <p className="sub" style={{ margin: '6px 0 0', fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="loader" size={14} />Checking that label…
            </p>
          )}
          {checkError && !checking && (
            <p role="alert" style={{
              color: 'var(--red, #b42318)', display: 'flex', alignItems: 'center', gap: 6,
              margin: '6px 0 0', fontSize: '.8rem',
            }}>
              <Icon name="alert-circle" size={14} />{checkError}
            </p>
          )}
          {pickerOpen && (
            <div
              role="listbox" aria-label={browsing ? 'Available labels' : 'Matching labels'}
              style={{
                position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%',
                background: 'var(--bg, #fff)', border: '1.5px solid var(--line)',
                borderRadius: 8, marginTop: 4, maxHeight: 220, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,.12)',
              }}
            >
              {searching || results === null ? (
                <p className="sub" style={{ margin: 0, padding: '10px 12px' }}>
                  {browsing ? 'Loading your unused labels…' : 'Searching your labels…'}
                </p>
              ) : results.length === 0 ? (
                <p className="sub" style={{ margin: 0, padding: '10px 12px' }}>
                  {browsing
                    ? 'No unused pre-printed labels on file. Leave this empty to mint a fresh code.'
                    : `No unused label contains "${tail.trim().toUpperCase()}". Check the sticker, or leave this empty to mint a fresh code.`}
                </p>
              ) : (
                <>
                  {browsing && (
                    <p className="sub" style={{ margin: 0, padding: '8px 12px 4px', fontSize: '.72rem' }}>
                      {results.length} unused label{results.length === 1 ? '' : 's'} — newest first. Keep typing to narrow it down.
                    </p>
                  )}
                  {results.map((r) => (
                    browsing
                      ? <BrowseOption key={r.code} code={r.code} onSelect={onSelect} />
                      : <TailOption key={r.code} code={r.code} tail={tail.trim().toUpperCase()} onSelect={onSelect} />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** One row in the plain browse list — no fragment to highlight, since
 *  nothing was typed yet. */
function BrowseOption({ code, onSelect }: { code: string; onSelect: (code: string) => void }) {
  return (
    <button
      type="button" role="option" aria-selected="false"
      className="mono"
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px',
        border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '.9rem',
      }}
      onMouseDown={(e) => { e.preventDefault(); onSelect(code); }}
    >
      {code}
    </button>
  );
}

/** One dropdown row: the full code with the typed fragment emphasised
 *  wherever it occurs, so typing any consecutive run feels like the
 *  code building itself up live. */
function TailOption({ code, tail, onSelect }: { code: string; tail: string; onSelect: (code: string) => void }) {
  const upper = code.toUpperCase();
  const idx = tail ? upper.indexOf(tail) : -1;
  const head = idx >= 0 ? code.slice(0, idx) : code;
  const mid = idx >= 0 ? code.slice(idx, idx + tail.length) : '';
  const rest = idx >= 0 ? code.slice(idx + tail.length) : '';
  return (
    <button
      type="button" role="option" aria-selected="false"
      onMouseDown={(e) => { e.preventDefault(); onSelect(code); }}
      className="mono"
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
        padding: '9px 12px', border: 0, borderBottom: '1px solid var(--line)',
        background: 'transparent', fontSize: '.92rem',
      }}
    >
      {idx >= 0 ? (
        <><span style={{ opacity: 0.55 }}>{head}</span><strong>{mid}</strong><span style={{ opacity: 0.55 }}>{rest}</span></>
      ) : (
        <span style={{ opacity: 0.55 }}>{code}</span>
      )}
    </button>
  );
}
