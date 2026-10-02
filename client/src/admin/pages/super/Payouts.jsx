import { useState } from 'react';
import { DollarSign, Clock, CheckCircle, AlertTriangle, X } from 'lucide-react';
import adminApi from '../../../lib/adminApi';
import { useTranslation } from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import AdminErrorState from '../../lib/AdminErrorState';
import ConfirmDialog from '../../lib/ConfirmDialog';

const TABS = [
  { key: 'pending', labelKey: 'superPayouts.tabPending' },
  { key: 'processing', labelKey: 'superPayouts.tabProcessing' },
  { key: 'completed', labelKey: 'superPayouts.tabCompleted' },
  { key: 'failed', labelKey: 'superPayouts.tabFailed' },
];

// Per-row detail drawer for payout inspection.
function PayoutDrawer({ payout, fmt, onClose }) {
  const { t } = useTranslation();
  const requested = payout.created_at || payout.createdAt;
  const rows = [
    ['superPayouts.rowHelper', payout.helper_name || payout.helper?.name || payout.helperEmail || 'N/A'],
    ['superPayouts.rowAmount', fmt(payout.amount)],
    ['superPayouts.rowMethod', payout.method || 'N/A'],
    ['superPayouts.rowStatus', t(`superPayouts.status.${payout.status}`, { defaultValue: String(payout.status || 'N/A').replace(/_/g, ' ') })],
    ['superPayouts.rowRequested', requested ? new Date(requested).toLocaleString() : 'N/A'],
    ['superPayouts.rowFailureReason', payout.failure_reason || payout.failure_message || payout.error || 'N/A'],
    ['superPayouts.rowReference', payout.reference || payout.id || payout._id || 'N/A'],
  ];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        className="bg-slate-900 border-l border-slate-700 w-full max-w-md h-full overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-white font-semibold text-lg">{t('superPayouts.drawerTitle')}</h2>
          <button onClick={onClose} aria-label={t('superPayouts.close')} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-2">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-800 text-sm">
              <span className="text-gray-400">{t(label)}</span>
              <span className="text-white text-right break-words">{String(value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Payouts() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('pending');
  const [selected, setSelected] = useState(null);
  const [retryTarget, setRetryTarget] = useState(null); // payout id awaiting retry confirmation

  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const { data } = await adminApi.get('/admin/payouts', {
      signal,
      params: { status: activeTab },
    });
    return {
      payouts: data.payouts || [],
      stats: data.stats || { pending: 0, processing: 0, completed: 0, totalPaid: 0 },
      notice: data.message || '',
    };
  }, [activeTab]);

  const payouts = data?.payouts || [];
  const stats = data?.stats || { pending: 0, processing: 0, completed: 0, totalPaid: 0 };
  const notice = data?.notice || '';

  const doRetry = async () => {
    try {
      await adminApi.post(`/admin/super/payouts/${retryTarget}/retry`);
      setRetryTarget(null);
      reload();
    } catch (err) {
      throw new Error(err.response?.data?.error || err.message || t('superPayouts.retryFailed'));
    }
  };

  const fmt = (v) => {
    const amount = Number(v);
    return `$${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">{t('superPayouts.title')}</h1>
          <p className="text-gray-400 text-sm">{t('superPayouts.subtitle')}</p>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 mb-6 px-4 py-3 bg-yellow-900/40 border border-yellow-700/60 rounded-xl text-yellow-300 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {notice}
        </div>
      )}

      {!loading && error && (
        <div className="mb-6"><AdminErrorState onRetry={reload} /></div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">{t('superPayouts.statPending')}</span>
            <Clock size={16} className="text-yellow-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.pending)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">{t('superPayouts.statProcessing')}</span>
            <DollarSign size={16} className="text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.processing)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">{t('superPayouts.statCompleted')}</span>
            <CheckCircle size={16} className="text-green-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.completed)}</p>
        </div>
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-400 text-sm">{t('superPayouts.statTotalPaid')}</span>
            <DollarSign size={16} className="text-orange-400" />
          </div>
          <p className="text-xl font-bold text-white">{fmt(stats.totalPaid)}</p>
        </div>
      </div>

      <div className="flex gap-2 mb-6">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition-colors ${
              activeTab === tab.key
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-gray-400 hover:text-white border border-slate-700'
            }`}>{t(tab.labelKey)}</button>
        ))}
      </div>

      {!error && (
      <div className="bg-slate-800/50 border border-slate-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superPayouts.colHelper')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superPayouts.colAmount')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superPayouts.colMethod')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superPayouts.colStatus')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3">{t('superPayouts.colRequested')}</th>
              <th className="text-left text-gray-400 font-medium px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">{t('superPayouts.loading')}</td></tr>
            ) : payouts.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-gray-400 py-12">{t('superPayouts.empty', { status: t(TABS.find(x => x.key === activeTab)?.labelKey || 'superPayouts.tabPending') })}</td></tr>
            ) : payouts.map(p => {
              const pid = p.id || p._id;
              const failed = p.status === 'failed';
              return (
              <tr key={pid} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className="px-4 py-3 text-white">{p.helper_name || p.helper?.name || p.helperEmail || 'N/A'}</td>
                <td className="px-4 py-3 text-white font-medium">{fmt(p.amount)}</td>
                <td className="px-4 py-3 text-gray-300 capitalize">{p.method || 'N/A'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                    p.status === 'completed' ? 'bg-green-500/20 text-green-400' :
                    p.status === 'pending'   ? 'bg-yellow-500/20 text-yellow-400' :
                    p.status === 'processing'? 'bg-blue-500/20 text-blue-400' :
                    'bg-red-500/20 text-red-400'
                  }`}>{t(`superPayouts.status.${p.status}`, { defaultValue: String(p.status).replace(/_/g, ' ') })}</span>
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {p.created_at || p.createdAt
                    ? new Date(p.created_at || p.createdAt).toLocaleDateString()
                    : 'N/A'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setSelected(p)}
                      className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                    >
                      {t('superPayouts.details')}
                    </button>
                    {failed && (
                      <button
                        onClick={() => setRetryTarget(pid)}
                        className="px-2.5 py-1 text-xs bg-orange-600 hover:bg-orange-700 text-white rounded font-medium"
                      >
                        {t('superPayouts.retry')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
      )}

      {selected && (
        <PayoutDrawer payout={selected} fmt={fmt} onClose={() => setSelected(null)} />
      )}

      <ConfirmDialog
        open={retryTarget != null}
        title={t('superPayouts.retryPayout')}
        message={t('superPayouts.retryPayoutMsg')}
        confirmLabel={t('superPayouts.retryPayout')}
        danger
        onConfirm={doRetry}
        onClose={() => setRetryTarget(null)}
      />
    </div>
  );
}
