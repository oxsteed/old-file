import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Send, Tag, Megaphone, ToggleLeft, ToggleRight } from 'lucide-react';

export function MarketingTools({ businessId }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState('broadcasts');
  const [broadcasts, setBroadcasts] = useState([]);
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showBroadcastForm, setShowBroadcastForm] = useState(false);
  const [showPromoForm, setShowPromoForm] = useState(false);
  const [bf, setBf] = useState({ subject: '', message: '', channel: 'email', audience: 'all' });
  const [pf, setPf] = useState({ code: '', discount_type: 'percent', discount_value: '', min_order_cents: '', max_uses: '', expires_at: '', description: '' });

  useEffect(() => {
    if (tab === 'broadcasts') loadBroadcasts();
    else loadPromos();
  }, [businessId, tab]);

  const loadBroadcasts = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/broadcasts`); setBroadcasts(res.data || []); }
    catch { toast.error(t('businessHub.marketing.toastLoadBroadcastsFail')); }
    finally { setLoading(false); }
  };

  const loadPromos = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/promo-codes`); setPromos(res.data || []); }
    catch { toast.error(t('businessHub.marketing.toastLoadPromosFail')); }
    finally { setLoading(false); }
  };

  const createBroadcast = async () => {
    if (!bf.subject || !bf.message) return toast.error(t('businessHub.marketing.toastSubjectMessageRequired'));
    try { await api.post(`/businesses/${businessId}/broadcasts`, bf); toast.success(t('businessHub.marketing.toastBroadcastCreated')); setShowBroadcastForm(false); setBf({ subject: '', message: '', channel: 'email', audience: 'all' }); loadBroadcasts(); }
    catch { toast.error(t('businessHub.marketing.toastBroadcastCreateFail')); }
  };

  const sendBroadcast = async (id) => {
    if (!window.confirm(t('businessHub.marketing.confirmSendBroadcast'))) return;
    try { await api.post(`/businesses/${businessId}/broadcasts/${id}/send`); toast.success(t('businessHub.marketing.toastBroadcastSent')); loadBroadcasts(); }
    catch { toast.error(t('businessHub.marketing.toastSendFail')); }
  };

  const deleteBroadcast = async (id) => {
    if (!window.confirm(t('businessHub.marketing.confirmDeleteBroadcast'))) return;
    try { await api.delete(`/businesses/${businessId}/broadcasts/${id}`); toast.success(t('businessHub.marketing.toastDeleted')); loadBroadcasts(); }
    catch { toast.error(t('common.failed')); }
  };

  const createPromo = async () => {
    if (!pf.discount_type || pf.discount_value === '') return toast.error(t('businessHub.marketing.toastDiscountRequired'));
    const payload = { ...pf, discount_value: parseFloat(pf.discount_value), min_order_cents: pf.min_order_cents ? Math.round(parseFloat(pf.min_order_cents) * 100) : null, max_uses: pf.max_uses ? parseInt(pf.max_uses) : null };
    try { await api.post(`/businesses/${businessId}/promo-codes`, payload); toast.success(t('businessHub.marketing.toastPromoCreated')); setShowPromoForm(false); setPf({ code: '', discount_type: 'percent', discount_value: '', min_order_cents: '', max_uses: '', expires_at: '', description: '' }); loadPromos(); }
    catch (err) { toast.error(err?.response?.data?.error || t('businessHub.marketing.toastPromoCreateFail')); }
  };

  const togglePromo = async (id) => {
    try { await api.post(`/businesses/${businessId}/promo-codes/${id}/toggle`); toast.success(t('businessHub.marketing.toastUpdated')); loadPromos(); }
    catch { toast.error(t('common.failed')); }
  };

  const deletePromo = async (id) => {
    if (!window.confirm(t('businessHub.marketing.confirmDeletePromo'))) return;
    try { await api.delete(`/businesses/${businessId}/promo-codes/${id}`); toast.success(t('businessHub.marketing.toastDeleted')); loadPromos(); }
    catch { toast.error(t('common.failed')); }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.marketing.title')}</h3>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.marketing.subtitle')}</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {[['broadcasts', t('businessHub.marketing.tabs.broadcasts'), <Megaphone size={14} />], ['promos', t('businessHub.marketing.tabs.promoCodes'), <Tag size={14} />]].map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: tab === id ? '#f97316' : 'var(--muted-text)', borderBottom: tab === id ? '2px solid #f97316' : '2px solid transparent', fontWeight: tab === id ? 600 : 400, fontSize: '0.875rem' }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'broadcasts' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button onClick={() => setShowBroadcastForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> {t('businessHub.marketing.newBroadcast')}</button>
          </div>
          {showBroadcastForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.marketing.newBroadcast')}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.subjectRequired')}</label>
                  <input value={bf.subject} onChange={e => setBf(f => ({ ...f, subject: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} placeholder={t('businessHub.marketing.subjectPlaceholder')} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.messageRequired')}</label>
                  <textarea value={bf.message} onChange={e => setBf(f => ({ ...f, message: e.target.value }))} rows={4} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} placeholder={t('businessHub.marketing.messagePlaceholder')} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.channel')}</label>
                    <select value={bf.channel} onChange={e => setBf(f => ({ ...f, channel: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                      <option value="email">{t('businessHub.marketing.channels.email')}</option>
                      <option value="sms">{t('businessHub.marketing.channels.sms')}</option>
                      <option value="push">{t('businessHub.marketing.channels.push')}</option>
                    </select>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button onClick={() => setShowBroadcastForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('common.cancel')}</button>
                <button onClick={createBroadcast} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{t('businessHub.marketing.saveDraft')}</button>
              </div>
            </div>
          )}
          {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : broadcasts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Megaphone size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.marketing.noBroadcasts')}</p></div>
          ) : broadcasts.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{b.subject}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{t(`businessHub.marketing.channels.${b.channel}`, b.channel)} · {t(`businessHub.marketing.statuses.${b.status}`, b.status)} · {t('businessHub.marketing.recipients', { count: b.recipient_count || 0 })}</div>
              </div>
              {b.status !== 'sent' && <button onClick={() => sendBroadcast(b.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><Send size={12} /> {t('businessHub.marketing.send')}</button>}
              {b.status !== 'sent' && <button onClick={() => deleteBroadcast(b.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>}
            </div>
          ))}
        </>
      )}

      {tab === 'promos' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button onClick={() => setShowPromoForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> {t('businessHub.marketing.newCode')}</button>
          </div>
          {showPromoForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.marketing.newPromoCode')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[['code', t('businessHub.marketing.codeLabel'), 'text'], ['description', t('businessHub.marketing.description'), 'text']].map(([k,l]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                    <input value={pf[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.discountTypeRequired')}</label>
                  <select value={pf.discount_type} onChange={e => setPf(f => ({ ...f, discount_type: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                    <option value="percent">{t('businessHub.marketing.discountTypes.percent')}</option>
                    <option value="fixed">{t('businessHub.marketing.discountTypes.fixed')}</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.discountValueRequired')}</label>
                  <input type="number" step="0.01" value={pf.discount_value} onChange={e => setPf(f => ({ ...f, discount_value: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                </div>
                {[['max_uses', t('businessHub.marketing.maxUses'), 'number'], ['expires_at', t('businessHub.marketing.expires'), 'date']].map(([k,l,t]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                    <input type={t||'text'} value={pf[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button onClick={() => setShowPromoForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('common.cancel')}</button>
                <button onClick={createPromo} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{t('businessHub.marketing.create')}</button>
              </div>
            </div>
          )}
          {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : promos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Tag size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.marketing.noPromoCodes')}</p></div>
          ) : promos.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <code style={{ fontWeight: 700, letterSpacing: '0.1em', background: p.is_active ? '#f9731622' : 'var(--app-bg)', padding: '0.2rem 0.6rem', borderRadius: '0.25rem', color: p.is_active ? '#f97316' : 'var(--muted-text)' }}>{p.code}</code>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{p.discount_type === 'percent' ? t('businessHub.marketing.percentOff', { value: p.discount_value }) : t('businessHub.marketing.fixedOff', { value: p.discount_value })}</span>
                  {p.expires_at && <span style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.expiresShort')} {new Date(p.expires_at).toLocaleDateString(i18n.resolvedLanguage)}</span>}
                </div>
                {p.description && <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginTop: '0.2rem' }}>{p.description}</div>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{t('businessHub.marketing.uses', { count: p.use_count || 0, max: p.max_uses ? `/${p.max_uses}` : '' })}</div>
              <button onClick={() => togglePromo(p.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: p.is_active ? '#10b981' : '#94a3b8' }}>{p.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button>
              <button onClick={() => deletePromo(p.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
