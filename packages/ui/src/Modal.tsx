'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * The shared dialog — a booking or a side task pulled out of the page's
 * scroll order and into its own layer, so the page underneath stays
 * short. On a narrow screen it docks to the bottom edge instead of
 * floating centered, which is both easier to reach with a thumb and
 * avoids the keyboard fighting a vertically-centered panel for space.
 *
 * Escape and a backdrop click both close it; the panel itself scrolls
 * internally when its content is taller than the viewport, so the
 * header and footer (title, primary actions) stay put.
 */
export function Modal({
  title, subtitle, onClose, children, footer, size = 'md',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-o btn-sm modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
