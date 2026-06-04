import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { formatCents, formatDate } from '../../lib/format';

const CATEGORIES = ['materials','labor','vehicle','software','marketing','equipment','utilities','other'];

function fmtCents(cents, currency = 'USD') {
  return formatCents(cents, { currency });
}

const DEFAULT_FORM = { category: 'materials', description: '', amount: '', expense_date: new Date().toISOString().split('T')[0], receipt_url: '', notes: '' };

export function ExpenseTrackingTab({ businessId, currency = 'USD' }) {
  const [expenses, setExpenses] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ total_cents: 0, by_category: [] });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ category: '', from_date: '', to_date: '' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.set('category', filters.category);
      if (filters.from_date) params.set('from_date', filters.from_date);
      if (filters.to_date) params.set('to_date', filters.to_date);
      const { data } = await api.get(`/businesses/${businessId}/expenses?${params}`);
      setExpenses(data.expenses || []);
      setTotal(data.total || 0);
      setSummary(data.summary || { total_cents: 0, by_category: [] });
    } catch {
      toast.error('Could not load expenses');
    } finally {
      setLoading(false);
    }
  }, [businessId, filters]);

  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(DEFAULT_FORM); setEditId(null); setShowForm(true); }
  function openEdit(exp) {
    setForm({
      category: exp.category,
      description: exp.description,
      amount: (exp.amount_cents / 100).toFixed(2),
      expense_date: exp.expense_date?.split('T')[0] || '',
      receipt_url: exp.receipt_url || '',
      notes: exp.notes || '',
    });
    setEditId(exp.id);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.description.trim()) return toast.error('Description required');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Amount must be > 0');
    setSaving(true);
    try {
      const payload = {
        category: form.category,
        description: form.description.trim(),
        amount_cents: Math.round(parseFloat(form.amount) * 100),
        expense_date: form.expense_date,
        receipt_url: form.receipt_url || undefined,
        notes: form.notes || undefined,
      };
      if (editId) {
        await api.put(`/businesses/${businessId}/expenses/${editId}`, payload);
        toast.success('Expense updated');
      } else {
        await api.post(`/businesses/${businessId}/expenses`, payload);
        toast.success('Expense added');
      }
      setShowForm(false);
      setEditId(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not save expense');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this expense?')) return;
    try {
      await api.delete(`/businesses/${businessId}/expenses/${id}`);
      toast.success('Expense deleted');
      await load();
    } catch {
      toast.error('Could not delete expense');
    }
  }

  const topCategories = [...summary.by_category].slice(0, 3);

  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">Expense Tracking</h2>
        <button
          onClick={openNew}
          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          + Add Expense
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Total This Period</div>
          <div className="text-lg font-bold text-orange-400">{fmtCents(summary.total_cents, currency)}</div>
        </div>
        {topCategories.map(cat => (
          <div key={cat.category} className="bg-gray-800 border border-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1 capitalize">{cat.category}</div>
            <div className="text-lg font-bold text-white">{fmtCents(cat.total_cents, currency)}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <select
          value={filters.category}
          onChange={e => setFilters(f => ({ ...f, category: e.target.value }))}
          className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
        </select>
        <input
          type="date"
          value={filters.from_date}
          onChange={e => setFilters(f => ({ ...f, from_date: e.target.value }))}
          className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          placeholder="From"
        />
        <input
          type="date"
          value={filters.to_date}
          onChange={e => setFilters(f => ({ ...f, to_date: e.target.value }))}
          className="bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm"
          placeholder="To"
        />
      </div>

      {/* Inline add/edit form */}
      {showForm && (
        <div className="bg-gray-800 border border-orange-500/30 rounded-xl p-4 mb-4">
          <h3 className="text-base font-semibold mb-3 text-orange-400">{editId ? 'Edit Expense' : 'New Expense'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
              >
                {CATEGORIES.map(c => <option key={c} value={c} className="capitalize">{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Amount ($)</label>
              <input
                type="number"
                value={form.amount}
                onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Description *</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                placeholder="Description"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Date</label>
              <input
                type="date"
                value={form.expense_date}
                onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Receipt URL</label>
              <input
                type="url"
                value={form.receipt_url}
                onChange={e => setForm(f => ({ ...f, receipt_url: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                placeholder="https://..."
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Notes</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                placeholder="Optional notes"
              />
            </div>
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : editId ? 'Save Changes' : 'Add Expense'}
            </button>
            <button
              onClick={() => { setShowForm(false); setEditId(null); }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-gray-400 text-center py-8">Loading expenses...</div>
      ) : expenses.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">💰</div>
          <p className="font-medium">No expenses found</p>
          <p className="text-sm mt-1">Add your first expense to start tracking costs</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Category</th>
                <th className="pb-2 pr-4">Description</th>
                <th className="pb-2 pr-4 text-right">Amount</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(exp => (
                <tr key={exp.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-3 pr-4 text-gray-300 whitespace-nowrap">
                    {exp.expense_date ? formatDate(`${exp.expense_date}T00:00:00`, { month: 'short', day: 'numeric', year: undefined }) : '-'}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="capitalize bg-gray-700 text-orange-300 text-xs px-2 py-0.5 rounded-full">
                      {exp.category}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-gray-200">{exp.description}</td>
                  <td className="py-3 pr-4 text-right font-medium text-white">{fmtCents(exp.amount_cents, currency)}</td>
                  <td className="py-3 text-right">
                    <button onClick={() => openEdit(exp)} className="text-blue-400 hover:text-blue-300 mr-3 text-xs">Edit</button>
                    <button onClick={() => handleDelete(exp.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-500 mt-2">{total} total expense{total !== 1 ? 's' : ''}</p>
        </div>
      )}
    </div>
  );
}
