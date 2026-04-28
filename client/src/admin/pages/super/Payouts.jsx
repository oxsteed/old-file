import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Clock, CheckCircle, AlertTriangle } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

const TABS = ['pending', 'processing', 'completed', 'failed'];

export default function Payouts() {
  const [activeTab, setActiveTab] = useState('pending');
  const [payouts, setPayouts] = useState([]);
  const [stats, setStats] = useState({ pending: 0, processing: 0, completed: 0, totalPaid: 0 });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const fetchPayouts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/payouts', {
        params: { status: activeTab }
      });
      setPayouts(data.payouts || []);
      if (data.stats) setStats(data.stats);
      setNotice(data.message || '');
    } catch (err) {
      console.error('Failed to fetch payouts:', err);
      setPayouts([]);
      setNotice('');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchPayouts(); }, [fetchPayouts]);

  const fmt = (v) => `$${(v || 0).toFixed(2)}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Payouts</h1>
          <p className="text-gray-400 text-sm">Helper payout queue</p>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 mb-6 px-4 py-3 bg-yellow-900/40 border border-yellow-700/60 rounded-xl text-yellow-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Pending</span>
            <Clock size={16} className="text-yellow-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.pending)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Processing</span>
            <DollarSign size={16} className="text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.processing)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Completed</span>
            <CheckCircle size={16} className="text-green-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.completed)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">Total Paid</span>
            <DollarSign size={16} className="text-orange-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.totalPaid)}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-gray-400 hover:text-white border border-slate-700'
            }`}>{tab}</button>
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
              <th className="text-left text-gray-400 font-medium px-4 py-3">REQUESTED</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : payouts.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">No {activeTab} payouts.</td></tr>
            ) : payouts.map(p => (
              <tr key={p.id || p._id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="px-4 py-3 text-white">{p.helper_name || p.helper?.name || p.helperEmail || 'N/A'}</td>
                <td className="px-4 py-3 text-white font-medium">{fmt(p.amount)}</td>
                <td className="px-4 py-3 text-gray-300 capitalize">{p.method || 'N/A'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    p.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                    p.status === 'pending'   ? 'bg-yellow-500/20 text-yellow-400' :
                    p.status === 'processing'? 'bg-blue-500/20 text-blue-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>{p.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {p.created_at || p.createdAt
                    ? new Date(p.created_at || p.createdAt).toLocaleDateString()
                    : 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
