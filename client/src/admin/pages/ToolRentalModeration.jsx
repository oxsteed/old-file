import { useState } from 'react';
import { Wrench, Search, ToggleLeft, ToggleRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../lib/adminApi';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import AdminErrorState from '../lib/AdminErrorState';

const AVAIL_FILTERS = [
  { value: '',          label: 'All'       },
  { value: 'available', label: 'Available' },
  { value: 'hidden',    label: 'Hidden'    },
];

// ─── reason modal ─────────────────────────────────────────────────────────────

function ReasonModal({ tool, onConfirm, onClose, loading }) {
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');

  const handle = () => {
    if (!reason.trim()) { setError('A reason is required.'); return; }
    onConfirm(reason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-bold text-white text-base">
              {tool.is_available ? 'Hide' : 'Show'} Listing
            </h3>
            <p className="text-gray-400 text-sm mt-0.5 truncate max-w-xs">{tool.name}</p>
          </div>
          <button onClick={onClose} disabled={loading} className="text-gray-500 hover:text-white transition p-1">
            <X size={16} />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-300 mb-1.5">
            Reason <span className="text-red-400">*</span>
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder="Explain why this listing is being toggled…"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg text-white text-sm
                       p-2.5 placeholder-gray-500 focus:border-orange-500 focus:outline-none resize-none"
          />
          {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300
                       rounded-lg text-sm font-medium hover:bg-gray-700 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handle}
            disabled={loading || !reason.trim()}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-semibold transition
                        disabled:opacity-50 disabled:cursor-not-allowed text-white
                        ${tool.is_available
                          ? 'bg-red-600 hover:bg-red-700'
                          : 'bg-green-600 hover:bg-green-700'}`}
          >
            {loading ? 'Saving…' : tool.is_available ? 'Hide Listing' : 'Show Listing'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function ToolRentalModeration() {
  const [search,     setSearch]     = useState('');
  const [availFilter, setAvailFilter] = useState('');
  const [page,       setPage]       = useState(1);

  const [toggling,   setToggling]   = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Sequence-guarded + abortable: rapid search/filter paging can no longer
  // clobber the table with a stale response, and a failed fetch surfaces an
  // error panel instead of a misleading "no tool rentals found" empty state.
  const { data, loading, error, reload } = useAbortableFetch(async (signal) => {
    const params = { page };
    if (search)      params.search    = search;
    if (availFilter) params.available = availFilter;
    const { data: res } = await adminApi.get('/admin/tool-rentals', { params, signal });
    return { tools: res.tools || [], total: res.total || 0 };
  }, [search, availFilter, page]);
  const tools = data?.tools || [];
  const total = data?.total || 0;

  const resetPage = (setter) => (val) => { setter(val); setPage(1); };

  const handleToggle = async (reason) => {
    setActionBusy(true);
    try {
      await adminApi.put(`/admin/tool-rentals/${toggling.id}/toggle`, { reason });
      setToggling(null);
      toast.success('Tool listing updated.');
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const col = 'px-4 py-3 text-sm';

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Wrench size={22} className="text-orange-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Tool Rental Moderation</h1>
          <p className="text-gray-400 text-sm mt-0.5">{total} listings</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by name, category, owner…"
            value={search}
            onChange={e => resetPage(setSearch)(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg
                       text-white text-sm placeholder-gray-500 focus:border-orange-500 focus:outline-none"
          />
        </div>
        <div className="flex gap-2">
          {AVAIL_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => resetPage(setAvailFilter)(f.value)}
              className={`px-4 py-1.5 rounded-full text-xs font-semibold transition ${
                availFilter === f.value
                  ? 'bg-orange-500 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left text-gray-400 font-medium px-4 py-3">TOOL</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">OWNER</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">LOCATION</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">RATE</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">STATUS</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">CREATED</th>
                <th className="text-left text-gray-400 font-medium px-4 py-3">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-12">Loading…</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={7} className="py-6 px-4">
                    <AdminErrorState
                      title="Failed to load tool rentals"
                      message={error?.response?.data?.error || 'Could not load tool rentals.'}
                      onRetry={reload}
                    />
                  </td>
                </tr>
              ) : tools.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-12">No tool rentals found.</td>
                </tr>
              ) : tools.map(t => (
                <tr key={t.id} className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors">
                  <td className={`${col} max-w-[200px]`}>
                    <p className="text-white font-medium truncate">{t.name}</p>
                    <p className="text-gray-500 text-xs capitalize">
                      {(t.category || '').replace(/_/g, ' ')}
                      {t.condition && (
                        <span className="ml-1.5 text-gray-600">· {t.condition}</span>
                      )}
                    </p>
                  </td>
                  <td className={col}>
                    <p className="text-gray-300">{t.owner_name || '-'}</p>
                    <p className="text-gray-500 text-xs">{t.owner_email || '-'}</p>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {t.location_city && t.location_state
                      ? `${t.location_city}, ${t.location_state}`
                      : t.location_city || t.location_state || '-'}
                  </td>
                  <td className={`${col} text-white`}>
                    {t.daily_rate != null ? `$${Number(t.daily_rate).toFixed(2)}/day` : '-'}
                  </td>
                  <td className={col}>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                      t.is_available
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {t.is_available ? 'Available' : 'Hidden'}
                    </span>
                  </td>
                  <td className={`${col} text-gray-400`}>
                    {t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}
                  </td>
                  <td className={col}>
                    <button
                      onClick={() => setToggling(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                        t.is_available
                          ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                          : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                      }`}
                    >
                      {t.is_available
                        ? <><ToggleLeft size={13} /> Hide</>
                        : <><ToggleRight size={13} /> Show</>
                      }
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between mt-4 text-sm text-gray-400">
          <span>Page {page} · {total} total</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              ← Prev
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={tools.length < 25}
              className="px-3 py-1 bg-gray-800 border border-gray-700 rounded-lg
                         disabled:opacity-40 hover:bg-gray-700 transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Toggle modal */}
      {toggling && (
        <ReasonModal
          tool={toggling}
          onConfirm={handleToggle}
          onClose={() => !actionBusy && setToggling(null)}
          loading={actionBusy}
        />
      )}
    </div>
  );
}
