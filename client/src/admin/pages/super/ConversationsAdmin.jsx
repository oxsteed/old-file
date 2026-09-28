import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Search, RefreshCw, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import adminApi from '../../../lib/adminApi';

const STATUS_TABS = ['all', 'active', 'blocked', 'archived'];

function convStatusBadge(status) {
  switch (status) {
    case 'active':   return 'bg-green-500/20 text-green-400';
    case 'blocked':  return 'bg-red-500/20 text-red-400';
    case 'archived': return 'bg-gray-500/20 text-gray-400';
    default:         return 'bg-gray-500/20 text-gray-400';
  }
}

function timeAgo(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── Thread detail panel ──────────────────────────────────────────────────────

function ThreadDetail({ conv, onStatusChange, actionBusy, breakGlassReason }) {
  const [thread,   setThread]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [reason,   setReason]   = useState('');
  const [pendingStatus, setPendingStatus] = useState(null);
  const messagesEndRef = useRef(null);

  const loadThread = useCallback(async () => {
    if (!breakGlassReason || String(breakGlassReason).trim().length < 10) {
      setError('Break-glass reason required (min 10 characters).');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get(`/admin/super/conversations/${conv.id}`, {
        params: { reason: breakGlassReason },
      });
      setThread(data);
    } catch (err) {
      console.error('Failed to load thread:', err);
      setError(err?.response?.data?.error || 'Failed to load thread.');
    } finally {
      setLoading(false);
    }
  }, [conv.id, breakGlassReason]);

  useEffect(() => { loadThread(); }, [loadThread]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length]);

  const handleStatusConfirm = async () => {
    if (!reason.trim()) return;
    await onStatusChange(conv.id, pendingStatus, reason.trim());
    setPendingStatus(null);
    setReason('');
    loadThread();
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!thread) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-500 text-sm p-6 text-center">
        <p>{error || 'Failed to load thread.'}</p>
        <button
          type="button"
          onClick={loadThread}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-gray-200 hover:bg-gray-700 transition"
        >
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    );
  }

  const { conversation, messages } = thread;
  const currentStatus = conversation?.status || conv.status;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Audit banner */}
      <div className="px-5 py-2 bg-yellow-900/30 border-b border-yellow-700/30 flex items-center gap-2">
        <AlertTriangle size={13} className="text-yellow-400 shrink-0" />
        <p className="text-yellow-300 text-xs">
          Break-glass access: reason logged: “{breakGlassReason}”. Telegram cloud-chat model (not E2EE).
        </p>
      </div>

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 bg-gray-900">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-2">
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-base">
              {conv.customer_name} ↔ {conv.helper_name}
            </h2>
            <p className="text-gray-400 text-xs mt-0.5">
              {conv.customer_email} / {conv.helper_email}
              {conv.job_title && (
                <span className="ml-2 text-gray-500">· Job: {conv.job_title}</span>
              )}
            </p>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${convStatusBadge(currentStatus)}`}>
            {currentStatus}
          </span>
        </div>

        {/* Status controls */}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <span className="text-gray-500 text-xs">Set status:</span>
          {['active', 'blocked', 'archived'].map(s => (
            <button
              key={s}
              disabled={actionBusy || currentStatus === s}
              onClick={() => { setPendingStatus(s); setReason(''); }}
              className={`px-2.5 py-1 text-xs rounded-lg transition capitalize
                disabled:opacity-40 ${
                  currentStatus === s
                    ? 'bg-gray-700 text-gray-300 cursor-default'
                    : s === 'blocked'
                      ? 'bg-red-900/40 text-red-400 hover:bg-red-900/70'
                      : s === 'archived'
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-green-900/40 text-green-400 hover:bg-green-900/70'
                }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={loadThread}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition ml-auto"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Inline reason prompt */}
        {pendingStatus && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={`Reason for marking ${pendingStatus}…`}
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg text-white text-xs
                         px-3 py-2 placeholder-gray-500 focus:border-orange-500 focus:outline-none"
              onKeyDown={e => { if (e.key === 'Enter') handleStatusConfirm(); if (e.key === 'Escape') { setPendingStatus(null); setReason(''); } }}
              autoFocus
            />
            <button
              onClick={handleStatusConfirm}
              disabled={!reason.trim() || actionBusy}
              className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-medium
                         rounded-lg transition disabled:opacity-50"
            >
              {actionBusy ? '…' : 'Confirm'}
            </button>
            <button
              onClick={() => { setPendingStatus(null); setReason(''); }}
              className="px-3 py-2 bg-gray-800 text-gray-400 hover:text-white text-xs rounded-lg transition"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages && messages.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">No messages in this thread.</p>
        ) : (messages || []).map(msg => (
          <div key={msg.id} className="flex gap-3">
            <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center
                            text-xs font-bold text-gray-300 shrink-0">
              {(msg.sender_name || '?')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-white text-xs font-medium">{msg.sender_name || 'Unknown'}</span>
                <span className="text-gray-500 text-xs">{msg.sender_email || ''}</span>
                {msg.message_type && msg.message_type !== 'text' && (
                  <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded capitalize">
                    {msg.message_type}
                  </span>
                )}
                <span className="text-gray-600 text-xs ml-auto">{timeAgo(msg.created_at)}</span>
              </div>
              <div className="bg-gray-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-200
                              leading-relaxed whitespace-pre-wrap break-words">
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <LinkedArtifacts thread={thread} />
    </div>
  );
}

// ─── Conversation list item ───────────────────────────────────────────────────

function ConvRow({ conv, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-all
        hover:bg-gray-800/60 ${selected ? 'bg-gray-800/80 border-l-2 border-l-orange-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-white text-sm font-medium truncate">
          {conv.customer_name} ↔ {conv.helper_name}
        </span>
        <span className="text-gray-500 text-xs shrink-0">{timeAgo(conv.last_message_at)}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-500 text-xs truncate max-w-[180px]">
          {conv.customer_email}
        </span>
        <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${convStatusBadge(conv.status)}`}>
          {conv.status}
        </span>
      </div>
      {conv.job_title && (
        <p className="text-gray-600 text-xs mt-0.5 truncate">Job: {conv.job_title}</p>
      )}
      <p className="text-gray-600 text-xs mt-0.5">{conv.message_count} msg{conv.message_count !== 1 ? 's' : ''}</p>
    </button>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function LinkedArtifacts({ thread }) {
  if (!thread) return null;
  const pops = thread.proof_of_payments || [];
  const agreements = thread.agreements || [];
  const quotes = thread.quotes || [];
  const bookings = thread.bookings || [];
  if (!pops.length && !agreements.length && !quotes.length && !bookings.length) return null;
  return (
    <div className="px-5 py-3 border-t border-gray-800 bg-gray-950/60 text-xs text-gray-300 space-y-2">
      <p className="text-gray-400 font-semibold uppercase tracking-wide">Linked artifacts</p>
      {quotes.length > 0 && (
        <div>
          <span className="text-orange-300">Quotes ({quotes.length})</span>
          <ul className="mt-1 space-y-1">
            {quotes.slice(0, 8).map((q) => (
              <li key={`${q.kind}-${q.id}`}>{q.kind} · {q.title || q.id} · {q.status}</li>
            ))}
          </ul>
        </div>
      )}
      {pops.length > 0 && (
        <div>
          <span className="text-orange-300">Proof of payment ({pops.length})</span>
          <ul className="mt-1 space-y-1">
            {pops.slice(0, 8).map((p) => (
              <li key={p.id}>{(p.amount_cents / 100).toFixed(2)} {p.currency} · {p.status}</li>
            ))}
          </ul>
        </div>
      )}
      {agreements.length > 0 && (
        <div>
          <span className="text-orange-300">Agreements ({agreements.length})</span>
          <ul className="mt-1 space-y-1">
            {agreements.slice(0, 8).map((a) => (
              <li key={a.id}>{a.title} · v{a.version} · {a.status}</li>
            ))}
          </ul>
        </div>
      )}
      {bookings.length > 0 && (
        <div>
          <span className="text-orange-300">Bookings ({bookings.length})</span>
          <ul className="mt-1 space-y-1">
            {bookings.slice(0, 8).map((b) => (
              <li key={b.id}>{b.service_name || b.id} · {b.status}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ConversationsAdmin() {
  const [convs,      setConvs]      = useState([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [selected,   setSelected]   = useState(null); // conv object
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [pendingConv, setPendingConv] = useState(null);
  const [reasonDraft, setReasonDraft] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error,      setError]      = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const [search,     setSearch]     = useState('');
  const [statusTab,  setStatusTab]  = useState('all');

  const loadConvs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (search)                           params.search = search;
      if (statusTab && statusTab !== 'all') params.status = statusTab;
      const { data } = await adminApi.get('/admin/super/conversations', { params });
      setConvs(data.conversations || []);
      setTotal(data.total || 0);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setError(err?.response?.data?.error || 'Failed to load conversations.');
      setConvs([]);
    } finally {
      setLoading(false);
    }
  }, [search, statusTab]);

  useEffect(() => { loadConvs(); }, [loadConvs]);

  const handleStatusChange = async (convId, status, reason) => {
    setActionBusy(true);
    try {
      await adminApi.post(`/admin/super/conversations/${convId}/status`, { status, reason });
      setConvs(prev =>
        prev.map(c => c.id === convId ? { ...c, status } : c)
      );
      if (selected?.id === convId) {
        setSelected(prev => ({ ...prev, status }));
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const openConv = (conv) => {
    setPendingConv(conv);
    setReasonDraft('');
  };

  const confirmBreakGlass = () => {
    const reason = reasonDraft.trim();
    if (reason.length < 10) {
      toast.error('Enter a break-glass reason (at least 10 characters).');
      return;
    }
    setBreakGlassReason(reason);
    setSelected(pendingConv);
    setPendingConv(null);
    setShowDetail(true);
  };

  return (
    <div className="flex h-full">
      {/* ── Left panel ── */}
      <div className={`flex flex-col border-r border-gray-800 bg-gray-950
        ${showDetail ? 'hidden md:flex md:w-[360px] lg:w-[400px]' : 'flex-1 md:w-[360px] lg:w-[400px]'}`}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-white font-bold text-lg flex items-center gap-2">
              <MessageSquare size={20} className="text-orange-500" />
              Conversations
            </h1>
            <div className="flex items-center gap-2">
              {lastUpdated && !loading && (
                <span className="hidden lg:inline text-[11px] text-gray-600">
                  Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              )}
              <button
                type="button"
              onClick={loadConvs}
                aria-label={loading ? 'Refreshing conversations' : 'Refresh conversations'}
                title={loading ? 'Refreshing conversations' : 'Refresh conversations'}
                className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition disabled:opacity-50"
                disabled={loading}
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search by name, email…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                         text-sm text-white focus:outline-none focus:border-orange-500 placeholder-gray-500"
            />
          </div>

          {/* Status tabs */}
          <div className="flex gap-1.5 flex-wrap">
            {STATUS_TABS.map(t => (
              <button
                key={t}
                onClick={() => setStatusTab(t)}
                className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition ${
                  statusTab === t
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-3 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200" role="alert">
              <span>{error}</span>
              <button type="button" onClick={loadConvs} className="font-semibold underline underline-offset-2 hover:text-white">
                Try again
              </button>
            </div>
          )}
          {loading && !convs.length ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              <div className="animate-spin w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full mr-2" />
              Loading…
            </div>
          ) : convs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
              <MessageSquare size={32} className="mb-2 text-gray-700" />
              <p className="text-sm">{error ? 'Conversation list unavailable' : 'No conversations found'}</p>
            </div>
          ) : (
            <>
              {convs.map(c => (
                <ConvRow
                  key={c.id}
                  conv={c}
                  selected={selected?.id === c.id}
                  onClick={() => openConv(c)}
                />
              ))}
              <p className="text-center text-xs text-gray-600 py-3">
                Showing {convs.length} of {total}
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className={`flex-1 flex flex-col min-h-0 ${showDetail ? 'flex' : 'hidden md:flex'}`}>
        {selected ? (
          <>
            {/* Mobile back */}
            <div className="md:hidden px-4 py-2 border-b border-gray-800 bg-gray-900">
              <button
                onClick={() => setShowDetail(false)}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition"
              >
                ← Back to list
              </button>
            </div>
            <ThreadDetail
              key={`${selected.id}:${breakGlassReason}`}
              conv={selected}
              onStatusChange={handleStatusChange}
              actionBusy={actionBusy}
              breakGlassReason={breakGlassReason}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
            <MessageSquare size={48} className="mb-3 text-gray-800" />
            <p className="text-sm">Select a conversation to view the thread</p>
          </div>
        )}
      </div>

      {pendingConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-yellow-700/40 bg-gray-900 p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-yellow-300">
              <AlertTriangle size={16} />
              <h2 className="font-semibold text-white">Break-glass access</h2>
            </div>
            <p className="mb-3 text-sm text-gray-400">
              Viewing helper/customer threads requires a logged reason (Telegram cloud-chat model, not E2EE).
            </p>
            <p className="mb-2 text-xs text-gray-500">
              {pendingConv.customer_name} ↔ {pendingConv.helper_name}
            </p>
            <textarea
              className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
              rows={3}
              value={reasonDraft}
              onChange={(e) => setReasonDraft(e.target.value)}
              placeholder="Why do you need access? (min 10 characters)"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300"
                onClick={() => setPendingConv(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-medium text-white"
                onClick={confirmBreakGlass}
              >
                Open with audit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
