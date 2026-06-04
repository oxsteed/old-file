import { useState, useEffect, useCallback } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { formatCents } from '../../lib/format';

const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annually'];
const STATUS_COLORS = {
  active: 'bg-green-700 text-green-100',
  paused: 'bg-yellow-700 text-yellow-100',
  cancelled: 'bg-red-700 text-red-100',
};

function fmtCents(cents, currency = 'USD') {
  return formatCents(cents, { currency });
}

function toMonthlyCents(cents, frequency) {
  const map = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, annually: 1 / 12 };
  return Math.round(cents * (map[frequency] || 1));
}

const DEFAULT_FORM = {
  client_name: '',
  client_email: '',
  description: '',
  amount: '',
  frequency: 'monthly',
  next_billing_date: '',
  notes: '',
};

export function RecurringBillingTab({ businessId, currency = 'USD' }) {
  const { t } = useTranslation();
  const [contracts, setContracts] = useState([]);
  const [upcomingCount, setUpcomingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editContract, setEditContract] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  const tRecurring = useCallback((key) => {
    return t(`businessHub.guidedIntake.businessRecurringBilling.${key}`);
  }, [t]);

  const statusLabel = useCallback(
    (status) => {
      if (status === 'active') return tRecurring('statusActive');
      if (status === 'paused') return tRecurring('statusPaused');
      if (status === 'cancelled') return t('businessHub.statusCancelled');
      return tRecurring('statusUnknown');
    },
    [t, tRecurring]
  );

  const frequencyLabel = useCallback((frequency) => tRecurring(`frequencies.${frequency}`), [tRecurring]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const { data } = await api.get(`/businesses/${businessId}/recurring-billing${params}`);
      setContracts(data.contracts || []);
      setUpcomingCount(data.upcoming_this_month || 0);
    } catch {
      toast.error(tRecurring('loadError'));
    } finally {
      setLoading(false);
    }
  }, [businessId, statusFilter, tRecurring]);

  useEffect(() => {
    load();
  }, [load]);

  const activeContracts = contracts.filter((contract) => contract.status === 'active');
  const mrr = activeContracts.reduce((sum, contract) => sum + toMonthlyCents(contract.amount_cents, contract.frequency), 0);
  const upcoming = contracts.filter(
    (contract) =>
      contract.status === 'active' && new Date(contract.next_billing_date) <= new Date(Date.now() + 30 * 86400000)
  );

  const openNew = () => {
    setForm(DEFAULT_FORM);
    setEditContract(null);
    setShowForm(true);
  };

  const openEdit = (contract) => {
    setForm({
      client_name: contract.client_name,
      client_email: contract.client_email || '',
      description: contract.description,
      amount: (contract.amount_cents / 100).toFixed(2),
      frequency: contract.frequency,
      next_billing_date: contract.next_billing_date?.split('T')[0] || '',
      notes: contract.notes || '',
    });
    setEditContract(contract);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.client_name.trim()) return toast.error(t('businessHub.fieldClientNameRequired'));
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error(t('businessHub.businessRecurringBilling.requiredFields'));
    setSaving(true);
    try {
      const payload = {
        client_name: form.client_name.trim(),
        client_email: form.client_email || undefined,
        description: form.description,
        amount_cents: Math.round(parseFloat(form.amount) * 100),
        frequency: form.frequency,
        next_billing_date: form.next_billing_date,
        notes: form.notes || undefined,
      };
      if (editContract) {
        await api.put(`/businesses/${businessId}/recurring-billing/${editContract.id}`, payload);
        toast.success(tRecurring('updated'));
      } else {
        await api.post(`/businesses/${businessId}/recurring-billing`, payload);
        toast.success(tRecurring('created'));
      }
      setShowForm(false);
      setEditContract(null);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || tRecurring('saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (contract) => {
    try {
      await api.patch(`/businesses/${businessId}/recurring-billing/${contract.id}/toggle`);
      toast.success(contract.status === 'active' ? tRecurring('pause') : tRecurring('resume'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || tRecurring('updateError'));
    }
  };

  const handleDelete = async (contract) => {
    if (!window.confirm(tRecurring('deleteConfirm'))) return;
    try {
      await api.delete(`/businesses/${businessId}/recurring-billing/${contract.id}`);
      toast.success(tRecurring('deleted'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || tRecurring('deleteError'));
    }
  };

  const handleGenerate = async (contract) => {
    try {
      await api.post(`/businesses/${businessId}/recurring-billing/${contract.id}/generate-invoice`);
      toast.success(tRecurring('invoiceGenerated'));
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.error || tRecurring('saveError'));
    }
  };

  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{tRecurring('title')}</h2>
        <button
          onClick={openNew}
          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg font-medium"
        >
          + {tRecurring('createRecurring')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">{tRecurring('activeContracts')}</div>
          <div className="text-2xl font-bold text-white">{activeContracts.length}</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">{tRecurring('monthlyRecurringRevenue')}</div>
          <div className="text-lg font-bold text-orange-400">{fmtCents(mrr, currency)}</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-3">
          <div className="text-xs text-gray-400 mb-1">{tRecurring('dueThisMonth')}</div>
          <div className="text-2xl font-bold text-yellow-400">{upcomingCount}</div>
        </div>
      </div>

      {upcoming.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-yellow-400 mb-2">{tRecurring('dueNext30Days')}</h3>
          <div className="space-y-2">
            {upcoming.map((contract) => (
              <div
                key={contract.id}
                className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg p-3 flex items-center justify-between"
              >
                <div>
                  <span className="font-medium text-white">{contract.client_name}</span>
                  <span className="text-gray-400 text-sm ml-2">- {contract.description}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-orange-400 font-bold">{fmtCents(contract.amount_cents, currency)}</span>
                  <span className="text-gray-400 text-xs">{contract.next_billing_date?.split('T')[0]}</span>
                  <button
                    onClick={() => handleGenerate(contract)}
                    className="text-xs bg-orange-500 hover:bg-orange-600 text-white px-3 py-1 rounded"
                  >
                    {tRecurring('generateInvoice')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {['', 'active', 'paused', 'cancelled'].map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`px-3 py-1 rounded-full text-xs font-medium capitalize ${
              statusFilter === status ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {status === '' ? tRecurring('all') : statusLabel(status)}
          </button>
        ))}
      </div>

      {showForm && (
        <div className="bg-gray-800 border border-orange-500/30 rounded-xl p-4 mb-4">
          <h3 className="font-semibold text-orange-400 mb-3">{editContract ? tRecurring('editRecurring') : tRecurring('createRecurring')}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              ['client_name', 'text', t('businessHub.fieldClientNameRequired')],
              ['client_email', 'email', t('businessHub.fieldClientEmail')],
              ['amount', 'number', tRecurring('amount')],
              ['next_billing_date', 'date', tRecurring('nextDateLabel')],
            ].map(([key, type, label]) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{label}</label>
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                />
              </div>
            ))}
            <div>
              <label className="text-xs text-gray-400 block mb-1">{tRecurring('frequency')}</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm capitalize"
              >
                {FREQUENCIES.map((freq) => (
                  <option key={freq} value={freq} className="capitalize">
                    {frequencyLabel(freq)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">{t('businessHub.businessRecurringBilling.description')}</label>
              <input
                type="text"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
                placeholder={tRecurring('descriptionPlaceholder')}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="text-xs text-gray-400 block mb-1">{t('businessHub.businessRecurringBilling.notes')}</label>
            <input
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full bg-gray-700 border border-gray-600 text-white rounded px-3 py-2 text-sm"
              placeholder={tRecurring('notesPlaceholder')}
            />
          </div>
          <div className="flex gap-3 mt-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
            >
              {saving ? t('businessHub.btnSaving') : editContract ? t('businessHub.btnSaveChanges') : tRecurring('createRecurring')}
            </button>
            <button
              onClick={() => {
                setShowForm(false);
                setEditContract(null);
              }}
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
            >
              {t('businessHub.btnCancel')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center text-gray-400 py-8">{tRecurring('loading')}</div>
      ) : contracts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">🔄</div>
          <p className="font-medium">{tRecurring('emptyState')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-left">
                <th className="pb-2 pr-4">{tRecurring('tableClient')}</th>
                <th className="pb-2 pr-4">{tRecurring('tableDescription')}</th>
                <th className="pb-2 pr-4">{tRecurring('amount')}</th>
                <th className="pb-2 pr-4">{tRecurring('frequency')}</th>
                <th className="pb-2 pr-4">{tRecurring('tableNextBilling')}</th>
                <th className="pb-2 pr-4">{tRecurring('tableStatus')}</th>
                <th className="pb-2 text-right">{tRecurring('tableActions')}</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className="border-b border-gray-800 hover:bg-gray-800/40">
                  <td className="py-3 pr-4 font-medium text-white">{contract.client_name}</td>
                  <td className="py-3 pr-4 text-gray-300 max-w-xs truncate">{contract.description}</td>
                  <td className="py-3 pr-4 text-orange-400 font-medium">{fmtCents(contract.amount_cents, currency)}</td>
                  <td className="py-3 pr-4 text-gray-300 capitalize">{frequencyLabel(contract.frequency)}</td>
                  <td className="py-3 pr-4 text-gray-300">{contract.next_billing_date?.split('T')[0]}</td>
                  <td className="py-3 pr-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[contract.status]}`}>
                      {statusLabel(contract.status)}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => openEdit(contract)}
                      className="text-blue-400 hover:text-blue-300 text-xs mr-2"
                    >
                      {t('businessHub.btnEdit')}
                    </button>
                    <button
                      onClick={() => handleToggle(contract)}
                      className="text-yellow-400 hover:text-yellow-300 text-xs mr-2"
                    >
                      {contract.status === 'active' ? tRecurring('pause') : tRecurring('resume')}
                    </button>
                    {contract.status !== 'active' && (
                      <button onClick={() => handleDelete(contract)} className="text-red-400 hover:text-red-300 text-xs">
                        {t('businessHub.btnDelete')}
                      </button>
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
