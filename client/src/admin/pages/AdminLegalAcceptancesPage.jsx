import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Download, Mail, RefreshCw, Search, Filter, Eye, RotateCcw } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';
import ConfirmDialog from '../lib/ConfirmDialog';
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

// Document type options
const DOCUMENT_TYPES = [
  { value: '', label: 'All Documents' },
  { value: 'contractor_agreement', label: 'Contractor Agreement' },
  { value: 'dispute_resolution', label: 'Dispute Resolution' },
  { value: 'account_termination', label: 'Account Termination' },
  { value: 'privacy_policy', label: 'Privacy Policy' },
  { value: 'biometric_data', label: 'Biometric Data' },
  { value: 'harassment_policy', label: 'Harassment Policy' },
  { value: 'background_check', label: 'Background Check' },
  { value: 'arbitration', label: 'Arbitration' },
  { value: 'escrow_policy', label: 'Escrow Policy' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'name_asc', label: 'By Name (A-Z)' },
];

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function DetailModal({ acceptance, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold">Acceptance Details</h2>
          <button onClick={onClose} aria-label={t('common.aria.closeButton')} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-6">
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">User Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Name</p>
                <p className="text-white">{acceptance.user_name}</p>
              </div>
              <div>
                <p className="text-gray-500">Email</p>
                <p className="text-white">{acceptance.user_email}</p>
              </div>
              <div>
                <p className="text-gray-500">User ID</p>
                <p className="text-gray-300 font-mono text-xs">{acceptance.user_id}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-gray-300 text-sm font-semibold mb-3">Document Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Document Type</p>
                <p className="text-white capitalize">{acceptance.document_type?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-gray-500">Version</p>
                <p className="text-white">{acceptance.document_version || 'N/A'}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-gray-300 text-sm font-semibold mb-3">Signature Details</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Signed Name</p>
                <p className="text-white">{acceptance.signed_first_name} {acceptance.signed_last_name}</p>
              </div>
              <div>
                <p className="text-gray-500">Accepted Date</p>
                <p className="text-white">{new Date(acceptance.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-gray-500">IP Address</p>
                <p className="text-gray-300 font-mono text-xs">{acceptance.ip_address}</p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <h3 className="text-gray-300 text-sm font-semibold mb-3">User Agent</h3>
            <p className="text-gray-300 text-xs font-mono bg-gray-900 p-3 rounded border border-gray-700 overflow-auto max-h-24">
              {acceptance.user_agent}
            </p>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 px-6 py-4 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Action Menu ──────────────────────────────────────────────────────────────

function ActionMenu({ acceptance, onRevoke, revoking }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-label={t('adminA11y.moreActions')}
        className="p-1.5 hover:bg-gray-700 rounded-lg transition"
      >
        <MoreVertical size={16} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-700 border border-gray-600 rounded-lg shadow-lg z-40 py-1">
          <button
            onClick={() => {
              onRevoke(acceptance.id);
              setOpen(false);
            }}
            disabled={revoking}
            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-600 transition disabled:opacity-50"
          >
            {revoking ? 'Revoking...' : 'Revoke Acceptance'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminLegalAcceptancesPage() {
  const { t } = useTranslation();

  // Filter & pagination state
  const [documentType, setDocumentType] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [selectedDetail, setSelectedDetail] = useState(null);

  // Action states
  const [revoking, setRevoking] = useState({});
  const [revokeTarget, setRevokeTarget] = useState(null);
  const [exportError, setExportError] = useState('');

  const { data, error, loading, reload } = useAbortableFetch(async (signal) => {
    const res = await adminApi.get('/admin/legal/acceptances', {
      params: {
        documentType: documentType || undefined,
        search: search || undefined,
        sort,
        page,
        limit,
      },
      signal,
    });
    return {
      acceptances: res.data.acceptances || [],
      totalCount: res.data.total || 0,
      stats: res.data.stats,
      chartData: res.data.trend || [],
      pieData: res.data.breakdown || [],
    };
  }, [documentType, search, sort, page, limit]);

  const acceptances = data?.acceptances ?? [];
  const totalCount = data?.totalCount ?? 0;
  const stats = data?.stats ?? null;
  const chartData = data?.chartData ?? [];
  const pieData = data?.pieData ?? [];

  // Revocation is destructive: it goes through a confirmation dialog.
  // ConfirmDialog stays open and shows the error if the POST fails.
  const confirmRevoke = async () => {
    const acceptanceId = revokeTarget;
    setRevoking(prev => ({ ...prev, [acceptanceId]: true }));
    try {
      await adminApi.post(`/admin/legal/acceptances/${acceptanceId}/revoke`);
      reload();
    } finally {
      setRevoking(prev => ({ ...prev, [acceptanceId]: false }));
    }
  };

  const handleExportCSV = async () => {
    try {
      const res = await adminApi.get('/admin/legal/acceptances/export/csv', {
        params: { documentType, search, sort },
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `legal-acceptances-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
    } catch (err) {
      setExportError('Failed to export CSV');
    }
  };

  const COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899'];
  const pages = Math.ceil(totalCount / limit);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">Legal Acceptances</h1>
          <p className="text-gray-400 text-sm">View all legal document acceptances across users and document types.</p>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          aria-label={t('common.refresh')}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <AdminErrorState onRetry={reload} />
      )}
      {exportError && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <span>⚠️</span>
          <span>{exportError}</span>
        </div>
      )}

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Total Acceptances</p>
            <p className="text-white text-3xl font-bold">{stats.total_acceptances}</p>
            <p className="text-gray-500 text-xs mt-2">All time</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Unique Users</p>
            <p className="text-white text-3xl font-bold">{stats.unique_users}</p>
            <p className="text-gray-500 text-xs mt-2">Signed documents</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">This Month</p>
            <p className="text-white text-3xl font-bold">{stats.this_month}</p>
            <p className="text-gray-500 text-xs mt-2">New acceptances</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Acceptance Rate</p>
            <p className="text-white text-3xl font-bold">{stats.acceptance_rate}%</p>
            <p className="text-gray-500 text-xs mt-2">Active users</p>
          </div>
        </div>
      )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Chart */}
        {chartData.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">Acceptances Trend (90 Days)</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <YAxis stroke="#9ca3af" style={{ fontSize: '12px' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
                <Legend />
                <Line type="monotone" dataKey="count" stroke="#f97316" strokeWidth={2} name="Acceptances" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Breakdown Pie Chart */}
        {pieData.length > 0 && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <h3 className="text-white font-semibold mb-4">By Document Type</h3>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Filters & Export */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-300 font-semibold">Filters & Search</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Document Type Filter */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Document Type</label>
            <select
              value={documentType}
              onChange={(e) => {
                setDocumentType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {DOCUMENT_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Search Input */}
          <div className="md:col-span-2">
            <label className="block text-gray-400 text-sm mb-2">Search by Email or Name</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Email or user name..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Sort */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Sort By</label>
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {SORT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition"
          >
            <Download size={16} />
            Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">USER</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">DOCUMENT TYPE</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">VERSION</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">ACCEPTED DATE</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">IP ADDRESS</th>
                <th className="px-6 py-4 text-center text-gray-400 font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading && acceptances.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full" />
                    </div>
                  </td>
                </tr>
              ) : error ? null : acceptances.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-gray-400">
                    No acceptances found
                  </td>
                </tr>
              ) : (
                acceptances.map(acceptance => (
                  <tr key={acceptance.id} className="hover:bg-gray-700/50 transition">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                          {acceptance.user_name?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">{acceptance.user_name}</p>
                          <p className="text-gray-400 text-xs">{acceptance.user_email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-gray-300 capitalize">
                      {acceptance.document_type?.replace(/_/g, ' ')}
                    </td>
                    <td className="px-6 py-4 text-gray-300">
                      {acceptance.document_version || 'v1'}
                    </td>
                    <td className="px-6 py-4 text-gray-300 text-xs">
                      {new Date(acceptance.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-gray-400 text-xs font-mono">
                      {acceptance.ip_address}
                    </td>
                    <td className="px-6 py-4 text-center space-x-2">
                      <button
                        onClick={() => setSelectedDetail(acceptance)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition"
                      >
                        <Eye size={14} />
                        View
                      </button>
                      <ActionMenu
                        acceptance={acceptance}
                        onRevoke={(id) => setRevokeTarget(id)}
                        revoking={revoking[acceptance.id]}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-900 border-t border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} acceptances
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="flex items-center gap-2">
              {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded text-sm transition ${
                    p === page
                      ? 'bg-orange-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedDetail && (
        <DetailModal
          acceptance={selectedDetail}
          onClose={() => setSelectedDetail(null)}
        />
      )}

      <ConfirmDialog
        open={!!revokeTarget}
        danger
        title={t('adminLegalAcceptances.confirmRevokeTitle')}
        message={t('adminLegalAcceptances.confirmRevokeMessage')}
        onConfirm={confirmRevoke}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  );
}
