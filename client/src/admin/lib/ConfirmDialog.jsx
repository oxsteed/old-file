import { useState } from 'react';
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
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireReason = false,
  reasonLabel = 'Reason',
  reasonPlaceholder = '',
  onConfirm,
  onClose,
}) {
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
      setError(err?.response?.data?.error || err?.message || 'Action failed');
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {danger && <AlertTriangle size={22} className="text-red-400 shrink-0 mt-0.5" />}
          <div>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {message && <div className="mt-2 text-sm text-gray-300">{message}</div>}
          </div>
        </div>

        {requireReason && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1">
              {reasonLabel} <span className="text-red-400">*</span>
            </label>
            <textarea
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
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !reasonOk}
            className={`px-4 py-2 rounded-md text-sm font-medium text-white disabled:opacity-50 ${
              danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
