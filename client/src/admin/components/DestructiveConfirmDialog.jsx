import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * E12 — the single confirmation contract for destructive admin actions.
 *
 * Every destructive admin action (revoke, delete, force logout, status
 * change with blast radius, ...) must go through this dialog instead of an
 * ad-hoc window.confirm(), so operators get one consistent pattern:
 *
 *   - a clear title naming the action,
 *   - a description of exactly what will happen,
 *   - an explicit irreversibility notice,
 *   - optional type-to-confirm for the most destructive actions,
 *   - Cancel / <action> buttons with the action named on the confirm button.
 *
 * The destructive endpoint behind the dialog must record the action in the
 * audit log (server: logAdminAction / logUserAction).
 */
export default function DestructiveConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  requireTypeText = null, // when set, the operator must type this exact text
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState('');
  const confirmRef = useRef(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      const id = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open ]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const typeOk = requireTypeText == null || typed.trim() === requireTypeText;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onCancel} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-md bg-white dark:bg-gray-800 rounded-lg shadow-xl overflow-hidden"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="destructive-confirm-title"
          aria-describedby="destructive-confirm-description"
        >
          <div className="p-6">
            <div className="flex items-start gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40"
                aria-hidden="true"
              >
                <svg className="h-5 w-5 text-red-600 dark:text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="min-w-0">
                <h3
                  id="destructive-confirm-title"
                  className="text-base font-semibold text-gray-900 dark:text-white"
                >
                  {title || t('destructiveConfirm.title')}
                </h3>
                {description ? (
                  <p
                    id="destructive-confirm-description"
                    className="mt-2 text-sm text-gray-600 dark:text-gray-300"
                  >
                    {description}
                  </p>
                ) : null}
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                  {t('destructiveConfirm.irreversible')}
                </p>
              </div>
            </div>

            {requireTypeText != null ? (
              <div className="mt-4">
                <label
                  htmlFor="destructive-confirm-typed"
                  className="block text-sm text-gray-700 dark:text-gray-300"
                >
                  {t('destructiveConfirm.typeToConfirm', { text: requireTypeText })}
                </label>
                <input
                  id="destructive-confirm-typed"
                  type="text"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder={t('destructiveConfirm.typePlaceholder', { text: requireTypeText })}
                  className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white"
                  autoComplete="off"
                />
              </div>
            ) : null}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t('destructiveConfirm.cancel')}
              </button>
              <button
                ref={confirmRef}
                type="button"
                disabled={!typeOk}
                onClick={onConfirm}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {confirmLabel || t('destructiveConfirm.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
