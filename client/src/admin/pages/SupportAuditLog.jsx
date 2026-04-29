import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import {
  History, Download, RefreshCw, Search, Filter, Calendar, User, FileText, Trash2,
} from 'lucide-react';

// Audit Log Entry
function AuditLogEntry({ entry }) {
  const getActionColor = (action) => {
    if (action.includes('create') || action.includes('add')) return 'text-green-400 bg-green-900/20';
    if (action.includes('delete') || action.includes('remove')) return 'text-red-400 bg-red-900/20';
    if (action.includes('update') || action.includes('modify')) return 'text-yellow-400 bg-yellow-900/20';
    if (action.includes('login') || action.includes('access')) return 'text-blue-400 bg-blue-900/20';
    return 'text-gray-400 bg-gray-900/20';
  };

  return (
    <div className="bg-gray-700 rounded-lg p-4 hover:bg-gray-700/80 transition">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-3 flex-1">
          <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-sm">
            {entry.user_name?.[0] || '?'}
          </div>
          <div className="flex-1">
            <p className="text-white font-medium">{entry.user_name || 'System'}</p>
            <p className="text-gray-400 text-sm">{entry.email || 'system@oxsteed.com'}</p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getActionColor(entry.action)}`}>
          {entry.action}
        </span>
      </div>

      <p className="text-gray-200 text-sm mb-2">{entry.description}</p>

      {entry.changes && Object.keys(entry.changes).length > 0 && (
        <div className="bg-gray-600/30 rounded p-2 mb-2 text-xs space-y-1">
          {Object.entries(entry.changes).map(([key, value]) => (
            <div key={key} className="text-gray-300">
              <span className="text-gray-400 font-semibold">{key}:</span> {JSON.stringify(value)}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-600">
        <span>{new Date(entry.created_at).toLocaleString()}</span>
        {entry.ip_address && <span>{entry.ip_address}</span>}
      </div>
    </div>
  );
}

// Filter Panel
function FilterPanel({ filters, onFilterChange }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 mb-6 space-y-4">
      <h3 className="text-white font-semibold flex items-center gap-2">
        <Filter size={16} />
        Filters
      </h3>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-gray-400 text-sm mb-2">Search</label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by user or action..."
              value={filters.search}
              onChange={e => onFilterChange({ ...filters, search: e.target.value })}
              className="w-full pl-9 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg
                         text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">Action Type</label>
          <select
            value={filters.action}
            onChange={e => onFilterChange({ ...filters, action: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="">All Actions</option>
            <option value="create">Create</option>
            <option value="update">Update</option>
            <option value="delete">Delete</option>
            <option value="login">Login</option>
            <option value="export">Export</option>
          </select>
        </div>

        <div>
          <label className="block text-gray-400 text-sm mb-2">Date Range</label>
          <select
            value={filters.dateRange}
            onChange={e => onFilterChange({ ...filters, dateRange: e.target.value })}
            className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white
                       text-sm focus:outline-none focus:border-orange-500"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>

        <div className="flex items-end gap-2">
          <button
            onClick={() => onFilterChange({ search: '', action: '', dateRange: '7d' })}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg
                       text-sm transition"
          >
            Clear Filters
          </button>
        </div>
      </div>
    </div>
  );
}

// Main Audit Log
export default function SupportAuditLog() {
  const { businessId } = useParams();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    search: '',
    action: '',
    dateRange: '7d',
  });
  const [stats, setStats] = useState({
    total_entries: 0,
    users_active: 0,
    actions_today: 0,
    last_entry: null,
  });

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get(`/api/support/audit/logs`, {
        params: {
          business_id: businessId,
          ...filters,
        },
      });
      setLogs(res.data.logs || []);
      setStats(res.data.stats || {});
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    }
    setLoading(false);
  }, [businessId, filters]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleExport = async () => {
    try {
      const response = await adminApi.get(`/api/support/audit/export`, {
        params: {
          business_id: businessId,
          ...filters,
          format: 'csv',
        },
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `audit-log-${new Date().toISOString()}.csv`);
      document.body.appendChild(link);
      link.click();
      link.parentChild.removeChild(link);
    } catch (err) {
      console.error('Failed to export logs:', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2 flex items-center gap-2">
            <History size={28} className="text-orange-400" />
            Audit Log
          </h1>
          <p className="text-gray-400 text-sm">Track all system activities and changes for compliance.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadLogs}
            disabled={loading}
            className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg
                       hover:text-white transition disabled:opacity-50"
          >
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 hover:bg-orange-700
                       text-white rounded-lg transition font-medium"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-8">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Total Entries</p>
          <p className="text-white text-3xl font-bold">{stats.total_entries || 0}</p>
          <p className="text-gray-500 text-xs mt-2">Lifetime</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <User size={14} />
            Active Users
          </p>
          <p className="text-white text-3xl font-bold">{stats.users_active || 0}</p>
          <p className="text-gray-500 text-xs mt-2">This period</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2 flex items-center gap-2">
            <FileText size={14} />
            Actions Today
          </p>
          <p className="text-white text-3xl font-bold">{stats.actions_today || 0}</p>
          <p className="text-gray-500 text-xs mt-2">Last 24 hours</p>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <p className="text-gray-400 text-sm mb-2">Last Entry</p>
          <p className="text-white font-semibold">
            {stats.last_entry ? new Date(stats.last_entry).toLocaleTimeString() : '–'}
          </p>
          <p className="text-gray-500 text-xs mt-2">Most recent activity</p>
        </div>
      </div>

      {/* Filters */}
      <FilterPanel filters={filters} onFilterChange={setFilters} />

      {/* Logs List */}
      <div>
        <h2 className="text-white font-bold text-xl mb-4 flex items-center gap-2">
          <Calendar size={20} className="text-orange-400" />
          Activity Timeline
        </h2>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-12 bg-gray-800 border border-gray-700 rounded-xl">
            <FileText size={40} className="mx-auto mb-3 text-gray-600" />
            <p className="text-gray-400">No audit log entries found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {logs.map((entry, idx) => (
              <AuditLogEntry key={idx} entry={entry} />
            ))}
          </div>
        )}
      </div>

      {/* Compliance Info */}
      <div className="bg-blue-900/20 border border-blue-700 rounded-xl p-6 mt-8">
        <h3 className="text-blue-400 font-bold mb-2">Compliance Information</h3>
        <p className="text-gray-300 text-sm">
          This audit log tracks all system activities including user logins, data modifications, and administrative actions.
          Logs are retained for 90 days and can be exported for compliance and security audits.
        </p>
      </div>
    </div>
  );
}
