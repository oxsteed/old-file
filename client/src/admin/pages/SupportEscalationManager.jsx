import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import {
  AlertTriangle, Plus, Edit2, Trash2, RefreshCw, CheckCircle, XCircle, ChevronDown,
} from 'lucide-react';

// Escalation Rule Card
function EscalationRuleCard({ rule, onEdit, onDelete, onToggle }) {
  const [expanded, setExpanded] = useState(false);

  const getPriorityColor = (priority) => {
    if (priority === 'critical') return 'text-red-400 bg-red-900/20';
    if (priority === 'high') return 'text-orange-400 bg-orange-900/20';
    if (priority === 'medium') return 'text-yellow-400 bg-yellow-900/20';
    return 'text-blue-400 bg-blue-900/20';
  };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-gray-600 transition">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <h3 className="text-white font-semibold text-lg">{rule.rule_name}</h3>
          <p className="text-gray-400 text-sm mt-1">{rule.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getPriorityColor(rule.priority)}`}>
            {rule.priority.toUpperCase()}
          </span>
          <button
            onClick={() => onToggle(rule.id)}
            className="p-2 hover:bg-gray-700 rounded-lg transition"
          >
            {rule.is_active ? (
              <CheckCircle size={18} className="text-green-400" />
            ) : (
              <XCircle size={18} className="text-gray-500" />
            )}
          </button>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-gray-400 text-sm hover:text-gray-300 mb-3"
      >
        <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        {expanded ? 'Hide details' : 'Show details'}
      </button>

      {expanded && (
        <div className="bg-gray-700/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
          <div>
            <p className="text-gray-400">Trigger Condition:</p>
            <p className="text-white">{rule.trigger_condition}</p>
          </div>
          <div>
            <p className="text-gray-400">Escalate To:</p>
            <p className="text-white">{rule.escalate_to}</p>
          </div>
          <div>
            <p className="text-gray-400">After (minutes):</p>
            <p className="text-white">{rule.escalate_after_minutes} minutes</p>
          </div>
          {rule.notify_managers && (
            <div>
              <p className="text-gray-400">Manager Notification:</p>
              <p className="text-white">✓ Enabled</p>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-gray-700 pt-3">
        <button
          onClick={() => onEdit(rule)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600
                     text-gray-300 rounded-lg transition text-sm"
        >
          <Edit2 size={14} />
          Edit
        </button>
        <button
          onClick={() => onDelete(rule.id)}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-900/30 hover:bg-red-900/50
                     text-red-400 rounded-lg transition text-sm"
        >
          <Trash2 size={14} />
          Delete
        </button>
      </div>
    </div>
  );
}

// Escalation Rule Form Modal
function EscalationRuleModal({ rule, onClose, onSave }) {
  const [formData, setFormData] = useState(rule || {
    rule_name: '',
    description: '',
    trigger_condition: '',
    priority: 'medium',
    escalate_to: '',
    escalate_after_minutes: 15,
    notify_managers: true,
    is_active: true,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="border-b border-gray-700 p-6 flex items-center justify-between sticky top-0 bg-gray-800">
          <h2 className="text-white font-bold text-xl">
            {rule ? 'Edit Escalation Rule' : 'Create Escalation Rule'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl">×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">Rule Name</label>
            <input
              type="text"
              value={formData.rule_name}
              onChange={e => setFormData({ ...formData, rule_name: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              placeholder="e.g., Long Wait Time Escalation"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500 resize-none"
              placeholder="Brief description of when this rule triggers"
              rows="2"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-400 text-sm mb-2">Priority</label>
              <select
                value={formData.priority}
                onChange={e => setFormData({ ...formData, priority: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                           focus:outline-none focus:border-orange-500"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div>
              <label className="block text-gray-400 text-sm mb-2">Escalate After (min)</label>
              <input
                type="number"
                value={formData.escalate_after_minutes}
                onChange={e => setFormData({ ...formData, escalate_after_minutes: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                           focus:outline-none focus:border-orange-500"
                min="1"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Trigger Condition</label>
            <input
              type="text"
              value={formData.trigger_condition}
              onChange={e => setFormData({ ...formData, trigger_condition: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              placeholder="e.g., Wait time > 30 minutes"
              required
            />
          </div>

          <div>
            <label className="block text-gray-400 text-sm mb-2">Escalate To</label>
            <select
              value={formData.escalate_to}
              onChange={e => setFormData({ ...formData, escalate_to: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                         focus:outline-none focus:border-orange-500"
              required
            >
              <option value="">Select escalation target</option>
              <option value="supervisor">Supervisor</option>
              <option value="manager">Manager</option>
              <option value="director">Director</option>
              <option value="support_team">Support Team</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.notify_managers}
                onChange={e => setFormData({ ...formData, notify_managers: e.target.checked })}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-gray-300 text-sm">Notify managers when escalated</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={e => setFormData({ ...formData, is_active: e.target.checked })}
                className="w-4 h-4 accent-orange-500"
              />
              <span className="text-gray-300 text-sm">Rule is active</span>
            </label>
          </div>

          <div className="flex gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition font-medium"
            >
              {rule ? 'Update Rule' : 'Create Rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Main Escalation Manager
export default function SupportEscalationManager() {
  const { t } = useTranslation();
  const { businessId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/escalation/rules', {
        params: { business_id: businessId },
      });
      setData(res.data);
    } catch (err) {
      console.error('Failed to load escalation rules:', err);
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEdit = (rule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const handleSave = async (formData) => {
    try {
      if (editingRule) {
        await adminApi.put(`/support/escalation/rules/${editingRule.id}`, formData);
      } else {
        await adminApi.post('/support/escalation/rules', {
          ...formData,
          business_id: businessId,
        });
      }
      setShowForm(false);
      setEditingRule(null);
      loadData();
    } catch (err) {
      console.error('Failed to save rule:', err);
    }
  };

  const handleDelete = async (ruleId) => {
    if (!window.confirm(t('supportAdmin.escalation.confirmDeleteRule'))) return;
    try {
      await adminApi.delete(`/support/escalation/rules/${ruleId}`);
      loadData();
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  const handleToggle = async (ruleId) => {
    try {
      await adminApi.patch(`/support/escalation/rules/${ruleId}/toggle`);
      loadData();
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  const escalationData = data || {};
  const rules = escalationData.rules || [];
  const stats = escalationData.stats || {};

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Escalation Management</h1>
          <p className="text-gray-400 text-sm">Configure rules for automatic ticket escalation.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg
                       hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setEditingRule(null);
              setShowForm(true);
            }}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700
                       text-white rounded-lg transition font-medium"
          >
            <Plus size={18} />
            New Rule
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Total Rules</p>
          <p className="text-white text-3xl font-bold">{stats.total_rules || 0}</p>
          <p className="text-gray-500 text-xs mt-2">{stats.active_rules || 0} active</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Escalations This Week</p>
          <p className="text-white text-3xl font-bold">{stats.escalations_this_week || 0}</p>
          <p className="text-gray-500 text-xs mt-2">Last 7 days</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Avg Escalation Time</p>
          <p className="text-white text-3xl font-bold">{stats.avg_escalation_minutes || '–'}m</p>
          <p className="text-gray-500 text-xs mt-2">From trigger to escalation</p>
        </div>
      </div>

      {/* Rules List */}
      <div>
        <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
          <AlertTriangle size={20} className="text-orange-400" />
          Active Escalation Rules
        </h2>

        {rules.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <AlertTriangle size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">No escalation rules configured</p>
            <button
              onClick={() => setShowForm(true)}
              className="mt-4 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition"
            >
              Create your first rule
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {rules.map(rule => (
              <EscalationRuleCard
                key={rule.id}
                rule={rule}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onToggle={handleToggle}
              />
            ))}
          </div>
        )}
      </div>

      {/* Form Modal */}
      {showForm && (
        <EscalationRuleModal
          rule={editingRule}
          onClose={() => {
            setShowForm(false);
            setEditingRule(null);
          }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
