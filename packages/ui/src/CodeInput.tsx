'use client';

import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';

/**
 * The boxed code entry — one box per digit, numeric keypad, no letters.
 *
 * Deliberately N separate inputs rather than one wide field with
 * letter-spacing. A single field is simpler to write and worse in every
 * way that matters here: there is no way to show how many digits are
 * expected without the clerk counting characters, a mistyped digit
 * means re-reading the whole string to find it, and on Android the
 * caret in a letter-spaced field lands visually between the wrong two
 * characters. One box per digit makes the expected length a fact of the
 * layout, and a wrong digit a single tap to fix.
 *
 * Every box carries inputMode="numeric", so the handset raises the
 * digits-only keypad rather than a full QWERTY — the whole reason the
 * delivery code became digits (see dbx.DeliveryCodeDigits). That keypad
 * has targets roughly four times the area of a letter key, which is the
 * actual accessibility win for a clerk working fast, outdoors, or with
 * limited literacy: ten large keys with no shift state beat thirty
 * small ones.
 *
 * autoComplete="one-time-code" on the first box lets iOS offer the code
 * straight from the SMS notification, so a receiver holding their own
 * phone at the counter can often fill it without reading anything
 * aloud at all.
 */
export function CodeInput({
  length,
  value,
  onChange,
  onComplete,
  id,
  label,
  invalid = false,
  disabled = false,
  autoFocus = false,
}: {
  length: number;
  /** The digits entered so far. Shorter than `length` while typing. */
  value: string;
  onChange: (next: string) => void;
  /** Fired once the last box is filled — the counter submits on this
   *  rather than making the clerk reach for a button after the sixth
   *  digit, which is the single most common "why isn't it working"
   *  moment on a code field. */
  onComplete?: (code: string) => void;
  id: string;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, ' ').slice(0, length).split('');

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) {
      // Blur before firing: the handset keyboard covers the result card
      // on a phone, and a clerk who has just finished typing wants to
      // see the verdict, not the keypad.
      boxes.current[length - 1]?.blur();
      onComplete?.(clean);
    }
    return clean;
  }

  function handleInput(index: number, raw: string) {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;
    // Take the LAST character, not the first: typing over a filled box
    // should replace it, which is what a clerk fixing a misread digit
    // expects. Taking the first would silently ignore the correction.
    const next = value.split('');
    for (let i = 0; i < typed.length && index + i < length; i += 1) {
      next[index + i] = typed[i]!;
    }
    const joined = commit(next.join('').replace(/\s/g, ''));
    const landed = Math.min(index + typed.length, length - 1);
    if (joined.length < length) boxes.current[landed]?.focus();
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = value.split('');
      if (next[index]) {
        // Clear this box and stay put — one backspace, one digit gone.
        next[index] = '';
        onChange(next.join('').replace(/\s/g, ''));
      } else if (index > 0) {
        next[index - 1] = '';
        onChange(next.join('').replace(/\s/g, ''));
        boxes.current[index - 1]?.focus();
      }
      return;
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      e.preventDefault();
      boxes.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      e.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  }

  /** A code pasted (or autofilled) as one string fills every box. */
  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    e.preventDefault();
    const joined = commit(pasted);
    boxes.current[Math.min(joined.length, length - 1)]?.focus();
  }

  return (
    <div className="codein">
      <label className="codein-label" htmlFor={`${id}-0`}>{label}</label>
      {/* One group, so a screen reader announces "4 of 6 entered" rather
          than reading six unlabelled boxes. */}
      <div
        className={`codein-boxes${invalid ? ' is-invalid' : ''}`}
        role="group"
        aria-labelledby={`${id}-label`}
      >
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { boxes.current[i] = el; }}
            id={`${id}-${i}`}
            className="codein-box mono"
            value={d.trim()}
            onChange={(e) => handleInput(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={handlePaste}
            onFocus={(e) => e.target.select()}
            disabled={disabled}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the code
            // field is the sole purpose of the panel it appears in; the
            // clerk has already chosen "hand it over" to get here.
            autoFocus={autoFocus && i === 0}
            inputMode="numeric"
            pattern="[0-9]*"
            type="text"
            maxLength={1}
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1} of ${length}`}
            aria-invalid={invalid || undefined}
          />
        ))}
      </div>
      <span id={`${id}-label`} className="sr-only">{label}</span>
      <span className="sr-only" aria-live="polite">
        {value.length} of {length} digits entered
      </span>
    </div>
  );
}
