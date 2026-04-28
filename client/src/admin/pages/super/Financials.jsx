import { useEffect, useState } from 'react';
import { Download }            from 'lucide-react';
import adminApi                from '../../../lib/adminApi';

const TYPE_TABS = [
  { key: '',             label: 'All'           },
  { key: 'job_fee',      label: 'Job Fees'      },
  { key: 'subscription', label: 'Subscriptions' },
  { key: 'refund',       label: 'Refunds'       },
];

export default function Financials() {
  const [ledger,  setLedger]  = useState([]);
  const [totals,  setTotals]  = useState(null);
  const [type,    setType]    = useState('');
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setLoading(true);
      try {
        const { data } = await adminApi.get('/admin/financials', {
          params: { type, page, limit: 30 }
        });
        setLedger(data.ledger);
        setTotals(data.totals);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [type, page]);

  const handleExport = async () => {
    try {
      const res = await adminApi.get('/admin/export/revenue', {
        responseType: 'blob'
      });
      const url  = URL.createObjectURL(res.data);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `oxsteed_revenue_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Financials</h1>
          <p className="text-gray-400 text-sm mt-1">
            Full platform revenue ledger
          </p>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700
                     text-gray-200 text-sm font-medium rounded-lg
                     hover:bg-gray-600 transition"
        >
          <Download size={15} />
          Export CSV
        </button>
      </div>

      {/* Revenue summary */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            {
              label: 'Gross Revenue',
              value: `$${((totals.gross_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-green-400'
            },
            {
              label: 'Job Fees',
              value: `$${((totals.job_fee_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-orange-400'
            },
            {
              label: 'Subscriptions',
              value: `$${((totals.subscription_revenue_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-purple-400'
            },
            {
              label: 'Total Refunds',
              value: `-$${((totals.total_refunds_cents || 0) / 100)
                .toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              color: 'text-red-400'
            },
          ].map(({ label, value, color }) => (
            <div key={label}
                 className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">
                {label}
              </p>
              <p className={`text-2xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Type filter tabs */}
      <div className="flex gap-2 mb-6">
        {TYPE_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => { setType(t.key); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-xs font-semibold
                        transition ${
              type === t.key
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Ledger table */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl
                      overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400
                             text-xs uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">User</th>
                <th className="px-4 py-3 text-left">Job</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : ledger.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center
                                             text-gray-500">
                    No ledger entries found.
                  </td>
                </tr>
              ) : ledger.map(entry => (
                <tr key={entry.id}
                    className="hover:bg-gray-750 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: '2-digit'
                    })}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs
                                      font-medium ${
                      entry.source_type === 'subscription'
                        ? 'bg-purple-900 text-purple-300' :
                      entry.source_type === 'job_fee'
                        ? 'bg-orange-900 text-orange-300' :
                      entry.source_type === 'refund'
                        ? 'bg-red-900 text-red-300'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      {entry.source_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-white text-xs font-medium">
                      {entry.user_name || '—'}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {entry.user_email || ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs
                                 max-w-32 truncate">
                    {entry.job_title || '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold font-mono text-sm ${
                      entry.amount_cents < 0
                        ? 'text-red-400'
                        : 'text-green-400'
                    }`}>
                      {entry.amount_cents < 0 ? '-' : '+'}
                      ${(Math.abs(entry.amount_cents) / 100)
                        .toFixed(2)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs
                                 max-w-xs truncate">
                    {entry.description || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3
                        border-t border-gray-700">
          <p className="text-xs text-gray-500">Page {page}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={ledger.length < 30}
              className="px-3 py-1.5 bg-gray-700 text-gray-300 text-xs
                         rounded-lg disabled:opacity-40 hover:bg-gray-600
                         transition"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
