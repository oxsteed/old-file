import { useEffect, useState, useCallback } from 'react';
import { Settings, Edit2, X, Loader2, Save } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';

export default function FeeConfiguration() {
  const [config, setConfig] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/fee-config');
      setConfig(data.config || []);
    } catch (err) {
      toast.error('Failed to load fee configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/fee-config/history');
      setHistory(data.history || []);
    } catch (err) {
      toast.error('Failed to load change history');
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleEdit = (row) => {
    setEditing(row.key);
    setEditValue(row.value.toString());
    setEditReason('');
  };

  const handleCancel = () => {
    setEditing(null);
    setEditValue('');
    setEditReason('');
  };

  const handleSave = async () => {
    if (!editValue || editValue.trim() === '') {
      toast.error('Value cannot be empty');
      return;
    }

    const newValue = parseFloat(editValue);
    if (isNaN(newValue)) {
      toast.error('Invalid number');
      return;
    }

    const currentRow = config.find(r => r.key === editing);
    if (!currentRow) return;

    // Validate min/max
    if (currentRow.min_value !== null && newValue < currentRow.min_value) {
      toast.error(`Value must be at least ${currentRow.min_value}`);
      return;
    }
    if (currentRow.max_value !== null && newValue > currentRow.max_value) {
      toast.error(`Value must not exceed ${currentRow.max_value}`);
      return;
    }

    setSaving(true);
    try {
      await adminApi.put('/fee-config', {
        key: editing,
        value: newValue,
        reason: editReason || null,
      });
      toast.success(`Updated ${editing}`);
      fetchConfig();
      fetchHistory();
      handleCancel();
    } catch (err) {
      const errMsg = err.response?.data?.error || err.response?.data?.message || 'Failed to update';
      toast.error(errMsg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  const trialDayConfig = config.find(c => c.key === 'trial_duration_days');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-orange-500" />
          <h1 className="text-2xl font-bold text-white">Fee Configuration</h1>
        </div>
        <button
          onClick={() => {
            setShowHistory(!showHistory);
            if (!showHistory && history.length === 0) fetchHistory();
          }}
          className="px-3 py-1 text-sm bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg"
        >
          {showHistory ? 'Hide' : 'Show'} History
        </button>
      </div>

      {/* Trial Duration Highlight */}
      {trialDayConfig && (
        <div className="bg-gradient-to-r from-orange-900 to-orange-800 rounded-xl border border-orange-700 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-white mb-2">
                Trial Duration Configuration
              </h3>
              <p className="text-orange-100 text-sm">
                New users get a {Math.floor(trialDayConfig.value)}-day trial with pro tier access before reverting to free tier.
              </p>
              <div className="mt-3 text-sm">
                <p className="text-orange-100">
                  Min: {trialDayConfig.min_value} days | Max: {trialDayConfig.max_value} days
                </p>
              </div>
            </div>
            {editing !== 'trial_duration_days' ? (
              <button
                onClick={() => handleEdit(trialDayConfig)}
                className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg transition"
              >
                <Edit2 className="w-4 h-4" />
                Adjust
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  type="number"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  min={trialDayConfig.min_value}
                  max={trialDayConfig.max_value}
                  className="px-3 py-2 bg-zinc-800 text-white rounded-lg border border-orange-600 w-24"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded-lg disabled:opacity-50"
                  >
                    <Save className="w-4 h-4" />
                    Save
                  </button>
                  <button
                    onClick={handleCancel}
                    className="px-3 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* All Fee Configs */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold text-white">All Configuration Values</h2>
        <div className="grid gap-4">
          {config.map((row) => (
            <div
              key={row.key}
              className="bg-zinc-900 rounded-lg border border-zinc-800 p-4 hover:border-zinc-700 transition"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="font-semibold text-white">{row.label}</h3>
                  <p className="text-sm text-zinc-400 mt-1">{row.description}</p>
                  <div className="flex items-center gap-4 mt-3">
                    <div>
                      <span className="text-xs text-zinc-500">Current Value:</span>
                      <div className="text-lg font-mono text-orange-400">
                        {row.value_type === 'percentage'
                          ? `${(parseFloat(row.value) * 100).toFixed(2)}%`
                          : row.value_type === 'cents'
                          ? `$${(parseFloat(row.value) / 100).toFixed(2)}`
                          : parseFloat(row.value).toFixed(4)}
                      </div>
                    </div>
                    {row.min_value !== null && (
                      <div>
                        <span className="text-xs text-zinc-500">Min:</span>
                        <div className="text-sm text-zinc-300">{row.min_value}</div>
                      </div>
                    )}
                    {row.max_value !== null && (
                      <div>
                        <span className="text-xs text-zinc-500">Max:</span>
                        <div className="text-sm text-zinc-300">{row.max_value}</div>
                      </div>
                    )}
                  </div>
                  {row.updated_by_name && (
                    <p className="text-xs text-zinc-500 mt-2">
                      Last updated by {row.updated_by_name}
                    </p>
                  )}
                </div>

                {editing === row.key ? (
                  <div className="flex flex-col gap-3 ml-4">
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">New Value</label>
                      <input
                        type="number"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        min={row.min_value}
                        max={row.max_value}
                        step="0.01"
                        className="w-32 px-2 py-1 bg-zinc-800 text-white rounded border border-zinc-600 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 block mb-1">Reason (optional)</label>
                      <textarea
                        value={editReason}
                        onChange={(e) => setEditReason(e.target.value)}
                        placeholder="Why this change?"
                        className="w-32 px-2 py-1 bg-zinc-800 text-white rounded border border-zinc-600 text-xs resize-none"
                        rows={2}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded disabled:opacity-50"
                      >
                        <Save className="w-3 h-3" />
                        Save
                      </button>
                      <button
                        onClick={handleCancel}
                        className="flex items-center gap-1 px-2 py-1 bg-zinc-700 hover:bg-zinc-600 text-white text-xs rounded"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => handleEdit(row)}
                    className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-sm rounded-lg transition ml-4"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Change History */}
      {showHistory && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-white">Change History</h2>
          {history.length === 0 ? (
            <p className="text-zinc-400 text-center py-8">No changes recorded yet</p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="bg-zinc-900 rounded-lg p-3 border border-zinc-800 text-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono text-white">{entry.config_key}</p>
                      <p className="text-zinc-400">
                        {entry.old_value} → {entry.new_value}
                      </p>
                      {entry.reason && (
                        <p className="text-zinc-500 italic mt-1">"{entry.reason}"</p>
                      )}
                    </div>
                    <div className="text-right text-xs text-zinc-500">
                      <p>{entry.changed_by_name || 'System'}</p>
                      <p>{new Date(entry.created_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
