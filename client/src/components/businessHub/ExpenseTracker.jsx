import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Edit2, TrendingDown, DollarSign } from 'lucide-react';

const CATEGORIES = ['materials','labor','vehicle','software','marketing','equipment','utilities','other'];
const CAT_COLORS = { materials:'#f97316', labor:'#8b5cf6', vehicle:'#06b6d4', software:'#10b981', marketing:'#f59e0b', equipment:'#ef4444', utilities:'#6366f1', other:'#94a3b8' };

export function ExpenseTracker({ businessId }) {
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ category: '', from: '', to: '' });
  const [form, setForm] = useState({ category: 'materials', description: '', amount_cents: '', expense_date: new Date().toISOString().split('T')[0], notes: '' });

  useEffect(() => { load(); }, [businessId, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.category) params.category = filter.category;
      if (filter.from) params.from = filter.from;
      if (filter.to) params.to = filter.to;
      const res = await api.get(`/businesses/${businessId}/expenses`, { params });
      setExpenses(res.data.expenses || []);
      setSummary(res.data.summary || []);
      setTotal(res.data.total || 0);
    } catch { toast.error('Failed to load expenses'); }
    finally { setLoading(false); }
  };

  const save = async () => {
    if (!form.amount_cents || !form.expense_date) return toast.error('Amount and date are required');
    try {
      const payload = { ...form, amount_cents: Math.round(parseFloat(form.amount_cents) * 100) };
      if (editing) {
        await api.put(`/businesses/${businessId}/expenses/${editing.id}`, payload);
        toast.success('Expense updated');
      } else {
        await api.post(`/businesses/${businessId}/expenses`, payload);
        toast.success('Expense added');
      }
      setShowForm(false); setEditing(null);
      setForm({ category: 'materials', description: '', amount_cents: '', expense_date: new Date().toISOString().split('T')[0], notes: '' });
      load();
    } catch { toast.error('Failed to save expense'); }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this expense?')) return;
    try { await api.delete(`/businesses/${businessId}/expenses/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Failed to delete'); }
  };

  const startEdit = (exp) => {
    setEditing(exp);
    setForm({ category: exp.category, description: exp.description || '', amount_cents: (exp.amount_cents / 100).toFixed(2), expense_date: exp.expense_date?.split('T')[0] || '', notes: exp.notes || '' });
    setShowForm(true);
  };

  const totalAmount = expenses.reduce((s, e) => s + (e.amount_cents || 0), 0);

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Expense Tracker</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>Track business costs and spending</p>
        </div>
        <button onClick={() => { setEditing(null); setShowForm(true); }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1.2rem', cursor: 'pointer', fontWeight: 600 }}>
          <Plus size={16} /> Add Expense
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted-text)', fontSize: '0.75rem', marginBottom: '0.25rem' }}><TrendingDown size={14} /> TOTAL</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ef4444' }}>${(totalAmount / 100).toFixed(2)}</div>
        </div>
        {summary.map(s => (
          <div key={s.category} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)', marginBottom: '0.25rem', textTransform: 'capitalize' }}>{s.category}</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: CAT_COLORS[s.category] || '#94a3b8' }}>${(s.total_cents / 100).toFixed(2)}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={filter.category} onChange={e => setFilter(f => ({ ...f, category: e.target.value }))} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
          <option value="">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
        </select>
        <input type="date" value={filter.from} onChange={e => setFilter(f => ({ ...f, from: e.target.value }))} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} placeholder="From" />
        <input type="date" value={filter.to} onChange={e => setFilter(f => ({ ...f, to: e.target.value }))} style={{ padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} placeholder="To" />
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.5rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{editing ? 'Edit' : 'Add'} Expense</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Category *</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }}>
                {CATEGORIES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Amount ($) *</label>
              <input type="number" step="0.01" value={form.amount_cents} onChange={e => setForm(f => ({ ...f, amount_cents: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} placeholder="0.00" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Date *</label>
              <input type="date" value={form.expense_date} onChange={e => setForm(f => ({ ...f, expense_date: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Description</label>
              <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} placeholder="What was this for?" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>Notes</label>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', resize: 'vertical', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => { setShowForm(false); setEditing(null); }} style={{ padding: '0.6rem 1.2rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} style={{ padding: '0.6rem 1.2rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }}>Save Expense</button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? <p style={{ color: 'var(--muted-text)' }}>Loading...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {expenses.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}>
              <DollarSign size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
              <p>No expenses recorded yet. Start tracking your business costs.</p>
            </div>
          ) : expenses.map(exp => (
            <div key={exp.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: CAT_COLORS[exp.category] || '#94a3b8', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{exp.description || exp.category}</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted-text)' }}>{exp.category} · {exp.expense_date?.split('T')[0]}</div>
              </div>
              <div style={{ fontWeight: 700, color: '#ef4444', whiteSpace: 'nowrap' }}>${(exp.amount_cents / 100).toFixed(2)}</div>
              <button onClick={() => startEdit(exp)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--muted-text)' }}><Edit2 size={14} /></button>
              <button onClick={() => remove(exp.id)} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
