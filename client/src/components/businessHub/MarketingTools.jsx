import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Send, Tag, Megaphone, ToggleLeft, ToggleRight } from 'lucide-react';

export function MarketingTools({ businessId }) {
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
    catch { toast.error('Failed to load broadcasts'); }
    finally { setLoading(false); }
  };

  const loadPromos = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/promo-codes`); setPromos(res.data || []); }
    catch { toast.error('Failed to load promo codes'); }
    finally { setLoading(false); }
  };

  const createBroadcast = async () => {
    if (!bf.subject || !bf.message) return toast.error('Subject and message required');
    try { await api.post(`/businesses/${businessId}/broadcasts`, bf); toast.success('Broadcast created'); setShowBroadcastForm(false); setBf({ subject: '', message: '', channel: 'email', audience: 'all' }); loadBroadcasts(); }
    catch { toast.error('Failed to create broadcast'); }
  };

  const sendBroadcast = async (id) => {
    if (!window.confirm('Send this broadcast to all customers now?')) return;
    try { await api.post(`/businesses/${businessId}/broadcasts/${id}/send`); toast.success('Broadcast sent!'); loadBroadcasts(); }
    catch { toast.error('Failed to send'); }
  };

  const deleteBroadcast = async (id) => {
    if (!window.confirm('Delete this broadcast?')) return;
    try { await api.delete(`/businesses/${businessId}/broadcasts/${id}`); toast.success('Deleted'); loadBroadcasts(); }
    catch { toast.error('Failed'); }
  };

  const createPromo = async () => {
    if (!pf.discount_type || pf.discount_value === '') return toast.error('Discount type and value required');
    const payload = { ...pf, discount_value: parseFloat(pf.discount_value), min_order_cents: pf.min_order_cents ? Math.round(parseFloat(pf.min_order_cents) * 100) : null, max_uses: pf.max_uses ? parseInt(pf.max_uses) : null };
    try { await api.post(`/businesses/${businessId}/promo-codes`, payload); toast.success('Promo code created'); setShowPromoForm(false); setPf({ code: '', discount_type: 'percent', discount_value: '', min_order_cents: '', max_uses: '', expires_at: '', description: '' }); loadPromos(); }
    catch (err) { toast.error(err?.response?.data?.error || 'Failed to create promo code'); }
  };

  const togglePromo = async (id) => {
    try { await api.post(`/businesses/${businessId}/promo-codes/${id}/toggle`); toast.success('Updated'); loadPromos(); }
    catch { toast.error('Failed'); }
  };

  const deletePromo = async (id) => {
    if (!window.confirm('Delete this promo code?')) return;
    try { await api.delete(`/businesses/${businessId}/promo-codes/${id}`); toast.success('Deleted'); loadPromos(); }
    catch { toast.error('Failed'); }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Marketing Tools</h3>
        <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>Reach customers with broadcasts and promotions</p>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {[['broadcasts', 'Broadcasts', <Megaphone size={14} />], ['promos', 'Promo Codes', <Tag size={14} />]].map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: tab === id ? '#f97316' : 'var(--muted-text)', borderBottom: tab === id ? '2px solid #f97316' : '2px solid transparent', fontWeight: tab === id ? 600 : 400, fontSize: '0.875rem' }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'broadcasts' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button onClick={() => setShowBroadcastForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> New Broadcast</button>
          </div>
          {showBroadcastForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>New Broadcast</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Subject *</label>
                  <input value={bf.subject} onChange={e => setBf(f => ({ ...f, subject: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} placeholder="Announcement subject..." />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Message *</label>
                  <textarea value={bf.message} onChange={e => setBf(f => ({ ...f, message: e.target.value }))} rows={4} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} placeholder="Your message..." />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Channel</label>
                    <select value={bf.channel} onChange={e => setBf(f => ({ ...f, channel: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                      <option value="push">Push</option>
                    </select>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button onClick={() => setShowBroadcastForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={createBroadcast} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>Save Draft</button>
              </div>
            </div>
          )}
          {loading ? <p style={{ color: 'var(--muted-text)' }}>Loading...</p> : broadcasts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Megaphone size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>No broadcasts yet.</p></div>
          ) : broadcasts.map(b => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{b.subject}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{b.channel} · {b.status} · {b.recipient_count || 0} recipients</div>
              </div>
              {b.status !== 'sent' && <button onClick={() => sendBroadcast(b.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><Send size={12} /> Send</button>}
              {b.status !== 'sent' && <button onClick={() => deleteBroadcast(b.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>}
            </div>
          ))}
        </>
      )}

      {tab === 'promos' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button onClick={() => setShowPromoForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> New Code</button>
          </div>
          {showPromoForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>New Promo Code</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[['code','Code (auto-generated if blank)','text'], ['description','Description','text']].map(([k,l]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                    <input value={pf[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                  </div>
                ))}
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Discount Type *</label>
                  <select value={pf.discount_type} onChange={e => setPf(f => ({ ...f, discount_type: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                    <option value="percent">Percent (%)</option>
                    <option value="fixed">Fixed ($)</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Discount Value *</label>
                  <input type="number" step="0.01" value={pf.discount_value} onChange={e => setPf(f => ({ ...f, discount_value: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                </div>
                {[['max_uses','Max Uses','number'], ['expires_at','Expires','date']].map(([k,l,t]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                    <input type={t||'text'} value={pf[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button onClick={() => setShowPromoForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>Cancel</button>
                <button onClick={createPromo} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>Create</button>
              </div>
            </div>
          )}
          {loading ? <p style={{ color: 'var(--muted-text)' }}>Loading...</p> : promos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Tag size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>No promo codes yet.</p></div>
          ) : promos.map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <code style={{ fontWeight: 700, letterSpacing: '0.1em', background: p.is_active ? '#f9731622' : 'var(--app-bg)', padding: '0.2rem 0.6rem', borderRadius: '0.25rem', color: p.is_active ? '#f97316' : 'var(--muted-text)' }}>{p.code}</code>
                  <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>{p.discount_type === 'percent' ? `${p.discount_value}% off` : `$${p.discount_value} off`}</span>
                  {p.expires_at && <span style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>Exp: {new Date(p.expires_at).toLocaleDateString()}</span>}
                </div>
                {p.description && <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginTop: '0.2rem' }}>{p.description}</div>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{p.use_count || 0}{p.max_uses ? `/${p.max_uses}` : ''} uses</div>
              <button onClick={() => togglePromo(p.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: p.is_active ? '#10b981' : '#94a3b8' }}>{p.is_active ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}</button>
              <button onClick={() => deletePromo(p.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
