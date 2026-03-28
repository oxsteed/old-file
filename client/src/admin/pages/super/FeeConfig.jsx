import { useEffect, useState } from 'react';
import api from '../../../api/axios';

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

// Fee row component
function FeeRow({ row, onSave }) {
  const [editing, setEditing] = useState(false);
  const [rawInput, setRawInput] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      let sendValue = parseFloat(rawInput);
      if (row.value_type === 'percentage') {
        sendValue = sendValue / 100;
      } else if (row.value_type === 'cents') {
        sendValue = Math.round(sendValue * 100);
      }
      await api.put(`/api/admin/fees/${row.key}`, {
        key: row.key,
        value: sendValue,
        reason: reason || undefined,
      });
      setEditing(false);
      onSave();
    } catch (err) {
      alert(err.response?.data?.error || 'Update failed');
    } finally {
      setSaving(false);
    }
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
              Edit
            </button>
          )}
        </div>
      </div>
      {row.updated_by_name && (
        <p className="text-xs text-gray-300 mt-2">
          Last updated by {row.updated_by_name} on{' '}
          {new Date(row.updated_at).toLocaleDateString()}
        </p>
      )}
      {editing && (
        <div className="mt-4 space-y-3 border-t border-orange-200 pt-4">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                New value
                {row.value_type === 'percentage' && ' (enter as %)'}
                {row.value_type === 'cents' && ' (enter as $)'}
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
                Reason (optional)
              </label>
              <input
                type="text"
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Why this change?"
                className="w-full border border-gray-200 rounded-lg px-3 py-2
                  text-sm focus:outline-none focus:ring-2
                  focus:ring-orange-300"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Change History component
function ChangeHistory({ history }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? history : history.slice(0, 5);
  if (!history.length) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-5 py-4
          hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800">Change History</h2>
          <span className="text-xs bg-gray-100 text-gray-500
            px-2 py-0.5 rounded-full">
            {history.length}
          </span>
        </div>
        <span className="text-gray-400">{expanded ? '▲' : '▼'}</span>
      </button>
      <div className="px-5 pb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 border-b">
              <th className="pb-2">Setting</th>
              <th className="pb-2">Old</th>
              <th className="pb-2">New</th>
              <th className="pb-2">Changed By</th>
              <th className="pb-2">Reason</th>
              <th className="pb-2">Date</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(h => (
              <tr key={h.id} className="border-b border-gray-100">
                <td className="py-2 font-medium">{h.config_key}</td>
                <td className="py-2 text-red-500">{h.old_value}</td>
                <td className="py-2 text-green-600">{h.new_value}</td>
                <td className="py-2">{h.changed_by_name || 'System'}</td>
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
  const [config, setConfig] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [showReset, setShowReset] = useState(false);

  const load = () => {
    Promise.all([
      api.get('/admin/fees'),
      api.get('/admin/fees/history'),
    ]).then(([cfgRes, histRes]) => {
      setConfig(cfgRes.data.config);
      setHistory(histRes.data.history);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleReset = async () => {
    setResetting(true);
    try {
      await api.post('/admin/fees/reset', {
        reason: resetReason || 'Manual reset to defaults',
      });
      setShowReset(false);
      setResetReason('');
      load();
    } finally {
      setResetting(false);
    }
  };

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
            Price Management
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            All fee changes take effect immediately for new transactions.
            Every change is logged with a full audit trail.
          </p>
        </div>
        <button
          onClick={() => setShowReset(r => !r)}
          className="flex items-center gap-1.5 text-xs font-semibold
            text-gray-500 hover:text-red-600 px-3 py-2
            border border-gray-200 hover:border-red-200
            rounded-lg transition-colors">
          Reset to Defaults
        </button>
      </div>

      {showReset && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-2 mb-3">
            <div>
              <p className="text-sm font-semibold text-red-700">
                Reset all fees to default values?
              </p>
              <p className="text-xs text-red-500 mt-0.5">
                This will restore: 10% platform fee, 2% protection fee,
                5% broker cut, $5 minimum, $29 Pro, $79 Broker.
                All changes are logged.
              </p>
            </div>
          </div>
          <input
            type="text"
            value={resetReason}
            onChange={e => setResetReason(e.target.value)}
            placeholder="Reason for reset..."
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
              {resetting ? 'Resetting...' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => setShowReset(false)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700
                font-semibold px-4 py-2 rounded-lg text-sm
                transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      <h2 className="text-lg font-semibold text-gray-800 mb-3">
        Transaction Fees
      </h2>
      {transactionFees.map(row => (
        <FeeRow key={row.key} row={row} onSave={load} />
      ))}

      <h2 className="text-lg font-semibold text-gray-800 mb-3 mt-8">
        Subscription Prices
      </h2>
      {subscriptionFees.map(row => (
        <FeeRow key={row.key} row={row} onSave={load} />
      ))}

      <div className="mt-8">
        <ChangeHistory history={history} />
      </div>
    </div>
  );
}
