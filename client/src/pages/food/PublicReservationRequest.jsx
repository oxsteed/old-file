import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { requestRestaurantReservation } from '../../api/food';
import { apiErrorMessage } from './foodShared';

function localInputDate(offsetMinutes) {
  const date = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function newKey() {
  return globalThis.crypto?.randomUUID?.() || `reservation:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

export default function PublicReservationRequest({ t, restaurantId, locationId, locations = [], accent = '#f97316' }) {
  const initial = useMemo(() => ({
    locationId: locationId ? String(locationId) : '', guestName: '', guestPhone: '', guestEmail: '', partySize: 2,
    startsAt: localInputDate(60), endsAt: localInputDate(120), notes: '',
  }), [locationId]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await requestRestaurantReservation(restaurantId, {
        ...form,
        locationId: form.locationId || locationId || undefined,
        partySize: Number(form.partySize),
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      }, newKey());
      setConfirmation(result?.reservation || null);
      setForm(initial);
    } catch (error) {
      toast.error(apiErrorMessage(error, t('food.restaurant.reservation.error')));
    } finally { setBusy(false); }
  };
  if (confirmation) {
    return (
      <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, marginBottom: 14 }} aria-live="polite">
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', marginBottom: 10 }}>{t('food.restaurant.reservation.title')}</p>
        <strong>{t('food.restaurant.reservation.received')}</strong>
        <p className="fd-card-meta">{t('food.restaurant.reservation.pendingHint')}</p>
        <button type="button" className="fd-btn fd-btn-secondary" onClick={() => setConfirmation(null)} data-track="ui.a612ceb6f0.55">
          {t('food.restaurant.reservation.requestAnother')}
        </button>
      </section>
    );
  }
  return (
    <section style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 14, marginBottom: 14 }} aria-labelledby="public-reservation-title">
      <p id="public-reservation-title" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-muted)', marginBottom: 10 }}>{t('food.restaurant.reservation.title')}</p>
      <p className="fd-card-meta">{t('food.restaurant.reservation.subtitle')}</p>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-track="ui.a612ceb6f0.54">
        {locations.length > 1 && <select aria-label={t('food.restaurant.reservation.store')} value={form.locationId || String(locationId || '')} onChange={set('locationId')} required>
          <option value="">{t('food.restaurant.reservation.chooseStore')}</option>
          {locations.map((store) => <option key={store.id} value={store.id} disabled={store.status === 'archived'}>{store.name}</option>)}
        </select>}
        <input aria-label={t('food.restaurant.reservation.name')} placeholder={t('food.restaurant.reservation.name')} value={form.guestName} onChange={set('guestName')} required maxLength={160} />
        <input aria-label={t('food.restaurant.reservation.phone')} placeholder={t('food.restaurant.reservation.phone')} value={form.guestPhone} onChange={set('guestPhone')} maxLength={40} />
        <input aria-label={t('food.restaurant.reservation.email')} type="email" placeholder={t('food.restaurant.reservation.email')} value={form.guestEmail} onChange={set('guestEmail')} maxLength={320} />
        <input aria-label={t('food.restaurant.reservation.partySize')} type="number" min="1" max="20" value={form.partySize} onChange={set('partySize')} required />
        <label>{t('food.restaurant.reservation.startsAt')}<input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required /></label>
        <label>{t('food.restaurant.reservation.endsAt')}<input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} required /></label>
        <textarea aria-label={t('food.restaurant.reservation.notes')} placeholder={t('food.restaurant.reservation.notes')} value={form.notes} onChange={set('notes')} maxLength={500} rows={2} />
        <button type="submit" className="fd-btn" style={{ background: accent, color: '#fff' }} disabled={busy} data-track="ui.a612ceb6f0.56">
          {busy ? t('food.restaurant.reservation.sending') : t('food.restaurant.reservation.submit')}
        </button>
      </form>
    </section>
  );
}
