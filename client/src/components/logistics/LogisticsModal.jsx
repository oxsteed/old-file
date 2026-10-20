import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import '../../styles/logistics/LogisticsModal.css';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Module-level scroll-lock bookkeeping so stacked modals do not fight over
// document.body styles.
let scrollLockCount = 0;
let savedBodyOverflow = '';

function lockBodyScroll() {
  if (scrollLockCount === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function unlockBodyScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
  }
}

function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.hasAttribute('disabled')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });
}

/**
 * Accessible modal for the Logistics workspaces.
 *
 * - Traps Tab/Shift+Tab focus inside the dialog while open.
 * - Returns focus to the element that opened the modal on close.
 * - Escape dismisses (when dismissable), as does clicking the backdrop.
 * - Locks body scroll while open and restores it on close.
 * - RTL-safe: layout uses flex order and logical properties in CSS.
 * - Sits at z-index 1200, above the floating support/assistant widget (z-40)
 *   and page content, matching the app's other modal overlays.
 */
export default function LogisticsModal({
  open,
  title,
  onClose,
  children,
  dismissable = true,
  fullPageHref = null,
  describedBy = null,
  size = 'md',
}) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();

  // Capture the trigger element and lock body scroll while open.
  useEffect(() => {
    if (!open) return undefined;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll();
    return () => {
      unlockBodyScroll();
      // Return focus to whatever opened the modal.
      if (triggerRef.current && typeof triggerRef.current.focus === 'function') {
        triggerRef.current.focus();
      }
      triggerRef.current = null;
    };
  }, [open ]);

  // Move focus into the dialog on open (first focusable element, else the dialog itself).
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = getFocusableElements(dialog);
    const target = focusables[0] || dialog;
    // Defer one frame so the portal content is fully painted before focusing.
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(raf);
  }, [open ]);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      if (dismissable) {
        event.stopPropagation();
        onClose?.();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = getFocusableElements(dialog);
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleBackdropMouseDown = (event) => {
    // Only dismiss when the backdrop itself (not dialog content) is clicked.
    if (dismissable && event.target === overlayRef.current) {
      onClose?.();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="lxm-overlay"
      onMouseDown={handleBackdropMouseDown}
      data-testid="logistics-modal-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(describedBy ? { 'aria-describedby': describedBy } : {})}
        tabIndex={-1}
        className={`lxm-dialog lxm-dialog--${size}`}
        onKeyDown={handleKeyDown}
      >
        <div className="lxm-header">
          <h2 id={titleId} className="lxm-title">{title}</h2>
          <div className="lxm-header-actions">
            {fullPageHref && (
              <Link to={fullPageHref} className="lxm-fullpage-btn" onClick={() => onClose?.()}>
                {tx('logistics.modal.openFullPage', 'Open full page')}
              </Link>
            )}
            <button
              type="button"
              className="lxm-close-btn"
              onClick={() => onClose?.()}
              aria-label={tx('logistics.modal.close', 'Close')} data-track="ui.72908cf3d0.1"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>
        <div className="lxm-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

/** Small loading state used by the logistics preview components. */
export function LogisticsModalLoading({ label }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  const text = label || tx('logistics.modal.loading', 'Loading…');
  return (
    <div className="lxm-state" role="status" aria-live="polite">
      <div className="lxm-spinner" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

/** Error state with retry used by the logistics preview components. */
export function LogisticsModalError({ message, onRetry }) {
  const { t } = useTranslation();
  const tx = (key, fallback, opts = {}) => t(key, { defaultValue: fallback, ...opts });
  return (
    <div className="lxm-state" role="alert">
      <div className="lxm-state-icon" aria-hidden="true">⚠️</div>
      <p>{message || tx('logistics.modal.loadError', "Couldn't load this preview.")}</p>
      {onRetry && (
        <button type="button" className="lx-btn-secondary lxm-retry-btn" onClick={onRetry} data-track="ui.72908cf3d0.2">
          {tx('logistics.modal.retry', 'Retry')}
        </button>
      )}
    </div>
  );
}
