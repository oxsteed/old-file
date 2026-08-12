import { useState, useEffect, useCallback, useRef } from 'react';
import adminApi from '../../lib/adminApi';
import { useAuth } from '../../hooks/useAuth';
import { useSocket } from '../../hooks/useSocket';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Inbox,
  MessageSquare,
  User,
  Clock,
  AlertTriangle,
  CheckCircle,
  Search,
  RefreshCw,
  Lock,
  Unlock,
  Send,
  FileText,
  Users,
  BookOpen,
  Settings,
  BarChart3,
  AlertCircle,
  TrendingUp,
  Layers,
  Flag,
  Filter,
  ChevronRight,
  X,
} from 'lucide-react';

const STATUS_LABELS = {
  open: { label: 'Open', color: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  assigned: { label: 'Assigned', color: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/25' },
  in_progress: { label: 'In Progress', color: 'bg-orange-500/15 text-orange-300 border-orange-500/25' },
  waiting_user: { label: 'Waiting User', color: 'bg-purple-500/15 text-purple-300 border-purple-500/25' },
  resolved: { label: 'Resolved', color: 'bg-green-500/15 text-green-300 border-green-500/25' },
  closed: { label: 'Closed', color: 'bg-gray-500/15 text-gray-400 border-gray-500/20' },
};

const PRIORITY_LABELS = {
  urgent: { label: 'Urgent', color: 'bg-red-500/15 text-red-300 border-red-500/25' },
  high: { label: 'High', color: 'bg-orange-500/15 text-orange-300 border-orange-500/25' },
  normal: { label: 'Normal', color: 'bg-gray-500/15 text-gray-300 border-gray-500/20' },
  low: { label: 'Low', color: 'bg-slate-500/15 text-slate-400 border-slate-500/20' },
};

const SUPPORT_TOOLS = [
  { label: 'Agent Dashboard', to: '/admin/support/agent-dashboard', icon: Users },
  { label: 'Agents', to: '/admin/support/agents', icon: Users },
  { label: 'Onboarding', to: '/admin/support/agent-onboarding', icon: User },
  { label: 'Shifts', to: '/admin/support/shifts', icon: Clock },
  { label: 'Live Chat', to: '/admin/support/chat', icon: MessageSquare },
  { label: 'Knowledge Base', to: '/admin/support/kb', icon: BookOpen },
  { label: 'Templates', to: '/admin/support/templates', icon: FileText },
  { label: 'Metrics', to: '/admin/support/metrics', icon: BarChart3 },
  { label: 'SLA', to: '/admin/support/sla', icon: AlertCircle },
  { label: 'Performance', to: '/admin/support/performance', icon: TrendingUp },
  { label: 'CSAT', to: '/admin/support/csat', icon: BarChart3 },
  { label: 'Escalations', to: '/admin/support/escalations', icon: AlertTriangle },
  { label: 'Hierarchy', to: '/admin/support/team-hierarchy', icon: Layers },
  { label: 'Settings', to: '/admin/support/settings', icon: Settings },
  { label: 'Audit', to: '/admin/support/audit', icon: FileText },
];

function Badge({ map, value }) {
  const cfg = map[value] || { label: value, color: 'bg-gray-500/15 text-gray-400 border-gray-500/20' };
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatCard({ icon: Icon, label, value, tone = 'text-gray-300', detail }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/85 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.01)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{label}</div>
        <div className={`rounded-xl bg-gray-800 p-2 ${tone}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className={`text-2xl font-semibold ${tone}`}>{value ?? '–'}</div>
      <div className="mt-1 text-sm text-gray-500">{detail}</div>
    </div>
  );
}

function MiniStat({ label, value, tone = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3">
      <div className={`text-lg font-semibold ${tone}`}>{value ?? '–'}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.16em] text-gray-500">{label}</div>
    </div>
  );
}

function EmptyState({ title, body, icon: Icon = Inbox }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 text-gray-500">
        <Icon size={28} />
      </div>
      <div className="text-base font-medium text-gray-200">{title}</div>
      <div className="mt-2 max-w-md text-sm leading-6 text-gray-500">{body}</div>
    </div>
  );
}

function DetailPlaceholder({ total, unassigned, mine, onNavigate }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-[28px] border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
            <MessageSquare size={15} />
            Conversation Workspace
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Your support team's active workbench</h2>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            Select a ticket from the queue to review the conversation, claim ownership, update priority, and reply to the customer. When the queue is quiet, this space becomes your operational overview.
          </p>
        </div>

        <div className="grid min-w-[240px] grid-cols-3 gap-3">
          <MiniStat label="Queue" value={total} />
          <MiniStat label="Unassigned" value={unassigned} tone="text-blue-300" />
          <MiniStat label="Mine" value={mine} tone="text-orange-300" />
        </div>
      </div>

      <div className="mt-6 grid flex-1 min-h-0 grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[24px] border border-gray-800 bg-gray-950/70 p-5">
          <div className="text-sm font-medium text-white">When a new ticket arrives</div>
          <div className="mt-4 space-y-3">
            {[
              'Scan the queue for urgency, waiting-user tickets, and unassigned conversations.',
              'Claim the ticket, set the right priority, and move it into a clear owner workflow.',
              'Reply to the customer or leave an internal note so the next agent has context.',
            ].map((step, index) => (
              <div key={step} className="flex gap-3 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-sm font-semibold text-orange-300">
                  {index + 1}
                </div>
                <div className="text-sm leading-6 text-gray-400">{step}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[24px] border border-gray-800 bg-gray-950/70 p-5">
          <div className="text-sm font-medium text-white">Jump to support operations</div>
          <div className="mt-1 text-xs text-gray-500">Use these when you are not actively in a conversation.</div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {SUPPORT_TOOLS.slice(0, 6).map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.to}
                  onClick={() => onNavigate(item.to)}
                  className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-left transition hover:border-orange-500/40 hover:bg-gray-900"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-gray-800 p-2 text-gray-300">
                      <Icon size={14} />
                    </div>
                    <div className="text-sm font-medium text-gray-200">{item.label}</div>
                  </div>
                  <ChevronRight size={14} className="text-gray-600" />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketRow({ ticket, selected, onClick }) {
  const hasUnread = parseInt(ticket.unread_user_replies, 10) > 0;
  const preview = ticket.latest_message_preview || ticket.message_preview || ticket.description || '';

  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        selected
          ? 'border-orange-500/50 bg-orange-500/8 shadow-[0_0_0_1px_rgba(249,115,22,0.15)]'
          : 'border-gray-800 bg-gray-900/70 hover:border-gray-700 hover:bg-gray-900'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {hasUnread && <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shadow-[0_0_12px_rgba(249,115,22,0.55)]" />}
            <span className="truncate text-sm font-semibold text-white">{ticket.subject}</span>
          </div>
          <div className="mt-1 text-xs text-gray-500">
            #{ticket.ticket_number} · {ticket.name || ticket.email}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs text-gray-500">{timeAgo(ticket.created_at)}</div>
          {ticket.assignee_id && (
            <div className="mt-1 text-[11px] text-gray-600">
              {ticket.assignee_first} {ticket.assignee_last}
            </div>
          )}
        </div>
      </div>

      {preview && (
        <div className="mb-3 max-h-[3.2rem] overflow-hidden text-sm leading-6 text-gray-400">
          {preview}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge map={STATUS_LABELS} value={ticket.status} />
        <Badge map={PRIORITY_LABELS} value={ticket.priority} />
        {ticket.category && (
          <span className="rounded-full border border-gray-700 bg-gray-800/70 px-2.5 py-1 text-xs text-gray-400">
            {ticket.category}
          </span>
        )}
      </div>
    </button>
  );
}

function TicketDetail({ ticketId, currentUserId, isSuper, onUpdated }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const messagesEndRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await adminApi.get(`/admin/support/tickets/${ticketId}`);
      setData(d);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages?.length]);

  const action = async (fn) => {
    setActionBusy(true);
    try {
      await fn();
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Action failed.');
    } finally {
      setActionBusy(false);
    }
  };

  const handleClaim = () => action(() => adminApi.post(`/admin/support/tickets/${ticketId}/claim`));
  const handleUnclaim = () => action(() => adminApi.post(`/admin/support/tickets/${ticketId}/unclaim`));
  const handleStatus = (status) => action(() => adminApi.put(`/admin/support/tickets/${ticketId}/status`, { status }));
  const handlePriority = (priority) => action(() => adminApi.put(`/admin/support/tickets/${ticketId}/priority`, { priority }));

  const handleSend = async (event) => {
    event.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      await adminApi.post(`/admin/support/tickets/${ticketId}/reply`, {
        content: reply.trim(),
        is_internal: isInternal,
      });
      setReply('');
      await load();
      onUpdated();
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to send reply.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-gray-500">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        title="Ticket details unavailable"
        body="This conversation could not be loaded right now. Refresh the inbox or reopen the ticket."
        icon={AlertTriangle}
      />
    );
  }

  const { ticket, messages } = data;
  const isMine = ticket?.assigned_to === currentUserId;
  const isClosed = ticket && ['resolved', 'closed'].includes(ticket.status);

  return (
    <div className="flex flex-1 flex-col overflow-hidden rounded-[28px] border border-gray-800 bg-gray-950/80">
      <div className="border-b border-gray-800 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge map={STATUS_LABELS} value={ticket.status} />
              <Badge map={PRIORITY_LABELS} value={ticket.priority} />
              {ticket.category && (
                <span className="rounded-full border border-gray-700 bg-gray-800/70 px-2.5 py-1 text-xs text-gray-400">
                  {ticket.category}
                </span>
              )}
            </div>
            <h2 className="mt-3 text-xl font-semibold text-white">{ticket.subject}</h2>
            <p className="mt-2 text-sm text-gray-400">
              #{ticket.ticket_number} · {ticket.name} &lt;{ticket.email}&gt;
              {ticket.user_first && ` · registered as ${ticket.user_first} ${ticket.user_last}`}
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
              <span>Opened {timeAgo(ticket.created_at)}</span>
              {ticket.first_response_at && <span>First response {timeAgo(ticket.first_response_at)}</span>}
              {ticket.assignee_id && <span>Assigned to {ticket.assignee_first} {ticket.assignee_last}</span>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!isClosed && !ticket.assigned_to && (
              <button
                onClick={handleClaim}
                disabled={actionBusy}
                className="flex items-center gap-1.5 rounded-xl bg-orange-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-orange-700 disabled:opacity-50"
              >
                <Lock size={12} /> Claim
              </button>
            )}
            {!isClosed && ticket.assigned_to && (isMine || isSuper) && (
              <button
                onClick={handleUnclaim}
                disabled={actionBusy}
                className="flex items-center gap-1.5 rounded-xl bg-gray-800 px-3 py-2 text-xs font-medium text-gray-200 transition hover:bg-gray-700 disabled:opacity-50"
              >
                <Unlock size={12} /> Unclaim
              </button>
            )}
            {!isClosed && ticket.assigned_to && !isMine && isSuper && (
              <button
                onClick={handleClaim}
                disabled={actionBusy}
                className="flex items-center gap-1.5 rounded-xl bg-purple-700 px-3 py-2 text-xs font-medium text-white transition hover:bg-purple-600 disabled:opacity-50"
              >
                <Lock size={12} /> Take over
              </button>
            )}
            <button
              onClick={load}
              className="rounded-xl border border-gray-700 bg-gray-900 p-2 text-gray-400 transition hover:border-gray-600 hover:text-white"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!isClosed && (
            <>
              <button
                onClick={() => handleStatus('waiting_user')}
                disabled={actionBusy || ticket.status === 'waiting_user'}
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300 transition hover:border-gray-600 hover:bg-gray-800 disabled:opacity-40"
              >
                Waiting user
              </button>
              <button
                onClick={() => handleStatus('resolved')}
                disabled={actionBusy}
                className="flex items-center gap-1 rounded-xl bg-green-500/15 px-3 py-2 text-xs text-green-300 transition hover:bg-green-500/20 disabled:opacity-40"
              >
                <CheckCircle size={11} /> Resolve
              </button>
              <button
                onClick={() => handleStatus('closed')}
                disabled={actionBusy}
                className="flex items-center gap-1 rounded-xl bg-gray-800 px-3 py-2 text-xs text-gray-400 transition hover:bg-gray-700 disabled:opacity-40"
              >
                <X size={11} /> Close
              </button>
            </>
          )}

          {isClosed && isSuper && (
            <button
              onClick={() => handleStatus('open')}
              disabled={actionBusy}
              className="rounded-xl bg-blue-500/15 px-3 py-2 text-xs text-blue-300 transition hover:bg-blue-500/20 disabled:opacity-40"
            >
              Re-open
            </button>
          )}

          <select
            value={ticket.priority}
            onChange={(event) => handlePriority(event.target.value)}
            disabled={actionBusy}
            className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300 focus:border-orange-500 focus:outline-none disabled:opacity-40"
          >
            <option value="low">Low priority</option>
            <option value="normal">Normal priority</option>
            <option value="high">High priority</option>
            <option value="urgent">Urgent priority</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.05),transparent_30%),linear-gradient(to_bottom,rgba(17,24,39,0.55),rgba(2,6,23,0.1))] px-6 py-5">
        <div className="space-y-5">
          {messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.is_from_admin ? 'justify-end' : 'justify-start'}`}>
              {!msg.is_from_admin && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-gray-800 text-xs font-bold text-gray-300">
                  {msg.sender_name?.[0]?.toUpperCase() || '?'}
                </div>
              )}

              <div className={`max-w-[82%] ${msg.is_from_admin ? 'items-end' : 'items-start'} flex flex-col`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span>{msg.sender_name || 'Unknown'}</span>
                  {msg.is_internal && (
                    <span className="rounded-full border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-yellow-300">
                      Internal note
                    </span>
                  )}
                  <span>{timeAgo(msg.created_at)}</span>
                </div>

                <div
                  className={`whitespace-pre-wrap rounded-3xl px-4 py-3 text-sm leading-7 ${
                    msg.is_internal
                      ? 'border border-yellow-800/40 bg-yellow-900/20 text-yellow-100'
                      : msg.is_from_admin
                        ? 'rounded-tr-md bg-orange-600 text-white'
                        : 'rounded-tl-md border border-gray-800 bg-gray-900 text-gray-200'
                  }`}
                >
                  {msg.content}
                </div>
              </div>

              {msg.is_from_admin && (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-orange-600 text-xs font-bold text-white">
                  {msg.sender_name?.[0]?.toUpperCase() || 'A'}
                </div>
              )}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {(!isClosed || isSuper) && (
        <div className="border-t border-gray-800 bg-gray-950 px-6 py-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsInternal(false)}
              className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                !isInternal ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <MessageSquare size={11} className="mr-1 inline" />
              Reply to user
            </button>
            <button
              onClick={() => setIsInternal(true)}
              className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                isInternal ? 'bg-yellow-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <FileText size={11} className="mr-1 inline" />
              Internal note
            </button>
          </div>

          <form onSubmit={handleSend} className="flex gap-3">
            <textarea
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              placeholder={isInternal ? 'Add a private note for the support team…' : 'Write a reply to the customer…'}
              rows={4}
              style={{ resize: 'none' }}
              className={`flex-1 rounded-2xl border bg-gray-900 px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none ${
                isInternal ? 'border-yellow-700 focus:border-yellow-500' : 'border-gray-700 focus:border-orange-500'
              }`}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) handleSend(event);
              }}
            />
            <button
              type="submit"
              disabled={sending || !reply.trim()}
              className="self-end rounded-2xl bg-orange-600 px-4 py-3 text-white transition hover:bg-orange-700 disabled:opacity-50"
            >
              {sending ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Send size={16} />
              )}
            </button>
          </form>
          <div className="mt-2 text-xs text-gray-600">Cmd/Ctrl + Enter to send</div>
        </div>
      )}
    </div>
  );
}

