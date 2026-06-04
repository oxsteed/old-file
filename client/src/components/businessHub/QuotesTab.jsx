import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatCents } from '../../lib/format';

const STATUS_COLORS = {
  draft: 'bg-gray-600 text-gray-200',
  sent: 'bg-blue-600 text-blue-100',
  approved: 'bg-green-600 text-green-100',
  declined: 'bg-red-600 text-red-100',
  expired: 'bg-yellow-600 text-yellow-100',
  converted: 'bg-purple-600 text-purple-100',
};

const STATUS_TABS = ['all','draft','sent','approved','declined','expired','converted'];

function fmtCents(cents) {
  return formatCents(cents);
}

function calcTotals(lineItems, taxRate) {
  const subtotal = (lineItems || []).reduce((s, li) => s + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
  const tax = subtotal * ((parseFloat(taxRate) || 0) / 100);
  return { subtotal, total: subtotal + tax };
}

const DEFAULT_FORM = {
  client_name: '', client_email: '', title: '', description: '',
  line_items: [{ description: '', quantity: 1, unit_price: '' }],
  tax_rate: '0', notes: '', valid_until: '',
};

export function QuotesTab({ businessId, setTab }) {
  const { t } = useTranslation();
  const [quotes, setQuotes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [editQuote, setEditQuote] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const { data } = await api.get(`/businesses/${businessId}/quotes?${params}`);
      setQuotes(data.quotes || []);
      setTotal(data.total || 0);
    } catch {
      toast.error(t('businessQuotes.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [businessId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(DEFAULT_FORM); setEditQuote(null); setShowForm(true); }
  function openEdit(q) {
    setForm({
      client_name: q.client_name || '',
      client_email: q.client_email || '',
      title: q.title || '',
      description: q.description || '',
      line_items: q.line_items?.length ? q.line_items : [{ description: '', quantity: 1, unit_price: '' }],
      tax_rate: String(q.tax_rate || 0),
      notes: q.notes || '',
      valid_until: q.valid_until?.split('T')[0] || '',
    });
    setEditQuote(q);
    setShowForm(true);
  }

  function updateLineItem(i, field, val) {
    setForm(f => {
      const items = [...f.line_items];
      items[i] = { ...items[i], [field]: val };
      return { ...f, line_items: items };
    });
  }
  function addLine() { setForm(f => ({ ...f, line_items: [...f.line_items, { description: '', quantity: 1, unit_price: '' }] })); }
  function removeLine(i) { setForm(f => ({ ...f, line_items: f.line_items.filter((_, idx) => idx !== i) })); }

  async function handleSave() {
    if (!form.client_name.trim()) return toast.error(t('businessQuotes.toastClientNameRequired'));
    setSaving(true);
    try {
      const payload = {
        ...form,
        tax_rate: parseFloat(form.tax_rate) || 0,
        line_items: form.line_items.map(li => ({
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unit_price: parseFloat(li.unit_price) || 0,
        })),
      };
      if (editQuote) {
        await api.put(`/businesses/${businessId}/quotes/${editQuote.id}`, payload);
        toast.success(t('businessQuotes.toastUpdated'));
      } else {
        await api.post(`/businesses/${businessId}/quotes`, payload);
        toast.success(t('businessQuotes.toastCreated'));
      }
      setShowForm(false);
      setEditQuote(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessQuotes.toastSaveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSend(q) {
    try {
      await api.post(`/businesses/${businessId}/quotes/${q.id}/send`);
      toast.success(t('businessQuotes.toastSent'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessQuotes.toastSendFailed'));
    }
  }

  async function handleConvert(q) {
    try {
      await api.post(`/businesses/${businessId}/quotes/${q.id}/convert`);
      toast.success(t('businessQuotes.toastConverted'));
      await load();
      setTimeout(() => setTab && setTab('invoices'), 1000);
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessQuotes.toastConvertFailed'));
    }
  }

  async function handleDelete(q) {
    if (!window.confirm(t('businessQuotes.deleteConfirm'))) return;
    try {
      await api.delete(`/businesses/${businessId}/quotes/${q.id}`);
      toast.success(t('businessQuotes.toastDeleted'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || t('businessQuotes.toastDeleteFailed'));
    }
  }

  const { subtotal, total: grandTotal } = calcTotals(form.line_items, form.tax_rate);

  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{t('businessQuotes.title')}</h2>
        <button onClick={openNew} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors">
          + {t('businessQuotes.newQuote')}
        </button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
              statusFilter === s ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {t(`businessQuotes.status.${s}`)}
          </button>
        ))}
      </div>

      {/* New/Edit form */}
      {showForm && (
        <div className="bg-gray-800 border border-orange-500/30 rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-orange-400 mb-3">{editQuote ? t('businessQuotes.form.edit') : t('businessQuotes.form.new')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.clientName')} *</label>
              <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder={t('businessQuotes.form.clientNamePlaceholder')} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.clientEmail')}</label>
              <input type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder={t('businessQuotes.form.clientEmailPlaceholder')} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.quoteTitle')}</label>
              <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder={t('businessQuotes.form.quoteTitlePlaceholder')} />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.validUntil')}</label>
              <input type="date" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" />
            </div>
          </div>

          <label className="text-xs text-gray-400 block mb-2">{t('businessQuotes.form.lineItems')}</label>
          {form.line_items.map((li, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input value={li.description} onChange={e => updateLineItem(i, 'description', e.target.value)}
                className="flex-1 bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder={t('businessQuotes.form.lineItemDesc')} />
              <input type="number" value={li.quantity} onChange={e => updateLineItem(i, 'quantity', e.target.value)}
                className="w-20 bg-gray-700 border border-gray-600 text-white rounded px-2 py-2 text-sm" placeholder={t('businessQuotes.form.lineItemQty')} min="0" step="0.01" />
              <input type="number" value={li.unit_price} onChange={e => updateLineItem(i, 'unit_price', e.target.value)}
                className="w-28 bg-gray-700 border border-gray-600 text-white rounded px-2 py-2 text-sm" placeholder={t('businessQuotes.form.lineItemUnitPrice')} min="0" step="0.01" />
              {form.line_items.length > 1 && (
                <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-300 px-2">×</button>
              )}
            </div>
          ))}
          <button onClick={addLine} className="text-orange-400 hover:text-orange-300 text-sm mt-1">+ {t('businessQuotes.form.addLine')}</button>

          <div className="flex gap-3 mt-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.taxRate')}</label>
              <input type="number" value={form.tax_rate} onChange={e => setForm(f => ({ ...f, tax_rate: e.target.value }))}
                className="w-24 bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" min="0" max="100" step="0.01" />
            </div>
              <div className="ml-auto text-right text-sm">
              <div className="text-gray-400">{t('businessQuotes.subtotal')}: ${subtotal.toFixed(2)}</div>
              <div className="text-white font-bold">{t('businessQuotes.total')}: ${grandTotal.toFixed(2)}</div>
            </div>
          </div>

          <div className="mt-3">
            <label className="text-xs text-gray-400 block mb-1">{t('businessQuotes.form.notes')}</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" rows={2} placeholder={t('businessQuotes.form.notesPlaceholder')} />
          </div>

          <div className="flex gap-3 mt-3">
            <button onClick={handleSave} disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
              {saving ? t('businessQuotes.form.saving') : editQuote ? t('businessQuotes.form.saveChanges') : t('businessQuotes.form.createQuote')}
            </button>
            <button onClick={() => { setShowForm(false); setEditQuote(null); }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm">
              {t('businessQuotes.form.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Quotes list */}
      {loading ? (
          <div className="text-center text-gray-400 py-8">{t('businessQuotes.loading')}</div>
        ) : quotes.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-medium">{t('businessQuotes.emptyTitle')}</p>
          <p className="text-sm">{t('businessQuotes.emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {quotes.map(q => (
            <div key={q.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-white">{q.client_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[q.status] || 'bg-gray-600 text-gray-200'}`}>
                    {t(`businessQuotes.status.${q.status}`)}
                  </span>
                </div>
                {q.title && <div className="text-sm text-gray-300">{q.title}</div>}
                <div className="text-xs text-gray-500 mt-1">
                  {q.valid_until && `${t('businessQuotes.validUntilPrefix')} ${new Date(q.valid_until + 'T00:00:00').toLocaleDateString()}`}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold text-orange-400">{fmtCents(q.total_cents)}</div>
                <div className="flex gap-2 mt-2 flex-wrap justify-end">
                  {q.status === 'draft' && (
                    <>
                      <button onClick={() => openEdit(q)} className="text-xs bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded">{t('businessQuotes.actions.edit')}</button>
                      <button onClick={() => handleSend(q)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded">{t('businessQuotes.actions.send')}</button>
                      <button onClick={() => handleDelete(q)} className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded">{t('businessQuotes.actions.delete')}</button>
                    </>
                  )}
                  {q.status === 'approved' && (
                    <button onClick={() => handleConvert(q)} className="text-xs bg-purple-600 hover:bg-purple-500 text-white px-3 py-1 rounded">{t('businessQuotes.actions.convertToInvoice')}</button>
                  )}
                </div>
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-500">{t('businessQuotes.totalQuotes', { count: total })}</p>
        </div>
      )}
    </div>
  );
}
