// OxSteed Food - kitchen display system (KDS). Fullscreen board meant to be
// projected or shown on a screen in the kitchen. Polls the active-order feed
// and lets staff tap a ticket to advance it (new -> preparing -> ready -> done).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { listFoodRestaurantOrders, updateFoodOrderStatus } from '../../api/food';
import { FoodBrand } from './foodShared';
import '../../styles/FoodPages.css';

const POLL_MS = 5000;
const ADVANCE = { received: 'preparing', accepted: 'preparing', preparing: 'ready', ready: 'completed' };

export default function FoodKitchenPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback(() => {
    listFoodRestaurantOrders(restaurantId, { active: 1 })
      .then((rows) => {
        setOrders(rows);
        setError(false);
      })
      .catch(() => setError(true));
  }, [restaurantId]);

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  const advance = async (order) => {
    const next = ADVANCE[order.status];
    if (!next) return;
    try {
      await updateFoodOrderStatus(restaurantId, order.id, next);
      load();
    } catch {
      toast.error(t('food.merchant.statusError'));
    }
  };

  const columns = [
    { key: 'new', title: t('food.kds.new'), match: (o) => o.status === 'received' || o.status === 'accepted' },
    { key: 'preparing', title: t('food.kds.preparing'), match: (o) => o.status === 'preparing' },
    { key: 'ready', title: t('food.kds.ready'), match: (o) => o.status === 'ready' },
  ];

  return (
    <div className="fd-screen">
      <div className="fd-screen-header">
        <FoodBrand size={34} />
        <h1 className="fd-screen-title">{t('food.kds.title')}</h1>
        <span className="fd-kds-meta">{t('food.kds.tapHint')}</span>
      </div>
      {error && <p className="fd-kds-meta">{t('food.common.loadError')}</p>}
      <div className="fd-kds-grid">
        {columns.map((column) => {
          const list = orders.filter(column.match);
          return (
            <div key={column.key} className="fd-kds-col">
              <h2 className="fd-kds-col-title">{column.title} ({list.length})</h2>
              {list.map((order) => (
                <div
                  key={order.id}
                  className="fd-kds-card"
                  onClick={() => advance(order)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && advance(order)}
                >
                  <div className="fd-kds-num">#{order.queue_number}</div>
                  <div className="fd-kds-items">
                    {(order.items || []).map((item) => (
                      <div key={item.id}>
                        {item.quantity}× {item.itemName}
                        {item.specialInstructions && <em> - {item.specialInstructions}</em>}
                      </div>
                    ))}
                  </div>
                  <div className="fd-kds-meta">
                    {t(`food.fulfillment.${order.fulfillment_type}`)}
                    {order.table_label ? ` · ${order.table_label}` : ''}
                    {' · '}
                    {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
              {list.length === 0 && <p className="fd-kds-meta">{t('food.kds.emptyColumn')}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
