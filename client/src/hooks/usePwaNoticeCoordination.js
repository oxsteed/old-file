import { useLayoutEffect, useState } from 'react';
import { deferAppUpdates, isUpdateSensitivePath } from '../utils/appUpdateSafety';

const EDITABLE = 'input:not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"]';
const MODALS = '[role="dialog"][aria-modal="true"], dialog[open]';
const visible = element => !element.hidden && element.getClientRects().length > 0;

export function usePwaNoticeCoordination({ pathname, cookiesOpen, connectionStatus, waitingWorker }) {
  const [editedPath, setEditedPath] = useState(null);
  const [fieldFocused, setFieldFocused] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [protectedWork, setProtectedWork] = useState(false);
  const [localRecovery, setLocalRecovery] = useState(false);

  useLayoutEffect(() => {
    const editable = target => target?.matches?.(EDITABLE)
      && !target.closest('[data-update-transient="true"]');
    const focus = () => setFieldFocused(Boolean(editable(document.activeElement)));
    const edit = event => {
      if (editable(event.target)) setEditedPath(pathname);
    };
    setEditedPath(null);
    focus();
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', focus, true);
    document.addEventListener('input', edit, true);
    document.addEventListener('change', edit, true);
    return () => {
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', focus, true);
      document.removeEventListener('input', edit, true);
      document.removeEventListener('change', edit, true);
    };
  }, [pathname]);

  useLayoutEffect(() => {
    // Observe overlays only when there is a notice to coordinate. Avoid
    // querying layout on every application mutation during ordinary browsing.
    if (!waitingWorker && connectionStatus === 'online' && !cookiesOpen) return undefined;
    const inspect = () => {
      setModalOpen([...document.querySelectorAll(MODALS)].some(visible));
      setProtectedWork([...document.querySelectorAll('[data-update-defer="true"]')].some(visible));
      setLocalRecovery([...document.querySelectorAll('[data-pwa-connection-recovery]')].some(visible));
      const actionClearance = Math.max(0, ...[...document.querySelectorAll('[data-pwa-bottom-actions]')]
        .filter(visible).map(element => Math.max(0, window.innerHeight - element.getBoundingClientRect().top + 12)));
      document.documentElement.style.setProperty('--pwa-action-clearance', `${Math.ceil(actionClearance)}px`);
      const launcher = document.querySelector('[data-pwa-support-launcher]');
      const clearance = launcher && visible(launcher)
        ? Math.max(0, window.innerHeight - launcher.getBoundingClientRect().top + 12) : 0;
      document.documentElement.style.setProperty('--pwa-support-clearance', `${Math.ceil(clearance)}px`);
    };
    inspect();
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['open', 'hidden', 'aria-hidden', 'aria-modal', 'data-update-defer', 'data-pwa-connection-recovery'] });
    const root = document.documentElement;
    let cookieHeight = root.style.getPropertyValue('--cookie-banner-height');
    const rootObserver = new MutationObserver(records => {
      const nextHeight = root.style.getPropertyValue('--cookie-banner-height');
      if (nextHeight !== cookieHeight || records.some(record => record.attributeName !== 'style')) {
        cookieHeight = nextHeight;
        inspect();
      }
    });
    rootObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'dir'] });
    window.addEventListener('resize', inspect);
    return () => {
      observer.disconnect();
      rootObserver.disconnect();
      window.removeEventListener('resize', inspect);
      document.documentElement.style.removeProperty('--pwa-support-clearance');
      document.documentElement.style.removeProperty('--pwa-action-clearance');
    };
  }, [waitingWorker, connectionStatus, cookiesOpen]);

  const deferred = isUpdateSensitivePath(pathname) || cookiesOpen
    || connectionStatus !== 'online' || modalOpen || protectedWork
    || fieldFocused || editedPath === pathname;
  useLayoutEffect(() => {
    if (!deferred) return undefined;
    return deferAppUpdates();
  }, [deferred]);
  return { modalOpen, localRecovery };
}
