import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import LogisticsModal from './LogisticsModal';

/**
 * UnsavedChangesGuard - confirms before the user leaves a dirty form.
 *
 * BrowserRouter-compatible: the app renders a plain BrowserRouter
 * (client/src/App.jsx), and react-router's useBlocker only works inside a
 * data router, so this guard does not use it. Instead it combines:
 *
 * - the native `beforeunload` event for tab close / refresh / external
 *   navigation, and
 * - capture-phase interception of in-app link clicks plus a `popstate`
 *   listener for back/forward buttons, showing the accessible
 *   LogisticsModal (Escape dismisses, focus is contained and returned).
 *
 * Programmatic navigations issued by the page itself (e.g. redirecting
 * after a successful submit) are the page's own intent and are never
 * intercepted; only user-initiated link clicks and history pops are
 * guarded. On confirm, navigation proceeds programmatically.
 *
 * Props:
 *  - when: boolean — true while the form has unsaved changes
 */
export default function UnsavedChangesGuard({ when }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  // { type: 'link', to } for an intercepted link click,
  // { type: 'pop' } for an intercepted back/forward pop.
  const [pendingNav, setPendingNav] = useState(null);

  const whenRef = useRef(when);
  whenRef.current = when;
  const lastLocationRef = useRef(location.pathname + location.search + location.hash);

  // Track the last committed location so a back/forward pop can be undone.
  useEffect(() => {
    lastLocationRef.current = location.pathname + location.search + location.hash;
  }, [location]);

  // Native guard for full-page unloads (refresh, tab close, external links).
  useEffect(() => {
    if (!when) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  // In-app link clicks: intercept in the capture phase, before React
  // Router's Link handlers run, so a dirty form can ask first. Modified
  // clicks (new tab), downloads, hash jumps, same-page and external links
  // are left alone.
  useEffect(() => {
    if (!when) return undefined;
    const onClickCapture = (event) => {
      if (!whenRef.current) return;
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor =
        event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      let url;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return; // beforeunload covers these
      const target = url.pathname + url.search + url.hash;
      const current = window.location.pathname + window.location.search + window.location.hash;
      if (target === current) return;
      event.preventDefault();
      event.stopPropagation();
      setPendingNav({ type: 'link', to: target });
    };
    document.addEventListener('click', onClickCapture, true);
    return () => document.removeEventListener('click', onClickCapture, true);
  }, [when]);

  // Back/forward buttons: the browser moves first (popstate cannot be
  // cancelled under BrowserRouter), so move back to the guarded page and
  // ask. "Discard" replays the pop with navigate(-1).
  useEffect(() => {
    if (!when) return undefined;
    const onPopState = () => {
      if (!whenRef.current) return;
      navigate(lastLocationRef.current);
      setPendingNav({ type: 'pop' });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [when, navigate]);

  const reset = useCallback(() => setPendingNav(null), []);

  const confirm = useCallback(() => {
    const nav = pendingNav;
    setPendingNav(null);
    if (!nav) return;
    // Disarm for the programmatic navigation that follows; the ref
    // re-syncs from `when` on the next render if the page stays mounted.
    whenRef.current = false;
    if (nav.type === 'link') {
      navigate(nav.to);
    } else {
      navigate(-1);
    }
  }, [pendingNav, navigate]);

  return (
    <LogisticsModal
      open={pendingNav !== null}
      onClose={reset}
      title={t('logistics.forms.unsavedChanges.title')}
      size="sm"
    >
      <p className="lx-t-muted lx-t-small" style={{ margin: '0 0 1.25rem', lineHeight: 1.6 }}>
        {t('logistics.forms.unsavedChanges.body')}
      </p>
      <div className="lx-btn-row">
        <button
          type="button"
          className="lx-btn-secondary"
          onClick={reset}
          autoFocus
        >
          {t('logistics.forms.unsavedChanges.stay')}
        </button>
        <button
          type="button"
          className="lx-btn-primary"
          onClick={confirm}
        >
          {t('logistics.forms.unsavedChanges.discard')}
        </button>
      </div>
    </LogisticsModal>
  );
}
