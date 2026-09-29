import { useState } from 'react';
import { DollarSign, TrendingUp, Download, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useTranslation } from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';

export default function Revenue() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState('30d');
  const [exportError, setExportError] = useState('');

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/admin/super/revenue', {
      signal,
      params: { period },
    });
    return {
      stats: data.stats || { totalRevenue: 0, subscriptionRevenue: 0, jobFeeRevenue: 0, refunds: 0, growth: 0 },
      transactions: data.transactions || [],
    };
  }, [period]);
  const stats = data?.stats || null;
  const transactions = data?.transactions || [];

  const fmt = (v) => {
    const amount = Number(v);
    return `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
  };

  const exportCSV = async () => {
    setExportError('');
    try {
      const { data } = await adminApi.get('/admin/super/revenue/export', { params: { period }, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `revenue_${period}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click(); window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(err.response?.data?.error || t('superRevenue.errorExport'));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('superRevenue.title')}</h1>
          <p className="text-gray-400 text-sm">{t('superRevenue.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          {['7d','30d','90d','1y'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium ${
                period === p ? 'bg-orange-500 text-white' : 'bg-slate-800 text-gray-400 border border-slate-700'
              }`}>{t('superDashboard.period' + p)}</button>
          ))}
          <button onClick={exportCSV}
            className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded-lg text-sm ml-2">
            <Download size={14} /> {t('superRevenue.export')}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="mb-6 px-4 py-3 bg-red-900/30 border border-red-700/60 rounded-xl text-red-300 text-sm">
          <span>{exportError}</span>
        </div>
      )}

      {!loading && error && (
        <div className="mb-6"><AdminErrorState onRetry={reload} /></div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {[
          { key: 'total', label: t('superRevenue.cardTotal'), value: stats?.totalRevenue, icon: DollarSign, color: 'orange' },
          { key: 'subs', label: t('superRevenue.cardSubscriptions'), value: stats?.subscriptionRevenue, icon: TrendingUp, color: 'green' },
          { key: 'fees', label: t('superRevenue.cardJobFees'), value: stats?.jobFeeRevenue, icon: DollarSign, color: 'blue' },
          { key: 'refunds', label: t('superRevenue.cardRefunds'), value: stats?.refunds, icon: ArrowDownRight, color: 'red' },
        ].map(card => (
          <div key={card.key} className="bg-slate-800/50 border border-slate-700 rounded-xl p-5">
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
            <span className="text-gray-400">{t('superRevenue.growthLabel')}</span>
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
          <h2 className="text-white font-medium">{t('superRevenue.recentTransactions')}</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superRevenue.colDate')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superRevenue.colType')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superRevenue.colUser')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superRevenue.colAmount')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superRevenue.colStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">{t('superRevenue.loading')}</td></tr>
            ) : !error && transactions.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-gray-400 py-12">{t('superRevenue.empty')}</td></tr>
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
