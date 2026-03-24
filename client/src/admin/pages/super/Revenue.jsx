import { useEffect, useState, useCallback } from 'react';
import { DollarSign, TrendingUp, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import adminApi from '../../../lib/adminApi';

export default function Revenue() {
  const [stats, setStats] = useState(null);
  const [period, setPeriod] = useState('30d');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRevenue = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/super/revenue', {
        params: { period }
      });
      setStats(data.stats || { totalRevenue: 0, subscriptionRevenue: 0, jobFeeRevenue: 0, refunds: 0, growth: 0 });
      setTransactions(data.transactions || []);
    } catch (err) {
      console.error('Failed to fetch revenue:', err);
      setStats({ totalRevenue: 0, subscriptionRevenue: 0, jobFeeRevenue: 0, refunds: 0, growth: 0 });
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchRevenue(); }, [fetchRevenue]);

  const fmt = (v) => `$${(v || 0).toFixed(2)}`;

  const exportCSV = async () => {
    try {
      const { data } = await adminApi.get('/admin/super/revenue/export', { params: { period }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `revenue_${period}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch (err) { console.error('Export failed:', err); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Revenue</h1>
          <p className="text-gray-400 text-sm">Platform revenue analytics</p>
        </div>
        <div className="flex gap-2">
          {['7d','30d','90d','1y'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                period === p ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-400 border border-slate-700'
              }`}>{p}</button>
          ))}
          <button onClick={exportCSV}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm ml-2">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Revenue', value: stats?.totalRevenue, icon: DollarSign, color: 'orange' },
          { label: 'Subscriptions', value: stats?.subscriptionRevenue, icon: TrendingUp, color: 'green' },
          { label: 'Job Fees', value: stats?.jobFeeRevenue, icon: DollarSign, color: 'blue' },
          { label: 'Refunds', value: stats?.refunds, icon: ArrowDownRight, color: 'red' },
        ].map(card => (
          <div key={card.label} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-400 text-sm">{card.label}</span>
              <card.icon size={18} className={`text-${card.color}-400`} />
            </div>
            <p className="text-2xl font-bold text-white">{loading ? '...' : fmt(card.value)}</p>
          </div>
        ))}
      </div>

      {stats?.growth !== undefined && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Growth vs previous period:</span>
            <span className={`flex items-center font-bold ${
              (stats.growth || 0) >= 0 ? 'text-green-400' : 'text-red-400'
            }`}>
              {(stats.growth || 0) >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
              {Math.abs(stats.growth || 0).toFixed(1)}%
            </span>
          </div>
        </div>
      )}

      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-700">
          <h2 className="text-white font-medium">Recent Transactions</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">DATE</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">TYPE</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">USER</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">AMOUNT</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">Loading...</td></tr>
            ) : transactions.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">No transactions found.</td></tr>
            ) : transactions.map(tx => (
              <tr key={tx._id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="px-4 py-3 text-gray-400">{new Date(tx.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-white capitalize">{tx.type}</td>
                <td className="px-4 py-3 text-gray-300">{tx.user?.name || tx.userEmail || 'N/A'}</td>
                <td className="px-4 py-3 text-white">{fmt(tx.amount)}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    tx.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                    tx.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>{tx.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
