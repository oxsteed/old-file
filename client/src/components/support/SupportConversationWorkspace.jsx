import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import io from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Headphones,
  History,
  Inbox,
  Lock,
  MessageSquare,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  Unlock,
  UserRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../hooks/useAuth';
import { realtimeNamespaceUrl } from '../../lib/realtime';
import { createMessageRequestId } from '../../lib/messageRequestId';
import Customer360Panel from './Customer360Panel';

const STATUS = {
  open: ['Open', 'border-blue-500/30 bg-blue-500/10 text-blue-200'],
  pending: ['Pending', 'border-amber-500/30 bg-amber-500/10 text-amber-200'],
  reopened: ['Reopened', 'border-orange-500/30 bg-orange-500/10 text-orange-200'],
  in_progress: ['In progress', 'border-orange-500/30 bg-orange-500/10 text-orange-200'],
  waiting_for_customer: ['Waiting for customer', 'border-amber-500/30 bg-amber-500/10 text-amber-200'],
  waiting_for_agent: ['Waiting for agent', 'border-purple-500/30 bg-purple-500/10 text-purple-200'],
  escalated: ['Escalated', 'border-red-500/30 bg-red-500/10 text-red-200'],
  resolved: ['Resolved', 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'],
  closed: ['Closed', 'border-slate-500/30 bg-slate-500/10 text-slate-300'],
  merged: ['Merged', 'border-violet-500/30 bg-violet-500/10 text-violet-200'],
};

const PRIORITY = {
  urgent: 'text-red-300',
  high: 'text-orange-300',
  normal: 'text-slate-300',
  low: 'text-slate-500',
};

const CONVERSATION_PAGE_SIZE = 100;

function statusBadge(status, t) {
  const [label, className] = STATUS[status] || [status || 'Unknown', 'border-slate-700 bg-slate-800 text-slate-300'];
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${className}`}>{t ? t(`support.workspace.status.${status}`, { defaultValue: label }) : label}</span>;
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

function formatRemaining(milliseconds) {
  const totalMinutes = Math.max(0, Math.ceil(Math.abs(milliseconds) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function SlaTimer({ target, label }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const targetTime = new Date(target).getTime();
  if (!target || Number.isNaN(targetTime)) return null;
  const remaining = targetTime - now;
  const breached = remaining < 0;
  return (
    <span className={breached ? 'font-semibold text-red-300' : 'font-semibold text-emerald-300'}>
      {label} SLA {breached ? `breached ${formatRemaining(remaining)} ago` : `due in ${formatRemaining(remaining)}`}
    </span>
  );
}

export default function SupportConversationWorkspace({ businessId = null, embedded = false }) {
  const { t } = useTranslation();
  const copy = (key, options) => t(`support.workspace.${key}`, options);
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [agents, setAgents] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');
  const [ownershipFilter, setOwnershipFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [messageFilter, setMessageFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [reply, setReply] = useState('');
  const [quickReply, setQuickReply] = useState('');
  const [responseTemplates, setResponseTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [knowledgeOpen, setKnowledgeOpen] = useState(false);
  const [knowledgeSearch, setKnowledgeSearch] = useState('');
  const [knowledgeArticles, setKnowledgeArticles] = useState([]);
  const [knowledgeLoading, setKnowledgeLoading] = useState(false);
  const [aiDraft, setAiDraft] = useState(null);
  const [aiDraftBusy, setAiDraftBusy] = useState(false);
  const [internalNote, setInternalNote] = useState(false);
  const [resolutionSummary, setResolutionSummary] = useState('');
  const [resolutionReasonCode, setResolutionReasonCode] = useState('other');
  const [followUpReminders, setFollowUpReminders] = useState([]);
  const [followUpDueAt, setFollowUpDueAt] = useState('');
  const [followUpNote, setFollowUpNote] = useState('');
  const [followUpBusy, setFollowUpBusy] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingContent, setEditingContent] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [sendError, setSendError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState(null);
  const [queueUpdatedAt, setQueueUpdatedAt] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customer360, setCustomer360] = useState(null);
  const [customer360Loading, setCustomer360Loading] = useState(false);
  const [lifecycle, setLifecycle] = useState([]);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [emailRetryBusy, setEmailRetryBusy] = useState(false);
  const [channelDeliveries, setChannelDeliveries] = useState([]);
  const [channelCapabilities, setChannelCapabilities] = useState(null);
  const [channelCapabilitiesLoading, setChannelCapabilitiesLoading] = useState(false);
  const [channelRetryBusy, setChannelRetryBusy] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeReason, setMergeReason] = useState('');
  const [mergeBusy, setMergeBusy] = useState(false);
  const [showNewMessages, setShowNewMessages] = useState(false);
  const [customerTyping, setCustomerTyping] = useState(false);
  const [ticketViewerCount, setTicketViewerCount] = useState(0);
  const [ticketViewers, setTicketViewers] = useState([]);
  const [realtimeStatus, setRealtimeStatus] = useState('offline');
  const [agentEmployment, setAgentEmployment] = useState(null);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const agentSocketRef = useRef(null);
  const typingTimerRef = useRef(null);
  const customerTypingTimerRef = useRef(null);
  const messageListRef = useRef(null);
  const queueSearchRef = useRef(null);
  const replyInputRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const pendingMessageIdRef = useRef(null);
  const renderedConversationRef = useRef({ id: null, messageCount: 0 });
  const conversationRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const customer360RequestRef = useRef(0);
  const conversationLoadingRequestRef = useRef(null);
  const detailLoadingRequestRef = useRef(null);
  const conversationOffsetRef = useRef(0);

  const isPlatformAdmin = ['admin', 'super_admin'].includes(user?.role);

  const loadConversations = useCallback(async ({ quiet = false, append = false } = {}) => {
    const requestId = conversationRequestRef.current + 1;
    conversationRequestRef.current = requestId;
    if (append) {
      setLoadingMore(true);
    } else if (!quiet) {
      conversationLoadingRequestRef.current = requestId;
      setLoading(true);
    }
    if (!quiet && !append) setQueueError(null);
    try {
      const params = {
        ...(businessId ? { business_id: businessId } : {}),
        limit: CONVERSATION_PAGE_SIZE,
        offset: append ? conversationOffsetRef.current : 0,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(channelFilter !== 'all' ? { channel: channelFilter } : {}),
      };
      const { data } = await api.get('/support/conversations', { params });
      if (requestId !== conversationRequestRef.current) return;
      const rows = data?.conversations || data?.data || [];
      const nextRows = Array.isArray(rows) ? rows : [];
      if (append) {
        setConversations((currentRows) => {
          const byId = new Map(currentRows.map((row) => [row.id, row]));
          nextRows.forEach((row) => byId.set(row.id, row));
          return Array.from(byId.values());
        });
        conversationOffsetRef.current += nextRows.length;
      } else {
        setConversations(nextRows);
        conversationOffsetRef.current = nextRows.length;
        setSelectedId((current) => {
          if (current && nextRows.some((row) => row.id === current)) return current;
          return nextRows[0]?.id || null;
        });
      }
      setHasMoreConversations(nextRows.length === CONVERSATION_PAGE_SIZE);
      if (!append) setQueueUpdatedAt(new Date());
    } catch (error) {
      if (requestId === conversationRequestRef.current && (append || !quiet)) {
        if (!append) setQueueError(error?.response?.data?.error || 'Could not load the support queue.');
        toast.error(error?.response?.data?.error || 'Could not load the support queue.');
      }
    } finally {
      if (append) {
        setLoadingMore(false);
      }
      if (!append && !quiet && conversationLoadingRequestRef.current === requestId) {
        conversationLoadingRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [businessId, channelFilter, search]);

  const loadDetail = useCallback(async (conversationId, { quiet = false } = {}) => {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    if (!conversationId) {
      setDetail(null);
      detailLoadingRequestRef.current = null;
      setDetailLoading(false);
      return;
    }
    if (!quiet) {
      detailLoadingRequestRef.current = requestId;
      setDetailLoading(true);
    }
    try {
      const { data } = await api.get(`/support/conversations/${conversationId}`);
      if (requestId !== detailRequestRef.current) return;
      setDetail(data?.data || null);
    } catch (error) {
      if (requestId === detailRequestRef.current && !quiet) {
        toast.error(error?.response?.data?.error || 'Could not load this conversation.');
      }
    } finally {
      if (!quiet && detailLoadingRequestRef.current === requestId) {
        detailLoadingRequestRef.current = null;
        setDetailLoading(false);
      }
    }
  }, []);

  const loadCustomer360 = useCallback(async (conversationId) => {
    const requestId = customer360RequestRef.current + 1;
    customer360RequestRef.current = requestId;
    if (!conversationId) {
      setCustomer360(null);
      setLifecycle([]);
      setCustomer360Loading(false);
      setLifecycleLoading(false);
      return;
    }
    setCustomer360Loading(true);
    setLifecycleLoading(true);
    try {
      const [customerResult, lifecycleResult] = await Promise.allSettled([
        api.get(`/support/conversations/${conversationId}/customer-360`),
        api.get(`/support/conversations/${conversationId}/lifecycle`),
      ]);
      if (requestId !== customer360RequestRef.current) return;
      setCustomer360(customerResult.status === 'fulfilled' ? customerResult.value.data?.data || null : null);
      setLifecycle(
        lifecycleResult.status === 'fulfilled' && Array.isArray(lifecycleResult.value.data?.data)
          ? lifecycleResult.value.data.data
          : []
      );
    } catch {
      if (requestId !== customer360RequestRef.current) return;
      setCustomer360(null);
      setLifecycle([]);
    } finally {
      if (requestId === customer360RequestRef.current) {
        setCustomer360Loading(false);
        setLifecycleLoading(false);
      }
    }
  }, []);

  const loadFollowUpReminders = useCallback(async (conversationId) => {
    if (!conversationId) {
      setFollowUpReminders([]);
      return;
    }
    try {
      const { data } = await api.get('/support/follow-up-reminders', {
        params: { conversation_id: conversationId, status: 'all' },
      });
      setFollowUpReminders(Array.isArray(data?.reminders) ? data.reminders : []);
    } catch {
      setFollowUpReminders([]);
    }
  }, []);

  const loadChannelDeliveries = useCallback(async (conversationId) => {
    if (!conversationId) {
      setChannelDeliveries([]);
      return;
    }
    try {
      const { data } = await api.get(`/support/conversations/${conversationId}/channel-deliveries`);
      setChannelDeliveries(Array.isArray(data?.data) ? data.data : []);
    } catch {
      setChannelDeliveries([]);
    }
  }, []);

  const loadChannelCapabilities = useCallback(async () => {
    setChannelCapabilitiesLoading(true);
    try {
      const { data } = await api.get('/support/channel-capabilities', {
        params: businessId ? { business_id: businessId } : undefined,
      });
      setChannelCapabilities(data?.data || null);
    } catch {
      setChannelCapabilities(null);
    } finally {
      setChannelCapabilitiesLoading(false);
    }
  }, [businessId]);

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

  const loadResponseTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const { data } = await api.get(
        businessId ? '/support/templates/available' : '/support/templates',
        { params: businessId ? { business_id: businessId } : { active: 'true' } }
      );
      const rows = data?.templates || data?.data || [];
      setResponseTemplates(Array.isArray(rows) ? rows.filter((row) => row.is_active !== false) : []);
    } catch {
      setResponseTemplates([]);
    } finally {
      setTemplatesLoading(false);
    }
  }, [businessId]);

  const loadKnowledgeArticles = useCallback(async () => {
    setKnowledgeLoading(true);
    try {
      const { data } = await api.get('/support/kb/available', {
        params: { ...(businessId ? { business_id: businessId } : {}), search: knowledgeSearch.trim() },
      });
      const rows = data?.articles || data?.data || [];
      setKnowledgeArticles(Array.isArray(rows) ? rows : []);
    } catch {
      setKnowledgeArticles([]);
    } finally {
      setKnowledgeLoading(false);
    }
  }, [businessId, knowledgeSearch]);

  useEffect(() => {
    loadAgents();
    loadAgentEmployment();
    loadResponseTemplates();
    loadChannelCapabilities();
  }, [loadAgentEmployment, loadAgents, loadChannelCapabilities, loadResponseTemplates]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadConversations(), search.trim() ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [loadConversations, search]);

  useEffect(() => {
    loadDetail(selectedId);
    loadCustomer360(selectedId);
    loadFollowUpReminders(selectedId);
    loadChannelDeliveries(selectedId);
    setAiDraft(null);
    stickToBottomRef.current = true;
  }, [loadChannelDeliveries, loadCustomer360, loadDetail, loadFollowUpReminders, selectedId]);

  useEffect(() => {
    if (!selectedId || detailLoading) return;
    // Mark only customer-visible messages as read for this authorized operator.
    api.post(`/support/conversations/${selectedId}/mark-all-read`).catch(() => {});
  }, [detailLoading, selectedId]);

  useEffect(() => {
    const messageList = messageListRef.current;
    const conversationId = detail?.id || null;
    const messageCount = detail?.messages?.length || 0;
    const previous = renderedConversationRef.current;
    const sameConversation = previous.id === conversationId;
    renderedConversationRef.current = { id: conversationId, messageCount };
    if (!messageList || !conversationId) return;

    if (stickToBottomRef.current) {
      messageList.scrollTo({ top: messageList.scrollHeight, behavior: 'smooth' });
      setShowNewMessages(false);
    } else if (sameConversation && messageCount > previous.messageCount) {
      setShowNewMessages(true);
    }
  }, [detail?.id, detail?.messages?.length]);

  // Each conversation starts in public-reply mode so a prior private note
  // selection cannot silently carry over to the next customer.
  useEffect(() => {
    setReply('');
    setCustomer360(null);
    setQuickReply('');
    setAttachment(null);
    setSendError('');
    setInternalNote(false);
    setKnowledgeOpen(false);
    setKnowledgeSearch('');
    setKnowledgeArticles([]);
    setResolutionSummary('');
    setResolutionReasonCode('other');
    setFollowUpReminders([]);
    setChannelDeliveries([]);
    setFollowUpDueAt('');
    setFollowUpNote('');
    setEditingMessageId(null);
    setEditingContent('');
    setMergeTargetId('');
    setMergeReason('');
    setCustomerTyping(false);
    setTicketViewers([]);
    setShowNewMessages(false);
    stickToBottomRef.current = true;
    renderedConversationRef.current = { id: selectedId, messageCount: 0 };
    window.clearTimeout(customerTypingTimerRef.current);
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
    setTicketViewerCount(0);
    setTicketViewers([]);
    setRealtimeStatus('connecting');
    if (!isPlatformAdmin && (!agentEmployment?.is_available || !agentEmployment?.agent_id)) {
      agentSocketRef.current?.disconnect();
      agentSocketRef.current = null;
      setRealtimeStatus('offline');
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
    const setActiveRealtimeStatus = (status) => {
      if (active) setRealtimeStatus(status);
    };
    socket.on('connect', () => {
      setActiveRealtimeStatus('connected');
      socket.emit(isPlatformAdmin ? 'admin:join' : 'agent:join');
      if (selectedId) socket.emit('ticket:join', { ticketId: selectedId });
    });
    socket.on('connect_error', () => setActiveRealtimeStatus('reconnecting'));
    socket.on('disconnect', (reason) => {
      setActiveRealtimeStatus(reason === 'io client disconnect' ? 'offline' : 'reconnecting');
    });
    socket.io.on('reconnect_attempt', () => setActiveRealtimeStatus('reconnecting'));
    const refreshWorkspace = () => {
      loadConversations({ quiet: true });
      if (selectedId) loadDetail(selectedId, { quiet: true });
    };
    socket.on('ticket:new-assignment', refreshWorkspace);
    socket.on('ticket:created', refreshWorkspace);
    socket.on('message:new', refreshWorkspace);
    socket.on('support:conversation-updated', refreshWorkspace);
    socket.on('ticket:viewer-presence', (data) => {
      if (data?.ticketId !== selectedId) return;
      setTicketViewerCount(Number(data.viewerCount) || 0);
    });
    socket.on('ticket:viewer-details', (data) => {
      if (data?.ticketId !== selectedId) return;
      setTicketViewers(Array.isArray(data.viewers) ? data.viewers : []);
    });
    socket.on('customer:typing-indicator', (data) => {
      if (data?.ticketId !== selectedId) return;
      const isTyping = Boolean(data.isTyping);
      setCustomerTyping(isTyping);
      window.clearTimeout(customerTypingTimerRef.current);
      if (isTyping) {
        customerTypingTimerRef.current = window.setTimeout(() => setCustomerTyping(false), 4_000);
      }
    });
    socket.on('ticket:read', (data) => {
      if (data.ticketId !== selectedId) return;
      setDetail((current) => current ? {
        ...current,
        messages: (current.messages || []).map((message) => message.is_agent
          ? { ...message, read_by_recipient: true, read_at: data.readAt || new Date().toISOString(), status: 'read' }
          : message),
      } : current);
    });
    agentSocketRef.current = socket;

    return () => {
      active = false;
      window.clearInterval(heartbeatTimer);
      window.clearTimeout(customerTypingTimerRef.current);
      socket.disconnect();
      setRealtimeStatus('offline');
      if (agentSocketRef.current === socket) agentSocketRef.current = null;
    };
  }, [agentEmployment?.agent_id, agentEmployment?.is_available, isPlatformAdmin, loadConversations, loadDetail, selectedId]);

  useEffect(() => () => {
    window.clearTimeout(typingTimerRef.current);
    if (selectedId) agentSocketRef.current?.emit('agent:typing', { ticketId: selectedId, isTyping: false });
  }, [selectedId]);

  const selected = detail || conversations.find((row) => row.id === selectedId) || null;
  const isAssignedToMe = selected?.agent_user_id === user?.id;
  const isClosed = ['resolved', 'closed', 'merged'].includes(selected?.status);
  const canReply = Boolean(selected) && !isClosed && (isPlatformAdmin || isAssignedToMe);
  const isExternalChannel = Boolean(selected?.channel && selected.channel !== 'web_chat');
  const channelCapability = isExternalChannel ? channelCapabilities?.[selected.channel] : null;
  const channelNotReady = Boolean(
    !internalNote
      && isExternalChannel
      && channelCapability
      && (!channelCapability.supported || !channelCapability.configured)
  );
  const channelDeliveryByMessageId = useMemo(
    () => new Map(channelDeliveries.map((delivery) => [delivery.message_id, delivery])),
    [channelDeliveries]
  );
  const mergeTargets = useMemo(() => {
    if (!selected?.customer_email || isClosed) return [];
    const email = String(selected.customer_email).trim().toLowerCase();
    return conversations.filter((conversation) => (
      conversation.id !== selected.id
      && String(conversation.customer_email || '').trim().toLowerCase() === email
      && String(conversation.business_id ?? '') === String(selected.business_id ?? '')
      && !['resolved', 'closed', 'merged'].includes(conversation.status)
    ));
  }, [conversations, isClosed, selected]);

  const visibleConversations = useMemo(() => conversations.filter((conversation) => {
    const haystack = [
      conversation.customer_name,
      conversation.customer_email,
      conversation.subject,
      conversation.last_message,
      conversation.description,
    ].filter(Boolean).join(' ').toLowerCase();
    if (statusFilter === 'active' && ['resolved', 'closed', 'merged'].includes(conversation.status)) return false;
    if (statusFilter !== 'all' && statusFilter !== 'active' && conversation.status !== statusFilter) return false;
    if (ownershipFilter === 'mine' && conversation.agent_user_id !== user?.id) return false;
    if (ownershipFilter === 'unassigned' && conversation.agent_id) return false;
    if (priorityFilter !== 'all' && conversation.priority !== priorityFilter) return false;
    if (messageFilter === 'unread' && Number(conversation.unread_count || 0) < 1) return false;
    if (categoryFilter !== 'all' && (conversation.category || 'general') !== categoryFilter) return false;
    if (channelFilter !== 'all' && (conversation.channel || copy('channels.webChat')) !== channelFilter) return false;
    return true;
  }), [categoryFilter, channelFilter, conversations, messageFilter, ownershipFilter, priorityFilter, search, statusFilter, user?.id]);

  useEffect(() => {
    const handleShortcut = (event) => {
      const tagName = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tagName) || event.target?.isContentEditable) return;
      if (event.key === '/') {
        event.preventDefault();
        queueSearchRef.current?.focus();
        return;
      }
      if (event.key === 'r' && canReply) {
        event.preventDefault();
        replyInputRef.current?.focus();
        return;
      }
      if (!['j', 'k'].includes(event.key) || visibleConversations.length === 0) return;
      const currentIndex = visibleConversations.findIndex((conversation) => conversation.id === selectedId);
      const nextIndex = event.key === 'j'
        ? Math.min(visibleConversations.length - 1, currentIndex < 0 ? 0 : currentIndex + 1)
        : Math.max(0, currentIndex <= 0 ? visibleConversations.length - 1 : currentIndex - 1);
      setSelectedId(visibleConversations[nextIndex].id);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [canReply, selectedId, visibleConversations]);

  const runAction = async (request, successMessage) => {
    setBusy(true);
    try {
      await request();
      if (successMessage) toast.success(successMessage);
      await Promise.all([
        loadConversations({ quiet: true }),
        selectedId ? loadDetail(selectedId, { quiet: true }) : Promise.resolve(),
        selectedId ? loadCustomer360(selectedId) : Promise.resolve(),
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

  const updateStatus = (status, extra = {}) => runAction(
    () => api.put(`/support/conversations/${selected.id}/status`, { status, ...extra }),
    'Conversation status updated.'
  );

  const createFollowUpReminder = async (event) => {
    event.preventDefault();
    if (!selected?.id || !followUpDueAt || followUpBusy) return;
    const dueAt = new Date(followUpDueAt);
    if (Number.isNaN(dueAt.getTime())) return;
    setFollowUpBusy(true);
    try {
      await api.post(`/support/conversations/${selected.id}/follow-up-reminders`, {
        dueAt: dueAt.toISOString(),
        note: followUpNote.trim() || null,
        assignedTo: selected.agent_user_id || null,
      });
      setFollowUpDueAt('');
      setFollowUpNote('');
      await loadFollowUpReminders(selected.id);
      toast.success('Follow-up reminder created.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not create follow-up reminder.');
    } finally {
      setFollowUpBusy(false);
    }
  };

  const updateFollowUpReminder = async (reminderId, status) => {
    if (!reminderId || followUpBusy) return;
    setFollowUpBusy(true);
    try {
      await api.patch(`/support/follow-up-reminders/${reminderId}`, { status });
      await loadFollowUpReminders(selected.id);
      toast.success(status === 'completed' ? 'Follow-up marked complete.' : 'Follow-up cancelled.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not update follow-up reminder.');
    } finally {
      setFollowUpBusy(false);
    }
  };

  const downloadTranscript = async (includeInternal = false) => {
    if (!selected?.id || downloadBusy) return;
    setDownloadBusy(true);
    try {
      const response = await api.get(`/support/conversations/${selected.id}/download`, {
        params: includeInternal ? { include_internal: 'true' } : undefined,
        responseType: 'blob',
      });
      const blobUrl = URL.createObjectURL(response.data);
      const disposition = response.headers?.['content-disposition'] || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `oxsteed-support-${selected.id}${includeInternal ? '-case-record' : ''}.txt`;
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
      toast.success(includeInternal ? 'Full case record downloaded.' : 'Transcript downloaded.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not download this transcript.');
    } finally {
      setDownloadBusy(false);
    }
  };

  const retryFailedEmails = async () => {
    if (!selected?.id || emailRetryBusy || Number(selected.emailDelivery?.failed || 0) < 1) return;
    setEmailRetryBusy(true);
    try {
      const response = await api.post(`/support/conversations/${selected.id}/email/retry-failed`);
      await loadDetail(selected.id, { quiet: true });
      const queued = Number(response.data?.data?.queued || 0);
      toast.success(queued ? `${queued} customer notification${queued === 1 ? '' : 's'} queued for retry.` : 'No failed customer notifications need a retry.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not retry customer notifications.');
    } finally {
      setEmailRetryBusy(false);
    }
  };

  const retryChannelDelivery = async (deliveryId) => {
    if (!selected?.id || !deliveryId || channelRetryBusy) return;
    setChannelRetryBusy(true);
    try {
      await api.post(`/support/conversations/${selected.id}/channel-deliveries/${deliveryId}/retry`);
      await Promise.all([
        loadChannelDeliveries(selected.id),
        loadDetail(selected.id, { quiet: true }),
      ]);
      toast.success('Channel reply delivered.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not retry this channel reply.');
      await loadChannelDeliveries(selected.id);
    } finally {
      setChannelRetryBusy(false);
    }
  };

  const mergeSelectedConversation = async () => {
    if (!selected?.id || !mergeTargetId || mergeBusy) return;
    setMergeBusy(true);
    try {
      await api.post(`/support/conversations/${selected.id}/merge`, {
        targetConversationId: mergeTargetId,
        reason: mergeReason.trim(),
      });
      const targetId = mergeTargetId;
      setMergeTargetId('');
      setMergeReason('');
      await loadConversations({ quiet: true });
      setSelectedId(targetId);
      toast.success('Conversations merged and history preserved.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Could not merge these conversations.');
    } finally {
      setMergeBusy(false);
    }
  };

  const copyContextValue = async (value, label) => {
    if (!value || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(String(value));
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}.`);
    }
  };

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

  const handleAgentReplyChange = (event) => {
    const value = event.target.value;
    setReply(value);
    if (!selectedId || !canReply || internalNote) return;
    agentSocketRef.current?.emit('agent:typing', { ticketId: selectedId, isTyping: Boolean(value.trim()) });
    window.clearTimeout(typingTimerRef.current);
    typingTimerRef.current = window.setTimeout(() => {
      agentSocketRef.current?.emit('agent:typing', { ticketId: selectedId, isTyping: false });
    }, 1500);
  };

  const sendMessage = async (event) => {
    event?.preventDefault?.();
    const content = reply.trim();
    if ((!content && !attachment) || !selected || !canReply || channelNotReady) return;
    setBusy(true);
    setSendError('');
    stickToBottomRef.current = true;
    const clientMessageId = pendingMessageIdRef.current || createMessageRequestId();
    pendingMessageIdRef.current = clientMessageId;
    try {
      if (!internalNote && isExternalChannel) {
        await api.post(`/support/conversations/${selected.id}/channel-message`, {
          channel: selected.channel,
          content,
          subject: selected.subject,
          requestId: clientMessageId,
        });
      } else {
        const body = new FormData();
        if (content) body.append('content', content);
        if (attachment) body.append('file', attachment);
        body.append('isInternal', String(internalNote));
        body.append('clientMessageId', clientMessageId);
        await api.post(`/support/conversations/${selected.id}/message`, body);
      }
      pendingMessageIdRef.current = null;
      setReply('');
      setAttachment(null);
      await Promise.all([
        loadConversations({ quiet: true }),
        loadDetail(selected.id, { quiet: true }),
        loadCustomer360(selected.id),
      ]);
      agentSocketRef.current?.emit('agent:typing', { ticketId: selected.id, isTyping: false });
      window.clearTimeout(typingTimerRef.current);
      toast.success(internalNote ? 'Internal note saved.' : 'Reply sent to the customer.');
    } catch (error) {
      if (isExternalChannel && !internalNote) pendingMessageIdRef.current = null;
      const message = error?.response?.data?.error || error?.response?.data?.message || 'Could not send the message.';
      setSendError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const generateAIDraft = async () => {
    if (!selected?.id || (!canReply && !isPlatformAdmin) || isClosed || aiDraftBusy) return;
    const sourceMessage = [...(detail?.messages || [])]
      .reverse()
      .find((message) => !message.is_agent && message.message_type !== 'internal_note');
    const sourceContent = String(sourceMessage?.content || selected.description || '').trim();
    if (!sourceContent) {
      toast.error('There is no customer message to draft a reply for.');
      return;
    }
    const targetBusinessId = selected.business_id || businessId;
    if (!targetBusinessId) {
      toast.error('This conversation is missing a support business.');
      return;
    }
    setAiDraftBusy(true);
    try {
      const { data } = await api.post(`/support/${targetBusinessId}/ai/message`, {
        conversationId: selected.id,
        content: sourceContent,
        language: user?.preferred_language || 'en',
      });
      setAiDraft(data?.data || null);
      toast.success('AI draft ready for your review. It was not sent.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'AI drafting is unavailable. Use a manual reply instead.');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const applyAIDraft = async () => {
    if (!aiDraft?.id || aiDraftBusy || !selected?.business_id && !businessId) return;
    const targetBusinessId = selected.business_id || businessId;
    setAiDraftBusy(true);
    try {
      await api.post(`/support/${targetBusinessId}/ai/drafts/${aiDraft.id}/apply`);
      setAiDraft(null);
      await Promise.all([
        loadConversations({ quiet: true }),
        loadDetail(selected.id, { quiet: true }),
        loadCustomer360(selected.id),
      ]);
      toast.success('Approved AI draft sent to the customer.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'This AI draft could not be applied.');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const discardAIDraft = async () => {
    if (!aiDraft?.id || aiDraftBusy || !selected?.business_id && !businessId) return;
    const targetBusinessId = selected.business_id || businessId;
    setAiDraftBusy(true);
    try {
      await api.post(`/support/${targetBusinessId}/ai/drafts/${aiDraft.id}/discard`);
      setAiDraft(null);
      toast.success('AI draft discarded.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'This AI draft could not be discarded.');
    } finally {
      setAiDraftBusy(false);
    }
  };

  const editAgentMessage = async (messageId) => {
    const content = editingContent.trim();
    if (!content || !selected?.id || busy) return;
    setBusy(true);
    try {
      await api.put(`/support/conversations/${selected.id}/agent-messages/${messageId}`, { content });
      await loadDetail(selected.id, { quiet: true });
      setEditingMessageId(null);
      setEditingContent('');
      toast.success('Reply updated.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'This reply can no longer be edited.');
    } finally {
      setBusy(false);
    }
  };

  const redactMessage = async (message) => {
    if (!selected?.id || !message?.id || busy || message.redacted_at) return;
    const reason = window.prompt('Reason for redacting this message (optional):', 'Sensitive information');
    if (reason === null) return;
    setBusy(true);
    try {
      await api.post(`/support/conversations/${selected.id}/messages/${message.id}/redact`, { reason });
      await Promise.all([
        loadDetail(selected.id, { quiet: true }),
        loadCustomer360(selected.id),
      ]);
      toast.success('Message redacted from future conversation views.');
    } catch (error) {
      toast.error(error?.response?.data?.error || 'This message could not be redacted.');
    } finally {
      setBusy(false);
    }
  };

  const openCount = conversations.filter((row) => !['resolved', 'closed', 'merged'].includes(row.status)).length;
  const unassignedCount = conversations.filter((row) => !row.agent_id && !['resolved', 'closed', 'merged'].includes(row.status)).length;
  const mineCount = conversations.filter((row) => row.agent_user_id === user?.id && !['resolved', 'closed', 'merged'].includes(row.status)).length;
  const categories = useMemo(() => Array.from(new Set(conversations.map((row) => row.category || 'general'))).sort(), [conversations]);

  return (
    <section className={`${embedded ? '' : 'min-h-[72vh]'} overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950/90 text-white shadow-2xl`}>
      <div className="border-b border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-orange-300">
              <Headphones size={16} /> {copy('title')}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium ${
                  realtimeStatus === 'connected'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : realtimeStatus === 'reconnecting' || realtimeStatus === 'connecting'
                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                      : 'border-slate-700 bg-slate-900 text-slate-400'
                }`}
                aria-live="polite"
                title={copy('connectionTitle')}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${
                  realtimeStatus === 'connected' ? 'bg-emerald-400' : realtimeStatus === 'offline' ? 'bg-slate-500' : 'bg-amber-400'
                }`} />
                {realtimeStatus === 'connected' ? copy('liveOn') : realtimeStatus === 'offline' ? copy('liveOff') : copy('reconnecting')}
              </span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold">{copy('headline')}</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              {copy('description')}
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
                {agentEmployment.is_available ? copy('onlineForSupport') : copy('goOnline')}
              </button>
            )}
            <button
              type="button"
              onClick={() => loadConversations()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:border-orange-500/50 disabled:opacity-50"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> {copy('refresh')}
            </button>
          </div>
        </div>
        {queueError && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
            <span>{queueError}</span>
            <button type="button" onClick={() => loadConversations()} disabled={loading} className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10 disabled:opacity-50">{copy('tryAgain')}</button>
          </div>
        )}
        {queueUpdatedAt && !queueError && <div className="mt-2 text-end text-[11px] text-slate-600">{copy('queueUpdated')} {queueUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>}
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            [copy('stats.active'), openCount, Inbox],
            [copy('stats.unassigned'), unassignedCount, AlertTriangle],
            [copy('stats.mine'), mineCount, Lock],
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
        <aside className="border-b border-slate-800 p-4 xl:border-b-0 xl:border-e">
          <div className="relative">
            <Search size={16} className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              ref={queueSearchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy('searchPlaceholder')}
              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 ps-10 pe-3 text-sm outline-none focus:border-orange-500"
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-600">{copy('shortcuts')}: <span className="text-slate-400">/</span> search · <span className="text-slate-400">j/k</span> move · <span className="text-slate-400">r</span> reply</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="active">{copy('status.active')}</option>
              <option value="all">{copy('allStatuses')}</option>
              <option value="pending">{copy('status.pending')}</option>
              <option value="reopened">{copy('status.reopened')}</option>
              <option value="waiting_for_agent">{copy('status.waitingForAgent')}</option>
              <option value="in_progress">{copy('status.inProgress')}</option>
              <option value="waiting_for_customer">{copy('status.waitingForCustomer')}</option>
              <option value="escalated">{copy('status.escalated')}</option>
              <option value="resolved">{copy('status.resolved')}</option>
              <option value="merged">{copy('status.merged')}</option>
            </select>
            <select value={ownershipFilter} onChange={(event) => setOwnershipFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">{copy('allOwners')}</option>
              <option value="mine">{copy('assignedToMe')}</option>
              <option value="unassigned">{copy('stats.unassigned')}</option>
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} className="col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">{copy('allPriorities')}</option>
              <option value="urgent">{copy('priority.urgent')}</option>
              <option value="high">{copy('priority.high')}</option>
              <option value="normal">{copy('priority.normal')}</option>
              <option value="low">{copy('priority.low')}</option>
            </select>
            <select value={messageFilter} onChange={(event) => setMessageFilter(event.target.value)} className="col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">{copy('allMessages')}</option>
              <option value="unread">{copy('unreadCustomer')}</option>
            </select>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className="col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">{copy('allCategories')}</option>
              {categories.map((category) => <option key={category} value={category}>{category.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)} className="col-span-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
              <option value="all">{copy('allChannels')}</option>
              <option value="web_chat">{copy('channels.webChat')}</option>
              <option value="email">{copy('channels.email')}</option>
              <option value="sms">{copy('channels.sms')}</option>
              <option value="phone">{copy('channels.phone')}</option>
              <option value="social">{copy('channels.social')}</option>
            </select>
          </div>

          <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pe-1">
            {!loading && visibleConversations.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                {queueError ? copy('queueUnavailable') : copy('noMatches')}
              </div>
            )}
            {visibleConversations.map((conversation) => (
              <button
                type="button"
                key={conversation.id}
                onClick={() => setSelectedId(conversation.id)}
                className={`w-full rounded-2xl border p-4 text-start transition ${selectedId === conversation.id ? 'border-orange-500/50 bg-orange-500/10' : 'border-slate-800 bg-slate-900/65 hover:border-slate-700'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{conversation.customer_name || conversation.customer_email || copy('customer')}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{conversation.subject}</div>
                  </div>
                  <span className={`text-[11px] font-semibold uppercase ${PRIORITY[conversation.priority] || 'text-slate-400'}`}>{conversation.priority || copy('priority.normal')}</span>
                </div>
                <div className="mt-3 line-clamp-2 text-xs leading-5 text-slate-400">{conversation.last_message || conversation.description || copy('noPreview')}</div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {statusBadge(conversation.status, t)}
                    <span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{conversation.channel || copy('channels.webChat')}</span>
                    {Number(conversation.unread_count || 0) > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-semibold text-orange-200" aria-label={copy('unreadAria', { count: conversation.unread_count })}>
                        <MessageSquare size={11} /> {copy('newCount', { count: conversation.unread_count })}
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-600">{formatWhen(conversation.updated_at || conversation.created_at)}</span>
                </div>
              </button>
            ))}
            {hasMoreConversations && (
              <button
                type="button"
                onClick={() => loadConversations({ quiet: true, append: true })}
                disabled={loadingMore}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-orange-500/50 disabled:opacity-50"
              >
                {loadingMore ? copy('loadingMore') : copy('loadMore')}
              </button>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
              <UserRound size={42} className="text-slate-700" />
              <h3 className="mt-4 text-lg font-semibold">{copy('selectConversation')}</h3>
              <p className="mt-2 max-w-md text-sm text-slate-500">{copy('selectDescription')}</p>
            </div>
          ) : (
            <>
              <header className="border-b border-slate-800 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {statusBadge(selected.status, t)}
                      <span className={`text-xs font-semibold uppercase ${PRIORITY[selected.priority] || 'text-slate-400'}`}>{t(`support.workspace.priority.${selected.priority}`, { defaultValue: selected.priority || 'normal' })} {copy('prioritySuffix')}</span>
                    </div>
                    <h3 className="mt-3 text-xl font-semibold">{selected.subject}</h3>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-400">
                      <span>{selected.customer_name || copy('customer')} · {selected.customer_email || copy('noEmail')}</span>
                      {selected.customer_email && <button type="button" onClick={() => copyContextValue(selected.customer_email, copy('email'))} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-orange-500/50" title={copy('copyCustomerEmail')}><Copy size={11} /> {copy('email')}</button>}
                      <button type="button" onClick={() => copyContextValue(selected.id, copy('conversationId'))} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-orange-500/50" title={copy('copyConversationId')}><Copy size={11} /> {copy('id')}</button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-slate-300">
                        {selected.customerHistory?.previousConversationCount > 0
                          ? copy('returningCustomer', { count: selected.customerHistory.previousConversationCount })
                          : copy('noPriorConversations')}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-slate-300">
                        {selected.category || 'general'}
                      </span>
                      <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-blue-200">
                        {copy('channel')} · {selected.channel || copy('channels.webChat')}
                      </span>
                      <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-slate-300">
                        {selected.customer_message_count || 0} {copy('customerMessages')} · {selected.agent_message_count || 0} {copy('supportMessages')}
                      </span>
                      {selected.review && (
                        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-emerald-200">
                          {copy('reviewed')} · {selected.review.rating}/5
                        </span>
                      )}
                      {selected.emailDelivery && Number(selected.emailDelivery.failed || 0) > 0 && (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-200" title={copy('emailDeliveryAttention')}>
                          {copy('emailDeliveryIssue')} · {selected.emailDelivery.failed} {copy('failed')}
                        </span>
                      )}
                      {selected.emailDelivery && Number(selected.emailDelivery.pending || 0) > 0 && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-200" title={copy('emailQueued')}>
                          {copy('emailRetryQueued')} · {selected.emailDelivery.pending} {copy('pending')}
                        </span>
                      )}
                      {channelDeliveries.filter((delivery) => ['failed', 'not_configured'].includes(delivery.status)).map((delivery) => (
                        <span key={delivery.id} className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-red-200" title={delivery.error_message || copy('channelDeliveryAttention')}>
                          {delivery.channel.toUpperCase()} {copy('delivery')} {delivery.status === 'not_configured' ? copy('notConfigured') : copy('failed')}
                          <button type="button" onClick={() => retryChannelDelivery(delivery.id)} disabled={channelRetryBusy} className="font-semibold underline disabled:opacity-50">{copy('retry')}</button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
                      <span>{copy('opened')} {formatWhen(selected.created_at)}</span>
                      <span>{selected.agent_name ? copy('assignedTo', { name: selected.agent_name }) : copy('stats.unassigned')}</span>
                      {selected.first_response_at && <span>{copy('firstResponse')} {formatWhen(selected.first_response_at)}</span>}
                      <SlaTimer target={selected.sla_first_response_target} label={copy('firstResponse')} />
                      <SlaTimer target={selected.sla_resolution_target} label={copy('resolution')} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={downloadTranscript} disabled={downloadBusy} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-orange-500/50 disabled:opacity-50" title={copy('downloadTranscript')}>
                      <Download size={13} /> {downloadBusy ? copy('preparing') : copy('download')}
                    </button>
                    <button type="button" onClick={() => downloadTranscript(true)} disabled={downloadBusy} className="inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200 hover:border-amber-400/60 disabled:opacity-50" title={copy('downloadCaseRecord')}>
                      <Download size={13} /> {copy('caseRecord')}
                    </button>
                    {Number(selected.emailDelivery?.failed || 0) > 0 && (
                      <button type="button" onClick={retryFailedEmails} disabled={emailRetryBusy} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-200 hover:border-red-400/60 disabled:opacity-50" title={copy('retryFailedNotifications')}>
                        <RefreshCw size={13} className={emailRetryBusy ? 'animate-spin' : ''} /> {emailRetryBusy ? copy('retrying') : copy('retryEmail')}
                      </button>
                    )}
                    {!selected.agent_id && !isClosed && (
                      <button type="button" onClick={claim} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 px-3 py-2 text-xs font-semibold hover:bg-orange-500 disabled:opacity-50">
                        <Lock size={13} /> {copy('claim')}
                      </button>
                    )}
                    {selected.agent_id && (isAssignedToMe || isPlatformAdmin) && !isClosed && (
                      <button type="button" onClick={release} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50">
                        <Unlock size={13} /> {copy('release')}
                      </button>
                    )}
                    {isPlatformAdmin && !isClosed && (
                      <select value={selected.agent_id || ''} onChange={(event) => assign(event.target.value)} disabled={busy} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
                        <option value="">{copy('assignAgent')}</option>
                        {agents.filter((agent) => agent.status === 'active').map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}{agent.is_available ? ' · online' : ''}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                {(isPlatformAdmin || isAssignedToMe) && mergeTargets.length > 0 && !isClosed && (
                  <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
                    <label className="min-w-[220px] flex-1 text-xs text-slate-400">{copy('mergeDuplicateInto')}
                      <select value={mergeTargetId} onChange={(event) => setMergeTargetId(event.target.value)} disabled={mergeBusy} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200">
                        <option value="">{copy('chooseConversation')}</option>
                        {mergeTargets.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.subject} · {conversation.status}</option>)}
                      </select>
                    </label>
                    <label className="min-w-[220px] flex-1 text-xs text-slate-400">{copy('reasonOptional')}
                      <input value={mergeReason} onChange={(event) => setMergeReason(event.target.value)} maxLength={1000} disabled={mergeBusy} placeholder={copy('duplicateRequest')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200" />
                    </label>
                    <button type="button" onClick={mergeSelectedConversation} disabled={mergeBusy || !mergeTargetId} className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/20 disabled:opacity-50">{mergeBusy ? copy('merging') : copy('mergeSafely')}</button>
                  </div>
                )}

                {(canReply || isPlatformAdmin) && !isClosed && (
                  <div className="mt-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-blue-200">{copy('nextActions')}</div>
                        <div className="mt-1 text-xs text-slate-400">{copy('followUpDescription')}</div>
                      </div>
                      {followUpReminders.filter((reminder) => reminder.status === 'pending').length > 0 && <span className="rounded-full border border-blue-500/30 px-2 py-1 text-xs text-blue-200">{copy('pendingCount', { count: followUpReminders.filter((reminder) => reminder.status === 'pending').length })}</span>}
                    </div>
                    {followUpReminders.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {followUpReminders.map((reminder) => (
                          <div key={reminder.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-xs">
                            <div className="min-w-0"><span className="font-medium text-slate-200">{formatWhen(reminder.due_at)}</span><span className="ms-2 capitalize text-slate-500">{reminder.status}</span>{reminder.note && <div className="mt-1 truncate text-slate-400">{reminder.note}</div>}</div>
                            {reminder.status === 'pending' && <div className="flex gap-2"><button type="button" disabled={followUpBusy} onClick={() => updateFollowUpReminder(reminder.id, 'completed')} className="rounded-lg border border-emerald-500/30 px-2 py-1 text-emerald-200 hover:bg-emerald-500/10">{copy('complete')}</button><button type="button" disabled={followUpBusy} onClick={() => updateFollowUpReminder(reminder.id, 'cancelled')} className="rounded-lg border border-slate-700 px-2 py-1 text-slate-400 hover:text-slate-200">{copy('cancel')}</button></div>}
                          </div>
                        ))}
                      </div>
                    )}
                    <form onSubmit={createFollowUpReminder} className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr_auto] sm:items-end">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{copy('dueAt')}<input type="datetime-local" required value={followUpDueAt} onChange={(event) => setFollowUpDueAt(event.target.value)} disabled={followUpBusy} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200" /></label>
                      <label className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{copy('note')}<input value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} maxLength={2000} disabled={followUpBusy} placeholder={copy('callCustomerNextSteps')} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 text-xs text-slate-200" /></label>
                      <button type="submit" disabled={followUpBusy || !followUpDueAt} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50">{followUpBusy ? copy('saving') : copy('addFollowUp')}</button>
                    </form>
                  </div>
                )}

                {(canReply || isPlatformAdmin || (selected.status === 'resolved' && isAssignedToMe)) && (
                  <div className="mt-4 space-y-3">
                    {!isClosed && <label className="block max-w-2xl text-xs text-slate-400">{copy('resolutionSummary')} <span className="text-slate-500">{copy('shownWhenResolved')}</span>
                      <textarea value={resolutionSummary} onChange={(event) => setResolutionSummary(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full resize-none rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500" placeholder={copy('resolutionSummaryPlaceholder')} />
                    </label>}
                    {selected.resolution_summary && isClosed && <div className="max-w-2xl rounded-xl border border-orange-500/25 bg-orange-500/10 px-3 py-2 text-xs text-orange-100"><span className="font-semibold">{copy('resolutionSummary')}:</span> {selected.resolution_summary}{selected.resolution_reason_code && <span className="ms-2 text-orange-200/70">({selected.resolution_reason_code})</span>}</div>}
                    {!isClosed && <label className="block max-w-2xl text-xs text-slate-400">{copy('resolutionReason')}
                      <select value={resolutionReasonCode} onChange={(event) => setResolutionReasonCode(event.target.value)} disabled={busy} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none focus:border-orange-500">
                        <option value="resolved">{copy('status.resolved')}</option>
                        <option value="bug_fixed">{copy('resolutionReasons.bugFixed')}</option>
                        <option value="billing">{copy('resolutionReasons.billing')}</option>
                        <option value="how_to">{copy('resolutionReasons.howTo')}</option>
                        <option value="duplicate">{copy('resolutionReasons.duplicate')}</option>
                        <option value="customer_no_response">{copy('resolutionReasons.customerNoResponse')}</option>
                        <option value="not_supported">{copy('resolutionReasons.notSupported')}</option>
                        <option value="spam">{copy('resolutionReasons.spam')}</option>
                        <option value="other">{copy('resolutionReasons.other')}</option>
                      </select>
                    </label>}
                    <div className="flex flex-wrap gap-2">
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('waiting_for_customer')} className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-amber-500/50">{copy('waitingForCustomer')}</button>}
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('escalated')} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs text-red-200 hover:bg-red-500/10">{copy('escalate')}</button>}
                    {!isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('resolved', { resolutionSummary: resolutionSummary.trim(), resolutionReasonCode })} className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 px-3 py-2 text-xs text-emerald-200 hover:bg-emerald-500/10"><CheckCircle2 size={13} /> {copy('resolve')}</button>}
                    {selected.status === 'resolved' && <button type="button" disabled={busy} onClick={() => updateStatus('closed', { resolutionSummary: selected.resolution_summary || resolutionSummary.trim(), resolutionReasonCode: selected.resolution_reason_code || resolutionReasonCode })} className="rounded-xl border border-slate-500/40 px-3 py-2 text-xs text-slate-200 hover:bg-slate-500/10">{copy('closeCase')}</button>}
                    {isClosed && <button type="button" disabled={busy} onClick={() => updateStatus('open')} className="rounded-xl border border-blue-500/30 px-3 py-2 text-xs text-blue-200 hover:bg-blue-500/10">{copy('reopen')}</button>}
                    </div>
                  </div>
                )}
              </header>

              <div
                ref={messageListRef}
                onScroll={(event) => {
                  const element = event.currentTarget;
                  const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
                  stickToBottomRef.current = nearBottom;
                  if (nearBottom) setShowNewMessages(false);
                }}
                className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.05),transparent_30%)] p-5"
              >
                {showNewMessages && <button type="button" role="status" aria-live="polite" aria-atomic="true" onClick={() => { stickToBottomRef.current = true; setShowNewMessages(false); messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'smooth' }); }} className="sticky top-2 z-10 mx-auto block rounded-full border border-orange-500/40 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-orange-200 shadow-lg">{copy('newMessages')} ↓</button>}
                {customerTyping && <div className="sticky top-2 z-10 mx-auto mb-3 w-fit rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 shadow-lg" role="status" aria-live="polite">{copy('customerTyping')}</div>}
                {detailLoading ? (
                  <div className="flex h-full items-center justify-center"><RefreshCw className="animate-spin text-orange-400" /></div>
                ) : (
                  <div className="space-y-4">
                    {ticketViewerCount > 1 && (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-100" role="status" aria-live="polite">
                        {copy('otherStaffViewing', { count: ticketViewerCount })}
                        {ticketViewers.length > 0 && <span className="mt-1 block font-normal text-amber-100/80">{copy('currentlyViewing')}: {ticketViewers.map((viewer) => viewer.name).filter(Boolean).join(', ')}</span>}
                      </div>
                    )}
                    <Customer360Panel
                      data={customer360}
                      loading={customer360Loading}
                      lifecycle={lifecycle}
                      lifecycleLoading={lifecycleLoading}
                      canIssueRefunds={isPlatformAdmin}
                      canAdjustCredit={isPlatformAdmin}
                      onResolutionAction={() => { if (selectedId) loadCustomer360(selectedId); }}
                    />
                    {selected.review && (
                      <section className="rounded-2xl border border-emerald-500/25 bg-emerald-500/10 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-emerald-200">{copy('customerReview')}</span>
                          <span className="text-lg text-orange-300" aria-label={`${selected.review.rating} out of 5 stars`}>
                            {'★'.repeat(Number(selected.review.rating || 0))}{'☆'.repeat(Math.max(0, 5 - Number(selected.review.rating || 0)))}
                          </span>
                        </div>
                        {selected.review.comment && <p className="mt-2 text-sm text-slate-200">{selected.review.comment}</p>}
                        {selected.review.nps_score != null && <p className="mt-2 text-xs text-slate-300">NPS: <span className="font-semibold text-orange-200">{selected.review.nps_score}/10</span></p>}
                        <p className="mt-2 text-[11px] text-slate-500">{copy('submitted')} {formatWhen(selected.review.updated_at || selected.review.created_at)}</p>
                      </section>
                    )}
                    {selected.customerHistory?.previousConversationCount > 0 && (
                      <section className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-orange-200">
                            <History size={16} /> Customer history
                          </div>
                          <span className="rounded-full border border-orange-500/30 px-2.5 py-1 text-[11px] font-semibold text-orange-200">
                            {copy('previousConversations', { count: selected.customerHistory.previousConversationCount })}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">
                          {copy('verifiedSupportHistory', { email: selected.customerHistory.email || selected.customer_email })}
                        </p>
                        <div className="mt-3 space-y-2">
                          {selected.customerHistory.conversations.map((history) => (
                            <details key={history.id} className="rounded-xl border border-slate-800 bg-slate-950/70">
                              <summary className="cursor-pointer list-none px-3 py-3 text-sm">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-200">{history.subject}</span>
                                  <span className="text-xs text-slate-500">{statusBadge(history.status, t)} · {formatWhen(history.created_at)}</span>
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {history.customer_message_count || 0} {copy('customerMessages')} · {history.agent_message_count || 0} {copy('supportMessages')}
                                </div>
                              </summary>
                              <div className="space-y-2 border-t border-slate-800 px-3 py-3">
                                {history.messages.length === 0 && <p className="text-xs text-slate-500">{copy('noMessagesRecorded')}</p>}
                                {history.messages.map((message) => {
                                  const fromAgent = Boolean(message.is_agent || message.is_from_agent);
                                  const isNote = message.message_type === 'internal_note';
                                  return (
                                    <div key={message.id} className={`rounded-xl border px-3 py-2 text-xs ${isNote ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : fromAgent ? 'border-orange-500/20 bg-orange-500/10 text-orange-100' : 'border-slate-800 bg-slate-900 text-slate-300'}`}>
                                      <div className="mb-1 flex items-center gap-2 text-[10px] opacity-70">
                                        <span>{message.sender_name || (fromAgent ? copy('supportTeam') : history.customer_name || copy('customer'))}</span>
                                        {isNote && <span className="rounded-full border border-amber-400/30 px-1.5 py-0.5">{copy('internalNote')}</span>}
                                        <span className="ms-auto">{formatWhen(message.created_at)}</span>
                                      </div>
                                      {message.attachment_url && <a href={message.attachment_url} download={message.attachment_name || undefined} target="_blank" rel="noreferrer" className="group relative mb-2 block w-fit" aria-label={copy('downloadAttachment', { name: message.attachment_name || copy('supportAttachment') })}><img src={message.attachment_url} alt={message.attachment_name || copy('supportAttachment')} className="max-h-40 max-w-full rounded-lg object-contain transition group-hover:opacity-90" /><span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-lg bg-slate-950/85 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100"><Download size={12} /> {copy('download')}</span></a>}
                                      {messageBody(message) && <div className="whitespace-pre-wrap leading-5">{messageBody(message)}</div>}
                                      {message.edited_at && <div className="mt-1 text-[10px] opacity-60">{copy('edited')} {formatWhen(message.edited_at)}</div>}
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
                      const channelDelivery = channelDeliveryByMessageId.get(message.id);
                      const isChannelReply = message.message_type === 'outbound_channel';
                      const channelDeliveryStatus = channelDelivery?.status || message.status;
                      const canEdit = fromAgent && !isNote && !isClosed
                        && (isPlatformAdmin || message.sender_id === user?.id)
                        && Date.now() - new Date(message.created_at).getTime() < 15 * 60 * 1000;
                      const canRedact = !isClosed && !message.redacted_at;
                      return (
                        <div key={message.id} className={`flex ${fromAgent ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[84%] rounded-2xl border px-4 py-3 ${isNote ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : fromAgent ? 'border-orange-500/20 bg-orange-600 text-white' : 'border-slate-800 bg-slate-900 text-slate-200'}`}>
                            <div className="mb-2 flex items-center gap-2 text-[11px] opacity-70">
                              <span>{message.sender_name || (fromAgent ? copy('supportTeam') : selected.customer_name || copy('customer'))}</span>
                              {isNote && <span className="rounded-full border border-amber-400/30 px-2 py-0.5">{copy('internalNote')}</span>}
                              {isChannelReply && channelDeliveryStatus === 'sending' && <span className="rounded-full border border-blue-400/30 px-2 py-0.5 text-blue-100">{copy('deliveringVia', { channel: message.channel || selected.channel })}</span>}
                              {isChannelReply && channelDeliveryStatus === 'failed' && <span className="rounded-full border border-red-400/30 px-2 py-0.5 text-red-100">{copy('deliveryFailed')}</span>}
                            </div>
                            {message.attachment_url && <a href={message.attachment_url} download={message.attachment_name || undefined} target="_blank" rel="noreferrer" className="group relative mb-2 block w-fit" aria-label={copy('downloadAttachment', { name: message.attachment_name || copy('supportAttachment') })}><img src={message.attachment_url} alt={message.attachment_name || copy('supportAttachment')} onLoad={() => { if (stickToBottomRef.current) messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: 'auto' }); }} className="max-h-64 max-w-full rounded-xl object-contain transition group-hover:opacity-90" /><span className="absolute bottom-2 end-2 inline-flex items-center gap-1 rounded-lg bg-slate-950/85 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow transition group-hover:opacity-100 group-focus-visible:opacity-100"><Download size={12} /> {copy('download')}</span></a>}
                            {editingMessageId === message.id ? (
                              <div className="space-y-2">
                                <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} maxLength={5000} rows={3} className="w-full rounded-xl bg-slate-900 px-3 py-2 text-white" />
                                <div className="flex gap-2">
                                  <button type="button" onClick={() => editAgentMessage(message.id)} disabled={busy || !editingContent.trim()} className="rounded-lg bg-white/20 px-3 py-1.5 text-xs font-semibold">{copy('save')}</button>
                                  <button type="button" onClick={() => setEditingMessageId(null)} className="rounded-lg px-3 py-1.5 text-xs text-white/70">{copy('cancel')}</button>
                                </div>
                              </div>
                            ) : (
                              <>
                                {messageBody(message) && <div className="whitespace-pre-wrap text-sm leading-6">{messageBody(message)}</div>}
                                <div className="mt-2 flex flex-wrap gap-3">
                                  {canEdit && <button type="button" onClick={() => { setEditingMessageId(message.id); setEditingContent(messageBody(message)); }} className="inline-flex items-center gap-1 text-xs opacity-75 hover:opacity-100"><Pencil size={12} /> {copy('editReply')}</button>}
                                  {canRedact && <button type="button" onClick={() => redactMessage(message)} disabled={busy} className="inline-flex items-center gap-1 text-xs text-red-200/80 opacity-80 hover:opacity-100 disabled:opacity-40"><Trash2 size={12} /> {copy('redact')}</button>}
                                  {isChannelReply && channelDelivery && channelDeliveryStatus !== 'sent' && ['failed', 'not_configured'].includes(channelDeliveryStatus) && <button type="button" onClick={() => retryChannelDelivery(channelDelivery.id)} disabled={channelRetryBusy} className="inline-flex items-center gap-1 text-xs font-semibold text-red-100 underline disabled:opacity-40"><RefreshCw size={12} /> {copy('retryDelivery')}</button>}
                                </div>
                              </>
                            )}
                            {fromAgent && message.read_by_recipient && <div className="mt-2 text-[11px] opacity-60">{copy('readByCustomer')}</div>}
                            {message.edited_at && <div className="mt-2 text-[11px] opacity-60">{copy('edited')} {formatWhen(message.edited_at)}</div>}
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
                    {copy('claimBeforeReply')}
                  </div>
                )}
                    <div className="mb-3 flex gap-2">
                  <button type="button" onClick={() => setInternalNote(false)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${!internalNote ? 'bg-orange-600 text-white' : 'bg-slate-900 text-slate-400'}`}><MessageSquare size={12} className="me-1 inline" /> {copy('customerReply')}</button>
                  <button type="button" onClick={() => setInternalNote(true)} className={`rounded-xl px-3 py-2 text-xs font-semibold ${internalNote ? 'bg-amber-600 text-white' : 'bg-slate-900 text-slate-400'}`}><Lock size={12} className="me-1 inline" /> {copy('internalNote')}</button>
                  <select
                    value={quickReply}
                    onChange={(event) => {
                      const next = responseTemplates.find((template) => String(template.id) === event.target.value);
                      setQuickReply('');
                      if (next) setReply((current) => current.trim() ? `${current.trim()}\n\n${next.content}` : next.content);
                    }}
                    disabled={!canReply || busy}
                    className="ms-auto max-w-[180px] rounded-xl bg-slate-900 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"
                    aria-label={copy('insertQuickReply')}
                  >
                    <option value="">{templatesLoading ? copy('loadingSavedReplies') : responseTemplates.length ? copy('insertSavedReply') : copy('noSavedReplies')}</option>
                    {responseTemplates.map((template) => <option key={template.id} value={template.id}>{template.title || template.name}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const nextOpen = !knowledgeOpen;
                      setKnowledgeOpen(nextOpen);
                      if (nextOpen) loadKnowledgeArticles();
                    }}
                    disabled={!canReply || busy || knowledgeLoading}
                    className={`inline-flex items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold ${knowledgeOpen ? 'bg-blue-500/15 text-blue-200' : 'bg-slate-900 text-slate-400'} disabled:opacity-50`}
                    aria-expanded={knowledgeOpen}
                  >
                    <BookOpen size={13} /> {copy('helpCenter')}
                  </button>
                  <button
                    type="button"
                    onClick={generateAIDraft}
                    disabled={!canReply && !isPlatformAdmin || busy || aiDraftBusy || isClosed}
                    className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <Sparkles size={13} /> {aiDraftBusy ? copy('drafting') : copy('draftWithAi')}
                  </button>
                </div>
                {aiDraft && (
                  <div className="mb-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3" role="status" aria-label={copy('aiDraftAwaitingApproval')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-200">{copy('aiDraftReview')}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{copy('aiDraftPrivate')}</div>
                      </div>
                      <span className="rounded-full border border-emerald-500/30 px-2 py-1 text-[11px] text-emerald-200">{copy('pendingApproval')}</span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-sm leading-6 text-slate-200">{aiDraft.draft_content}</p>
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={discardAIDraft} disabled={aiDraftBusy} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-red-400/50 disabled:opacity-50">{copy('discard')}</button>
                      <button type="button" onClick={() => setReply(aiDraft.draft_content || '')} disabled={aiDraftBusy} className="rounded-xl border border-emerald-500/30 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/10 disabled:opacity-50">{copy('editInComposer')}</button>
                      <button type="button" onClick={applyAIDraft} disabled={aiDraftBusy || !canReply && !isPlatformAdmin} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">{aiDraftBusy ? copy('applying') : copy('approveAndSend')}</button>
                    </div>
                  </div>
                )}
                {knowledgeOpen && (
                  <div className="mb-3 rounded-2xl border border-blue-500/25 bg-blue-500/5 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        value={knowledgeSearch}
                        onChange={(event) => setKnowledgeSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            loadKnowledgeArticles();
                          }
                        }}
                        placeholder={copy('searchHelpArticles')}
                        className="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-blue-400"
                        aria-label={copy('searchHelpArticles')}
                      />
                      <button type="button" onClick={loadKnowledgeArticles} disabled={knowledgeLoading} className="rounded-xl border border-blue-500/30 px-3 py-2 text-xs font-semibold text-blue-200 disabled:opacity-50">
                        {knowledgeLoading ? copy('searching') : copy('search')}
                      </button>
                    </div>
                    <div className="mt-2 max-h-48 space-y-2 overflow-y-auto">
                      {!knowledgeLoading && knowledgeArticles.length === 0 && <p className="px-1 py-2 text-xs text-slate-500">{copy('noHelpArticles')}</p>}
                      {knowledgeArticles.map((article) => (
                        <div key={article.id} className="rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-slate-200">{article.title}</div>
                            <button
                              type="button"
                              onClick={() => setReply((current) => {
                                const content = String(article.content || article.excerpt || '').slice(0, 10000);
                                return current.trim() ? `${current.trim()}\n\n${content}` : content;
                              })}
                              className="rounded-lg border border-blue-500/30 px-2 py-1 text-[11px] font-semibold text-blue-200 hover:bg-blue-500/10"
                            >
                              {copy('insertIntoReply')}
                            </button>
                          </div>
                          {article.excerpt && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{article.excerpt}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {internalNote && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" role="status">
                    <Lock size={13} /> {copy('internalNoteMode')}
                  </div>
                )}
                {!internalNote && isExternalChannel && (
                  <div className="mb-3 rounded-xl border border-blue-500/25 bg-blue-500/10 px-3 py-2 text-xs text-blue-100" role="status">
                    {copy('externalReplyDelivery', { channel: selected.channel === 'sms' ? 'SMS' : selected.channel === 'email' ? 'email' : selected.channel })}
                  </div>
                )}
                {!internalNote && isExternalChannel && channelCapabilitiesLoading && (
                  <div className="mb-3 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs text-slate-400" role="status">
                    {copy('checkingDelivery', { channel: selected.channel })}
                  </div>
                )}
                {!internalNote && isExternalChannel && channelNotReady && (
                  <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100" role="alert">
                    {channelCapability.supported
                      ? copy('channelNotConfigured', { provider: channelCapability.provider || selected.channel })
                      : copy('channelUnavailable', { channel: selected.channel })}
                  </div>
                )}
                {sendError && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100" role="alert">
                    <span>{sendError} Your draft is still here.</span>
                    <button
                      type="button"
                      onClick={() => sendMessage({ preventDefault: () => {} })}
                      disabled={busy || !canReply || (!reply.trim() && !attachment)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-400/40 px-2.5 py-1.5 font-semibold text-red-100 hover:bg-red-500/15 disabled:opacity-50"
                    >
                      <RefreshCw size={12} /> {copy('retry')}
                    </button>
                  </div>
                )}
                {attachment && <div className="mb-2 flex items-center gap-2 text-xs text-orange-200">{attachment.name}<button type="button" onClick={() => setAttachment(null)} className="text-slate-400 hover:text-white">{copy('remove')}</button></div>}
                <div className="flex gap-3">
                  <label className={`rounded-2xl border border-slate-700 p-3 text-slate-300 ${isExternalChannel && !internalNote ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:border-orange-500'}`} title={isExternalChannel && !internalNote ? copy('externalAttachmentsUnsupported') : copy('attachImage')}>
                    <Paperclip size={18} />
                    <input type="file" accept="image/jpeg,image/png,image/gif,image/webp" disabled={isExternalChannel && !internalNote} className="hidden" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />
                  </label>
                  <textarea
                    ref={replyInputRef}
                    value={reply}
                    onChange={handleAgentReplyChange}
                    onBlur={() => {
                      window.clearTimeout(typingTimerRef.current);
                      if (selectedId) agentSocketRef.current?.emit('agent:typing', { ticketId: selectedId, isTyping: false });
                    }}
                    disabled={!canReply || busy}
                    rows={3}
                    placeholder={internalNote ? copy('privateContextPlaceholder') : copy('replyPlaceholder')}
                    className="min-w-0 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none focus:border-orange-500 disabled:opacity-50"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendMessage(event);
                    }}
                  />
                  <button type="submit" aria-label={t('common.send', { defaultValue: 'Send' })} disabled={!canReply || busy || channelNotReady || (!reply.trim() && !attachment)} className="self-end rounded-2xl bg-orange-600 p-4 text-white hover:bg-orange-500 disabled:opacity-40"><Send size={18} aria-hidden="true" /></button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
