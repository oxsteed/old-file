import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit2, Package, Gift, Minus } from 'lucide-react';

export function ServicePackagesManager({ businessId }) {
  const { t } = useTranslation();
  const [packages, setPackages] = useState([]);
  const [clientPkgs, setClientPkgs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('packages');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '', total_sessions: 1, price_cents: '', validity_days: 90 });

  useEffect(() => {
    if (tab === 'packages') loadPackages();
    else loadClientPkgs();
  }, [businessId, tab]);

  const loadPackages = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/packages`); setPackages(res.data || []); }
    catch { toast.error(t('businessHub.packages.toastLoadPackagesFail')); }
    finally { setLoading(false); }
  };

  const loadClientPkgs = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/client-packages`); setClientPkgs(res.data || []); }
    catch { toast.error(t('businessHub.packages.toastLoadClientPackagesFail')); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.name || !form.price_cents) return toast.error(t('businessHub.packages.toastNamePriceRequired'));
    const payload = { ...form, price_cents: Math.round(parseFloat(form.price_cents) * 100) };
    try {
      if (editing) {
        await api.put(`/businesses/${businessId}/packages/${editing.id}`, payload);
        toast.success(t('businessHub.packages.toastUpdated'));
      } else {
        await api.post(`/businesses/${businessId}/packages`, payload);
        toast.success(t('businessHub.packages.toastCreated'));
      }
      setShowForm(false); setEditing(null); setForm({ name: '', description: '', total_sessions: 1, price_cents: '', validity_days: 90 }); loadPackages();
    } catch { toast.error(t('common.failedSave')); }
  };

  const deletePackage = async (id) => {
    if (!window.confirm(t('businessHub.packages.confirmArchive'))) return;
    try { await api.delete(`/businesses/${businessId}/packages/${id}`); toast.success(t('businessHub.packages.toastArchived')); loadPackages(); }
    catch { toast.error(t('common.failed')); }
  };

  const redeem = async (cpId) => {
    try { await api.post(`/businesses/${businessId}/client-packages/${cpId}/redeem`); toast.success(t('businessHub.packages.toastRedeemed')); loadClientPkgs(); }
    catch (err) { toast.error(err?.response?.data?.error || t('businessHub.packages.toastRedeemFail')); }
  };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.packages.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.packages.subtitle')}</p>
        </div>
        {tab === 'packages' && <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}><Plus size={16} /> {t('businessHub.packages.newPackage')}</button>}
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {[['packages', t('businessHub.packages.tabs.packages'), <Package size={14} />], ['clients', t('businessHub.packages.tabs.clientPackages'), <Gift size={14} />]].map(([id,label,icon]) => (
          <button key={id} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: tab === id ? '#f97316' : 'var(--muted-text)', borderBottom: tab === id ? '2px solid #f97316' : '2px solid transparent', fontWeight: tab === id ? 600 : 400, fontSize: '0.875rem' }}>
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'packages' && (
        <>
          {showForm && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 1rem' }}>
              {editing ? t('businessHub.packages.editPackage') : t('businessHub.packages.newPackage')}
            </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {[
                  ['name', t('businessHub.packages.labelName'), 'text'],
                  ['price_cents', t('businessHub.packages.labelPrice'), 'number'],
                  ['total_sessions', t('businessHub.packages.labelTotalSessions'), 'number'],
                  ['validity_days', t('businessHub.packages.labelValidityDays'), 'number'],
                ].map(([k,l,fieldType]) => (
                  <div key={k}>
                    <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
                    <input
                      type={fieldType}
                      step={fieldType === 'number' && k === 'price_cents' ? '0.01' : undefined}
                      value={form[k]}
                      onChange={e => setForm(f => ({ ...f, [k]: fieldType === 'number' ? (k === 'price_cents' ? e.target.value : parseInt(e.target.value) || 0) : e.target.value }))}
                      style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}
                    />
                  </div>
                ))}
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.packages.labelDescription')}</label>
                  <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button
                  onClick={() => { setShowForm(false); setEditing(null); }}
                  style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}
                >
                  {t('common.cancel')}
                </button>
                <button onClick={save} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          )}
          {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : packages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Package size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.packages.emptyPackages')}</p></div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: '1rem' }}>
              {packages.map(p => (
                <div key={p.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>{p.name}</h4>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => { setEditing(p); setForm({ name: p.name, description: p.description || '', total_sessions: p.total_sessions, price_cents: (p.price_cents/100).toFixed(2), validity_days: p.validity_days || 90 }); setShowForm(true); }} style={{ padding: '0.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}><Edit2 size={14} /></button>
                      <button onClick={() => deletePackage(p.id)} style={{ padding: '0.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {p.description && <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: 'var(--muted-text)' }}>{p.description}</p>}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{p.total_sessions} {t('businessHub.packages.sessions')} · {p.validity_days}d</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f97316' }}>${(p.price_cents/100).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'clients' && (
        loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : clientPkgs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Gift size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.packages.emptyClientPackages')}</p></div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {clientPkgs.map(cp => (
              <div key={cp.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{cp.customer_name} · {cp.package_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>
                    {cp.sessions_remaining} {t('businessHub.packages.sessionsLeft')} · {cp.expires_at ? `${t('businessHub.packages.expires')} ${new Date(cp.expires_at).toLocaleDateString()}` : t('businessHub.packages.noExpiry')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.875rem', background: cp.sessions_remaining > 0 ? '#10b98122' : '#94a3b822', color: cp.sessions_remaining > 0 ? '#10b981' : '#94a3b8', padding: '0.25rem 0.6rem', borderRadius: '999px', fontWeight: 600 }}>{cp.sessions_remaining}/{cp.sessions_used + cp.sessions_remaining} {t('businessHub.packages.sessions')}</div>
                  {cp.sessions_remaining > 0 && cp.status === 'active' && <button onClick={() => redeem(cp.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}><Minus size={12} /> {t('businessHub.packages.useSession')}</button>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
