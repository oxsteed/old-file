import { useCallback, useEffect, useState } from 'react';
import { Search, Trash2, RotateCcw, AlertCircle } from 'lucide-react';
import adminApi from '../../lib/adminApi';

const TABS = [
  { key: 'bids',    label: 'Bids'    },
  { key: 'reviews', label: 'Reviews' },
];

function RemoveModal({ item, type, onConfirm, onClose }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) { setErr('Reason is required.'); return; }
    setSaving(true);
    setErr('');
    try {
      await onConfirm(item.id, reason.trim());
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Action failed.');
    } finally {
      setSaving(false);
    }
  }

  const title = type === 'bids' ? `Remove bid on "${item.job_title}"` : `Hide review on "${item.job_title}"`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <AlertCircle className="text-red-400 shrink-0" size={20} />
          <h2 className="text-white font-semibold text-lg">{title}</h2>
        </div>

        {type === 'bids' && (
          <div className="bg-gray-800 rounded-lg p-3 mb-4 text-sm text-gray-300">
            <p><span className="text-gray-500">Helper:</span> {item.helper_name} ({item.helper_email})</p>
            <p><span className="text-gray-500">Amount:</span> ${Number(item.amount).toFixed(2)}</p>
            {item.message && <p className="mt-1 italic text-gray-400">"{item.message}"</p>}
          </div>
        )}

        {type === 'reviews' && (
          <div className="bg-gray-800 rounded-lg p-3 mb-4 text-sm text-gray-300">
            <p><span className="text-gray-500">Reviewer:</span> {item.reviewer_name}</p>
            <p><span className="text-gray-500">Reviewee:</span> {item.reviewee_name}</p>
            <p><span className="text-gray-500">Rating:</span> {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</p>
            {item.comment && <p className="mt-1 italic text-gray-400">"{item.comment}"</p>}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="block text-sm text-gray-400 mb-1">
            Reason <span className="text-red-400">*</span>
            <span className="text-gray-500 font-normal"> — logged to audit trail</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:border-orange-500 focus:outline-none resize-none"
            placeholder="Describe why you're removing this content…"
            autoFocus
          />
          {err && <p className="text-red-400 text-sm mt-1">{err}</p>}
          <div className="flex gap-3 mt-4">
            <button type="submit" disabled={saving}
              className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg text-sm font-medium">
              {saving ? 'Removing…' : type === 'reviews' ? 'Hide Review' : 'Remove Bid'}
            </button>
            <button type="button" onClick={onClose}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-2 rounded-lg text-sm font-medium">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ContentRemovals() {
  const [tab, setTab]         = useState('bids');
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage]       = useState(1);
  const [modal, setModal]     = useState(null); // { item, type }
  const [toast, setToast]     = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = { type: tab, page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const { data } = await adminApi.get('/admin/content', { params });
      setItems(data.items || []);
      setTotal(data.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [tab, page, search, statusFilter]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleRemoveBid(bidId, reason) {
    await adminApi.post(`/admin/bids/${bidId}/remove`, { reason });
    showToast('Bid removed and action logged.');
    fetchItems();
  }

  async function handleRemoveReview(reviewId, reason) {
    await adminApi.post(`/admin/reviews/${reviewId}/remove`, { reason });
    showToast('Review hidden and action logged.');
    fetchItems();
  }

  async function handleRestoreReview(reviewId) {
    await adminApi.post(`/admin/reviews/${reviewId}/restore`);
    showToast('Review restored.');
    fetchItems();
  }

  function switchTab(t) {
    setTab(t);
    setPage(1);
    setSearch('');
    setStatusFilter('');
  }

  const pages = Math.ceil(total / 25) || 1;

  return (
    <div className="p-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Content Removals</h1>
        <p className="text-gray-400 text-sm mt-1">
          All removals are logged to the audit trail for super-admin review.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5">
        {TABS.map(t => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.key
                ? 'bg-orange-500 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input type="text" placeholder={`Search ${tab}…`}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:border-orange-500 focus:outline-none" />
        </div>
        {tab === 'bids' && (
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2">
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="removed">Removed</option>
          </select>
        )}
        {tab === 'reviews' && (
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="bg-gray-800 border border-gray-700 rounded-lg text-white text-sm px-3 py-2">
            <option value="">All Reviews</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl overflow-hidden">
        {tab === 'bids' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">Job</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Helper</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Amount</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Status</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Date</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-12">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-12">No bids found.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-white max-w-[200px] truncate">{item.job_title}</td>
                  <td className="px-4 py-3">
                    <p className="text-gray-300">{item.helper_name}</p>
                    <p className="text-gray-500 text-xs">{item.helper_email}</p>
                  </td>
                  <td className="px-4 py-3 text-white">${Number(item.amount).toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.status === 'removed'  ? 'bg-red-500/20 text-red-400' :
                      item.status === 'accepted' ? 'bg-green-500/20 text-green-400' :
                      item.status === 'pending'  ? 'bg-yellow-500/20 text-yellow-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>{item.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {new Date(item.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    {item.status !== 'removed' && (
                      <button onClick={() => setModal({ item, type: 'bids' })}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs font-medium">
                        <Trash2 size={13} /> Remove
                      </button>
                    )}
                    {item.status === 'removed' && (
                      <span className="text-gray-600 text-xs italic">Removed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'reviews' && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">Job</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Reviewer → Reviewee</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Rating</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Comment</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Visible</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-12">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-gray-400 py-12">No reviews found.</td></tr>
              ) : items.map(item => (
                <tr key={item.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                  <td className="px-4 py-3 text-white max-w-[160px] truncate">{item.job_title}</td>
                  <td className="px-4 py-3 text-sm">
                    <p className="text-gray-300">{item.reviewer_name}</p>
                    <p className="text-gray-500 text-xs">→ {item.reviewee_name}</p>
                  </td>
                  <td className="px-4 py-3 text-yellow-400 text-sm">
                    {'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-[200px] truncate text-xs italic">
                    {item.comment || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      item.is_public ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>{item.is_public ? 'Visible' : 'Hidden'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {item.is_public ? (
                      <button onClick={() => setModal({ item, type: 'reviews' })}
                        className="flex items-center gap-1 text-red-400 hover:text-red-300 text-xs font-medium">
                        <Trash2 size={13} /> Hide
                      </button>
                    ) : (
                      <button onClick={() => handleRestoreReview(item.id)}
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs font-medium">
                        <RotateCcw size={13} /> Restore
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-gray-400">{total} total · page {page} of {pages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-700">
              Previous
            </button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="px-3 py-1.5 bg-gray-800 text-gray-300 rounded text-sm disabled:opacity-40 hover:bg-gray-700">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Removal modal */}
      {modal && (
        <RemoveModal
          item={modal.item}
          type={modal.type}
          onConfirm={modal.type === 'bids' ? handleRemoveBid : handleRemoveReview}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
