import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';

const FREQUENCIES = ['weekly','biweekly','monthly','quarterly','annually'];
const STATUS_COLORS = { active: 'bg-green-700 text-green-100', paused: 'bg-yellow-700 text-yellow-100', cancelled: 'bg-red-700 text-red-100' };

function fmtCents(cents, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format((cents || 0) / 100);
}

function toMonthlyCents(cents, frequency) {
  const map = { weekly: 52/12, biweekly: 26/12, monthly: 1, quarterly: 1/3, annually: 1/12 };
  return Math.round(cents * (map[frequency] || 1));
}

const DEFAULT_FORM = { client_name: '', client_email: '', description: '', amount: '', frequency: 'monthly', next_billing_date: '', notes: '' };

export function RecurringBillingTab({ businessId, currency = 'USD' }) {
  const [contracts, setContracts] = useState([]);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editContract, setEditContract] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/businesses/${businessId}/recurring-billing${params}`);
      setContracts(data.contracts || []);
      setUpcomingCount(data.upcoming_this_month || 0);
    } catch {
      toast.error('Could not load recurring billing');
    } finally {
      setLoading(false);
    }
  }, [businessId, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const activeContracts = contracts.filter(c => c.status === 'active');
  const mrr = activeContracts.reduce((s, c) => s + toMonthlyCents(c.amount_cents, c.frequency), 0);
  const upcoming = contracts.filter(c => c.status === 'active' && new Date(c.next_billing_date) <= new Date(Date.now() + 30 * 86400000));

  function openNew() { setForm(DEFAULT_FORM); setEditContract(null); setShowForm(true); }
  function openEdit(c) {
    setForm({
      client_name: c.client_name, client_email: c.client_email || '', description: c.description,
      amount: (c.amount_cents / 100).toFixed(2), frequency: c.frequency,
      next_billing_date: c.next_billing_date?.split('T')[0] || '',
      notes: c.notes || '',
    });
    setEditContract(c);
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.client_name.trim()) return toast.error('Client name required');
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Amount must be > 0');
    setSaving(true);
    try {
      const payload = {
        client_name: form.client_name.trim(), client_email: form.client_email || undefined,
        description: form.description, amount_cents: Math.round(parseFloat(form.amount) * 100),
        frequency: form.frequency, next_billing_date: form.next_billing_date,
        notes: form.notes || undefined,
      };
      if (editContract) {
        await api.put(`/businesses/${businessId}/recurring-billing/${editContract.id}`, payload);
        toast.success('Contract updated');
      } else {
        await api.post(`/businesses/${businessId}/recurring-billing`, payload);
        toast.success('Contract created');
      }
      setShowForm(false); setEditContract(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not save contract');
    } finally { setSaving(false); }
  }

  async function handleToggle(c) {
    try {
      await api.patch(`/businesses/${businessId}/recurring-billing/${c.id}/toggle`);
      toast.success(c.status === 'active' ? 'Contract paused' : 'Contract resumed');
      await load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not update contract'); }
  }

  async function handleDelete(c) {
    if (!window.confirm('Delete this contract?')) return;
    try {
      await api.delete(`/businesses/${businessId}/recurring-billing/${c.id}`);
      toast.success('Contract deleted');
      await load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not delete contract'); }
  }

  async function handleGenerate(c) {
    try {
      await api.post(`/businesses/${businessId}/recurring-billing/${c.id}/generate-invoice`);
      toast.success('Invoice generated');
      await load();
    } catch (e) { toast.error(e?.response?.data?.error || 'Could not generate invoice'); }
  }

  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Recurring Billing</h2>
        <button onClick={openNew} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium">
          + New Contract
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Active Contracts</div>
          <div className="text-2xl font-bold text-white">{activeContracts.length}</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Monthly Recurring Revenue</div>
          <div className="text-lg font-bold text-orange-400">{fmtCents(mrr, currency)}</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">Due This Month</div>
          <div className="text-2xl font-bold text-yellow-400">{upcomingCount}</div>
        </div>
      </div>

      {/* Upcoming this month */}
      {upcoming.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-yellow-400 mb-2">Due in Next 30 Days</h3>
          <div className="space-y-2">
            {upcoming.map(c => (
              <div key={c.id} className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 flex items-center justify-between">
                <div>
                  <span className="font-medium text-white">{c.client_name}</span>
                  <span className="text-gray-400 text-sm ml-2">- {c.description}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-orange-400 font-bold">{fmtCents(c.amount_cents, currency)}</span>
                  <span className="text-gray-400 text-xs">{c.next_billing_date?.split('T')[0]}</span>
                  <button onClick={() => handleGenerate(c)} className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded">
                    Generate Invoice
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter */}
      <div className="flex gap-2 mb-4">
        {['', 'active', 'paused', 'cancelled'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${statusFilter === s ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-gray-800 border border-orange-500/30 rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-orange-400 mb-3">{editContract ? 'Edit Contract' : 'New Contract'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['Client Name *', 'client_name', 'text', 'Client name'],
              ['Client Email', 'client_email', 'email', 'client@email.com'],
              ['Amount ($) *', 'amount', 'number', '0.00'],
              ['Next Billing Date *', 'next_billing_date', 'date', ''],
            ].map(([label, key, type, placeholder]) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input type={type} value={form[key]} placeholder={placeholder}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Frequency</label>
              <select value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm capitalize">
                {FREQUENCIES.map(freq => <option key={freq} value={freq} className="capitalize">{freq}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Description *</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder="Service description" />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-gray-400 block mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm" placeholder="Optional notes" />
          </div>
          <div className="flex gap-3 mt-3">
            <button onClick={handleSave} disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : editContract ? 'Save Changes' : 'Create Contract'}
            </button>
            <button onClick={() => { setShowForm(false); setEditContract(null); }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm">Cancel</button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center text-gray-400 py-8">Loading...</div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🔄</div>
          <p className="font-medium">No contracts yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-2 pr-4">Client</th>
                <th className="pb-2 pr-4">Description</th>
                <th className="pb-2 pr-4">Amount</th>
                <th className="pb-2 pr-4">Frequency</th>
                <th className="pb-2 pr-4">Next Billing</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map(c => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-3 pr-4 font-medium text-white">{c.client_name}</td>
                  <td className="py-3 pr-4 text-gray-300 max-w-xs truncate">{c.description}</td>
                  <td className="py-3 pr-4 text-orange-400 font-medium">{fmtCents(c.amount_cents, currency)}</td>
                  <td className="py-3 pr-4 text-gray-300 capitalize">{c.frequency}</td>
                  <td className="py-3 pr-4 text-gray-300">{c.next_billing_date?.split('T')[0]}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[c.status]}`}>{c.status}</span>
                  </td>
                  <td className="py-3 text-right">
                    <button onClick={() => openEdit(c)} className="text-blue-400 hover:text-blue-300 text-xs mr-2">Edit</button>
                    <button onClick={() => handleToggle(c)} className="text-yellow-400 hover:text-yellow-300 text-xs mr-2">
                      {c.status === 'active' ? 'Pause' : 'Resume'}
                    </button>
                    {c.status !== 'active' && (
                      <button onClick={() => handleDelete(c)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
