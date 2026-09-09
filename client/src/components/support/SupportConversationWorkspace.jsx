import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import io from 'socket.io-client';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Headphones,
  History,
  Inbox,
  Lock,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  Unlock,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { realtimeNamespaceUrl } from '../../lib/realtime';

const STATUS = {
  open: ['Open', 'border-blue-500/30 bg-blue-500/10 text-blue-200'],
  in_progress: ['In progress', 'border-orange-500/30 bg-orange-500/10 text-orange-200'],
  waiting_for_customer: ['Waiting for customer', 'border-amber-500/30 bg-amber-500/10 text-amber-200'],
  waiting_for_agent: ['Waiting for agent', 'border-purple-500/30 bg-purple-500/10 text-purple-200'],
  escalated: ['Escalated', 'border-red-500/30 bg-red-500/10 text-red-200'],
  resolved: ['Resolved', 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'],
  closed: ['Closed', 'border-slate-500/30 bg-slate-500/10 text-slate-300'],
};

const PRIORITY = {
  urgent: 'text-red-300',
  high: 'text-orange-300',
  normal: 'text-slate-300',
  low: 'text-slate-500',
};

function statusBadge(status) {
  const [label, className] = STATUS[status] || [status || 'Unknown', 'border-slate-700 bg-slate-800 text-slate-300'];
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{label}</span>;
}

function formatWhen(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function messageBody(message) {
  return message.content || message.text || '';
}

export default function SupportConversationWorkspace({ businessId = null, embedded = false }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [reply, setReply] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [agentEmployment, setAgentEmployment] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const agentSocketRef = useRef(null);

  const isPlatformAdmin = ['admin', 'super_admin'].includes(user?.role);

  const loadConversations = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const params = businessId ? { business_id: businessId } : {};
      const { data } = await api.get('/support/conversations', { params });
      const rows = data?.conversations || data?.data || [];
      setConversations(Array.isArray(rows) ? rows : []);
      setSelectedId((current) => {
        if (current && rows.some((row) => row.id === current)) return current;
        return rows[0]?.id || null;
      });
    } catch (error) {
      if (!quiet) toast.error(error?.response?.data?.error || 'Could not load the support queue.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [businessId]);

  const loadDetail = useCallback(async (conversationId, { quiet = false } = {}) => {
    if (!conversationId) {
      setDetail(null);
      return;
    }
    if (!quiet) setDetailLoading(true);
    try {
      const { data } = await api.get(`/support/conversations/${conversationId}`);
      setDetail(data?.data || null);
    } catch (error) {
      if (!quiet) toast.error(error?.response?.data?.error || 'Could not load this conversation.');
    } finally {
      if (!quiet) setDetailLoading(false);
    }
  }, []);

  const loadAgents = useCallback(async () => {
    if (!isPlatformAdmin) return;
    try {
      const params = businessId ? { business_id: businessId } : {};
      const { data } = await api.get('/support/agents', { params });
      setAgents(Array.isArray(data?.agents) ? data.agents : []);
    } catch {
      setAgents([]);
    }
  }, [businessId, isPlatformAdmin]);

  const loadAgentEmployment = useCallback(async () => {
    if (isPlatformAdmin) return;
    try {
      const { data } = await api.get('/support/agent/me');
      const rows = Array.isArray(data?.data) ? data.data : [];
      const activeRows = rows.filter((row) => row.status === 'active');
      const matching = businessId
        ? activeRows.find((row) => String(row.business_id) === String(businessId))
        : activeRows.find((row) => row.employer_kind === 'platform');
      setAgentEmployment(matching || null);
    } catch {
      setAgentEmployment(null);
    }
  }, [businessId, isPlatformAdmin]);

  useEffect(() => {
    loadConversations();
    loadAgents();
    loadAgentEmployment();
  }, [loadAgentEmployment, loadAgents, loadConversations]);

  useEffect(() => {
    loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  // Each conversation starts in public-reply mode so a prior private note
  // selection cannot silently carry over to the next customer.
  useEffect(() => {
    setReply('');
    setAttachment(null);
    setInternalNote(false);
  }, [selectedId]);

  useEffect(() => {
    const refresh = () => {
      loadConversations({ quiet: true });
      if (selectedId) loadDetail(selectedId, { quiet: true });
    };
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener('oxs:admin-support-ticket', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('oxs:admin-support-ticket', refresh);
    };
  }, [loadConversations, loadDetail, selectedId]);

  useEffect(() => {
    if (isPlatformAdmin || !agentEmployment?.is_available || !agentEmployment?.agent_id) {
      agentSocketRef.current?.disconnect();
      agentSocketRef.current = null;
      return undefined;
    }

    let active = true;
    const heartbeat = async () => {
      try {
        await api.patch('/support/agent/me/availability', {
          agent_id: agentEmployment.agent_id,
          is_available: true,
        });
      } catch {
        if (active) setAgentEmployment((current) => current ? { ...current, is_available: false } : current);
      }
    };

    heartbeat();
    const heartbeatTimer = window.setInterval(heartbeat, 45_000);
    const socket = io(realtimeNamespaceUrl('support'), {
      transports: ['websocket', 'polling'],
      reconnection: true,
      auth: { token: localStorage.getItem('accessToken') },
    });
    socket.on('connect', () => socket.emit('agent:join'));
    const refreshWorkspace = () => loadConversations({ quiet: true });
    socket.on('ticket:new-assignment', refreshWorkspace);
    socket.on('ticket:created', refreshWorkspace);
    socket.on('message:new', refreshWorkspace);
    agentSocketRef.current = socket;

    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      socket.disconnect();
      if (agentSocketRef.current === socket) agentSocketRef.current = null;
    };
  }, [agentEmployment?.agent_id, agentEmployment?.is_available, isPlatformAdmin, loadConversations]);

  const selected = detail || conversations.find((row) => row.id === selectedId) || null;
  const isAssignedToMe = selected?.agent_user_id === user?.id;
  const isClosed = ['resolved', 'closed'].includes(selected?.status);
  const canReply = Boolean(selected) && !isClosed && (isPlatformAdmin || isAssignedToMe);

  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const haystack = [
      conversation.customer_name,
      conversation.customer_email,
      conversation.subject,
      conversation.last_message,
      conversation.description,
    ].filter(Boolean).join(' ').toLowerCase();
    if (search && !haystack.includes(search.trim().toLowerCase())) return false;
    if (statusFilter === 'active' && ['resolved', 'closed'].includes(conversation.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'active' && conversation.status !== statusFilter) return false;
    if (ownershipFilter === 'mine' && conversation.agent_user_id !== user?.id) return false;
    if (ownershipFilter === 'unassigned' && conversation.agent_id) return false;
    return true;
  }), [conversations, ownershipFilter, search, statusFilter, user?.id]);

  const runAction = async (request, successMessage) => {
    setBusy(true);
    try {
      await request();
      if (successMessage) toast.success(successMessage);
      await Promise.all([
        loadConversations({ quiet: true }),
        selectedId ? loadDetail(selectedId, { quiet: true }) : Promise.resolve(),
      ]);
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'The support action failed.');
    } finally {
      setBusy(false);
    }
  };

  const claim = () => runAction(
    () => api.post(`/support/conversations/${selected.id}/claim`),
    'Conversation claimed.'
  );

  const release = () => runAction(
    () => api.post(`/support/conversations/${selected.id}/release`, { reason: 'Released from operator workspace' }),
    'Conversation returned to the queue.'
  );

  const assign = (agentId) => {
    if (!agentId) return;
    const path = selected.agent_id ? 'reassign' : 'assign';
    runAction(
      () => api.post(`/support/conversations/${selected.id}/${path}`, { agentId }),
      selected.agent_id ? 'Conversation reassigned.' : 'Conversation assigned.'
    );
  };

  const updateStatus = (status) => runAction(
    () => api.put(`/support/conversations/${selected.id}/status`, { status }),
    'Conversation status updated.'
  );

  const toggleAvailability = async () => {
    if (!agentEmployment) return;
    setAvailabilityBusy(true);
    try {
      const next = !agentEmployment.is_available;
      await api.patch('/support/agent/me/availability', {
        agent_id: agentEmployment.agent_id,
        is_available: next,
      });
      setAgentEmployment((current) => current ? { ...current, is_available: next } : current);
      toast.success(next ? 'You are online for live support.' : 'You are offline for new conversations.');
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Could not update availability.');
    } finally {
      setAvailabilityBusy(false);
    }
  };

  const sendMessage = async (event) => {
    event.preventDefault();
    const content = reply.trim();
    if ((!content && !attachment) || !selected || !canReply) return;
    setBusy(true);
    try {
      const body = new FormData();
      if (content) body.append('content', content);
      if (attachment) body.append('file', attachment);
      body.append('isInternal', String(internalNote));
      await api.post(`/support/conversations/${selected.id}/message`, body);
      setReply('');
      setAttachment(null);
      await Promise.all([
        loadConversations({ quiet: true }),
        loadDetail(selected.id, { quiet: true }),
      ]);
      toast.success(internalNote ? 'Internal note saved.' : 'Reply sent to the customer.');
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.response?.data?.message || 'Could not send the message.');
    } finally {
      setBusy(false);
    }
  };

  const openCount = conversations.filter((row) => !['resolved', 'closed'].includes(row.status)).length;
  const unassignedCount = conversations.filter((row) => !row.agent_id && !['resolved', 'closed'].includes(row.status)).length;
  const mineCount = conversations.filter((row) => row.agent_user_id === user?.id && !['resolved', 'closed'].includes(row.status)).length;

  return (
    <section className={`${embedded ? '' : 'min-h-[72vh]'} overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950/90 text-white shadow-2xl`}>
      <div className="border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-orange-300">
              <Headphones size={16} /> Live support workspace
            </div>
            <h2 className="mt-2 text-2xl font-semibold">Respond, coordinate, and resolve in one place</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              Claim customer conversations before replying, keep private team context in internal notes, and use clear statuses so no request disappears between shifts.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!isPlatformAdmin && agentEmployment && (
              <button
                type="button"
                onClick={toggleAvailability}
                disabled={availabilityBusy}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${agentEmployment.is_available ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-slate-700 bg-slate-900 text-slate-300'}`}
              >
                {agentEmployment.is_available ? <Wifi size={15} /> : <WifiOff size={15} />}
                {agentEmployment.is_available ? 'Online for live support' : 'Go online'}
              </button>
            )}
            <button
              type="button"
              onClick={() => loadConversations()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:border-orange-500/50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ['Active queue', openCount, Inbox],
            ['Unassigned', unassignedCount, AlertTriangle],
            ['Mine', mineCount, Lock],
          ].map(([label, value, Icon]) => (
            <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 sm:p-4">
              <Icon size={15} className="text-orange-300" />
              <div className="mt-2 text-xl font-semibold">{value}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid min-h-[620px] grid-cols-1 xl:grid-cols-[390px_minmax(0,1fr)]">
        <aside className="border-b border-slate-800 p-4 xl:border-b-0 xl:border-r">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer, subject, or message"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-10 pr-3 text-sm outline-none focus:border-orange-500"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="active">Active</option>
              <option value="all">All statuses</option>
              <option value="waiting_for_agent">Waiting for agent</option>
              <option value="in_progress">In progress</option>
              <option value="waiting_for_customer">Waiting for customer</option>
              <option value="escalated">Escalated</option>
              <option value="resolved">Resolved</option>
            </select>
            <select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">All owners</option>
              <option value="mine">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>

          <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {!loading && visibleConversations.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                No conversations match this view.
              </div>
            )}
            {visibleConversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                className={`w-full rounded-2xl border p-4 text-left transition ${selectedId === conversation.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-slate-800 bg-slate-900/65 hover:border-slate-700'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{conversation.customer_name || conversation.customer_email || 'Customer'}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{conversation.subject}</div>
                  </div>
                  <span className={`text-[11px] font-semibold uppercase ${PRIORITY[conversation.priority] || 'text-slate-400'}`}>{conversation.priority || 'normal'}</span>
                </div>
                <div className="mt-3 line-clamp-2 text-xs leading-5 text-slate-400">{conversation.last_message || conversation.description || 'No message preview.'}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  {statusBadge(conversation.status)}
                  <span className="text-[11px] text-slate-600">{formatWhen(conversation.updated_at || conversation.created_at)}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <UserRound size={42} className="text-slate-700" />
              <h3 className="mt-4 text-lg font-semibold">Select a customer conversation</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">Choose a request from the queue to review its history and begin helping.</p>
            </div>
          ) : (
            <>
              <header className="border-b border-slate-800 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(selected.status)}
                      <span className={`text-xs font-semibold uppercase ${PRIORITY[selected.priority] || 'text-slate-400'}`}>{selected.priority || 'normal'} priority</span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold">{selected.subject}</h3>
                    <div className="mt-2 text-sm text-slate-400">{selected.customer_name || 'Customer'} · {selected.customer_email || 'No email'}</div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                      <span>Opened {formatWhen(selected.created_at)}</span>
                      <span>{selected.agent_name ? `Assigned to ${selected.agent_name}` : 'Unassigned'}</span>
                      {selected.first_response_at && <span>First response {formatWhen(selected.first_response_at)}</span>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!selected.agent_id && !isClosed && (
                      <button type="button" onClick={claim} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold hover:bg-orange-500 disabled:opacity-50">
                        <Lock size={13} /> Claim
                      </button>
                    )}
                    {selected.agent_id && (isAssignedToMe || isPlatformAdmin) && !isClosed && (
                      <button type="button" onClick={release} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50">
                        <Unlock size={13} /> Release
                      </button>
                    )}
                    {isPlatformAdmin && !isClosed && (
                      <select value={selected.agent_id || ''} onChange={(event) => assign(event.target.value)} disabled={busy} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
                        <option value="">Assign agent</option>
                        {agents.filter((agent) => agent.status === 'active').map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}{agent.is_available ? ' · online' : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {(canReply || isPlatformAdmin) && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('waiting_for_customer')} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-amber-500/50">Waiting for customer</button>}
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('escalated')} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10">Escalate</button>}
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('resolved')} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10"><CheckCircle2 size={13} /> Resolve</button>}
                    {isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('open')} className="rounded-xl border border-blue-500/30 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/10">Reopen</button>}
                  </div>
                )}
              </header>

              <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.05),transparent_30%)] p-5">
                {detailLoading ? (
                  <div className="flex h-full items-center justify-center"><RefreshCw className="animate-spin text-orange-400" /></div>
                ) : (
                  <div className="space-y-4">
                    {selected.customerHistory?.previousConversationCount > 0 && (
                      <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-orange-200">
                            <History size={16} /> Customer history
                          </div>
                          <span className="rounded-full border border-orange-500/30 px-2.5 py-1 text-[11px] font-semibold text-orange-200">
                            {selected.customerHistory.previousConversationCount} previous conversation{selected.customerHistory.previousConversationCount === 1 ? '' : 's'}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          Verified support history for {selected.customerHistory.email || selected.customer_email}. Internal notes are visible only to authorized support staff.
                        </p>
                        <div className="mt-3 space-y-2">
                          {selected.customerHistory.conversations.map((history) => (
                            <details key={history.id} className="rounded-xl border border-slate-800 bg-slate-950/70">
                              <summary className="cursor-pointer list-none px-3 py-3 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-200">{history.subject}</span>
                                  <span className="text-xs text-slate-500">{statusBadge(history.status)} · {formatWhen(history.created_at)}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {history.customer_message_count || 0} customer message{history.customer_message_count === 1 ? '' : 's'} · {history.agent_message_count || 0} support message{history.agent_message_count === 1 ? '' : 's'}
                                </div>
                              </summary>
                              <div className="space-y-2 border-t border-slate-800 px-3 py-3">
                                {history.messages.length === 0 && <p className="text-xs text-slate-500">No messages recorded.</p>}
                                {history.messages.map((message) => {
                                  const fromAgent = Boolean(message.is_agent || message.is_from_agent);
                                  const isNote = message.message_type === 'internal_note';
                                  return (
                                    <div key={message.id} className={`rounded-xl border px-3 py-2 text-xs ${isNote ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : fromAgent ? 'border-orange-500/20 bg-orange-500/10 text-orange-100' : 'border-slate-800 bg-slate-900 text-slate-300'}`}>
                                      <div className="mb-1 flex items-center gap-2 text-[10px] opacity-70">
                                        <span>{message.sender_name || (fromAgent ? 'Support team' : history.customer_name || 'Customer')}</span>
                                        {isNote && <span className="rounded-full border border-amber-400/30 px-1.5 py-0.5">Internal note</span>}
                                        <span className="ml-auto">{formatWhen(message.created_at)}</span>
                                      </div>
                                      {message.attachment_url && <img src={message.attachment_url} alt={message.attachment_name || 'Support attachment'} className="mb-2 max-h-40 max-w-full rounded-lg object-contain" />}
                                      {messageBody(message) && <div className="whitespace-pre-wrap leading-5">{messageBody(message)}</div>}
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ))}
                        </div>
                      </section>
                    )}
                    {selected.description && (!selected.messages || selected.messages.length === 0) && (
                      <div className="max-w-[82%] rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm leading-6 text-slate-200">{selected.description}</div>
                    )}
                    {(selected.messages || []).map((message) => {
                      const fromAgent = Boolean(message.is_agent || message.is_from_agent);
                      const isNote = message.message_type === 'internal_note';
                      return (
                        <div key={message.id} className={`flex ${fromAgent ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[84%] rounded-2xl border px-4 py-3 ${isNote ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : fromAgent ? 'border-orange-500/20 bg-orange-600 text-white' : 'border-slate-800 bg-slate-900 text-slate-200'}`}>
                            <div className="mb-2 flex items-center gap-2 text-[11px] opacity-70">
                              <span>{message.sender_name || (fromAgent ? 'Support team' : selected.customer_name || 'Customer')}</span>
                              {isNote && <span className="rounded-full border border-amber-400/30 px-2 py-0.5">Internal note</span>}
                            </div>
                            {message.attachment_url && <img src={message.attachment_url} alt={message.attachment_name || 'Support attachment'} className="mb-2 max-h-64 max-w-full rounded-xl object-contain" />}
                            {messageBody(message) && <div className="whitespace-pre-wrap text-sm leading-6">{messageBody(message)}</div>}
                            <div className="mt-2 flex items-center gap-1 text-[11px] opacity-60"><Clock3 size={11} /> {formatWhen(message.created_at)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <form onSubmit={sendMessage} className="border-t border-slate-800 bg-slate-950 p-5">
                {!canReply && !isClosed && (
                  <div className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Claim this conversation before replying so the customer always has one accountable owner.
                  </div>
                )}
                <div className="mb-3 flex gap-2">
                  <button type="button" onClick={() => setInternalNote(false)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${!internalNote ? 'bg-orange-600 text-white' : 'bg-slate-900 text-slate-400'}`}><MessageSquare size={12} className="mr-1 inline" /> Customer reply</button>
                  <button type="button" onClick={() => setInternalNote(true)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${internalNote ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400'}`}><Lock size={12} className="mr-1 inline" /> Internal note</button>
                </div>
                {attachment && <div className="mb-2 flex items-center gap-2 text-xs text-orange-200">{attachment.name}<button type="button" onClick={() => setAttachment(null)} className="text-slate-400 hover:text-white">Remove</button></div>}
                <div className="flex gap-3">
                  <label className="cursor-pointer rounded-2xl border border-slate-700 p-3 text-slate-300 hover:border-orange-500" title="Attach image">
                    <Paperclip size={18} />
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />
                  </label>
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    disabled={!canReply || busy}
                    rows={3}
                    placeholder={internalNote ? 'Add private context for the next operator…' : 'Write a clear response to the customer…'}
                    className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-orange-500 disabled:opacity-50"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendMessage(event);
                    }}
                  />
                  <button type="submit" disabled={!canReply || busy || (!reply.trim() && !attachment)} className="self-end rounded-2xl bg-orange-600 p-4 text-white hover:bg-orange-500 disabled:opacity-40"><Send size={18} /></button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
