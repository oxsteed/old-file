import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Edit2, RefreshCw, Pause, Play } from 'lucide-react';

export function RecurringBillingManager({ businessId }) {
  const { t } = useTranslation();
  const tRecurring = (key, options) => t(`professionalIntakePage.continuityIntakePage.form.businessRecurringBilling.${key}`, options);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ description: '', amount_cents: '', frequency: 'monthly', start_date: new Date().toISOString().split('T')[0], customer_id: '', notes: '' });

  useEffect(() => { load(); }, [businessId]);

  const load = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/recurring`); setItems(res.data || []); }
    catch { toast.error(tRecurring('loadError')); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.amount_cents || !form.frequency || !form.start_date) return toast.error(tRecurring('requiredFields'));
    const payload = { ...form, amount_cents: Math.round(parseFloat(form.amount_cents) * 100) };
    try {
      if (editing) {
        await api.put(`/businesses/${businessId}/recurring/${editing.id}`, payload);
        toast.success(tRecurring('updated'));
      } else {
        await api.post(`/businesses/${businessId}/recurring`, payload);
        toast.success(tRecurring('created'));
      }
      setShowForm(false); setEditing(null); setForm({ description: '', amount_cents: '', frequency: 'monthly', start_date: new Date().toISOString().split('T')[0], customer_id: '', notes: '' }); load();
    } catch { toast.error(tRecurring('saveError')); }
  };

  const toggle = async (item) => {
    const newStatus = item.status === 'active' ? 'paused' : 'active';
    const statusLabel = newStatus === 'active' ? tRecurring('statusResumed') : tRecurring('statusPaused');
    try { await api.put(`/businesses/${businessId}/recurring/${item.id}`, { ...item, status: newStatus, next_billing_date: item.next_billing_date }); toast.success(statusLabel); load(); }
    catch { toast.error(tRecurring('updateError')); }
  };

  const remove = async (id) => {
    if (!window.confirm(tRecurring('deleteConfirm'))) return;
    try { await api.delete(`/businesses/${businessId}/recurring/${id}`); toast.success(tRecurring('deleted')); load(); }
    catch { toast.error(tRecurring('deleteError')); }
  };

  const frequencies = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annually'];
  const statusLabel = (status) => {
    if (status === 'active') return tRecurring('statusActive');
    if (status === 'paused') return tRecurring('statusPausedStatus');
    return tRecurring('statusUnknown');
  };
  const frequencyLabel = (value) => tRecurring(`frequencies.${value}`, value);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{tRecurring('title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{tRecurring('subtitle')}</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={16} /> {tRecurring('addRecurring')}
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{editing ? tRecurring('editRecurring') : tRecurring('createRecurring')}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {[
              ['description', tRecurring('description'), 'text'],
              ['amount_cents', tRecurring('amount'), 'number'],
            ].map(([fieldKey, label, fieldType]) => (
              <div key={fieldKey}>
                <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{label}</label>
                <input
                  type={fieldType}
                  step={fieldType === 'number' ? '0.01' : undefined}
                  value={form[fieldKey]}
                  onChange={e => setForm(f => ({ ...f, [fieldKey]: e.target.value }))}
                  style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
            ))}
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{tRecurring('frequency')} *</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                {frequencies.map(f => <option key={f} value={f}>{frequencyLabel(f)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{tRecurring('startDate')} *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{tRecurring('notes')}</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => { setShowForm(false); setEditing(null); }} style={{ padding: '0.6rem 1.2rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('common.cancel')}</button>
            <button onClick={save} style={{ padding: '0.6rem 1.2rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{tRecurring('save')}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{tRecurring('loading')}</p> : items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <RefreshCw size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{tRecurring('emptyState')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {items.map(item => (
            <div key={item.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>{item.description || tRecurring('fallbackDescription')}</span>
                  <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.6rem', borderRadius: '999px', background: item.status === 'active' ? '#10b98122' : '#94a3b822', color: item.status === 'active' ? '#10b981' : '#94a3b8', fontWeight: 600 }}>{statusLabel(item.status)}</span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                  {frequencyLabel(item.frequency)} · {tRecurring('next')} {item.next_billing_date ? new Date(item.next_billing_date).toLocaleDateString() : t('common.na')}
                  {item.client_name && ` · ${item.client_name}`}
                </div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>${(item.amount_cents / 100).toFixed(2)}</div>
              <button onClick={() => toggle(item)} title={item.status === 'active' ? tRecurring('pause') : tRecurring('resume')} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: item.status === 'active' ? '#f59e0b' : '#10b981' }}>
                {item.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button onClick={() => { setEditing(item); setForm({ description: item.description || '', amount_cents: (item.amount_cents / 100).toFixed(2), frequency: item.frequency, start_date: item.next_billing_date?.split('T')[0] || '', customer_id: item.customer_id || '', notes: item.notes || '' }); setShowForm(true); }} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}><Edit2 size={14} /></button>
              <button onClick={() => remove(item.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
