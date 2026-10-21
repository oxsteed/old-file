import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api/axios';

function errorMessage(error, fallback) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || fallback;
}

export default function GiftCardProductsPanel({ t, restaurant }) {
  const restaurantId = restaurant?.id;
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({ sku: '', name: '', amount: '', deliveryType: 'e_gift' });

  const load = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const response = await api.get(`/restaurants/${restaurantId}/gift-card-products`);
      setProducts(Array.isArray(response.data?.products) ? response.data.products : []);
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error, t('giftCards.loadError')) });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, t]);

  useEffect(() => { load(); }, [load]);

  const create = async (event) => {
    event.preventDefault();
    const amount = Number(form.amount);
    if (!form.sku.trim() || !form.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage({ ok: false, text: t('giftCards.validation') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/restaurants/${restaurantId}/gift-card-products`, {
        sku: form.sku.trim(), name: form.name.trim(), amountCents: Math.round(amount * 100), deliveryType: form.deliveryType,
      });
      setForm({ sku: '', name: '', amount: '', deliveryType: 'e_gift' });
      setMessage({ ok: true, text: t('giftCards.saved') });
      await load();
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error, t('giftCards.saveError')) });
    } finally { setSaving(false); }
  };

  const toggle = async (product) => {
    setSaving(true); setMessage(null);
    try {
      await api.patch(`/restaurants/${restaurantId}/gift-card-products/${product.id}`, { isActive: !product.isActive });
      setMessage({ ok: true, text: t('giftCards.saved') });
      await load();
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error, t('giftCards.saveError')) });
    } finally { setSaving(false); }
  };

  return (
    <section className="fd-settings-card fd-settings-card--wide" aria-label={t('giftCards.title')}>
      <header className="fd-settings-card-head"><div><h3 className="fd-settings-card-title">{t('giftCards.title')}</h3><p className="fd-card-meta fd-settings-card-desc">{t('giftCards.desc')}</p></div></header>
      <div className="fd-settings-card-body">
        <p className="fd-settings-note">{t('giftCards.catalogOnly')}</p>
        {message && <div role="status" className="fd-settings-note">{message.text}</div>}
        <form onSubmit={create} className="fd-settings-grid" data-track="ui.7a385cac33.1">
          <div className="fd-field"><label htmlFor={`gift-card-sku-${restaurantId}`}>{t('giftCards.sku')}</label><input id={`gift-card-sku-${restaurantId}`} value={form.sku} onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))} disabled={saving} maxLength={64} /></div>
          <div className="fd-field"><label htmlFor={`gift-card-name-${restaurantId}`}>{t('giftCards.name')}</label><input id={`gift-card-name-${restaurantId}`} value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} disabled={saving} maxLength={160} /></div>
          <div className="fd-field"><label htmlFor={`gift-card-amount-${restaurantId}`}>{t('giftCards.amount')}</label><input id={`gift-card-amount-${restaurantId}`} value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value.replace(/[^0-9.]/g, '') }))} disabled={saving} inputMode="decimal" /></div>
          <div className="fd-field"><label htmlFor={`gift-card-delivery-${restaurantId}`}>{t('giftCards.delivery')}</label><select id={`gift-card-delivery-${restaurantId}`} value={form.deliveryType} onChange={(e) => setForm((current) => ({ ...current, deliveryType: e.target.value }))} disabled={saving}><option value="e_gift">{t('giftCards.eGift')}</option><option value="physical">{t('giftCards.physical')}</option></select></div>
          <div className="fd-settings-actions"><button type="submit" className="fd-btn" disabled={saving} data-track="ui.7a385cac33.2">{saving ? t('food.common.saving') : t('giftCards.add')}</button></div>
        </form>
        {loading ? <p>{t('food.common.loading')}</p> : (
          <div className="fd-table-wrap"><table className="fd-table"><thead><tr><th>{t('giftCards.sku')}</th><th>{t('giftCards.name')}</th><th>{t('giftCards.amount')}</th><th>{t('giftCards.delivery')}</th><th>{t('giftCards.status')}</th><th /></tr></thead><tbody>
            {products.map((product) => <tr key={product.id}><td>{product.sku}</td><td>{product.name}</td><td>{(Number(product.amountCents) / 100).toFixed(2)} {product.currencyCode}</td><td>{product.deliveryType === 'physical' ? t('giftCards.physical') : t('giftCards.eGift')}</td><td>{product.isActive ? t('giftCards.active') : t('giftCards.inactive')}</td><td><button type="button" className="fd-btn-secondary" disabled={saving} onClick={() => toggle(product)} data-track="ui.7a385cac33.3">{product.isActive ? t('giftCards.deactivate') : t('giftCards.activate')}</button></td></tr>)}
            {!products.length && <tr><td colSpan="6">{t('giftCards.empty')}</td></tr>}
          </tbody></table></div>
        )}
      </div>
    </section>
  );
}
