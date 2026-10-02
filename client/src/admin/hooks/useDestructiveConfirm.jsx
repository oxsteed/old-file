import { useCallback, useRef, useState } from 'react';
import DestructiveConfirmDialog from '../components/DestructiveConfirmDialog';

/**
 * E12 — hook form of the destructive-confirm contract.
 *
 *   const { confirmDestructive, dialog } = useDestructiveConfirm();
 *   // render {dialog} once near the page root, then:
 *   if (await confirmDestructive({
 *     title: 'Revoke grant',
 *     description: '...',
 *     confirmLabel: 'Revoke grant',
 *     requireTypeText: 'REVOKE', // optional
 *   })) {
 *     await doTheThing(); // the endpoint must audit-log the action
 *   }
 */
export default function useDestructiveConfirm() {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirmDestructive = useCallback((options) => new Promise((resolve) => {
    resolverRef.current = resolve;
    setState({ ...(options || {}) });
  }), []);

  const close = useCallback((result) => {
    setState(null);
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
  }, []);

  const dialog = (
    <DestructiveConfirmDialog
      open={state !== null}
      title={state?.title}
      description={state?.description}
      confirmLabel={state?.confirmLabel}
      requireTypeText={state?.requireTypeText ?? null}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirmDestructive, dialog };
}
