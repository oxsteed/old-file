import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Clock, CheckCircle, XCircle } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

const TABS = ['pending', 'processing', 'completed', 'failed'];

export default function Payouts() {
  const [activeTab, setActiveTab] = useState('pending');
  const [payouts, setPayouts] = useState([]);
  const [stats, setStats] = useState({
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    totalPaid: 0,
  });
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/payouts', {
        params: { status: activeTab },
      });
      setPayouts(data.payouts || []);
      if (data.stats) setStats(data.stats);
      setInfo(data.message || null);
    } catch (err) {
      console.error('Failed to fetch payouts:', err);
      setPayouts([]);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  const fmtMoney = (v) => `$${(Number(v) || 0).toFixed(2)}`;

  return (
    <div className="p-4 sm:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Payouts</h1>
          <p className="text-gray-400 text-sm">
            Rows from <code className="text-gray-500">payments</code> (helper payee);
            tabs map to payment statuses — there is no separate payout queue yet.
          </p>
        </div>
      </div>

      {info && (
        <div className="mb-4 rounded-lg border border-slate-600 bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
          {info}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Pending</span>
            <Clock size={16} className="text-yellow-400" />
          </div>
          <p className="text-xl font-bold text-white">{stats.pending}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Processing</span>
            <DollarSign size={16} className="text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">{stats.processing}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Released</span>
            <CheckCircle size={16} className="text-green-400" />
          </div>
          <p className="text-xl font-bold text-white">{stats.completed}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Failed / refunded</span>
            <XCircle size={16} className="text-red-400" />
          </div>
          <p className="text-xl font-bold text-white">{stats.failed}</p>
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 text-sm text-gray-300">
        Total helper payouts released:{' '}
        <span className="font-semibold text-white">{fmtMoney(stats.totalPaid)}</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-gray-400 hover:text-white border border-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">HELPER</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">AMOUNT</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">METHOD</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">CREATED</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-12">Loading...</td>
              </tr>
            ) : payouts.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-400 py-12">
                  No payments in this tab.
                </td>
              </tr>
            ) : (
              payouts.map(p => (
                <tr key={p._id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className="px-4 py-3 text-white">
                    {p.helper?.name || p.helperEmail || 'N/A'}
                  </td>
                  <td className="px-4 py-3 text-white font-medium">{fmtMoney(p.amount)}</td>
                  <td className="px-4 py-3 text-gray-300 capitalize">{p.method || 'N/A'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                        p.status === 'released'
                          ? 'bg-green-500/20 text-green-400'
                          : p.status === 'pending' || p.status === 'authorized'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : p.status === 'captured'
                              ? 'bg-blue-500/20 text-blue-400'
                              : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">
                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
