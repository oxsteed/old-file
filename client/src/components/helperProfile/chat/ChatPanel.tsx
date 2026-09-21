import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, MessageCircle, Building2, LogIn, Trash2, Check, XCircle, Search, Maximize2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import type {
  ChatSession,
  ChatDestination,
  ChatMessage,
  TimelineEvent,
  TimelineItem,
} from '../../../types/helperProfile';
import ChatDestinationDropdown from './ChatDestinationDropdown';
import StatusBadge from './StatusBadge';
import ChatTimeline from './ChatTimeline';
import MessageComposer from './MessageComposer';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import { useSocket } from '../../../hooks/useSocket';
import { readGuestContact } from './messengerDockState.js';
import { buildSupportEscalationHandoff } from './supportEscalationHandoff.js';

interface ChatPanelProps {
  session: ChatSession;
  helperName: string;
  helperId: string;
  /** When set, the chat is scoped to a business (used on /business/:id pages). */
  businessId?: string;
  /** Visitor without an account - collect name/email and POST to guest session endpoint */
  isGuest?: boolean;
  /** When false, disables live chat mode; user can only use AI assistant */
  allowLiveChat?: boolean;
  /** 'sidebar' = embedded on desktop (no close btn). 'modal' = mobile drawer (shows close btn). 'dock' = messenger dock body. */
  variant?: 'sidebar' | 'modal' | 'dock';
  onClose?: () => void;
  className?: string;
  /** Override the chat destination (helper or oxsteed) from parent */
  destination?: ChatDestination;
  /** Callback when destination changes */
  onDestinationChange?: (destination: ChatDestination) => void;
  /** Ref to the message input textarea for external focus/scroll */
  messageInputRef?: React.RefObject<HTMLTextAreaElement>;
  roomy?: boolean;
  onExpand?: () => void;
}

// ── Offline / Message-mode empty state ───────────────────────────────────────
const UnavailableState: React.FC<{ destination: ChatDestination; helperName: string }> = ({
  destination, helperName,
}) => {
  const { t } = useTranslation();
  const name = destination === 'helper' ? helperName : t('helperProfile.chat.oxsteedAssistantLabel');
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center py-10">
      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
        <MessageCircle className="w-6 h-6 text-gray-500" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-medium text-white">{t('messages.isOffline', { name })}</p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">
          {t('messages.leaveMessage')}
        </p>
      </div>
    </div>
  );
};

// ── OxSteed context banner ────────────────────────────────────────────────────
const DestinationContextBanner: React.FC<{
  destination: ChatDestination;
  helperName: string;
  helperId: string;
  businessId?: string;
  timeline: TimelineItem[];
}> = ({ destination, helperName, helperId, businessId, timeline }) => {
  const { t } = useTranslation();
  if (destination === 'helper') return null;

  const returnTo = typeof window !== 'undefined'
    ? `${window.location.pathname}${window.location.search}`
    : undefined;
  const handoff = buildSupportEscalationHandoff({
    helperId,
    businessId,
    helperName,
    returnTo,
    timeline,
  });

  return (
    <div
      className="flex items-start gap-2 px-4 py-2.5 bg-violet-900/20 border-b border-violet-800/50"
      aria-label={t('messages.talkingToSupport', { name: helperName, support: t('messages.oxsteedSupport') })}
    >
      <Building2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-violet-300">
          {t('messages.talkingToSupport', { name: helperName, support: t('messages.oxsteedSupport') })}
        </p>
        <p className="text-[11px] text-violet-400/90 mt-0.5">
          {t('helperProfile.chat.oxsteedAiOnlyHint', {
            defaultValue: 'OxSteed here is AI. For a live support specialist, continue below.',
          })}
        </p>
        <Link
          to={{ pathname: handoff.pathname, search: handoff.search }}
          state={handoff.state}
          className="inline-block mt-1.5 text-xs font-semibold text-violet-200 underline hover:text-white"
        >
          {t('helperProfile.chat.talkToHumanCta')}
        </Link>
      </div>
    </div>
  );
};

