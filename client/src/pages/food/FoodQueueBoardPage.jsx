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
  const timerRef = useRef(null);

  const load = useCallback(() => {
    getFoodQueueBoard(restaurantId)
      .then((data) => {
        setBoard(data);
        setError(false);
      })
      .catch(() => setError(true));
  }, [restaurantId]);

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
              <span key={n} className="fd-queue-number">{n}</span>
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
