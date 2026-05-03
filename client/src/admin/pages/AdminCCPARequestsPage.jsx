import { useState, useEffect, useCallback } from 'react';
import { Search, Filter, RefreshCw, Calendar, Mail, MoreVertical, Eye } from 'lucide-react';
import adminApi from '../../lib/adminApi';

const REQUEST_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'data_access', label: 'Data Access' },
  { value: 'deletion', label: 'Deletion' },
  { value: 'opt_out', label: 'Opt-Out' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'awaiting_user', label: 'Awaiting User' },
  { value: 'completed', label: 'Completed' },
  { value: 'expired', label: 'Expired' },
  { value: 'denied', label: 'Denied' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'due_soon', label: 'Due Soon' },
  { value: 'overdue', label: 'Overdue First' },
];

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const styles = {
    pending: 'bg-yellow-500/20 text-yellow-400',
    processing: 'bg-blue-500/20 text-blue-400',
    awaiting_user: 'bg-purple-500/20 text-purple-400',
    completed: 'bg-green-500/20 text-green-400',
    expired: 'bg-gray-500/20 text-gray-400',
    denied: 'bg-red-500/20 text-red-400',
  };

  const labels = {
    pending: 'Pending',
    processing: 'Processing',
    awaiting_user: 'Awaiting User',
    completed: 'Completed',
    expired: 'Expired',
    denied: 'Denied',
  };

  return (
    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${styles[status] || styles.pending}`}>
      {labels[status] || 'Unknown'}
    </span>
  );
}

// ─── Request Detail Modal ──────────────────────────────────────────────────────

function RequestDetailModal({ request, onClose, onStatusChange, updating }) {
  const [newStatus, setNewStatus] = useState(request?.status);
  const [adminNotes, setAdminNotes] = useState(request?.admin_notes || '');
  const [fulfillmentDate, setFulfillmentDate] = useState(request?.fulfillment_date || '');

  const handleSave = async () => {
    try {
      await adminApi.put(`/admin/legal/ccpa-requests/${request.id}`, {
        status: newStatus,
        adminNotes,
        fulfillmentDate,
      });
      onStatusChange();
      onClose();
    } catch (err) {
      console.error('Failed to update request:', err);
    }
  };

  const daysRemaining = request ? Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24)) : 0;
  const isOverdue = daysRemaining < 0;
  const isUrgent = daysRemaining < 5 && daysRemaining >= 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="sticky top-0 bg-gray-800 border-b border-gray-700 px-6 py-4 flex items-center justify-between">
          <h2 className="text-white font-bold">Request Details</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-6 space-y-6">
          {/* Request Info */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">Request Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <p className="text-gray-500 mb-1">Request ID</p>
                <p className="text-gray-300 font-mono text-xs">{request.id}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Type</p>
                <p className="text-gray-300 capitalize">{request.type?.replace(/_/g, ' ')}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Submitted</p>
                <p className="text-gray-300">{new Date(request.submittedDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Due Date</p>
                <p className={`${isOverdue ? 'text-red-400' : isUrgent ? 'text-yellow-400' : 'text-gray-300'}`}>
                  {new Date(request.dueDate).toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>

          {/* User Info */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">User Information</h3>
            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <p className="text-gray-500 mb-1">Email</p>
                <p className="text-gray-300">{request.email}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Name</p>
                <p className="text-gray-300">{request.name}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Phone</p>
                <p className="text-gray-300">{request.phone || 'N/A'}</p>
              </div>
              <div>
                <p className="text-gray-500 mb-1">Address</p>
                <p className="text-gray-300 text-xs">{request.address || 'N/A'}</p>
              </div>
            </div>
          </div>

          {/* Request Details */}
          {request.requestNotes && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-3">Request Details</h3>
              <p className="text-gray-300 bg-gray-900 rounded-lg p-4 border border-gray-700 text-sm">
                {request.requestNotes}
              </p>
            </div>
          )}

          {/* Data Categories (for Access requests) */}
          {request.type === 'data_access' && (
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-3">Data Categories to Provide</h3>
              <div className="space-y-2 bg-gray-900 rounded-lg p-4 border border-gray-700">
                {['profile', 'messages', 'payments', 'background_check', 'jobs', 'applications'].map(cat => (
                  <label key={cat} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      defaultChecked={true}
                      className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-gray-300 text-sm capitalize">{cat.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Status Management */}
          <div>
            <h3 className="text-gray-300 text-sm font-semibold mb-3">Status Management</h3>
            <div className="space-y-4 bg-gray-900 rounded-lg p-4 border border-gray-700">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Current Status</label>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
                >
                  {STATUS_OPTIONS.slice(1).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Fulfillment Date</label>
                <input
                  type="date"
                  value={fulfillmentDate}
                  onChange={(e) => setFulfillmentDate(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-gray-400 text-sm mb-2">Admin Notes</label>
                <textarea
                  value={adminNotes}
                  onChange={(e) => setAdminNotes(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500 resize-none"
                  placeholder="Internal notes about this request..."
                />
                <p className="text-gray-500 text-xs mt-1">{adminNotes.length}/500</p>
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-gray-800 border-t border-gray-700 px-6 py-4 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
          >
            Close
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => {
                // Send notification email
                adminApi.post(`/admin/legal/ccpa-requests/${request.id}/send-notification`, {
                  message: 'Your CCPA request has been processed.',
                });
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition"
            >
              <Mail size={16} />
              Send Email
            </button>
            <button
              onClick={handleSave}
              disabled={updating}
              className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {updating ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AdminCCPARequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [updating, setUpdating] = useState(false);

  // Filters
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('due_soon');
  const [page, setPage] = useState(1);
  const [limit] = useState(25);

  // Stats
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.get('/admin/legal/ccpa-requests', {
        params: {
          status: status || undefined,
          type: type || undefined,
          search: search || undefined,
          sort,
          page,
          limit,
        },
      });
      setRequests(res.data.requests || []);
      setTotalCount(res.data.total || 0);
      setStats(res.data.stats);
    } catch (err) {
      console.error('Failed to load requests:', err);
      setError(err.response?.data?.message || 'Failed to load CCPA requests');
    }
    setLoading(false);
  }, [status, type, search, sort, page, limit]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleDetailClose = () => {
    setSelectedRequest(null);
  };

  const handleStatusChange = () => {
    setUpdating(false);
    loadData();
  };

  const pages = Math.ceil(totalCount / limit);

  // Determine row color based on SLA
  const getRowClass = (request) => {
    const daysRemaining = Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
    if (request.status === 'completed') return 'bg-green-500/10';
    if (daysRemaining < 0) return 'bg-red-500/10';
    if (daysRemaining < 5) return 'bg-yellow-500/10';
    return '';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-white font-bold text-3xl mb-2">CCPA Requests</h1>
          <p className="text-gray-400 text-sm">Manage CCPA data requests with 45-day SLA compliance tracking.</p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="p-2.5 bg-gray-700 border border-gray-600 text-gray-400 rounded-lg hover:text-white transition disabled:opacity-50"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="bg-red-500/20 border border-red-500/50 text-red-300 px-4 py-3 rounded-lg text-sm flex items-start gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Total Requests</p>
            <p className="text-white text-3xl font-bold">{stats.totalRequests}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Pending</p>
            <p className="text-yellow-400 text-3xl font-bold">{stats.pendingRequests}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">This Month</p>
            <p className="text-green-400 text-3xl font-bold">{stats.completedThisMonth}</p>
          </div>

          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <p className="text-gray-400 text-sm mb-2">Avg Response</p>
            <p className="text-white text-3xl font-bold">{stats.avgResponseDays}</p>
            <p className="text-gray-500 text-xs mt-2">days</p>
          </div>
        </div>
      )}

      {/* SLA Tracker */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-green-500/20 border border-green-500/50 rounded-xl p-4">
            <p className="text-green-400 font-semibold text-sm mb-1">On Track</p>
            <p className="text-green-300 text-2xl font-bold">{stats.onTrack}</p>
          </div>

          <div className="bg-yellow-500/20 border border-yellow-500/50 rounded-xl p-4">
            <p className="text-yellow-400 font-semibold text-sm mb-1">Due Within 5 Days</p>
            <p className="text-yellow-300 text-2xl font-bold">{stats.dueWithinFiveDays}</p>
          </div>

          <div className="bg-red-500/20 border border-red-500/50 rounded-xl p-4">
            <p className="text-red-400 font-semibold text-sm mb-1">Overdue</p>
            <p className="text-red-300 text-2xl font-bold">{stats.overdue}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-400" />
          <span className="text-gray-300 font-semibold">Filters & Search</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Search Email</label>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="user@example.com"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {REQUEST_TYPES.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label className="block text-gray-400 text-sm mb-2">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 text-white rounded-lg text-sm focus:outline-none focus:border-orange-500"
            >
              {STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900 border-b border-gray-700">
              <tr>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">REQUEST ID</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">USER EMAIL</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">TYPE</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">SUBMITTED</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">DUE DATE</th>
                <th className="px-6 py-4 text-left text-gray-400 font-semibold">STATUS</th>
                <th className="px-6 py-4 text-center text-gray-400 font-semibold">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {loading ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
                    <div className="flex justify-center">
                      <div className="animate-spin w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full" />
                    </div>
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-gray-400">
                    No CCPA requests found
                  </td>
                </tr>
              ) : (
                requests.map(request => {
                  const daysRemaining = Math.ceil((new Date(request.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
                  return (
                    <tr key={request.id} className={`hover:bg-gray-700/50 transition ${getRowClass(request)}`}>
                      <td className="px-6 py-4 text-gray-300 font-mono text-xs">{request.id}</td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-white">{request.email}</p>
                          <p className="text-gray-500 text-xs">{request.name}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-300 capitalize">
                        {request.type?.replace(/_/g, ' ')}
                      </td>
                      <td className="px-6 py-4 text-gray-300 text-xs">
                        {new Date(request.submittedDate).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs">
                          <p className="text-gray-300">{new Date(request.dueDate).toLocaleDateString()}</p>
                          <p className={`text-xs ${
                            daysRemaining < 0 ? 'text-red-400' :
                            daysRemaining < 5 ? 'text-yellow-400' :
                            'text-gray-500'
                          }`}>
                            {daysRemaining < 0 ? `${Math.abs(daysRemaining)} days overdue` : `${daysRemaining} days left`}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={request.status} />
                      </td>
                      <td className="px-6 py-4 text-center">
                        <button
                          onClick={() => setSelectedRequest(request)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded text-xs transition"
                        >
                          <Eye size={14} />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="bg-gray-900 border-t border-gray-700 px-6 py-4 flex items-center justify-between">
          <p className="text-gray-400 text-sm">
            Showing {(page - 1) * limit + 1} to {Math.min(page * limit, totalCount)} of {totalCount} requests
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
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                return pageNum <= pages ? (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded text-sm transition ${
                      pageNum === page
                        ? 'bg-orange-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {pageNum}
                  </button>
                ) : null;
              })}
              {pages > 5 && <span className="text-gray-400">...</span>}
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
      {selectedRequest && (
        <RequestDetailModal
          request={selectedRequest}
          onClose={handleDetailClose}
          onStatusChange={handleStatusChange}
          updating={updating}
        />
      )}
    </div>
  );
}
