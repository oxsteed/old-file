import { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../../api/axios';
import { useTranslation } from 'react-i18next';
import { useAbortableFetch } from '../../lib/useAbortableFetch';
import ConfirmDialog from '../../lib/ConfirmDialog';

// Format helper
const fmt = (row) => {
  if (row.value_type === 'percentage') {
    return `${(parseFloat(row.value) * 100).toFixed(1)}%`;
  }
  if (row.value_type === 'cents') {
    return `$${(parseFloat(row.value) / 100).toFixed(2)}`;
  }
  return row.value;
};

// Convert a user-entered value into the stored unit for this row.
const inputToStored = (row, parsed) => {
  if (row.value_type === 'percentage') return parsed / 100;
  if (row.value_type === 'cents') return Math.round(parsed * 100);
  return parsed;
};

// Convert a stored value back into the unit the user types.
const storedToInput = (row, stored) => {
  if (row.value_type === 'percentage') return stored * 100;
  if (row.value_type === 'cents') return stored / 100;
  return stored;
};

// Fee row component
function FeeRow({ row, onSave }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);

  const openEdit = () => {
    if (row.value_type === 'percentage') {
      setRawInput((parseFloat(row.value) * 100).toString());
    } else if (row.value_type === 'cents') {
      setRawInput((parseFloat(row.value) / 100).toString());
    } else {
      setRawInput(row.value.toString());
    }
    setReason('');
    setEditing(true);
  };

  const handleSave = () => {
    const trimmed = rawInput.trim();
    const parsed = parseFloat(trimmed);
    if (!trimmed || Number.isNaN(parsed)) {
      toast.error('Enter a valid number.');
      return;
    }
    const sendValue = inputToStored(row, parsed);
    if ((row.min_value != null && sendValue < row.min_value)
      || (row.max_value != null && sendValue > row.max_value)) {
      toast.error(`Value must be between ${storedToInput(row, row.min_value)} and ${storedToInput(row, row.max_value)}.`);
      return;
    }
    setConfirming(true);
  };

  const doSave = async () => {
    const sendValue = inputToStored(row, parseFloat(rawInput.trim()));
    try {
      await api.put('/fee-config', {
        key: row.key,
        value: sendValue,
        reason: reason || undefined,
      });
    } catch (err) {
      toast.error(err.response?.data?.error || t('superFeeConfig.updateFailed'));
      throw err; // keep the dialog open on failure
    }
    setEditing(false);
    setConfirming(false);
    onSave();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-800">{row.label}</h3>
          <p className="text-sm text-gray-500 mt-0.5">{row.description}</p>
        </div>
        <div className="text-right">
          <span className="text-lg font-bold text-orange-600">
            {fmt(row)}
          </span>
          {!editing && (
            <button
              onClick={openEdit}
              className="text-xs bg-orange-500 hover:bg-orange-600
                text-white font-semibold px-3 py-1.5
                rounded-lg transition-colors ml-3">
              {t('superFeeConfig.edit')}
            </button>
          )}
        </div>
      </div>
      {row.updated_by_name && (
        <p className="text-xs text-gray-300 mt-2">
          {t('superFeeConfig.lastUpdated', { name: row.updated_by_name, date: new Date(row.updated_at).toLocaleDateString() })}
        </p>
      )}
      {editing && (
        <div className="mt-4 space-y-3 border-t border-orange-200 pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                {t('superFeeConfig.newValue')}
                {row.value_type === 'percentage' && ` ${t('superFeeConfig.enterAsPct')}`}
                {row.value_type === 'cents' && ` ${t('superFeeConfig.enterAsDollars')}`}
              </label>
              <input
                type="number"
                value={rawInput}
                onChange={e => setRawInput(e.target.value)}
                step={row.value_type === 'percentage' ? '0.1' : '0.01'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2
                  text-sm focus:outline-none focus:ring-2
                  focus:ring-orange-300"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                {t('superFeeConfig.reasonOptional')}
              </label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('superFeeConfig.whyPlaceholder')}
                className="w-full border border-gray-200 rounded-lg px-3 py-2
                  text-sm focus:outline-none focus:ring-2
                  focus:ring-orange-300"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              className="bg-orange-500 hover:bg-orange-600 text-white
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors disabled:opacity-50">
              {t('superPlatformSettings.save')}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors">
              {t('superConversations.cancel')}
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title="Save fee change"
        message={`Save this fee change for ${row.label}? This takes effect immediately.`}
        confirmLabel={t('superPlatformSettings.save')}
        onConfirm={doSave}
        onClose={() => setConfirming(false)}
      />
    </div>
  );
}

// Change History component
function ChangeHistory({ history }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? history : history.slice(0, 5);
  if (!history.length) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
        aria-controls="fee-config-history"
        className="w-full flex items-center justify-between px-5 py-4
          hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800">{t('superFeeConfig.historyTitle')}</h2>
          <span className="text-xs bg-gray-100 text-gray-500
            px-2 py-0.5 rounded-full">
            {history.length}
          </span>
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>
      <div className="px-5 pb-4" id="fee-config-history">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">{t('superFeeConfig.colSetting')}</th>
              <th className="pb-2">{t('superFeeConfig.colOld')}</th>
              <th className="pb-2">{t('superFeeConfig.colNew')}</th>
              <th className="pb-2">{t('superFeeConfig.colChangedBy')}</th>
              <th className="pb-2">{t('superFeeConfig.colReason')}</th>
              <th className="pb-2">{t('superFeeConfig.colDate')}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(h => (
              <tr key={h.id} className="border-b border-gray-100">
                <td className="py-2 font-medium">{h.config_key}</td>
                <td className="py-2 text-red-500">{h.old_value}</td>
                <td className="py-2 text-green-600">{h.new_value}</td>
                <td className="py-2">{h.changed_by_name || t('superAuditLog.systemActor')}</td>
                <td className="py-2 text-gray-400">{h.reason || '-'}</td>
                <td className="py-2 text-gray-400">
                  {new Date(h.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Main FeeConfig page
export default function FeeConfig() {
  const { t } = useTranslation();
  const [config, setConfig] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [showReset, setShowReset] = useState(false);
  const [actionError, setActionError] = useState('');

  const { data, loading, error: fetchError, reload } = useAbortableFetch(async (signal) => {
    const [cfgRes, histRes] = await Promise.all([
      api.get('/fee-config', { signal }),
      api.get('/fee-config/history', { signal }),
    ]);
    return {
      config: cfgRes.data.config || [],
      history: histRes.data.history || [],
    };
  }, []);
  const config = data?.config || [];
  const history = data?.history || [];

  const loadError = !loading && fetchError
    ? (fetchError.response?.data?.error || t('superFeeConfig.errorLoad'))
    : '';

  const retryLoad = () => {
    setActionError('');
    reload();
  };

  const handleReset = async () => {
    setResetting(true);
    setActionError('');
    try {
      await api.post('/fee-config/reset', {
        reason: resetReason || t('superFeeConfig.defaultResetReason'),
      });
      setShowReset(false);
      setResetReason('');
      reload();
    } catch (err) {
      setActionError(err.response?.data?.error || t('superFeeConfig.errorReset'));
    } finally {
      setResetting(false);
    }
  };

  const error = actionError || loadError;

  const trialDurationConfig = config.find(r => r.key === 'trial_duration_days');
  const transactionFees = config.filter(r =>
    r.key.startsWith('tier3_') && !r.key.includes('subscription'));
  const subscriptionFees = config.filter(r =>
    r.key.includes('subscription'));

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-orange-500
        border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('superFeeConfig.title')}
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            {t('superFeeConfig.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowReset(r => !r)}
          className="flex items-center gap-1.5 text-xs font-semibold
            text-gray-500 hover:text-red-600 px-3 py-2
            border border-gray-200 hover:border-red-200
            rounded-lg transition-colors">
          {t('superFeeConfig.resetToDefaults')}
        </button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 mb-6 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <span>{error}</span>
          <button onClick={retryLoad} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold">
            {t('superFinancials.retry')}
          </button>
        </div>
      )}

      {showReset && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold text-red-700">
                {t('superFeeConfig.resetTitle')}
              </p>
              <p className="text-xs text-red-500 mt-0.5">
                {t('superFeeConfig.resetBody', { platform: 10, protection: 2, broker: 5, minimum: 5, pro: 29, brokerSub: 79 })}
              </p>
            </div>
          </div>
          <input
            type="text"
            value={resetReason}
            onChange={e => setResetReason(e.target.value)}
            placeholder={t('superFeeConfig.resetReasonPlaceholder')}
            className="w-full border border-red-200 rounded-lg px-3 py-2
              text-sm mb-3 focus:outline-none focus:ring-2
              focus:ring-red-300"
          />
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              disabled={resetting}
              className="bg-red-500 hover:bg-red-600 text-white
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors disabled:opacity-50">
              {resetting ? t('superFeeConfig.resetting') : t('superFeeConfig.confirmReset')}
            </button>
            <button
              onClick={() => setShowReset(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors">
              {t('superConversations.cancel')}
            </button>
          </div>
        </div>
      )}

      {trialDurationConfig && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6 mb-8">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-blue-900 mb-2">
                {t('superFeeConfig.trialTitle')}
              </h2>
              <p className="text-sm text-blue-700 mb-3">
                {t('superFeeConfig.trialBody', { days: Math.floor(trialDurationConfig.value) })}
              </p>
              <p className="text-xs text-blue-600">
                {t('superFeeConfig.trialRange', { min: trialDurationConfig.min_value, max: trialDurationConfig.max_value })}
              </p>
            </div>
          </div>
          <div className="mt-4 border-t border-blue-200 pt-4">
            <FeeRow row={trialDurationConfig} onSave={reload} />
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-800 mb-3">
        {t('superFeeConfig.transactionFees')}
      </h2>
      {transactionFees.map(row => (
        <FeeRow key={row.key} row={row} onSave={reload} />
      ))}

      <h2 className="text-lg font-semibold text-gray-800 mb-3 mt-8">
        {t('superFeeConfig.subscriptionPrices')}
      </h2>
      {subscriptionFees.map(row => (
        <FeeRow key={row.key} row={row} onSave={reload} />
      ))}

      <div className="mt-8">
        <ChangeHistory history={history} />
      </div>
    </div>
  );
}
