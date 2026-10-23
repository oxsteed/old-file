import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import {
  connectionChanged,
  connectionSnapshot,
  observeApiConnection,
  observeAppResume,
  refreshResumedViews,
  subscribeConnection,
} from '../utils/pwaRuntime';
import { observeMobileViewport } from '../utils/mobileViewport';
import '../styles/PwaExperience.css';

export default function PwaRuntime() {
  const { t, i18n } = useTranslation();
  const auth = useAuth(),
    query = useQueryClient(),
    { pathname } = useLocation();
  const state = useSyncExternalStore(
    subscribeConnection,
    connectionSnapshot,
    connectionSnapshot,
  );
  const current = useRef(auth),
    coordinator = useRef();
  current.current = auth;
  useEffect(() => {
    const detach = observeApiConnection(api),
      viewport = observeMobileViewport();
    coordinator.current = observeAppResume(async () => {
      connectionChanged('reconnecting');
      try {
        const account = current.current.user?.id;
        if (account) {
          const verified = await current.current.refreshUser();
          if (!verified || String(verified.id) !== String(account)) return;
        } else await api.get('/config/capabilities', { timeout: 8000 });
        connectionChanged('online', true);
        await Promise.allSettled([
          query.invalidateQueries({ refetchType: 'active' }),
          refreshResumedViews(),
        ]);
      } catch (error) {
        connectionChanged(
          error.response && error.response.status < 500 ? 'online' : 'offline',
        );
      }
    });
    return () => {
      coordinator.current?.stop();
      detach();
      viewport();
    };
  }, [query]);
  const displayRoute =
    /^\/(restaurants|food)\/(kitchen|queue|kiosk|screens)\//.test(pathname);
  useEffect(() => {
    document.documentElement.classList.toggle(
      'pwa-connection-present',
      !displayRoute,
    );
    return () =>
      document.documentElement.classList.remove('pwa-connection-present');
  }, [displayRoute]);
  if (displayRoute) return null;
  return (
    <aside
      className={`pwa-connection pwa-connection-${state.status}`}
      role="status"
      aria-live="polite"
    >
      <span>{t(`pwaExperience.${state.status}`)}</span>
      {state.lastSynced && (
        <time dateTime={new Date(state.lastSynced).toISOString()}>
          {t('pwaExperience.lastSynced', {
            time: new Intl.DateTimeFormat(i18n.language, {
              hour: 'numeric',
              minute: '2-digit',
            }).format(state.lastSynced),
          })}
        </time>
      )}
      {state.status !== 'online' && (
        <button
          type="button"
          onClick={() => coordinator.current?.retry()}
          data-track="pwa.retry-connection"
        >
          {t('pwaExperience.retry')}
        </button>
      )}
    </aside>
  );
}
