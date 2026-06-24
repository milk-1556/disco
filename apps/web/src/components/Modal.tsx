import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: role="dialog" aria-modal, labelled by its title, focus-trapped,
 * closes on Escape + backdrop click, focuses the first control on open and restores focus on close.
 * Visual style matches the app's other overlays (fixed scrim, blur, centered .panel).
 */
export function Modal({
  onClose,
  title,
  children,
  maxWidth = 460,
  zIndex = 50,
  panelStyle,
  closeOnBackdrop = true,
}: {
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: number;
  zIndex?: number;
  panelStyle?: React.CSSProperties;
  closeOnBackdrop?: boolean;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Remember the element that had focus before opening, restore it on unmount.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => restoreRef.current?.focus?.();
  }, []);

  // Focus the first focusable control (or the panel) once mounted.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel).focus();
  }, []);

  // Escape to close + Tab focus trap (cycle first ↔ last focusable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      className="p-4"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,7,12,0.7)',
        backdropFilter: 'blur(4px)',
        zIndex,
        display: 'grid',
        placeItems: 'center',
      }}
      onClick={() => closeOnBackdrop && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="panel p-5 md:p-6 rise w-full"
        style={{ maxWidth, maxHeight: '85vh', overflowY: 'auto', outline: 'none', ...panelStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
