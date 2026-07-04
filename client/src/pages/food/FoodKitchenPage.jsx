// OxSteed Food - kitchen display system (KDS). Fullscreen board meant to be
// projected or shown on a screen in the kitchen. Polls the active-order feed
// and lets staff tap a ticket to advance it (new -> preparing -> ready -> done).
// Production hardening: elapsed-time urgency tiers (amber/red borders + timer)
// and an explicit LIVE / RECONNECTING connection badge so staff never stare
// at a silently-stale board.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { listFoodRestaurantOrders, updateFoodOrderStatus } from '../../api/food';
import { subscribeRestaurantDisplay } from '../../api/restaurantDisplaySocket';
import { FoodBrand, FoodConnBadge, foodTicketUrgency } from './foodShared';
import '../../styles/FoodPages.css';

const POLL_MS = 5000;
const ADVANCE = { received: 'preparing', accepted: 'preparing', preparing: 'ready', ready: 'completed' };

export default function FoodKitchenPage() {
  const { restaurantId } = useParams();
  const { t } = useTranslation();
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(false);
  // Re-render every 30s so elapsed-minute badges stay current between polls.
  const [, setClockTick] = useState(0);
  const timerRef = useRef(null);
  const clockRef = useRef(null);

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
    clockRef.current = setInterval(() => setClockTick((n) => n + 1), 30000);
    // Live updates (instant) layered over the poll (fallback).
    const unsubscribe = subscribeRestaurantDisplay(restaurantId, load);
    return () => {
      clearInterval(timerRef.current);
      clearInterval(clockRef.current);
      unsubscribe();
    };
  }, [load, restaurantId]);

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
        <span className="fd-row" style={{ gap: '0.6rem', alignItems: 'center' }}>
          <FoodConnBadge ok={!error} />
          <span className="fd-kds-meta">{t('food.kds.tapHint')}</span>
        </span>
      </div>
      {error && <p className="fd-kds-meta">{t('food.common.loadError')}</p>}
      <div className="fd-kds-grid">
        {columns.map((column) => {
          const list = orders.filter(column.match);
          return (
            <div key={column.key} className="fd-kds-col">
              <h2 className="fd-kds-col-title">{column.title} ({list.length})</h2>
              {list.map((order) => {
                // Ready tickets are waiting on the guest, not the kitchen —
                // urgency colouring only applies before the food is up.
                const urgency = order.status === 'ready'
                  ? { tier: 'ontime', elapsedMin: null, color: null }
                  : foodTicketUrgency(order.created_at);
                const externalPayment = order.metadata && typeof order.metadata === 'object'
                  ? order.metadata.externalPayment || order.metadata.external_payment || null
                  : null;
                const paymentSubmission = externalPayment?.submission || externalPayment?.proof || externalPayment?.paymentProof || null;
                const paymentReference = paymentSubmission?.reference || externalPayment?.reference || null;
                const paymentAttachmentUrl = paymentSubmission?.attachmentUrl
                  || paymentSubmission?.url
                  || externalPayment?.attachmentUrl
                  || null;
                return (
                  <div
                    key={order.id}
                    className="fd-kds-card"
                    onClick={() => advance(order)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && advance(order)}
                    style={urgency.color ? {
                      borderLeft: `5px solid ${urgency.color}`,
                      boxShadow: `inset 0 0 0 1px ${urgency.color}55`,
                    } : undefined}
                  >
                    <div className="fd-kds-num" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span>#{order.queue_number}</span>
                      {urgency.elapsedMin != null && (
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: urgency.color || '#94a3b8' }}>
                          {urgency.elapsedMin}m
                        </span>
                      )}
                    </div>
                    <div className="fd-kds-items">
                      {(order.items || []).map((item) => (
                        <div key={item.id}>
                          {item.quantity}× {item.itemName}
                          {item.specialInstructions && <em> - {item.specialInstructions}</em>}
                        </div>
                      ))}
                    </div>
                    {externalPayment && (
                      <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', marginBottom: 4 }}>
                          External payment
                        </div>
                        <div style={{ fontSize: 13, color: '#0f172a', lineHeight: 1.45 }}>
                          {externalPayment.label || 'Payment app / QR'}
                          {externalPayment.handle ? ` · ${externalPayment.handle}` : ''}
                        </div>
                        {(paymentReference || externalPayment.note) && (
                          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                            {paymentReference ? `Ref: ${paymentReference}` : ''}
                            {paymentReference && externalPayment.note ? ' · ' : ''}
                            {externalPayment.note || ''}
                          </div>
                        )}
                        {paymentAttachmentUrl && (
                          <a
                            href={paymentAttachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            style={{ display: 'inline-block', marginTop: 6, fontSize: 12, fontWeight: 700, color: '#0f172a', textDecoration: 'none' }}
                          >
                            View receipt
                          </a>
                        )}
                      </div>
                    )}
                    <div className="fd-kds-meta">
                      {t(`food.fulfillment.${order.fulfillment_type}`)}
                      {order.table_label ? ` · ${order.table_label}` : ''}
                      {' · '}
                      {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
              {list.length === 0 && <p className="fd-kds-meta">{t('food.kds.emptyColumn')}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
