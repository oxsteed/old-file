import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import adminApi from '../../../lib/adminApi';

export default function ConversationsAdmin() {
  const [list, setList] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [thread, setThread] = useState(null);
  const [threadLoading, setThreadLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminApi.get('/admin/super/conversations', {
        params: { page, limit: 25, status: status || undefined, q: q.trim() || undefined },
      });
      setList(data.conversations || []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load conversations.');
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [page, status, q]);

  useEffect(() => { loadList(); }, [loadList]);

  const openThread = async (id) => {
    setSelectedId(id);
    setThread(null);
    setThreadLoading(true);
    try {
      const { data } = await adminApi.get(`/admin/super/conversations/${id}`);
      setThread(data);
    } catch (e) {
      setThread({ error: e.response?.data?.error || 'Failed to load thread.' });
    } finally {
      setThreadLoading(false);
    }
  };

  const setStatusConv = async (id, newStatus) => {
    const reason = window.prompt('Optional reason:') || '';
    try {
      await adminApi.put(`/admin/super/conversations/${id}/status`, { status: newStatus, reason });
      await loadList();
      if (selectedId === id) openThread(id);
    } catch (e) {
      window.alert(e.response?.data?.error || 'Update failed.');
    }
  };

  return (
    <div className="p-4 sm:p-8 flex flex-col xl:flex-row gap-6 min-h-[70vh]">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-bold text-white mb-2">Conversations</h1>
        <p className="text-gray-400 text-sm mb-4">Super-admin read-only triage. Opens are audit-logged.</p>

        <div className="flex flex-wrap gap-2 mb-4">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
          >
            <option value="">Any status</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
            <option value="blocked">blocked</option>
          </select>
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search message content…"
            className="flex-1 min-w-[180px] max-w-sm px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-white text-sm"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-200">{error}</div>
        )}

        <div className="bg-slate-800/50 border border-slate-700 rounded-xl divide-y divide-slate-700 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-gray-400">No conversations.</div>
          ) : (
            list.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openThread(c.id)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-700/30 ${selectedId === c.id ? 'bg-slate-700/40' : ''}`}
              >
                <div className="text-sm text-white font-medium">
                  {c.customer_name} ↔ {c.helper_name}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {c.status} · {c.message_count} msgs
                  {c.business_name ? ` · ${c.business_name}` : ''}
                </div>
              </button>
            ))
          )}
        </div>

        {total > 25 && (
          <div className="mt-3 flex gap-2 justify-center">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 py-1 text-sm rounded bg-slate-800 text-gray-300 disabled:opacity-40">Prev</button>
            <button type="button" disabled={page * 25 >= total} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 text-sm rounded bg-slate-800 text-gray-300 disabled:opacity-40">Next</button>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 xl:max-w-xl border border-slate-700 rounded-xl bg-slate-900/50 p-4 flex flex-col">
        {!selectedId && (
          <p className="text-gray-500 text-sm">Select a conversation to view messages.</p>
        )}
        {selectedId && threadLoading && (
          <p className="text-gray-400 text-sm">Loading thread…</p>
        )}
        {selectedId && thread?.error && (
          <p className="text-red-400 text-sm">{thread.error}</p>
        )}
        {selectedId && thread?.conversation && (
          <>
            <div className="mb-4 pb-4 border-b border-slate-700">
              <p className="text-white font-semibold text-sm">Thread</p>
              <p className="text-xs text-gray-400 mt-1">
                Status: {thread.conversation.status}
                {thread.conversation.job_id && (
                  <>
                    {' · '}
                    <Link className="text-orange-400 hover:underline" to={`/admin/jobs/${thread.conversation.job_id}`}>
                      Job
                    </Link>
                  </>
                )}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button type="button" onClick={() => setStatusConv(selectedId, 'archived')} className="text-xs px-2 py-1 rounded bg-slate-700 text-gray-200">Archive</button>
                <button type="button" onClick={() => setStatusConv(selectedId, 'blocked')} className="text-xs px-2 py-1 rounded bg-red-900/50 text-red-200">Block</button>
                <button type="button" onClick={() => setStatusConv(selectedId, 'active')} className="text-xs px-2 py-1 rounded bg-green-900/40 text-green-200">Set active</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 max-h-[55vh]">
              {(thread.messages || []).map((m) => (
                <div key={m.id} className="rounded-lg bg-slate-800/80 px-3 py-2 text-sm">
                  <div className="text-xs text-gray-500 mb-1">
                    {m.sender_name} · {new Date(m.created_at).toLocaleString()}
                  </div>
                  <div className="text-gray-200 whitespace-pre-wrap break-words">{m.content}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
