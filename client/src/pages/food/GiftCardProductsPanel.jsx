import React, { useCallback, useEffect, useState, useRef } from 'react';
import api from '../../api/axios';
import GiftCardFulfillmentPanel from './GiftCardFulfillmentPanel';
import { parseCreditMajorAmount } from '../../lib/creditCurrency';
import { moneyMinor } from '../../lib/moneyExact';

function errorMessage(error, fallback) {
  return error?.response?.data?.error?.message || error?.response?.data?.message || fallback;
}

export default function GiftCardProductsPanel({ t, restaurant }) {
  const restaurantId = restaurant?.id;
  const currency = restaurant?.currency_code || 'USD';
  const issueAttempt = useRef(null);
  const [revision,setRevision] = useState(0);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [issuedCode, setIssuedCode] = useState(null);
  const [issuing, setIssuing] = useState(false);
  const [issueForm, setIssueForm] = useState({ productId: '', customerId: '', expiresAt: '', recipientEmail: '', language: 'en', message: '', physicalCode: '' });
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

  useEffect(() => {
    if (!issueForm.productId && products.length) setIssueForm((current) => ({ ...current, productId: String(products[0].id) }));
  }, [products, issueForm.productId]);

  const create = async (event) => {
    event.preventDefault();
    let amount;
    try { amount = parseCreditMajorAmount(form.amount,currency); } catch { amount = null; }
    if (!form.sku.trim() || !form.name.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage({ ok: false, text: t('giftCards.validation') });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await api.post(`/restaurants/${restaurantId}/gift-card-products`, {
        sku: form.sku.trim(), name: form.name.trim(), amountCents: amount, currencyCode: currency, deliveryType: form.deliveryType,
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

  const issueValue = async (event) => {
    event.preventDefault();
    if (!issueForm.productId) return;
    setIssuing(true); setIssuedCode(null); setMessage(null);
    try {
      const payload = {
        productId: Number(issueForm.productId),
        ...(issueForm.customerId.trim() ? { customerId: issueForm.customerId.trim() } : {}),
        ...(issueForm.expiresAt ? { expiresAt: new Date(`${issueForm.expiresAt}T23:59:59.000Z`).toISOString() } : {}),
        recipientEmail: products.find(p=>String(p.id)===issueForm.productId)?.deliveryType==='e_gift'?issueForm.recipientEmail:'',
        physicalCode: products.find(p=>String(p.id)===issueForm.productId)?.deliveryType==='physical'?issueForm.physicalCode:'',
        language: issueForm.language, message: issueForm.message,
      };
      const fingerprint = JSON.stringify({restaurantId,...payload});
      if (issueAttempt.current?.fingerprint !== fingerprint) {
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(fingerprint)))).map(b=>b.toString(16).padStart(2,'0')).join('');
        let previous;
        try { previous = JSON.parse(sessionStorage.getItem(`gift-issue:${restaurantId}`)); } catch {}
        issueAttempt.current = {fingerprint,key:previous?.digest===digest && Date.now()-previous.createdAt<2*60*60*1000?previous.key:crypto.randomUUID()};
        try { sessionStorage.setItem(`gift-issue:${restaurantId}`,JSON.stringify({digest,key:issueAttempt.current.key,createdAt:Date.now()})); } catch {}
      }
      const response = await api.post(`/restaurants/${restaurantId}/gift-cards`, payload, { headers: { 'Idempotency-Key': issueAttempt.current.key } });
      setIssuedCode(response.data?.card?.code || null);
      setMessage({ ok: true, text: t('giftCards.issued') });
      issueAttempt.current = null;
      try { sessionStorage.removeItem(`gift-issue:${restaurantId}`); } catch {}
      setRevision(n=>n+1);
      setIssueForm((current) => ({ ...current, customerId: '', expiresAt: '',recipientEmail:'',message:'',physicalCode:'' }));
    } catch (error) {
      setMessage({ ok: false, text: errorMessage(error, t('giftCards.issueError')) });
    } finally { setIssuing(false); }
  };

  return (
    <section className="fd-settings-card fd-settings-card--wide" aria-label={t('giftCards.title')}>
      <header className="fd-settings-card-head"><div><h3 className="fd-settings-card-title">{t('giftCards.title')}</h3><p className="fd-card-meta fd-settings-card-desc">{t('giftCards.desc')}</p></div></header>
      <div className="fd-settings-card-body">
        <p className="fd-settings-note">{t('giftCards.valueLedger')}</p>
        {message && <div role="status" className="fd-settings-note">{message.text}</div>}
        <form onSubmit={create} className="fd-settings-grid" data-track="ui.7a385cac33.1">
          <div className="fd-field"><label htmlFor={`gift-card-sku-${restaurantId}`}>{t('giftCards.sku')}</label><input id={`gift-card-sku-${restaurantId}`} value={form.sku} onChange={(e) => setForm((current) => ({ ...current, sku: e.target.value }))} disabled={saving} maxLength={64} /></div>
          <div className="fd-field"><label htmlFor={`gift-card-name-${restaurantId}`}>{t('giftCards.name')}</label><input id={`gift-card-name-${restaurantId}`} value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} disabled={saving} maxLength={160} /></div>
          <div className="fd-field"><label htmlFor={`gift-card-amount-${restaurantId}`}>{t('giftCards.amount')}</label><input id={`gift-card-amount-${restaurantId}`} value={form.amount} onChange={(e) => setForm((current) => ({ ...current, amount: e.target.value.replace(/[^0-9.]/g, '') }))} disabled={saving} inputMode="decimal" /></div>
          <div className="fd-field"><label htmlFor={`gift-card-delivery-${restaurantId}`}>{t('giftCards.delivery')}</label><select id={`gift-card-delivery-${restaurantId}`} value={form.deliveryType} onChange={(e) => setForm((current) => ({ ...current, deliveryType: e.target.value }))} disabled={saving}><option value="e_gift">{t('giftCards.eGift')}</option><option value="physical">{t('giftCards.physical')}</option></select></div>
          <div className="fd-settings-actions"><button type="submit" className="fd-btn" disabled={saving} data-track="ui.7a385cac33.2">{saving ? t('food.common.saving') : t('giftCards.add')}</button></div>
        </form>
        <form onSubmit={issueValue} className="fd-settings-grid" data-track="ui.7a385cac33.4">
          <div className="fd-field"><label htmlFor={`gift-card-issue-product-${restaurantId}`}>{t('giftCards.issueProduct')}</label><select id={`gift-card-issue-product-${restaurantId}`} value={issueForm.productId} onChange={(e) => setIssueForm((current) => ({ ...current, productId: e.target.value }))} disabled={issuing || !products.length}><option value="">{t('giftCards.issueProduct')}</option>{products.filter((product) => product.isActive).map((product) => <option key={product.id} value={product.id}>{product.name} - {moneyMinor(product.amountCents,product.currencyCode)} {product.currencyCode}</option>)}</select></div>
          <div className="fd-field"><label htmlFor={`gift-card-issue-customer-${restaurantId}`}>{t('giftCards.issueCustomer')}</label><input id={`gift-card-issue-customer-${restaurantId}`} value={issueForm.customerId} onChange={(e) => setIssueForm((current) => ({ ...current, customerId: e.target.value }))} disabled={issuing} placeholder="UUID" /></div>
          <div className="fd-field"><label htmlFor={`gift-card-issue-expires-${restaurantId}`}>{t('giftCards.issueExpires')}</label><input id={`gift-card-issue-expires-${restaurantId}`} type="date" value={issueForm.expiresAt} onChange={(e) => setIssueForm((current) => ({ ...current, expiresAt: e.target.value }))} disabled={issuing} /></div>
          {products.find(p=>String(p.id)===issueForm.productId)?.deliveryType==='e_gift'?<label className="fd-field">{t('giftFulfillment.recipient')}<input type="email" required maxLength={254} disabled={issuing} value={issueForm.recipientEmail} onChange={e=>setIssueForm(s=>({...s,recipientEmail:e.target.value}))}/></label>:<label className="fd-field">{t('giftFulfillment.preprinted')}<input maxLength={40} disabled={issuing} value={issueForm.physicalCode} onChange={e=>setIssueForm(s=>({...s,physicalCode:e.target.value}))}/></label>}
          <label className="fd-field">{t('giftFulfillment.language')}<select disabled={issuing} value={issueForm.language} onChange={e=>setIssueForm(s=>({...s,language:e.target.value}))}>{['en','es','fr','ht','ar'].map(language=><option key={language} value={language}>{({en:'English',es:'Español',fr:'Français',ht:'Kreyòl',ar:'العربية'})[language]}</option>)}</select></label>
          <label className="fd-field">{t('giftFulfillment.message')}<input disabled={issuing} maxLength={500} value={issueForm.message} onChange={e=>setIssueForm(s=>({...s,message:e.target.value}))}/></label>
          <div className="fd-settings-actions"><button type="submit" className="fd-btn" disabled={issuing || !products.some((product) => product.isActive)} data-track="ui.7a385cac33.5">{issuing ? t('food.common.saving') : t('giftCards.issue')}</button></div>
        </form>
        {issuedCode && <p className="fd-settings-note" role="status"><strong>{t('giftCards.issuedCode')}</strong> <code>{issuedCode}</code></p>}
        {loading ? <p>{t('food.common.loading')}</p> : (
          <div className="fd-table-wrap"><table className="fd-table"><thead><tr><th>{t('giftCards.sku')}</th><th>{t('giftCards.name')}</th><th>{t('giftCards.amount')}</th><th>{t('giftCards.delivery')}</th><th>{t('giftCards.status')}</th><th /></tr></thead><tbody>
            {products.map((product) => <tr key={product.id}><td>{product.sku}</td><td>{product.name}</td><td>{moneyMinor(product.amountCents,product.currencyCode)} {product.currencyCode}</td><td>{product.deliveryType === 'physical' ? t('giftCards.physical') : t('giftCards.eGift')}</td><td>{product.isActive ? t('giftCards.active') : t('giftCards.inactive')}</td><td><button type="button" className="fd-btn-secondary" disabled={saving} onClick={() => toggle(product)} data-track="ui.7a385cac33.3">{product.isActive ? t('giftCards.deactivate') : t('giftCards.activate')}</button></td></tr>)}
            {!products.length && <tr><td colSpan="6">{t('giftCards.empty')}</td></tr>}
          </tbody></table></div>
        )}
      </div>
      <GiftCardFulfillmentPanel key={restaurantId} restaurantId={restaurantId} t={t} revision={revision} />
    </section>
  );
}
