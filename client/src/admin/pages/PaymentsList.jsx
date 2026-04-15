import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, Search } from 'lucide-react';
import adminApi from '../../lib/adminApi';

const PAYMENT_STATUSES = [
  '', 'pending', 'authorized', 'captured', 'released', 'refunded', 'failed', 'disputed',
];

function statusBadge(status) {
  switch (status) {
    case 'captured':
    case 'released':   return 'bg-green-500/20 text-green-400';
    case 'authorized': return 'bg-blue-500/20 text-blue-400';
    case 'pending':    return 'bg-yellow-500/20 text-yellow-300';
    case 'refunded':   return 'bg-purple-500/20 text-purple-400';
    case 'failed':     return 'bg-red-500/20 text-red-400';
    case 'disputed':   return 'bg-orange-500/20 text-orange-400';
    default:           return 'bg-gray-500/20 text-gray-400';
  }
}

function fmt(dollars) {
  if (dollars == null) return '—';
  return `$${Number(dollars).toFixed(2)}`;
}

export default function PaymentsList() {
  const [payments,   setPayments]   = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [forbidden,  setForbidden]  = useState(false);
  const [filters,    setFilters]    = useState({
    status: '', date_from: '', date_to: '', page: 1,
  });

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, v]) => v !== '' && v !== 0)
      );
      const { data } = await adminApi.get('/admin/payments', { params });
      setPayments(data.payments || []);
      setTotal(data.total || 0);
    } catch (err) {
      if (err?.response?.status === 403) {
        setForbidden(true);
        setPayments([]);
      } else {
        console.error('Failed to fetch payments:', err);
        setPayments([]);
      }
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchPayments(); }, [fetchPayments]);

  const updateFilter = (key, value) =>
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const col = 'px-4 py-3 text-sm';

  if (forbidden) {
    return (
      <div className="p-6 lg:p-8">
        <div className="flex items-center gap-3 mb-6">
          <CreditCard size={22} className="text-orange-400" />
          <h1 className="text-2xl font-bold text-white">Payments</h1>
        </div>
        <div className="bg-yellow-900/30 border border-yellow-700/40 rounded-xl p-6 text-center">
          <p className="text-yellow-300 text-sm">
            View Financials permission required. Contact a super-admin to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <CreditCard size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Payments</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} payments</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filters.status}
          onChange={e => updateFilter('status', e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                     focus:border-orange-500 focus:outline-none"
        >
          <option value="">All Statuses</option>
          {PAYMENT_STATUSES.filter(Boolean).map(s => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs">From</label>
          <input
            type="date"
            value={filters.date_from}
            onChange={e => updateFilter('date_from', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                       focus:border-orange-500 focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs">To</label>
          <input
            type="date"
            value={filters.date_to}
            onChange={e => updateFilter('date_to', e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2
                       focus:border-orange-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">PAYER</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">PAYEE</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">JOB</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">AMOUNT</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">FEE</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">PAYOUT</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">CREATED</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">Loading…</td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12">No payments found.</td>
                </tr>
              ) : payments.map(p => (
                <tr key={p.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className={col}>
                    <p className="text-white text-sm">{p.payer_name || '—'}</p>
                    <p className="text-gray-500 text-xs">{p.payer_email || '—'}</p>
                  </td>
                  <td className={col}>
                    <p className="text-white text-sm">{p.payee_name || '—'}</p>
                    <p className="text-gray-500 text-xs">{p.payee_email || '—'}</p>
                  </td>
                  <td className={`${col} max-w-[160px]`}>
                    {p.job_id ? (
                      <Link
                        to={`/admin/jobs/${p.job_id}`}
                        className="text-orange-400 hover:text-orange-300 text-xs truncate block"
                      >
                        {p.job_title || `Job #${p.job_id}`}
                      </Link>
                    ) : (
                      <span className="text-gray-500 text-xs italic">No job</span>
                    )}
                  </td>
                  <td className={`${col} text-white font-medium`}>{fmt(p.amount)}</td>
                  <td className={`${col} text-gray-400`}>{fmt(p.platform_fee)}</td>
                  <td className={`${col} text-gray-400`}>{fmt(p.helper_payout)}</td>
                  <td className={col}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(p.status)}`}>
                      {p.status || '—'}
                    </span>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {filters.page} · {total} total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setFilters(p => ({ ...p, page: Math.max(1, p.page - 1) }))}
              disabled={filters.page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}
              disabled={payments.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