export default function SupportTickets() {
  const { user } = useAuth();
  const { socket } = useSocket();
  const navigate = useNavigate();
  const isSuper = user?.role === 'super_admin';

  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [assigned, setAssigned] = useState('');
  const [availability, setAvailability] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (status) params.status = status;
      if (priority) params.priority = priority;
      if (assigned) params.assigned = assigned;

      const [ticketResponse, statsResponse] = await Promise.all([
        adminApi.get('/admin/support/tickets', { params }),
        adminApi.get('/admin/support/stats'),
      ]);

      setTickets(ticketResponse.data.tickets || []);
      setTotal(ticketResponse.data.total || 0);
      setStats(statsResponse.data || null);
    } catch {
      setTickets([]);
      setStats(null);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, status, priority, assigned]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

const loadAvailability = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/admin/support/availability');
      setAvailability(data?.is_available_for_support ?? false);
    } catch {
      setAvailability(null);
    }
  }, []);
  useEffect(() => { loadAvailability(); }, [loadAvailability]);
  const toggleAvailability = async () => {
    setAvailabilityBusy(true);
    try {
      const nextValue = !availability;
      const { data } = await adminApi.put('/admin/support/availability', { is_available_for_support: nextValue });
      setAvailability(data?.is_available_for_support ?? nextValue);
      toast.success(nextValue ? 'You are now available for support.' : 'You are now unavailable for support.');
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update availability.');
    } finally {
      setAvailabilityBusy(false);
    }
  };
  useEffect(() => {
    if (!socket) return undefined;
    const events = ['support:new_ticket', 'support:ticket_updated', 'support:ticket_claimed', 'support:user_reply'];
    const handler = () => loadTickets();
    events.forEach((eventName) => socket.on(eventName, handler));
    return () => events.forEach((eventName) => socket.off(eventName, handler));
  }, [socket, loadTickets]);

  const openTicket = (ticket) => {
    setSelected(ticket.id);
    setShowDetail(true);
  };

  const totalOpen = stats
    ? (stats.by_status?.open || 0) + (stats.by_status?.assigned || 0) + (stats.by_status?.in_progress || 0)
    : null;

  const activeFilterCount = [search, status, priority, assigned].filter(Boolean).length;

  return (
    <div className="h-full overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.07),transparent_22%),linear-gradient(180deg,#030712_0%,#0b1120_100%)] p-4 md:p-6">
      <div className="flex h-full flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_0.75fr]">
          <div className="rounded-[28px] border border-gray-800 bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2 text-sm font-medium text-orange-300">
                  <Inbox size={15} />
                  Support Command Center
                </div>
                <h1 className="mt-2 text-2xl font-semibold text-white">Admin support inbox</h1>
                <p className="mt-3 text-sm leading-6 text-gray-400">
                  Review incoming customer issues, claim ownership fast, and move conversations from first response to resolution with clearer operational context.
                </p>
              </div>

              <div className="flex items-center gap-2 self-start">
                <button
                  onClick={loadTickets}
                  className="flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              <button
                onClick={toggleAvailability}
                disabled={availabilityBusy || availability === null}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  availability
                    ? 'border-green-600/40 bg-green-500/15 text-green-300 hover:bg-green-500/20'
                    : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600 hover:text-white'
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${availability ? 'bg-green-400' : 'bg-gray-600'}`} />
                {availability ? 'Available for support' : 'Unavailable for support'}
              </button>
                {stats?.unassigned > 0 && (
                  <div className="rounded-full bg-orange-500 px-3 py-1 text-xs font-medium text-white">
                    {stats.unassigned} unassigned
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard
                icon={Inbox}
                label="Open queue"
                value={totalOpen}
                tone="text-white"
                detail="Open, assigned, and in-progress tickets."
              />
              <StatCard
                icon={User}
                label="My tickets"
                value={stats?.my_open ?? '–'}
                tone="text-orange-300"
                detail="Conversations currently owned by you."
              />
              <StatCard
                icon={AlertTriangle}
                label="Unassigned"
                value={stats?.unassigned ?? '–'}
                tone="text-blue-300"
                detail="Tickets waiting for first owner assignment."
              />
              <StatCard
                icon={CheckCircle}
                label="Resolved today"
                value={stats?.resolved_today ?? stats?.today_resolved ?? '–'}
                tone="text-green-300"
                detail="Resolved volume if provided by the stats endpoint."
              />
            </div>
          </div>

          <div className="rounded-[28px] border border-gray-800 bg-gray-950/90 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Quick routes</div>
                <div className="mt-1 text-xs text-gray-500">Fast access to the rest of support ops.</div>
              </div>
              <Flag size={15} className="text-gray-600" />
            </div>
            <div className="grid grid-cols-1 gap-2">
              {SUPPORT_TOOLS.slice(0, 6).map((item) => {
                const Icon = item.icon;
                return (
                <button
                  key={item.to}
                  onClick={() => navigate(item.to)}
                  className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-left transition hover:border-orange-500/40 hover:bg-gray-900"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-xl bg-gray-800 p-2 text-gray-300">
                      <Icon size={14} />
                    </div>
                    <div className="text-sm font-medium text-gray-200">{item.label}</div>
                  </div>
                  <ChevronRight size={14} className="text-gray-600" />
                </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className={`${showDetail ? 'hidden xl:flex' : 'flex'} min-h-0 flex-col rounded-[28px] border border-gray-800 bg-gray-950/90`}>
            <div className="border-b border-gray-800 px-5 py-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-white">Inbox queue</div>
                  <div className="mt-1 text-sm text-gray-500">
                    {total} ticket{total === 1 ? '' : 's'} matching the current view.
                  </div>
                </div>
                <div className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-400">
                  {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/80 p-3">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search by subject, ticket #, name, or email"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full rounded-xl border border-gray-700 bg-gray-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
                  <Filter size={12} />
                  Filter the queue to focus on ownership, urgency, or waiting states.
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 focus:border-orange-500 focus:outline-none"
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
                    onChange={(event) => setPriority(event.target.value)}
                    className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 focus:border-orange-500 focus:outline-none"
                  >
                    <option value="">All priorities</option>
                    <option value="urgent">Urgent</option>
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <select
                    value={assigned}
                    onChange={(event) => setAssigned(event.target.value)}
                    className="rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-xs text-gray-300 focus:border-orange-500 focus:outline-none"
                  >
                    <option value="">All agents</option>
                    <option value="me">Mine</option>
                    <option value="unassigned">Unassigned</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading && !tickets.length ? (
                <div className="flex h-32 items-center justify-center text-sm text-gray-500">
                  <div className="mr-2 h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
                  Loading support inbox…
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-[24px] border border-dashed border-gray-800 bg-gray-900/40 px-6 text-center">
                  <div className="mb-4 rounded-2xl border border-gray-800 bg-gray-900 p-4 text-gray-500">
                    <CheckCircle size={28} />
                  </div>
                  <div className="text-base font-medium text-gray-200">No tickets match this view</div>
                  <div className="mt-2 max-w-sm text-sm leading-6 text-gray-500">
                    Try widening the filters, switching assignment scope, or searching for a different customer or subject.
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {tickets.map((ticket) => (
                    <TicketRow
                      key={ticket.id}
                      ticket={ticket}
                      selected={selected === ticket.id}
                      onClick={() => openTicket(ticket)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className={`${showDetail ? 'flex' : 'hidden xl:flex'} min-h-0 flex-col`}>
            {selected ? (
              <>
                <div className="mb-3 xl:hidden">
                  <button
                    onClick={() => setShowDetail(false)}
                    className="rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-400 transition hover:text-white"
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
              <DetailPlaceholder
                total={total}
                unassigned={stats?.unassigned ?? '–'}
                mine={stats?.my_open ?? '–'}
                onNavigate={navigate}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
