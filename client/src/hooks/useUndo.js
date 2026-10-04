import { useCallback, useEffect, useRef } from 'react';

/**
 * useUndo — delayed-execution undo for destructive actions.
 *
 * Many destructive client actions (hard deletes with no server undelete,
 * cancels that notify the other party) cannot be reversed once the request
 * fires. Instead of a blocking confirm dialog, this hook applies the change
 * optimistically, shows an undo toast for a short window (default 5s), and
 * only runs the real server call when the window expires without an undo:
 *
 *   - onOptimistic(): update local UI immediately (remove the row, mark cancelled)
 *   - onRestore():    put the previous UI state back (undo pressed, finalize failed,
 *                     or the component unmounted before the window expired)
 *   - onFinalize():   the actual irreversible server call (async)
 *   - onFinalized():  optional success follow-up (e.g. success toast, refetch)
 *   - onError(err):   optional failure follow-up (onRestore already ran)
 *
 * Safety: if the component unmounts while actions are pending, the timers are
 * cleared and the toasts dismissed WITHOUT finalizing. The destructive call
 * only fires after a full, uninterrupted undo window.
 *
 * Toast rendering is injected through `notify` because the app uses two toast
 * libraries (react-hot-toast in dashboards, sonner in My Jobs). The adapter
 * must show the undo UI and return a dismiss function:
 *
 *   notify({ message, undoLabel, onUndo, durationMs }) => () => void
 *
 * Example (react-hot-toast):
 *   const { scheduleUndo } = useUndo({
 *     notify: ({ message, undoLabel, onUndo, durationMs }) => {
 *       const id = toast.custom(
 *         <UndoToast message={message} undoLabel={undoLabel} onUndo={onUndo} />,
 *         { duration: durationMs },
 *       );
 *       return () => toast.dismiss(id);
 *     },
 *   });
 *
 * Example (sonner):
 *   const { scheduleUndo } = useUndo({
 *     notify: ({ message, undoLabel, onUndo, durationMs }) => {
 *       const id = toast(message, {
 *         duration: durationMs,
 *         action: { label: undoLabel, onClick: onUndo },
 *       });
 *       return () => toast.dismiss(id);
 *     },
 *   });
 */
export function useUndo({ durationMs = 5000, notify } = {}) {
  // id -> { timer, dismiss }
  const pendingRef = useRef(new Map());

  useEffect(
    () => () => {
      // Fail closed: never finalize after unmount; just clear and dismiss.
      pendingRef.current.forEach((entry) => {
        clearTimeout(entry.timer);
        try {
          entry.dismiss();
        } catch {
          /* noop */
        }
      });
      pendingRef.current.clear();
    },
    [],
  );

  const scheduleUndo = useCallback(
    ({
      key,
      message,
      undoLabel,
      onOptimistic,
      onRestore,
      onFinalize,
      onFinalized,
      onError,
      duration,
    }) => {
      if (typeof notify !== 'function') {
        throw new Error('useUndo: a notify adapter is required');
      }
      const wait = duration ?? durationMs;
      const id = key ?? `undo-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      let settled = false;
      let dismissToast = () => {};
      const settle = () => {
        if (settled) return false;
        settled = true;
        const entry = pendingRef.current.get(id);
        if (entry) {
          clearTimeout(entry.timer);
          pendingRef.current.delete(id);
        }
        return true;
      };
      const undoNow = () => {
        if (!settle()) return;
        dismissToast();
        onRestore?.();
      };

      onOptimistic?.();

      const dismiss = notify({
        message,
        undoLabel,
        durationMs: wait,
        onUndo: undoNow,
      });
      dismissToast = () => {
        try {
          dismiss?.();
        } catch {
          /* noop */
        }
      };

      const timer = setTimeout(async () => {
        if (!settle()) return;
        dismissToast();
        try {
          await onFinalize?.();
          onFinalized?.();
        } catch (err) {
          // The server call failed: the item was never deleted, so the UI
          // must show it again and surface the error.
          onRestore?.();
          onError?.(err);
        }
      }, wait);
      pendingRef.current.set(id, { timer, dismiss: dismissToast });

      // Returned handle lets callers (or tests) cancel = undo programmatically.
      return undoNow;
    },
    [durationMs, notify],
  );

  return { scheduleUndo };
}

export default useUndo;
