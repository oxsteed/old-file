// F-08: manager review queue for offline (store-and-forward) card payments.
// Payments taken during an outage that broke a limit, could not be matched
// to their order, or were never reported back land here. "Accept" keeps a
// payment Stripe confirms; "Void" is only allowed when Stripe has no charge.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { apiErrorMessage } from './foodShared';

const REASONS = ['over_transaction_limit', 'over_lease_budget', 'outside_lease_window', 'amount_differs_from_order',
  'order_already_paid', 'order_already_has_offline_card', 'order_not_found'];

export default function RestaurantOfflineCardQueue({ restaurant }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/restaurants/${restaurant.id}/pos/offline-card/open`);
      const payments = (data.payments || []).map((p) => ({ id: p.offline_id, amount: p.amount_cents, status: p.status, reasons: p.review_reasons || [], orderId: p.food_order_id, at: p.collected_at }));
      const permits = (data.permits || []).filter((p) => !payments.some((x) => x.id === p.id))
        .map((p) => ({ id: p.id, amount: p.amount_cents, status: p.status, reasons: ['not_reported'], orderId: p.food_order_id, at: p.expires_at }));
      setItems([...payments, ...permits]);
    } catch {
      setItems([]);
    }
  }, [restaurant.id]);
  useEffect(() => { load(); }, [load]);

  if (!items || items.length === 0) return null;
  const money = (cents) => new Intl.NumberFormat(i18n.language, { style: 'currency', currency: restaurant.currency_code || 'USD' }).format(Number(cents) / 100);
  const when = (v) => (v ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '');

  const resolve = async (id, action) => {
    const note = (notes[id] || '').trim();
    if (note.length < 5) { toast.error(t('food.offlineCard.noteRequired')); return; }
    setBusy(id);
    try {
      await api.post(`/restaurants/${restaurant.id}/pos/offline-card/${id}/resolve`, { action, note });
      toast.success(t(action === 'void' ? 'food.offlineCard.voided' : 'food.offlineCard.accepted'));
      await load();
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.offlineCard.failed')));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="fd-section" aria-labelledby="offline-card-queue-title">
      <h3 id="offline-card-queue-title">{t('food.offlineCard.title')}</h3>
      <p className="fd-muted">{t('food.offlineCard.intro')}</p>
      <ul className="fd-list" role="list">
        {items.map((item) => (
          <li key={item.id} className="fd-card" style={{ paddingInlineStart: 12, paddingInlineEnd: 12 }}>
            <div><strong>{money(item.amount)}</strong>{item.orderId ? ` · ${t('food.offlineCard.order', { id: item.orderId })}` : ''} · <span>{when(item.at)}</span></div>
            <ul aria-label={t('food.offlineCard.reasons')}>
              {item.reasons.map((r) => <li key={r}>{t(REASONS.includes(r) || r === 'not_reported' ? `food.offlineCard.reason.${r}` : 'food.offlineCard.reason.other')}</li>)}
            </ul>
            <label>
              {t('food.offlineCard.note')}
              <input type="text" value={notes[item.id] || ''} maxLength={500} dir="auto"
                onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))} data-track="restaurant.offline_card.note" />
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="fd-btn" disabled={busy === item.id} onClick={() => resolve(item.id, 'accept')} data-track="restaurant.offline_card.accept">
                {t('food.offlineCard.accept')}
              </button>
              <button type="button" className="fd-btn fd-btn-secondary" disabled={busy === item.id} onClick={() => resolve(item.id, 'void')} data-track="restaurant.offline_card.void">
                {t('food.offlineCard.void')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
