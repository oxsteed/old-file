// OxSteed Food - public "now serving" queue board (McDonald's-style wall
// display). No auth: pointed at a TV/projector facing the dining room.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getFoodQueueBoard } from '../../api/food';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import { FoodBrand, FoodConnBadge } from './foodShared';
import '../../styles/FoodPages.css';

const POLL_MS = 5000;

export default function FoodQueueBoardPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('oxsteed:queue:sound') === '1');
  const [newlyReady, setNewlyReady] = useState([]);
  const timerRef = useRef(null);
  const readyRef = useRef([]);
  const soundRef = useRef(soundEnabled);

  useEffect(() => {
    soundRef.current = soundEnabled;
    localStorage.setItem('oxsteed:queue:sound', soundEnabled ? '1' : '0');
  }, [soundEnabled]);

  const playReadyChime = useCallback(() => {
    if (!soundRef.current) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.14);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.42);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.45);
      oscillator.addEventListener('ended', () => context.close());
    } catch (_) {
      // Visual ready animation remains available when audio is blocked.
    }
  }, []);

  const load = useCallback(() => {
    getFoodQueueBoard(restaurantId)
      .then((data) => {
        const nextReady = data?.ready || [];
        const previous = new Set(readyRef.current.map(String));
        const additions = nextReady.filter((number) => !previous.has(String(number)));
        readyRef.current = nextReady;
        if (additions.length) {
          setNewlyReady(additions.map(String));
          playReadyChime();
          window.setTimeout(() => setNewlyReady([]), 5000);
        }
        setBoard(data);
        setError(false);
      })
      .catch(() => setError(true));
  }, [playReadyChime, restaurantId]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    // Live updates (instant) layered over the poll (fallback).
    const unsubscribe = subscribeRestaurantDisplay(restaurantId, load);
    return () => {
      clearInterval(timerRef.current);
      unsubscribe();
    };
  }, [load, restaurantId]);

  return (
    <div className="fd-screen">
      <div className="fd-screen-header">
        <FoodBrand size={36} />
        <h1 className="fd-screen-title">{board?.restaurant?.display_name || ''}</h1>
        <span className="fd-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <FoodConnBadge ok={!error} />
          <span className="fd-kds-meta">{t('food.queue.payHint')}</span>
        </span>
        <button
          type="button"
          className="fd-queue-sound-toggle"
          onClick={() => setSoundEnabled((value) => !value)}
        >
          {soundEnabled ? t('food.queue.soundOn') : t('food.queue.enableSound')}
        </button>
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
    </div>
  );
}
