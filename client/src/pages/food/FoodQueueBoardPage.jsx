// OxSteed Food - public "now serving" queue board (McDonald's-style wall
// display). No auth: pointed at a TV/projector facing the dining room.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getFoodQueueBoard } from '../../api/food';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import { FoodBrand, FoodConnBadge } from './foodShared';
import DisplayFullscreenToggle from '../../components/DisplayFullscreenToggle';
import DisplayOfflineBanner from '../../components/DisplayOfflineBanner';
import DisplayInstallPrompt from '../../components/DisplayInstallPrompt';
import DisplayPairingCode from '../../components/DisplayPairingCode';
import { useFullscreen } from '../../hooks/useFullscreen';
import { useWakeLock } from '../../hooks/useWakeLock';
import { useDisplayPoller } from '../../hooks/useDisplayPoller';
import { useReadyChime } from '../../hooks/useReadyChime';
import { detectDisplayStandalone } from '../../utils/displayInstall';
import '../../styles/FoodPages.css';

const POLL_MS = 5000;

export default function FoodQueueBoardPage({managedBoard=null,managedStatus='online'}) {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(false);
  const [newlyReady, setNewlyReady] = useState([]);
  const readyRef = useRef([]);
  const { isFullscreen } = useFullscreen(rootRef);
  // Installed standalone apps (Add to Home Screen) never enter the
  // Fullscreen API state, so wake lock keys off that too.
  const [isStandalone] = useState(() =>
    detectDisplayStandalone({
      matchMedia: typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined,
      standalone: typeof window !== 'undefined' ? window.navigator?.standalone : undefined,
    }),
  );
  useWakeLock(isFullscreen || isStandalone);
  const { soundEnabled, audioBlocked, enableSound, disableSound, playChime } = useReadyChime();

  const load = useCallback(() => {
    const request = managedBoard
      ? Promise.resolve(managedBoard)
      : getFoodQueueBoard(restaurantId);
    return request
      .then((data) => {
        const nextReady = data?.ready || [];
        const previous = new Set(readyRef.current.map(String));
        const additions = nextReady.filter((number) => !previous.has(String(number)));
        readyRef.current = nextReady;
        if (additions.length) {
          setNewlyReady(additions.map(String));
          playChime();
          window.setTimeout(() => setNewlyReady([]), 5000);
        }
        setBoard(data);
        setError(false);
      })
      .catch((fetchError) => {
        setError(true);
        throw fetchError;
      });
  }, [playChime, restaurantId, managedBoard]);

  // Steady poll while healthy, exponential backoff while failing; the board
  // keeps rendering its last-known state and the banner shows offline.
  const { offline } = useDisplayPoller(load, { intervalMs: POLL_MS });

  useEffect(() => {
    if (managedBoard) return undefined;
    // Live updates (instant) layered over the poll (fallback). Routed through
    // the poller so a successful push refresh also clears the offline state.
    return subscribeRestaurantDisplay(restaurantId, () => load().catch(() => {}));
  }, [load, restaurantId, managedBoard]);

  const showOffline = offline || (managedBoard ? managedStatus !== 'online' : error);

  return (
    <div className="fd-screen" ref={rootRef}>
      <div className="fd-screen-header">
        <FoodBrand size={36} />
        <h1 className="fd-screen-title">{board?.restaurant?.display_name || ''}</h1>
        <span className="fd-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <FoodConnBadge ok={managedBoard?managedStatus==='online':!error} />
          <span className="fd-kds-meta">{t('food.queue.payHint')}</span>
        </span>
        {audioBlocked && soundEnabled ? (
          <button
            type="button"
            className="fd-display-sound-blocked"
            onClick={enableSound}
          >
            {t('display.sound.blocked')}
          </button>
        ) : (
          <button
            type="button"
            className="fd-queue-sound-toggle"
            onClick={() => (soundEnabled ? disableSound() : enableSound())}
          >
            {soundEnabled ? t('food.queue.soundOn') : t('food.queue.enableSound')}
          </button>
        )}
        {typeof board?.externalPaymentCount === 'number' && board.externalPaymentCount > 0 && (
          <span
            className="fd-kds-meta"
            style={{
              marginTop: '-0.25rem',
              color: '#ea580c',
              fontWeight: 700,
            }}
          >
            {board.externalPaymentCount} external payment order{board.externalPaymentCount === 1 ? '' : 's'} today
          </span>
        )}
      </div>
      {error && <p className="fd-kds-meta">{t('food.common.loadError')}</p>}
      <div className="fd-queue-grid">
        <div className="fd-queue-col fd-preparing">
          <h2>{t('food.queue.preparing')}</h2>
          <div className="fd-queue-numbers">
            {(board?.preparing || []).map((n) => (
              <span key={n} className="fd-queue-number">{n}</span>
            ))}
            {(board?.preparing || []).length === 0 && (
              <p className="fd-kds-meta">{t('food.queue.none')}</p>
            )}
          </div>
        </div>
        <div className="fd-queue-col fd-ready">
          <h2>{t('food.queue.ready')}</h2>
          <div className="fd-queue-numbers">
            {(board?.ready || []).map((n) => (
              <span
                key={n}
                className={`fd-queue-number ${newlyReady.includes(String(n)) ? 'fd-queue-number-new' : ''}`}
              >{n}</span>
            ))}
            {(board?.ready || []).length === 0 && (
              <p className="fd-kds-meta">{t('food.queue.none')}</p>
            )}
          </div>
        </div>
      </div>
      <DisplayOfflineBanner offline={showOffline} />
      <DisplayFullscreenToggle targetRef={rootRef} />
      <DisplayInstallPrompt />
      <DisplayPairingCode />
    </div>
  );
}
