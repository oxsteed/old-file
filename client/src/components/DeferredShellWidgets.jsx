import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
// Optional widgets must never trigger automatic chunk-recovery reloads over forms.
function useDeferredModule(load, enabled) {
  const [component, setComponent] = useState(null),
    [error, setError] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError(false);
    load()
      .then((module) => {
        if (active) setComponent(() => module.default);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [load, enabled, attempt]);
  return {
    Component: component,
    error,
    retry: () => setAttempt((value) => value + 1),
  };
}
const loadSupport = () => import('./SupportWidget'),
  loadPalette = () => import('./CommandPalette');

export function DeferredSupportWidget() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false),
    [request, setRequest] = useState(null);
  const { Component, error, retry } = useDeferredModule(loadSupport, ready);
  useEffect(() => {
    let idle;
    const timer = setTimeout(() => {
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(() => setReady(true), { timeout: 4000 })
        : setTimeout(() => setReady(true), 0);
    }, 2500);
    const open = (event) => {
      setRequest(event.detail || {});
      setReady(true);
    };
    window.addEventListener('oxsteed:open-support', open);
    return () => {
      clearTimeout(timer);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      window.removeEventListener('oxsteed:open-support', open);
    };
  }, []);
  if (Component) return <Component initialRequest={request} />;
  return (
    <button
      type="button"
      className="fixed right-5 bottom-5 z-50 rounded-full bg-orange-700 px-4 py-3 text-sm font-semibold text-white"
      onClick={() => {
        setRequest({});
        setReady(true);
        if (error) retry();
      }}
      data-track="pwa.open-support"
    >
      {t('supportWidget.talkToHuman')}
    </button>
  );
}
export function DeferredCommandPalette() {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const { Component, error, retry } = useDeferredModule(loadPalette, ready);
  useEffect(() => {
    if (ready) return;
    const open = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setReady(true);
      }
    };
    window.addEventListener('keydown', open);
    return () => window.removeEventListener('keydown', open);
  }, [ready]);
  if (Component) return <Component initialOpen />;
  return ready && error ? (
    <aside className="pwa-widget-recovery" role="alert">
      <p>{t('pwaExperience.searchUnavailable')}</p>
      <button type="button" onClick={retry} data-track="pwa.retry-search">
        {t('pwaExperience.retry')}
      </button>
      <button
        type="button"
        onClick={() => setReady(false)}
        data-track="pwa.close-search"
      >
        {t('common.close')}
      </button>
    </aside>
  ) : null;
}
