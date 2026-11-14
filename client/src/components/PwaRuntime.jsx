import { useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
import { CookieConsentContext } from '../context/CookieConsentContext';
import { getWaitingWorker, subscribeWorkerUpdate } from '../utils/serviceWorkerRegistration';
import { usePwaNoticeCoordination } from '../hooks/usePwaNoticeCoordination';
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
  const waitingWorker = useSyncExternalStore(subscribeWorkerUpdate, getWaitingWorker, getWaitingWorker);
  const cookies = useContext(CookieConsentContext);
  const { modalOpen, localRecovery } = usePwaNoticeCoordination({ pathname, waitingWorker,
    cookiesOpen: Boolean(cookies?.showBanner || cookies?.showSettings), connectionStatus: state.status });
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
        if (account || current.current.sessionRecovering) {
          const verified = await current.current.refreshUser();
          if (account && (!verified || String(verified.id) !== String(account))) return;
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
  // Item 13: the banner used to flash on every transient reconnect (app
  // resume sets 'reconnecting' on each refresh, and any 5xx API response
  // sets 'offline'). Only show it once the non-online status has persisted
  // about 3 seconds. The connection store itself is unchanged: it still
  // flips immediately, and a fast recovery never shows the banner at all.
  //
  // The 3s clock runs on the offline *episode*, not on the instantaneous
  // status. The store flips to 'online' on any successful response, so an
  // unrelated success during a sustained outage (draft autosave PUT, a
  // refetch) would otherwise clear the timer and the banner would never
  // appear even though the session check keeps failing. A return to
  // 'online' only ends the episode when a sync actually happened after the
  // episode began (a verified refresh or a successful GET advances
  // lastSynced; a lone non-GET success does not), so a transient reconnect
  // that re-verifies still never flashes the banner.
  const [sustainedOffline, setSustainedOffline] = useState(false);
  const offlineEpisodeRef = useRef({ since: 0, syncedAt: null, timer: null });
  useEffect(() => {
    const episode = offlineEpisodeRef.current;
    if (state.status !== 'online') {
      if (!episode.since) {
        episode.since = Date.now();
        episode.syncedAt = state.lastSynced;
      }
      if (!episode.timer) {
        const delay = Math.max(0, 3000 - (Date.now() - episode.since));
        episode.timer = setTimeout(() => {
          episode.timer = null;
          setSustainedOffline(true);
        }, delay);
      }
      return undefined;
    }
    if (episode.since && state.lastSynced !== episode.syncedAt) {
      if (episode.timer) {
        clearTimeout(episode.timer);
        episode.timer = null;
      }
      episode.since = 0;
      episode.syncedAt = null;
      setSustainedOffline(false);
    }
    return undefined;
  }, [state.status, state.lastSynced]);
  useEffect(
    () => () => {
      const episode = offlineEpisodeRef.current;
      if (episode.timer) clearTimeout(episode.timer);
      episode.timer = null;
    },
    [],
  );
  // Healthy connections need no persistent overlay. Keep the shared state
  // and resume coordinator active; show recovery controls only when needed.
  const showConnection = !displayRoute && !modalOpen && !localRecovery && !auth.sessionRecovering && sustainedOffline;
  // During a sustained offline episode the store can report 'online'
  // because an unrelated request succeeded (draft autosave). The banner
  // must still present the episode state, with its Retry action, until a
  // fresh sync ends the episode; a genuine 'reconnecting' state keeps its
  // own copy.
  const bannerStatus = sustainedOffline && state.status === 'online' ? 'offline' : state.status;
  useEffect(() => {
    document.documentElement.classList.toggle(
      'pwa-connection-present',
      showConnection,
    );
    return () =>
      document.documentElement.classList.remove('pwa-connection-present');
  }, [showConnection]);
  if (!showConnection) return null;
  return (
    <aside
      className={`pwa-connection pwa-connection-${bannerStatus}`}
      role="status"
      aria-live="polite"
    >
      <span>{t(`pwaExperience.${bannerStatus}`)}</span>
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
      {bannerStatus !== 'online' && (
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
