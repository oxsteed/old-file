import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

/**
 * ConfirmDialog — reusable confirmation modal for destructive or
 * privileged one-click actions (fixes the systemic "click takes effect
 * immediately with no confirmation" pattern across admin pages).
 *
 * Props:
 *  - open: boolean
 *  - title: string
 *  - message: string (or node)
 *  - confirmLabel / cancelLabel: strings
 *  - danger: boolean (red confirm button)
 *  - requireReason: boolean — show a reason textarea, block confirm when empty
 *  - onConfirm(reason?): Promise<void> | void
 *  - onClose(): void
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  requireReason = false,
  reasonLabel,
  reasonPlaceholder = '',
  onConfirm,
  onClose,
}) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
  const resolvedCancelLabel = cancelLabel ?? t('common.cancel');
  const resolvedReasonLabel = reasonLabel ?? t('adminConfirmDialog.reason');
  const titleId = useId();
  const reasonId = useId();
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (!open) return null;

  const reasonOk = !requireReason || reason.trim().length > 0;

  const handleConfirm = async () => {
    if (!reasonOk || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(requireReason ? reason.trim() : undefined);
      setReason('');
      onClose();
    } catch (err) {
      // Keep the dialog open on failure so the action is not mistaken for success.
      setError(err?.response?.data?.error || err?.message || t('adminConfirmDialog.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const handleClose = () => {
    if (busy) return;
    setReason('');
    setError(null);
    onClose();
  };

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const frame = window.requestAnimationFrame(() => {
      const firstFocusable = dialogRef.current?.querySelector(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      );
      (firstFocusable || dialogRef.current)?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused.current?.focus) previouslyFocused.current.focus();
    };
  }, [open]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={handleClose}
    >
      <div
        ref={dialogRef}
        tabIndex="-1"
        className="w-full max-w-md rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && <AlertTriangle size={22} className="text-red-400 shrink-0 mt-0.5" />}
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-white">{title}</h2>
            {message && <div className="mt-2 text-sm text-gray-300">{message}</div>}
          </div>
        </div>

        {requireReason && (
          <div className="mt-4">
            <label htmlFor={reasonId} className="block text-sm font-medium text-gray-300 mb-1">
              {resolvedReasonLabel} <span className="text-red-400">*</span>
            </label>
            <textarea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              className="w-full rounded-md bg-gray-800 border border-gray-700 text-white text-sm p-2 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {error && (
          <div className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="px-4 py-2 rounded-md text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700 disabled:opacity-50"
          >
            {resolvedCancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !reasonOk}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {busy ? t('adminConfirmDialog.working') : resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
