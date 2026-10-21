import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatFoodMoney } from '../../api/food';
import { getCreditMinorUnits } from '../../lib/creditCurrency';
import { apiErrorMessage } from './foodShared';

export default function StoreMenuPanel({ restaurant, locationId, t }) {
  const [items, setItems] = useState([]);
  const [itemId, setItemId] = useState('');
  const [price, setPrice] = useState('');
  const [availability, setAvailability] = useState('inherit');
  const [returnAt, setReturnAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.get(`/restaurants/${restaurant.id}/locations/${locationId}/menu`).then(({ data }) => {
      if (active) { setItems(data.items); setItemId(''); }
    }).catch((error) => {
      if (active) { setItems([]); toast.error(apiErrorMessage(error, t('food.storeMenu.failed'))); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [restaurant.id, locationId, revision, t]);
  const selected = items.find((item) => String(item.id) === itemId);
  const choose = (id) => {
    setItemId(id);
    const override = items.find((item) => String(item.id) === id)?.store_override || {};
    setPrice(override.price_cents == null ? '' : (override.price_cents / (10 ** getCreditMinorUnits(items.find((item) => String(item.id) === id)?.currency_code))).toFixed(getCreditMinorUnits(items.find((item) => String(item.id) === id)?.currency_code)));
    const stamp = override.available_again_at ? new Date(override.available_again_at) : null;
    const expired = stamp && stamp.getTime() <= Date.now();
    setAvailability(expired || override.is_available == null ? 'inherit' : override.is_available ? 'available' : 'soldOut');
    setReturnAt(stamp && !expired && !Number.isNaN(stamp.getTime())
      ? new Date(stamp.getTime() - stamp.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');
  };
  const save = async (event) => {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await api.patch(`/restaurants/${restaurant.id}/locations/${locationId}/menu-items/${selected.id}`, {
        priceCents: price === '' ? null : Math.round(Number(price) * (10 ** getCreditMinorUnits(selected.currency_code))),
        isAvailable: availability === 'inherit' ? null : availability === 'available',
        availableAgainAt: availability === 'soldOut' && returnAt ? new Date(returnAt).toISOString() : null,
      });
      toast.success(t('food.storeMenu.saved'));
      setRevision((value) => value + 1);
    } catch (error) { toast.error(apiErrorMessage(error, t('food.storeMenu.failed'))); }
    finally { setBusy(false); }
  };
  return <section className="fd-card" aria-label={t('food.storeMenu.title')}>
    <h3>{t('food.storeMenu.title')}</h3>
    <p className="fd-card-meta">{t('food.storeMenu.hint')}</p>
    {loading ? <p role="status">{t('food.common.loading')}</p> : <form onSubmit={save} data-track="ui.3cc8a8bca6.1">
      <label htmlFor="store-menu-item">{t('food.storeMenu.item')}</label>
      <select id="store-menu-item" value={itemId} onChange={(event) => choose(event.target.value)} disabled={busy}>
        <option value="">{t('food.storeMenu.choose')}</option>
        {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {selected && <>
        <p>{t('food.storeMenu.brandPrice', { price: formatFoodMoney(selected.brand_price_cents, selected.currency_code) })}</p>
        <div className="fd-field">
          <label htmlFor="store-menu-price">{t('food.storeMenu.price', { currency: selected.currency_code })}</label>
          <input id="store-menu-price" type="number" min="0" step={1 / (10 ** getCreditMinorUnits(selected.currency_code))} value={price} onChange={(event) => setPrice(event.target.value)} disabled={busy} />
          <p className="fd-card-meta">{t('food.storeMenu.inheritPrice')}</p>
        </div>
        <div className="fd-field">
          <label htmlFor="store-menu-availability">{t('food.storeMenu.availability')}</label>
          <select id="store-menu-availability" value={availability} onChange={(event) => setAvailability(event.target.value)} disabled={busy}>
            {['inherit', 'available', 'soldOut'].map((key) => <option value={key} key={key}>{t(`food.storeMenu.${key}`)}</option>)}
          </select>
        </div>
        {availability === 'soldOut' && <div className="fd-field">
          <label htmlFor="store-menu-return">{t('food.storeMenu.returnAt')}</label>
          <input id="store-menu-return" type="datetime-local" value={returnAt} onChange={(event) => setReturnAt(event.target.value)} disabled={busy} />
        </div>}
        <button className="fd-btn" type="submit" disabled={busy} data-track="ui.3cc8a8bca6.2">{t(busy ? 'food.common.saving' : 'food.merchant.locationSaveChanges')}</button>
      </>}
    </form>}
  </section>;
}