// ── Sign-in prompt (shown to unauthenticated users when helper is live) ───────
const SignInPrompt: React.FC<{ helperName: string }> = ({ helperName }) => {
  const { t } = useTranslation();
  return (
    <div className="mx-4 my-3 p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl flex items-start gap-2.5">
      <LogIn className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div>
        <p className="text-xs text-orange-200 leading-relaxed">
          <span className="font-semibold">{t('messages.helperIsOnline', { name: helperName })}</span>{' '}
          <Link to="/login" className="underline hover:text-orange-100">{t('auth.signIn') || 'Sign in'}</Link>{' '}
          {t('messages.signInForReal')}
        </p>
      </div>
    </div>
  );
};

// ── Main ChatPanel ────────────────────────────────────────────────────────────
const ChatPanel: React.FC<ChatPanelProps> = ({
  session: initialSession,
  helperName,
  helperId,
  businessId,
  isGuest = false,
  allowLiveChat = true,
  variant = 'sidebar',
  onClose,
  className = '',
  destination: externalDestination,
  onDestinationChange,
  messageInputRef,
  roomy = false,
  onExpand,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { socket } = useSocket();

  const [session,          setSession]          = useState<ChatSession>(initialSession);
  const [sending,          setSending]          = useState(false);
  const [guestName,        setGuestName]        = useState('');
  const [guestEmail,       setGuestEmail]       = useState('');
  /** Guest saved contact locally - send button sends message + this contact */
  const [guestContactSaved, setGuestContactSaved] = useState(() => {
    if (!isGuest) return false;
    return Boolean(readGuestContact(helperId, businessId));
  });
  const [conversationId,   setConversationId]   = useState<string | null>(null);
  // threadId ties this chat session to server-side Redis history (AI mode only).
  // null until the first AI response is received; echoed back on every subsequent send.
  const [threadId,         setThreadId]         = useState<string | null>(null);
  const internalTextareaRef = React.useRef<HTMLTextAreaElement>(null);
  const textareaRef = messageInputRef || internalTextareaRef;

  // Search state
  const [searchQuery,      setSearchQuery]      = useState('');
  const [searchFilter,     setSearchFilter]     = useState<'all' | 'me' | 'helper'>('all');
  const [searchResults,    setSearchResults]    = useState<ChatMessage[]>([]);
  const [searchLoading,    setSearchLoading]    = useState(false);
  const searchTimeoutRef   = useRef<NodeJS.Timeout | null>(null);

  // Pagination state
  const [messageOffset,    setMessageOffset]    = useState(0);
  const [hasMoreMessages,  setHasMoreMessages]  = useState(true);
  const [loadingOlder,     setLoadingOlder]     = useState(false);

  // Inline-edit state for ChatPanel messages
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText,      setEditingText]      = useState('');
  const [searchOpen,       setSearchOpen]       = useState(false);
  const guestClaimKeyRef = useRef<string | null>(null);

  // ── Live status polling ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const { data } = await api.get(`/helpers/${helperId}/status`);
        if (cancelled) return;
        setSession(prev => ({
          ...prev,
          helperStatus: data.helperStatus,
          status: prev.destination === 'helper' ? data.helperStatus : prev.oxsteedStatus,
        }));
      } catch { /* silent */ }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [helperId]);

  const guestStorageKey = `oxs:guest-contact:${helperId}:${businessId ?? 'personal'}`;
  const guestTokenKey = `oxs:guest-token:${helperId}:${businessId ?? 'personal'}`;

  useEffect(() => {
    if (!isGuest) return;

    // Try to restore from URL guest-token param first (returning visitor)
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('guest-token');

    let restored = false;

    if (urlToken) {
      try {
        const decoded = JSON.parse(atob(urlToken.split('.')[1])) as any;
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp && decoded.exp < now) {
          // Token expired
          localStorage.removeItem(guestTokenKey);
          return;
        }
        if (decoded.guestEmail?.trim()) {
          setGuestEmail(decoded.guestEmail.trim());
          setGuestName(decoded.guestName?.trim() || '');
          if (decoded.guestEmail?.trim() && decoded.guestName?.trim()) {
            setGuestContactSaved(true);
            localStorage.setItem(guestTokenKey, urlToken);
            restored = true;
          }
        }
      } catch {
        // Invalid token, ignore
      }
    }

    // Fall back to localStorage guest token
    if (!restored) {
      try {
        const savedToken = localStorage.getItem(guestTokenKey);
        if (savedToken) {
          const decoded = JSON.parse(atob(savedToken.split('.')[1])) as any;
          const now = Math.floor(Date.now() / 1000);
          if (decoded.exp && decoded.exp < now) {
            localStorage.removeItem(guestTokenKey);
            return;
          }
          if (decoded.guestEmail?.trim()) {
            setGuestEmail(decoded.guestEmail.trim());
            setGuestName(decoded.guestName?.trim() || '');
            if (decoded.guestEmail?.trim() && decoded.guestName?.trim()) {
              setGuestContactSaved(true);
              restored = true;
            }
          }
        }
      } catch {
        localStorage.removeItem(guestTokenKey);
      }
    }

    // Fall back to sessionStorage contact form data
    if (!restored) {
      try {
        const raw = sessionStorage.getItem(guestStorageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { name?: string; email?: string };
        if (parsed?.name?.trim()) setGuestName(parsed.name.trim());
        if (parsed?.email?.trim()) setGuestEmail(parsed.email.trim());
        if (parsed?.name?.trim() && parsed?.email?.trim()) setGuestContactSaved(true);
      } catch {
        /* ignore */
      }
    }
  }, [isGuest, guestStorageKey, guestTokenKey]);

  useEffect(() => {
    if (!isGuest || session.destination !== 'helper') return;
    if (!user?.email || !guestContactSaved) return;

    const guestEmailNormalized = guestEmail.trim().toLowerCase();
    const userEmailNormalized = String(user.email || '').trim().toLowerCase();
    if (!guestEmailNormalized || guestEmailNormalized !== userEmailNormalized) return;

    const claimKey = `${helperId}:${businessId ?? 'personal'}:${guestEmailNormalized}`;
    if (guestClaimKeyRef.current === claimKey) return;

    let cancelled = false;
    guestClaimKeyRef.current = claimKey;

    (async () => {
      try {
        const { data } = await api.post('/chat/sessions/guest/claim');
        if (cancelled) return;

        const claimedConversation = Array.isArray(data?.claimed)
          ? data.claimed.find((item: any) => item?.conversationId)
          : null;
        if (claimedConversation?.conversationId) {
          setConversationId(String(claimedConversation.conversationId));
        }

        if (Number(data?.count || 0) > 0) {
          toast.success(t('messages.guestClaimedToast'));
        }
      } catch {
        if (!cancelled) {
          guestClaimKeyRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isGuest, session.destination, user?.email, guestContactSaved, guestEmail, helperId, businessId, t]);

  // Reset pagination when conversation changes
  useEffect(() => {
    setMessageOffset(0);
    setHasMoreMessages(true);
  }, [conversationId]);

  // ── Real-time: listen for helper replies via Socket.IO ───────────────────
  useEffect(() => {
    if (!socket || !conversationId) return;

    const handleNewMessage = (payload: { conversationId: string; message: any }) => {
      if (payload.conversationId !== conversationId) return;
      const msg = payload.message;
      const timelineMsg: ChatMessage = {
        id:         String(msg.id),
        itemType:   'message',
        authorType: 'helper_human',
        content:    msg.content,
        timestamp:  msg.created_at || new Date().toISOString(),
      };
      setSession(prev => ({
        ...prev,
        typing:   null,
        timeline: [...prev.timeline, timelineMsg],
      }));
    };

    const handleMessageEdited = (payload: { conversationId: string; message: any }) => {
      if (payload.conversationId !== conversationId) return;
      const msg = payload.message;
      setSession(prev => ({
        ...prev,
        timeline: prev.timeline.map(item =>
          item.itemType === 'message' && item.id === String(msg.id)
            ? { ...item, content: msg.content, timestamp: msg.edited_at || item.timestamp }
            : item
        ),
      }));
    };

    const handleMessageDeleted = (payload: { conversationId: string; messageId: string }) => {
      if (payload.conversationId !== conversationId) return;
      setSession(prev => ({
        ...prev,
        timeline: prev.timeline.filter(item => !(item.itemType === 'message' && item.id === String(payload.messageId))),
      }));
    };

    const handleMessagesRead = (payload: { conversationId: string; readBy: string; readAt: string }) => {
      if (payload.conversationId !== conversationId) return;
      // Mark all messages sent by current user as read
      setSession(prev => ({
        ...prev,
        timeline: prev.timeline.map(item =>
          item.itemType === 'message' && item.authorType === 'user'
            ? { ...item, isRead: true, readAt: payload.readAt }
            : item
        ),
      }));
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:edited', handleMessageEdited);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('messages:read', handleMessagesRead);
    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:edited', handleMessageEdited);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('messages:read', handleMessagesRead);
    };
  }, [socket, conversationId]);

  const currentStatus =
    session.destination === 'helper' ? session.helperStatus : session.oxsteedStatus;

  const handleDestinationChange = useCallback((dest: ChatDestination) => {
    setSession(prev => ({
      ...prev,
      destination: dest,
      status: dest === 'helper' ? prev.helperStatus : prev.oxsteedStatus,
    }));
    if (onDestinationChange) {
      onDestinationChange(dest);
    }
  }, [onDestinationChange]);

  // Sync external destination prop
  useEffect(() => {
    if (externalDestination) {
      setSession(prev => ({
        ...prev,
        destination: externalDestination,
        status: externalDestination === 'helper' ? prev.helperStatus : prev.oxsteedStatus,
      }));
      }
  }, [externalDestination]);

  const handleSend = useCallback(async (text: string, attachment?: { url: string; key: string | null; name: string; size: number; mimeType: string }) => {
    if (sending) return;

    if (isGuest && session.destination === 'helper') {
      const name = guestName.trim();
      const email = guestEmail.trim();
      if (!guestContactSaved || !name || !email) {
        toast.error(t('messages.guestSaveContactFirst'));
        return;
      }
    }

    const msgContent = attachment
      ? `${text ? text + '\n' : ''}[attachment:${attachment.url}|${attachment.name}|${attachment.mimeType}]`
      : text;

    const userMsg: ChatMessage = {
      id:         `msg-${Date.now()}`,
      itemType:   'message',
      authorType: 'user',
      content:    msgContent,
      timestamp:  new Date().toISOString(),
      ...(attachment ? { attachment } : {}),
    };
    setSession(prev => ({
      ...prev,
      typing:   { authorType: session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai', authorLabel: t('helperProfile.chat.aiAssistant') },
      timeline: [...prev.timeline, userMsg],
    }));
    setSending(true);

    try {
      const { data } = await api.post('/chat/profile-message', {
        helperId,
        ...(businessId ? { businessId } : {}),
        destination: session.destination,
        ...(isGuest && session.destination === 'helper' ? {
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
        } : {}),
        // threadId links this request to server-side Redis history (null = new session)
        ...(threadId ? { threadId } : {}),
        language: localStorage.getItem('oxs:language') || 'en',
        messages: [...session.timeline, userMsg]
          .filter(i => i.itemType === 'message')
          .map(i => {
            const m = i as ChatMessage;
            return {
              role:    m.authorType === 'user' ? 'user' : 'assistant',
              content: m.content,
            };
          }),
      });

      if (data.type === 'live') {
        if (data.conversationId) setConversationId(data.conversationId);
        // Live replies don't use thread memory - clear any stale threadId so
        // a subsequent switch back to AI mode starts a fresh Redis thread.
        setThreadId(null);
        const waiting: TimelineEvent = {
          id:        `evt-${Date.now()}`,
          itemType:  'system',
          eventType: 'message_sent',
          content:   t('messages.messageSentWaiting', { name: helperName }),
          timestamp: new Date().toISOString(),
        };
        setSession(prev => ({
          ...prev,
          typing:   null,
          timeline: [...prev.timeline, waiting],
        }));
      } else {
        // Store the server-assigned threadId so history is tracked server-side
        if (data.threadId) setThreadId(data.threadId);
        const aiMsg: ChatMessage = {
          id:         `msg-${Date.now()}-reply`,
          itemType:   'message',
          authorType: data.authorType || (session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai'),
          content:    data.reply || t('messages.aiError'),
          timestamp:  new Date().toISOString(),
        };
        const events: TimelineItem[] = [];
        if (data.appointmentCreated) {
          events.push({
            id:        `evt-${Date.now()}-appointment`,
            itemType:  'booking_event',
            eventType: 'booking_requested',
            content:   t('messages.aiBookingRequested'),
            timestamp: new Date().toISOString(),
            metadata:  { appointmentId: data.appointmentCreated.id },
          });
          toast.success(t('messages.aiBookingRequestedToast'));
        } else if (data.bookingError) {
          events.push({
            id:        `evt-${Date.now()}-appointment-error`,
            itemType:  'system',
            eventType: 'booking_request_failed',
            content:   data.bookingError === 'conflict'
              ? t('messages.aiBookingConflict')
              : t('messages.aiBookingFailed'),
            timestamp: new Date().toISOString(),
          });
        }
        if (data.helperOnline && !user && session.destination === 'helper') {
          const note: TimelineEvent = {
            id:        `evt-${Date.now()}-note`,
            itemType:  'system',
            eventType: 'message_queued',
            content:   t('messages.helperOnlineSignIn', { name: helperName }),
            timestamp: new Date().toISOString(),
          };
          events.push(note);
        }
        setSession(prev => ({
          ...prev,
          typing:   null,
          timeline: [...prev.timeline, aiMsg, ...events],
        }));
      }
    } catch {
      const errMsg: ChatMessage = {
        id:         `msg-${Date.now()}-err`,
        itemType:   'message',
        authorType: 'oxsteed_ai',
        content:    t('messages.aiError'),
        timestamp:  new Date().toISOString(),
      };
      setSession(prev => ({
        ...prev,
        typing:   null,
        timeline: [...prev.timeline, errMsg],
      }));
    } finally {
      setSending(false);
    }
  }, [helperId, businessId, session, user, helperName, sending, t, isGuest, guestName, guestEmail, guestContactSaved]);

  const saveGuestContact = useCallback(() => {
    const name = guestName.trim();
    const email = guestEmail.trim();
    if (!name || !email) {
      toast.error(t('messages.guestMissingContact'));
      return;
    }
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      toast.error(t('messages.guestInvalidEmail'));
      return;
    }
    try {
      sessionStorage.setItem(guestStorageKey, JSON.stringify({ name, email }));
    } catch { /* ignore */ }
    setGuestContactSaved(true);
    toast.success(t('messages.guestContactSavedToast'));
  }, [guestName, guestEmail, guestStorageKey, t]);

  const helperIsLive  = session.helperStatus === 'live';
  const isOffline     = currentStatus === 'offline';
  /** Guest inquiries are persisted server-side even when the helper is offline */
  const guestWritesAlways = isGuest && session.destination === 'helper';
  const showOfflineWall = isOffline && !guestWritesAlways;
  const composerStatus =
    guestWritesAlways ? 'ai_assistant' : isOffline ? 'offline' : 'ai_assistant';

  const displayTimeline = React.useMemo(() => {
    const msgs = session.timeline.filter((item) => {
      if (session.destination === 'oxsteed' && item.itemType === 'booking_event') return false;
      return true;
    });
    if (msgs.length > 0) return msgs;
    const welcome: ChatMessage = {
      id: 'welcome-msg',
      itemType: 'message',
      authorType: session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai',
      content: session.destination === 'helper'
        ? t('messages.helperAiWelcome', { name: helperName })
        : t('messages.oxsteedAiWelcome'),
      timestamp: new Date().toISOString(),
    };
    return [welcome];
  }, [session.timeline, session.destination, helperName, t]);

  // Whether to show the close button - always show it when variant is 'modal',
  // even if onClose is undefined (fall back to a no-op so the button is never invisible)
  const isDockMode = variant === 'dock';
  const showCloseButton = variant === 'modal';
  const handleClose = onClose ?? (() => {});

  const handleMessageDelete = useCallback((messageId: string) => {
    setSession(prev => ({
      ...prev,
      timeline: prev.timeline.filter((item) => !(item.itemType === 'message' && item.id === messageId)),
    }));
  }, []);

  const handleMessageEdit = useCallback((messageId: string) => {
    const item = session.timeline.find(i => i.id === messageId);
    if (!item || item.itemType !== 'message') return;
    setEditingMessageId(messageId);
    setEditingText((item as ChatMessage).content);
  }, [session.timeline]);

  const handleEditSave = useCallback(async () => {
    if (!editingMessageId || !editingText.trim() || !conversationId) {
      setEditingMessageId(null);
      return;
    }
    const original = session.timeline.find(i => i.id === editingMessageId);
    // Optimistic update
    setSession(prev => ({
      ...prev,
      timeline: prev.timeline.map(item =>
        item.id === editingMessageId && item.itemType === 'message'
          ? { ...item, content: editingText.trim() } as ChatMessage
          : item
      ),
    }));
    setEditingMessageId(null);
    try {
      await api.put(`/messages/conversations/${conversationId}/${editingMessageId}`, {
        content: editingText.trim(),
      });
    } catch {
      // Revert on failure
      toast.error(t('messages.editFailed') || 'Failed to edit message');
      if (original) {
        setSession(prev => ({
          ...prev,
          timeline: prev.timeline.map(item =>
            item.id === editingMessageId ? original : item
          ),
        }));
      }
    }
  }, [editingMessageId, editingText, conversationId, session.timeline, t]);

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleQuickReply = useCallback((text: string) => {
    handleSend(text);
  }, [handleSend]);

  // Debounced search handler
  const performSearch = useCallback(async (q: string, filter: string) => {
    if (!conversationId) return;

    if (!q.trim()) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);
    try {
      const { data } = await api.get(`/messages/conversations/${conversationId}/search`, {
        params: {
          q: q.trim(),
          sender: filter,
          limit: 50,
          offset: 0,
        },
      });
      setSearchResults(data.results || []);
    } catch (error) {
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [conversationId]);

  // Cleanup search timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, []);

  // Debounce search input
  const handleSearchQueryChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(q, searchFilter);
    }, 300);
  }, [searchFilter, performSearch]);

  const handleSearchFilterChange = useCallback((filter: 'all' | 'me' | 'helper') => {
    setSearchFilter(filter);
    if (searchQuery.trim()) {
      performSearch(searchQuery, filter);
    }
  }, [searchQuery, performSearch]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
  }, []);

  // Load older messages
  const loadOlderMessages = useCallback(async () => {
    if (!conversationId || loadingOlder || !hasMoreMessages) return;

    setLoadingOlder(true);
    try {
      const newOffset = messageOffset + 50;
      const { data } = await api.get(`/messages/conversations/${conversationId}`, {
        params: { limit: 50, offset: newOffset },
      });

      if (data && data.length > 0) {
        // Prepend older messages to the beginning of timeline (filter out duplicates)
        const messageIds = new Set(data.map((m: ChatMessage) => m.id));
        setSession(prev => ({
          ...prev,
          timeline: [...data, ...prev.timeline.filter(item => !(item.itemType === 'message' && messageIds.has(item.id)))],
        }));
        setMessageOffset(newOffset);
        if (data.length < 50) {
          setHasMoreMessages(false);
        }
      } else {
        setHasMoreMessages(false);
      }
    } catch (error) {
      console.error('Error loading older messages:', error);
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, messageOffset, loadingOlder, hasMoreMessages]);

  return (
    <div
      className={`flex flex-col overflow-hidden h-full ${isDockMode ? 'chat-panel--dock bg-transparent border-0 rounded-none' : `bg-gray-900 border border-gray-800 rounded-2xl ${roomy ? 'shadow-2xl shadow-black/40' : ''}`} ${className}`}
      aria-label={t('helperProfile.chat.chatPanel')}
      role="region"
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className={`px-4 pt-4 pb-3 border-b border-gray-800 space-y-3 flex-shrink-0 ${isDockMode ? 'bg-transparent pt-3' : ''}`}>
        {/* Title row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-brand-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">{t('messages.chat')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={currentStatus} />
            <button
              onClick={() => {
                setSearchOpen((v) => {
                  if (v) clearSearch();
                  return !v;
                });
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label={t('helperProfile.chat.searchPlaceholder')}
              title={t('helperProfile.chat.searchPlaceholder')}
              type="button"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
            </button>
            {onExpand && !roomy && !isDockMode && (
              <button
                onClick={onExpand}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                aria-label={t('helperProfile.chat.expandChat')}
                title={t('helperProfile.chat.expandChat')}
                type="button"
              >
                <Maximize2 className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
            <button
              onClick={() => {
                if (window.confirm(t('messages.clearChatConfirm') || 'Clear this conversation?')) {
                  setSession(prev => ({
                    ...prev,
                    timeline: [],
                  }));
                  setThreadId(null);
                }
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label={t('messages.clearChat') || 'Clear chat'}
              title={t('messages.clearChat')}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </button>
            {showCloseButton && (
              <button
                onClick={handleClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                aria-label={t('messages.closeChat')}
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Destination dropdown */}
        <ChatDestinationDropdown
          destination={session.destination}
          helperName={helperName}
          helperStatus={session.helperStatus}
          oxsteedStatus={session.oxsteedStatus}
          allowLiveChat={allowLiveChat}
          onChange={handleDestinationChange}
        />

        {searchOpen && (
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchQueryChange(e.target.value)}
            placeholder={t('helperProfile.chat.searchPlaceholder')}
            className="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-brand-500"
            aria-label={t('helperProfile.chat.searchPlaceholder')}
          />
          <select
            value={searchFilter}
            onChange={(e) => handleSearchFilterChange(e.target.value as 'all' | 'me' | 'helper')}
            className="rounded-lg bg-gray-800 border border-gray-700 px-2 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
            aria-label={t('helperProfile.chat.filterSearchResults')}
          >
            <option value="all">{t('helperProfile.chat.searchFilterAll')}</option>
            <option value="me">{t('helperProfile.chat.searchFilterMe')}</option>
            <option value="helper">{t('helperProfile.chat.searchFilterHelper')}</option>
          </select>
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="p-2 text-gray-400 hover:text-white transition-colors"
              aria-label={t('helperProfile.chat.clearSearch')}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        )}
      </div>

      {/* ── Context banner (when OxSteed selected) ─────────── */}
      <DestinationContextBanner
        destination={session.destination}
        helperName={helperName}
        helperId={helperId}
        businessId={businessId}
        timeline={session.timeline}
      />

      {/* ── Sign-in prompt when helper is live but user isn't auth'd ── */}
      {helperIsLive && !user && session.destination === 'helper' && !isGuest && (
        <SignInPrompt helperName={helperName} />
      )}

      {isGuest && session.destination === 'helper' && !isDockMode && (
        <div className="px-4 py-3 border-b border-gray-800 space-y-3 bg-gray-950/40">
          {!guestContactSaved ? (
            <>
              <p className="text-xs text-gray-400">{t('messages.guestContactIntro')}</p>
              <div className="space-y-2">
                <label className="block">
                  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('messages.guestNameLabel')}</span>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => { setGuestName(e.target.value); setGuestContactSaved(false); }}
                    placeholder={t('messages.guestNamePlaceholder')}
                    className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500"
                    autoComplete="name"
                  />
                </label>
                <label className="block">
                  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{t('messages.guestEmailLabel')}</span>
                  <input
                    type="email"
                    value={guestEmail}
                    onChange={(e) => { setGuestEmail(e.target.value); setGuestContactSaved(false); }}
                    placeholder={t('messages.guestEmailPlaceholder')}
                    className="mt-1 w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder:text-gray-500"
                    autoComplete="email"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={saveGuestContact}
                className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold transition-colors"
              >
                {t('messages.guestSaveContact')}
              </button>
              <p className="text-[11px] text-gray-600">{t('messages.guestSaveContactHint')}</p>
            </>
          ) : (
            <div
              className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 flex items-center gap-2"
              role="status"
            >
              <span className="text-emerald-400 text-lg leading-none" aria-hidden="true">✓</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-emerald-200">{t('messages.guestContactSavedTitle')}</p>
                <p className="text-[11px] text-emerald-200/80 mt-0.5 truncate">
                  {t('messages.guestContactSavedBody', { name: guestName.trim(), email: guestEmail.trim() })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGuestContactSaved(false);
                    try { sessionStorage.removeItem(guestStorageKey); } catch { /* ignore */ }
                  }}
                  className="text-[11px] text-emerald-400/90 underline mt-1.5 hover:text-emerald-300"
                >
                  {t('messages.guestEditContact')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Timeline / Search Results / Empty state ──────────── */}
      {searchQuery ? (
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 space-y-2 min-h-0">
          {searchLoading && (
            <p className="text-center text-sm text-gray-400">{t('helperProfile.chat.searchLoading')}</p>
          )}
          {!searchLoading && searchResults.length === 0 && (
            <p className="text-center text-sm text-gray-400">{t('helperProfile.chat.searchNoResults')}</p>
          )}
          {searchResults.length > 0 && (
            <>
              <p className="text-xs text-gray-500 text-center mb-2">
                {searchResults.length === 1
                  ? t('helperProfile.chat.searchResults', { count: searchResults.length })
                  : t('helperProfile.chat.searchResultsPlural', { count: searchResults.length })}
              </p>
              <div className="space-y-2">
                {searchResults.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3 bg-gray-800/50 border border-gray-700/50 rounded-lg text-sm text-gray-300 hover:bg-gray-800 hover:border-brand-600/50 transition-colors cursor-pointer"
                    onClick={clearSearch}
                  >
                    <p className="text-xs text-gray-500 mb-1">
                      {msg.sender_name || 'Unknown'} • {new Date(msg.timestamp).toLocaleString()}
                    </p>
                    <p className="line-clamp-2 text-gray-200">{msg.content}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : showOfflineWall ? (
        <UnavailableState
          destination={session.destination}
          helperName={helperName}
        />
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {hasMoreMessages && (
            <div className="px-4 pt-3 pb-2 flex-shrink-0">
              <button
                onClick={loadOlderMessages}
                disabled={loadingOlder}
                className="w-full py-2 px-3 text-xs text-gray-400 hover:text-gray-300 border border-gray-700/50 rounded-lg hover:border-gray-600/50 transition-colors disabled:opacity-50"
              >
                {loadingOlder ? t('common.loading') : t('messages.loadOlderMessages')}
              </button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
            {displayTimeline.length === 0 && !sending ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center h-full min-h-[10rem]">
                <MessageCircle className="w-8 h-8 text-gray-600" aria-hidden="true" />
                <p className="text-sm text-gray-300 font-medium">{t('messages.noMessagesStart')}</p>
                <p className="text-xs text-gray-500 leading-relaxed max-w-xs">
                  {t('helperProfile.messenger.emptyPrompt')}
                </p>
              </div>
            ) : (
              <ChatTimeline
                items={displayTimeline}
                helperName={helperName}
                typing={sending ? session.typing : null}
                currentUserId={user?.id}
                onMessageDelete={handleMessageDelete}
                onMessageEdit={handleMessageEdit}
                onQuickReply={handleQuickReply}
                editingMessageId={editingMessageId}
                editingText={editingText}
                onEditTextChange={setEditingText}
                onEditSave={handleEditSave}
                onEditCancel={handleEditCancel}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Composer ────────────────────────────────────────── */}
      <MessageComposer
        status={composerStatus}
        onSend={handleSend}
        compact={!!(isGuest && session.destination === 'helper') && !roomy}
        roomy={roomy}
        hint={
          isGuest && session.destination === 'helper' && guestContactSaved ? (
            <span className="text-emerald-400/90">{t('messages.guestComposerHint')}</span>
          ) : isGuest && session.destination === 'helper' ? (
            <span>{t('messages.guestComposerLocked')}</span>
          ) : undefined
        }
        disabled={!!(isGuest && session.destination === 'helper' && !guestContactSaved)}
        conversationId={conversationId}
        placeholder={
          session.destination === 'oxsteed'
            ? t('messages.typeMessage')
            : isGuest
            ? t('messages.guestMessagePlaceholder')
            : helperIsLive && user
            ? t('messages.chatWith', { name: helperName })
            : undefined
        }
        textareaRef={textareaRef}
      />

      {/* ── Footer ──────────────────────────────────────────── */}
      {!isDockMode && (
      <div className="px-4 py-2 bg-gray-950/40 border-t border-gray-800/50 flex-shrink-0">
        <p className="text-xs text-gray-600 text-center">
          {isGuest && session.destination === 'helper'
            ? t('messages.guestFooterNote')
            : helperIsLive && user
            ? t('messages.helperWillReceive', { name: helperName })
            : t('messages.aiMonitored')}
        </p>
      </div>
      )}
    </div>
  );
};

export default ChatPanel;
