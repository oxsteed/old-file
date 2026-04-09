import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import {
  Inbox, MessageSquare, User, Clock, AlertTriangle, CheckCircle,
  ChevronRight, Search, Filter, RefreshCw, Lock, Unlock,
  Send, FileText, Flag, X,
} from 'lucide-react';

// ─── constants ────────────────────────────────────────────────────────────────

const STATUS_LABELS = {
  open:         { label: 'Open',         color: 'bg-blue-500/20 text-blue-300' },
  assigned:     { label: 'Assigned',     color: 'bg-yellow-500/20 text-yellow-300' },
  in_progress:  { label: 'In Progress',  color: 'bg-orange-500/20 text-orange-300' },
  waiting_user: { label: 'Waiting User', color: 'bg-purple-500/20 text-purple-300' },
  resolved:     { label: 'Resolved',     color: 'bg-green-500/20 text-green-300' },
  closed:       { label: 'Closed',       color: 'bg-gray-500/20 text-gray-400' },
};

const PRIORITY_LABELS = {
  urgent: { label: 'Urgent', color: 'bg-red-500/20 text-red-300' },
  high:   { label: 'High',   color: 'bg-orange-500/20 text-orange-300' },
  normal: { label: 'Normal', color: 'bg-gray-500/20 text-gray-400' },
  low:    { label: 'Low',    color: 'bg-gray-600/20 text-gray-500' },
};

