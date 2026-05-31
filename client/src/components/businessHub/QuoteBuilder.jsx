import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Send, FileText, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const STATUS_COLORS = { draft:'#94a3b8', sent:'#3b82f6', approved:'#10b981', declined:'#ef4444', expired:'#f59e0b', converted:'#8b5cf6' };

const emptyLine = () => ({ description: '', quantity: 1, unit_price_cents: '' });

export function QuoteBuilder({ businessId }) {
  const { t } = useTranslation();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('list'); // list | form
  const [editing, setEditing] = useState(null);
  const [copied, setCopied] = useState(null);
  const [form, setForm] = useState({ client_name: '', client_email: '', title: '', line_items: [emptyLine()], tax_rate: 0, valid_until: '' });

  useEffect(() => { load(); }, [businessId]);

  const load = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/quotes`); setQuotes(res.data.quotes || []); }
    catch { toast.error(t('businessQuotes.toastLoadFailed')); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.client_name) return toast.error(t('businessQuotes.toastClientNameRequired'));
    if (!form.title) return toast.error(t('businessHub.errTitleRequired'));
    const items = form.line_items.map(l => ({ ...l, unit_price_cents: Math.round(parseFloat(l.unit_price_cents || 0) * 100) }));
    try {
      if (editing) {
        await api.put(`/businesses/${businessId}/quotes/${editing.id}`, { ...form, line_items: items });
        toast.success(t('businessQuotes.toastUpdated'));
      } else {
        await api.post(`/businesses/${businessId}/quotes`, { ...form, line_items: items });
        toast.success(t('businessQuotes.toastCreated'));
      }
      setView('list'); setEditing(null); resetForm(); load();
    } catch { toast.error(t('businessQuotes.toastSaveFailed')); }
  };

  const sendQuote = async (id) => {
    try { await api.post(`/businesses/${businessId}/quotes/${id}/send`); toast.success(t('businessQuotes.toastSent')); load(); }
    catch { toast.error(t('businessQuotes.toastSendFailed')); }
  };

  const deleteQuote = async (id) => {
    if (!window.confirm(t('businessQuotes.deleteConfirm'))) return;
    try { await api.delete(`/businesses/${businessId}/quotes/${id}`); toast.success(t('businessQuotes.toastDeleted')); load(); }
    catch { toast.error(t('businessQuotes.toastDeleteFailed')); }
  };

  const copyLink = (token) => {
    const url = `${window.location.origin}/quote/${token}`;
    navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  const resetForm = () => setForm({ client_name: '', client_email: '', title: '', line_items: [emptyLine()], tax_rate: 0, valid_until: '' });

  const addLine = () => setForm(f => ({ ...f, line_items: [...f.line_items, emptyLine()] }));
  const removeLine = (i) => setForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) }));
  const updateLine = (i, field, val) => setForm(f => {
    const items = [...f.line_items];
    items[i] = { ...items[i], [field]: val };
    return { ...f, line_items: items };
  });

  const subtotal = form.line_items.reduce((s, l) => s + ((parseFloat(l.unit_price_cents || 0)) * (l.quantity || 1)), 0);
  const tax = subtotal * (form.tax_rate || 0) / 100;
  const total = subtotal + tax;

  if (view === 'form') return (
    <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <button onClick={() => { setView('list'); setEditing(null); resetForm(); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--muted-text)', fontSize: '1.5rem', lineHeight: 1 }}>←</button>
        <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{editing ? t('businessQuotes.form.edit') : t('businessQuotes.form.new')}</h3>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        {[['client_name', t('businessQuotes.form.clientName') + ' *'], ['client_email', t('businessQuotes.form.clientEmail')], ['title', t('businessQuotes.form.quoteTitle') + ' *'], ['valid_until', t('businessQuotes.form.validUntil')]].map(([k, l]) => (
          <div key={k}>
            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{l}</label>
            <input type={k === 'valid_until' ? 'date' : k === 'client_email' ? 'email' : 'text'} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
              style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
          </div>
        ))}
      </div>
      <h4 style={{ margin: '1.5rem 0 0.75rem' }}>{t('businessQuotes.form.lineItems')}</h4>
      {form.line_items.map((line, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 36px', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
          <input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} placeholder={t('businessQuotes.form.lineItemDesc')} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
          <input type="number" min="1" value={line.quantity} onChange={e => updateLine(i, 'quantity', parseInt(e.target.value) || 1)} placeholder={t('businessQuotes.form.lineItemQty')} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', textAlign: 'center' }} />
          <input type="number" step="0.01" value={line.unit_price_cents} onChange={e => updateLine(i, 'unit_price_cents', e.target.value)} placeholder={t('businessQuotes.form.lineItemUnitPrice')} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
          <button onClick={() => removeLine(i)} disabled={form.line_items.length === 1} style={{ padding: '0.5rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
        </div>
      ))}
      <button onClick={addLine} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', border: '1px dashed var(--border-color)', borderRadius: '0.5rem', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)', marginBottom: '1rem' }}>
        <Plus size={14} /> {t('businessQuotes.form.addLine')}
      </button>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '2rem', marginBottom: '1rem' }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{t('businessQuotes.subtotal')}: ${subtotal.toFixed(2)}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{t('businessQuotes.form.taxRate')}:</span>
            <input type="number" min="0" max="50" step="0.5" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))} style={{ width: '60px', padding: '0.25rem', border: '1px solid var(--border-color)', borderRadius: '0.25rem', background: 'var(--card-bg)', color: 'var(--app-text)', textAlign: 'right' }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>%</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: '1.1rem', marginTop: '0.25rem' }}>{t('businessQuotes.total')}: ${total.toFixed(2)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
        <button onClick={() => { setView('list'); setEditing(null); resetForm(); }} style={{ padding: '0.6rem 1.2rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>{t('businessQuotes.form.cancel')}</button>
        <button onClick={save} style={{ padding: '0.6rem 1.2rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>{editing ? t('businessQuotes.form.saveChanges') : t('businessQuotes.form.createQuote')}</button>
      </div>
    </div>
  );

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessQuotes.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessQuotes.emptyBody')}</p>
        </div>
        <button onClick={() => setView('form')} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={16} /> {t('businessQuotes.form.new')}
        </button>
      </div>
      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('businessQuotes.loading')}</p> : quotes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
          <FileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p>{t('businessQuotes.emptyTitle')}</p>
          <p style={{ marginTop: '0.5rem' }}>{t('businessQuotes.emptyBody')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {quotes.map(q => (
            <div key={q.id} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 600 }}>{q.title}</span>
                  <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.6rem', borderRadius: '999px', background: STATUS_COLORS[q.status] + '22', color: STATUS_COLORS[q.status], fontWeight: 600 }}>{t(`businessQuotes.status.${q.status}`, { defaultValue: q.status })}</span>
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{q.client_name} {q.client_email && `· ${q.client_email}`}</div>
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem', whiteSpace: 'nowrap' }}>${(q.total_cents / 100).toFixed(2)}</div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {q.status === 'draft' && <button onClick={() => sendQuote(q.id)} title={t('businessQuotes.actions.send')} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#3b82f6' }}><Send size={16} /></button>}
                {q.token && <button onClick={() => copyLink(q.token)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}>{copied === q.token ? <Check size={16} color="#10b981" /> : <Copy size={16} />}</button>}
                <button onClick={() => { setEditing(q); const items = (q.line_items || []).map(l => ({ ...l, unit_price_cents: (l.unit_price_cents / 100).toFixed(2) })); setForm({ client_name: q.client_name, client_email: q.client_email || '', title: q.title, line_items: items.length ? items : [emptyLine()], tax_rate: q.tax_rate || 0, valid_until: q.valid_until?.split('T')[0] || '' }); setView('form'); }} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}><FileText size={16} /></button>
                <button onClick={() => deleteQuote(q.id)} title={t('businessQuotes.deleteConfirm')} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
