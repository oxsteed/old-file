// Credit redesign (D-806): the generic drawer every Credit panel opens
// into. One component for all drawers so the accessibility contract is
// implemented once: a native modal <dialog> (focus trap and Escape come
// from the browser), return focus to the opener on close, backdrop click
// closes, and the panel docks to the inline end so RTL flips it
// automatically. The dialog is mounted only while open; the one-time
// values a drawer shows (a revealed card number, a fresh security code)
// die with the unmount.
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export default function CreditDrawer({ open, onClose, title, children }) {
  const { t } = useTranslation('credit');
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const node = dialog.current;
    if (!node) return undefined;
    const prior = document.activeElement;
    if (!node.open) node.showModal();
    // Focus the close button first: the drawer title is announced via
    // aria-label, and the first Tab lands on the drawer's own content.
    node.querySelector('[data-drawer-close]')?.focus?.();
    return () => {
      if (node.open) node.close();
      if (prior && typeof prior.focus === 'function') prior.focus();
    };
  }, [open ]);

  if (!open) return null;

  return (
    <dialog
      ref={dialog}
      className="ox-credit-drawer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    >
      <div className="ox-credit-drawer-head">
        <h2>{title}</h2>
        <button type="button" className="ox-credit-drawer-close" data-drawer-close onClick={onClose} aria-label={t('redesign.closeDrawer')}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="ox-credit-drawer-body">{children}</div>
    </dialog>
  );
}