function Badge({ map, value }) {
  const cfg = map[value] || { label: value, color: 'bg-gray-500/20 text-gray-400' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ─── stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = 'text-gray-400' }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center gap-3">
      <div className={`p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-2xl font-bold text-white">{value ?? '–'}</p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// ─── ticket list row ──────────────────────────────────────────────────────────

function TicketRow({ ticket, selected, onClick }) {
  const hasUnread = parseInt(ticket.unread_user_replies) > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-all
        hover:bg-gray-800/60 ${selected ? 'bg-gray-800/80 border-l-2 border-l-orange-500' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          {hasUnread && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />}
          <span className="text-white text-sm font-medium truncate">{ticket.subject}</span>
        </div>
        <span className="text-gray-500 text-xs shrink-0">{timeAgo(ticket.created_at)}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-gray-400 text-xs">#{ticket.ticket_number} · {ticket.name}</span>
        <Badge map={STATUS_LABELS} value={ticket.status} />
        <Badge map={PRIORITY_LABELS} value={ticket.priority} />
        {ticket.assignee_id && (
          <span className="text-xs text-gray-500">
            → {ticket.assignee_first} {ticket.assignee_last}
          </span>
        )}
      </div>
    </button>
  );
}

// ─── ticket detail panel ──────────────────────────────────────────────────────

function TicketDetail({ ticketId, currentUserId, isSuper, onUpdated }) {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [reply,      setReply]      = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending,    setSending]    = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const messagesEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await api.get(`/admin/support/tickets/${ticketId}`);
      setData(d);
    } catch { /* ignore */ }
    setLoading(false);
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  const action = async (fn) => {
    setActionBusy(true);
    try { await fn(); await load(); onUpdated(); }
    catch (err) { alert(err?.response?.data?.error || 'Action failed.'); }
    setActionBusy(false);
  };

  const handleClaim = () => action(() =>
    api.post(`/admin/support/tickets/${ticketId}/claim`)
  );
  const handleUnclaim = () => action(() =>
    api.post(`/admin/support/tickets/${ticketId}/unclaim`)
  );
  const handleStatus = (status) => action(() =>
    api.put(`/admin/support/tickets/${ticketId}/status`, { status })
  );
  const handlePriority = (priority) => action(() =>
    api.put(`/admin/support/tickets/${ticketId}/priority`, { priority })
  );
  const handleSend = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/admin/support/tickets/${ticketId}/reply`, {
        content: reply.trim(),
        is_internal: isInternal,
      });
      setReply('');
      await load();
      onUpdated();
    } catch (err) {
      alert(err?.response?.data?.error || 'Failed to send reply.');
    }
    setSending(false);
  };

  if (loading) return (
    <div className="flex-1 flex items-center justify-center text-gray-500">
      <div className="animate-spin w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full" />
    </div>
  );
  if (!data) return (
    <div className="flex-1 flex items-center justify-center text-gray-500">
      Failed to load ticket.
    </div>
  );

  const { ticket, messages } = data;
  const isMine = ticket.assigned_to === currentUserId;
  const isClosed = ['resolved', 'closed'].includes(ticket.status);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 bg-gray-900">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-white font-semibold text-base leading-tight truncate">
              {ticket.subject}
            </h2>
            <p className="text-gray-400 text-xs mt-0.5">
              #{ticket.ticket_number} · {ticket.name} &lt;{ticket.email}&gt;
              {ticket.user_first && ` · registered as ${ticket.user_first} ${ticket.user_last}`}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Badge map={STATUS_LABELS} value={ticket.status} />
            <Badge map={PRIORITY_LABELS} value={ticket.priority} />
          </div>
        </div>

        {/* Actions row */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {/* Claim / unclaim */}
          {!isClosed && !ticket.assigned_to && (
            <button
              onClick={handleClaim}
              disabled={actionBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 hover:bg-orange-700
                         text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
            >
              <Lock size={12} /> Claim ticket
            </button>
          )}
          {!isClosed && ticket.assigned_to && (isMine || isSuper) && (
            <button
              onClick={handleUnclaim}
              disabled={actionBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600
                         text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
            >
              <Unlock size={12} /> Unclaim
            </button>
          )}
          {!isClosed && ticket.assigned_to && !isMine && isSuper && (
            <button
              onClick={handleClaim}
              disabled={actionBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600
                         text-white text-xs font-medium rounded-lg transition disabled:opacity-50"
            >
              <Lock size={12} /> Take over
            </button>
          )}

          {/* Status quick-set */}
          {!isClosed && (
            <>
              <button
                onClick={() => handleStatus('waiting_user')}
                disabled={actionBusy || ticket.status === 'waiting_user'}
                className="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs
                           rounded-lg transition disabled:opacity-40"
              >
                Waiting user
              </button>
              <button
                onClick={() => handleStatus('resolved')}
                disabled={actionBusy}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-green-900/50 hover:bg-green-900
                           text-green-300 text-xs rounded-lg transition disabled:opacity-40"
              >
                <CheckCircle size={11} /> Resolve
              </button>
              <button
                onClick={() => handleStatus('closed')}
                disabled={actionBusy}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700
                           text-gray-400 text-xs rounded-lg transition disabled:opacity-40"
              >
                <X size={11} /> Close
              </button>
            </>
          )}
          {isClosed && isSuper && (
            <button
              onClick={() => handleStatus('open')}
              disabled={actionBusy}
              className="px-2.5 py-1.5 bg-blue-900/50 hover:bg-blue-900 text-blue-300 text-xs
                         rounded-lg transition disabled:opacity-40"
            >
              Re-open
            </button>
          )}

          {/* Priority */}
          <select
            value={ticket.priority}
            onChange={e => handlePriority(e.target.value)}
            disabled={actionBusy}
            className="px-2 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-xs
                       rounded-lg focus:outline-none focus:border-orange-500 disabled:opacity-40"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>

          <button
            onClick={load}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {ticket.assignee_id && (
          <p className="text-xs text-gray-500 mt-2">
            Assigned to: {ticket.assignee_first} {ticket.assignee_last}
            {ticket.first_response_at && ` · First response: ${timeAgo(ticket.first_response_at)}`}
          </p>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.is_from_admin ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0
              ${msg.is_from_admin ? 'bg-orange-600 text-white' : 'bg-gray-700 text-gray-300'}`}
            >
              {msg.sender_name?.[0]?.toUpperCase() || '?'}
            </div>
            <div className={`max-w-[75%] ${msg.is_from_admin ? 'items-end' : 'items-start'} flex flex-col`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500">{msg.sender_name || 'Unknown'}</span>
                {msg.is_internal && (
                  <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                    Internal note
                  </span>
                )}
                <span className="text-xs text-gray-600">{timeAgo(msg.created_at)}</span>
              </div>
              <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap
                ${msg.is_internal
                  ? 'bg-yellow-900/20 border border-yellow-800/40 text-yellow-200'
                  : msg.is_from_admin
                    ? 'bg-orange-600 text-white rounded-tr-sm'
                    : 'bg-gray-800 text-gray-200 rounded-tl-sm'
                }`}
              >
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply box */}
      {(!isClosed || isSuper) && (
        <div className="border-t border-gray-800 px-5 py-4 bg-gray-900">
          {/* Internal note toggle */}
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setIsInternal(false)}
              className={`text-xs px-2.5 py-1 rounded-lg transition
                ${!isInternal ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              <MessageSquare size={11} className="inline mr-1" />Reply to user
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`text-xs px-2.5 py-1 rounded-lg transition
                ${isInternal ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
            >
              <FileText size={11} className="inline mr-1" />Internal note
            </button>
          </div>
          <form onSubmit={handleSend} className="flex gap-2">
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder={isInternal ? 'Add a private note (admins only)…' : 'Type a reply…'}
              rows={3}
              style={{ resize: 'none' }}
              className={`flex-1 bg-gray-800 border rounded-xl px-3 py-2.5 text-white text-sm
                focus:outline-none placeholder-gray-500 transition
                ${isInternal ? 'border-yellow-700 focus:border-yellow-500' : 'border-gray-700 focus:border-orange-500'}`}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(e);
              }}
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="self-end px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white
                         rounded-xl transition disabled:opacity-50 shrink-0"
            >
              {sending ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
          <p className="text-xs text-gray-600 mt-1.5">Cmd+Enter to send</p>
        </div>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function SupportTickets() {
  const { user } = useAuth();
  const isSuper = user?.role === 'super_admin';

  const [tickets,     setTickets]     = useState([]);
  const [stats,       setStats]       = useState(null);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [showDetail,  setShowDetail]  = useState(false);

  // Filters
  const [search,   setSearch]   = useState('');
  const [status,   setStatus]   = useState('');
  const [priority, setPriority] = useState('');
  const [assigned, setAssigned] = useState('');

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search)   params.search   = search;
      if (status)   params.status   = status;
      if (priority) params.priority = priority;
      if (assigned) params.assigned = assigned;

      const [tRes, sRes] = await Promise.all([
        api.get('/admin/support/tickets', { params }),
        api.get('/admin/support/stats'),
      ]);
      setTickets(tRes.data.tickets);
      setTotal(tRes.data.total);
      setStats(sRes.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [search, status, priority, assigned]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // Listen for real-time admin events
  useEffect(() => {
    const handler = (e) => {
      if (e.detail && ['support:new_ticket', 'support:ticket_updated',
                        'support:ticket_claimed', 'support:user_reply'].includes(e.detail.event)) {
        loadTickets();
      }
    };
    window.addEventListener('socket:event', handler);
    return () => window.removeEventListener('socket:event', handler);
  }, [loadTickets]);

  const openTicket = (ticket) => {
    setSelected(ticket.id);
    setShowDetail(true);
  };

  const totalOpen = stats
    ? (stats.by_status.open || 0) + (stats.by_status.assigned || 0) + (stats.by_status.in_progress || 0)
    : null;

  return (
    <div className="flex h-full">
      {/* ── Left panel: list + filters ── */}
      <div className={`flex flex-col border-r border-gray-800 bg-gray-950
        ${showDetail ? 'hidden md:flex md:w-[360px] lg:w-[400px]' : 'flex-1 md:w-[360px] lg:w-[400px]'}`}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-white font-bold text-lg flex items-center gap-2">
              <Inbox size={20} className="text-orange-500" />
              Support Inbox
              {stats?.unassigned > 0 && (
                <span className="text-xs bg-orange-500 text-white px-1.5 py-0.5 rounded-full">
                  {stats.unassigned} new
                </span>
              )}
            </h1>
            <button
              onClick={loadTickets}
              className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="text-center bg-gray-800/60 rounded-lg py-2">
                <p className="text-lg font-bold text-white">{totalOpen}</p>
                <p className="text-xs text-gray-500">Open</p>
              </div>
              <div className="text-center bg-gray-800/60 rounded-lg py-2">
                <p className="text-lg font-bold text-orange-400">{stats.my_open}</p>
                <p className="text-xs text-gray-500">Mine</p>
              </div>
              <div className="text-center bg-gray-800/60 rounded-lg py-2">
                <p className="text-lg font-bold text-blue-400">{stats.unassigned}</p>
                <p className="text-xs text-gray-500">Unassigned</p>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search tickets, names, emails…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg
                         text-sm text-white focus:outline-none focus:border-orange-500 placeholder-gray-500"
            />
          </div>

          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 bg-gray-800 border border-gray-700 text-gray-300
                         text-xs rounded-lg focus:outline-none focus:border-orange-500"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="waiting_user">Waiting User</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 bg-gray-800 border border-gray-700 text-gray-300
                         text-xs rounded-lg focus:outline-none focus:border-orange-500"
            >
              <option value="">All priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
            <select
              value={assigned}
              onChange={e => setAssigned(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1.5 bg-gray-800 border border-gray-700 text-gray-300
                         text-xs rounded-lg focus:outline-none focus:border-orange-500"
            >
              <option value="">All agents</option>
              <option value="me">Mine</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>

        {/* Ticket list */}
        <div className="flex-1 overflow-y-auto">
          {loading && !tickets.length ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              <div className="animate-spin w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full mr-2" />
              Loading…
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-500">
              <CheckCircle size={32} className="mb-2 text-gray-700" />
              <p className="text-sm">No tickets found</p>
            </div>
          ) : (
            <>
              {tickets.map(t => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  selected={selected === t.id}
                  onClick={() => openTicket(t)}
                />
              ))}
              <p className="text-center text-xs text-gray-600 py-3">
                Showing {tickets.length} of {total}
              </p>
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: ticket detail ── */}
      <div className={`flex-1 flex flex-col min-h-0 ${showDetail ? 'flex' : 'hidden md:flex'}`}>
        {selected ? (
          <>
            {/* Mobile back button */}
            <div className="md:hidden px-4 py-2 border-b border-gray-800 bg-gray-900">
              <button
                onClick={() => setShowDetail(false)}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition"
              >
                ← Back to inbox
              </button>
            </div>
            <TicketDetail
              key={selected}
              ticketId={selected}
              currentUserId={user?.id}
              isSuper={isSuper}
              onUpdated={loadTickets}
            />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
            <Inbox size={48} className="mb-3 text-gray-800" />
            <p className="text-sm">Select a ticket to view the conversation</p>
          </div>
        )}
      </div>
    </div>
  );
}
