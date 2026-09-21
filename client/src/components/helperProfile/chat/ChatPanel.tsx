import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, MessageCircle, Building2, LogIn, Trash2, Check, XCircle, Search, Maximize2, Calendar } from 'lucide-react';
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
import CreditRefundPanel from './CreditRefundPanel';
import ProviderMessengerToolbar from '../../messaging/ProviderMessengerToolbar';
import QuoteSharePanel from './QuoteSharePanel';
import PopSharePanel from './PopSharePanel';
import AgreementSharePanel from './AgreementSharePanel';
import PaymentRequestSharePanel from './PaymentRequestSharePanel';
import ConversationContactDrawer from '../../messaging/ConversationContactDrawer';

import MessengerAvailabilityPicker from './MessengerAvailabilityPicker.jsx';
import { quoteEventContent } from './messengerQuotes.js';
import {
  buildMessengerBookingPayload,
  buildSlotConfirmationContent,
  buildSlotRequestMessage,
  canShowAvailabilityPicker,
  isProviderChatDestination,
  resolveClientTimezone,
} from './messengerAvailability.js';
import {
  appendBookingRequestMarker,
  buildProposeBookingPayload,
} from './messengerBookingRequests.js';
import { createBookingRequest } from '../../../api/bookings';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import { useSocket } from '../../../hooks/useSocket';
import { useGuestProfileChatSocket } from '../../../hooks/useGuestProfileChatSocket.js';
import {
  readGuestContact,
  readGuestVerifiedSession,
  clearGuestVerifiedSession,
  shouldAppendGuestLiveMessage,
} from './messengerDockState.js';
import { buildSupportEscalationHandoff } from './supportEscalationHandoff.js';
import {
  canVisitorLive,
  resolveAiFailureFromServer,
  resolveAiFailureRouting,
  resolveProviderPresenceTransition,
} from './profileChatRouting.js';

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
  /** When false (dock closed), disconnect the guest /chat socket. Defaults true for sidebar. */
  dockOpen?: boolean;
  /** Fired when verified guest token expires so parent can re-show OTP gate */
  onGuestSessionExpired?: () => void;
}

// ── Offline / Message-mode empty state ───────────────────────────────────────
const UnavailableState: React.FC<{ destination: ChatDestination; helperName: string }> = ({
  destination, helperName,
}) => {
  const { t } = useTranslation();
  const name = isProviderChatDestination(destination) ? helperName : t('helperProfile.chat.oxsteedAssistantLabel');
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
  if (isProviderChatDestination(destination)) return null;

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
  dockOpen = true,
  onGuestSessionExpired,
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();

  const isProviderActor = Boolean(
    user?.id && (
      String(user.id) === String(helperId) ||
      (businessId && (user.role === 'business' || user.roles?.includes?.('business_owner')))
    )
  );

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
  const [showAvailability, setShowAvailability] = useState(false);
  const [showProviderQuoteShare, setShowProviderQuoteShare] = useState(false);
  const [showProviderPopShare, setShowProviderPopShare] = useState(false);
  const [showProviderAgreementShare, setShowProviderAgreementShare] = useState(false);
  const [showProviderPayReqShare, setShowProviderPayReqShare] = useState(false);
  const [showProviderContact, setShowProviderContact] = useState(false);
  const [showCreditRefund, setShowCreditRefund] = useState(false);
  const [refundTarget, setRefundTarget] = useState<any>(null);
  const [schedulingQuote, setSchedulingQuote] = useState<null | { kind: string; id: string; token?: string }>(null);
  const [proposingBookingId, setProposingBookingId] = useState<string | number | null>(null);
  /** AI-failure / presence routing banners (not a dead error bubble alone) */
  const [routingNotice, setRoutingNotice] = useState<null | {
    kind: 'ai_to_helper' | 'verify_for_live' | 'escalate_support' | 'fallback_to_ai' | 'offer_connect_live';
  }>(null);
  const [escalationOpen, setEscalationOpen] = useState(false);
  const prevHelperStatusRef = useRef<string | null>(null);
  const autoRetryLiveRef = useRef(false);

  // ── Live status polling ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      try {
        const { data } = await api.get(`/helpers/${helperId}/status`);
        if (cancelled) return;
        const nextStatus = data.helperStatus;
        setSession(prev => {
          const previousStatus = prevHelperStatusRef.current ?? prev.helperStatus;
          const presence = resolveProviderPresenceTransition({
            previousStatus,
            nextStatus,
            destination: prev.destination,
          });
          prevHelperStatusRef.current = nextStatus;

          // Schedule notice updates outside the updater when possible via microtask
          queueMicrotask(() => {
            if (presence.action === 'fallback_to_ai') {
              setRoutingNotice({ kind: 'fallback_to_ai' });
              setConversationId(null);
              setThreadId(null);
            } else if (presence.action === 'offer_connect_live') {
              setRoutingNotice({ kind: 'offer_connect_live' });
            }
          });

          return {
            ...prev,
            helperStatus: nextStatus,
            status: isProviderChatDestination(prev.destination) ? nextStatus : prev.oxsteedStatus,
          };
        });
      } catch { /* silent */ }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [helperId]);

  const guestStorageKey = `oxs:guest-contact:${helperId}:${businessId ?? 'personal'}`;
  const guestTokenKey = `oxs:guest-token:${helperId}:${businessId ?? 'personal'}`;
  // Prefer opaque verified guest session (OTP) over legacy JWT-shaped guest tokens.
  useEffect(() => {
    if (!isGuest) return;
    const verified = readGuestVerifiedSession(helperId, businessId);
    if (!verified) return;
    if (verified.name) setGuestName(verified.name);
    if (verified.email) setGuestEmail(verified.email);
    setGuestContactSaved(true);
  }, [isGuest, helperId, businessId]);


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
    if (!isGuest || !isProviderChatDestination(session.destination)) return;
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

    const handleBookingChatUpdated = (payload: any) => {
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', { detail: payload }));
        }
      } catch { /* ignore */ }
    };

    socket.on('message:new', handleNewMessage);
    socket.on('message:edited', handleMessageEdited);
    socket.on('message:deleted', handleMessageDeleted);
    socket.on('messages:read', handleMessagesRead);
    socket.on('booking:chat_updated', handleBookingChatUpdated);
    return () => {
      socket.off('message:new', handleNewMessage);
      socket.off('message:edited', handleMessageEdited);
      socket.off('message:deleted', handleMessageDeleted);
      socket.off('messages:read', handleMessagesRead);
      socket.off('booking:chat_updated', handleBookingChatUpdated);
    };
  }, [socket, conversationId]);

  // ── Guest live /chat socket (OTP-verified; separate from JWT useSocket) ───
  const verifiedGuestSession = isGuest ? readGuestVerifiedSession(helperId, businessId) : null;
  const handleGuestLiveMessage = useCallback((incoming: ChatMessage) => {
    setSession((prev) => {
      if (!shouldAppendGuestLiveMessage(prev.timeline, incoming)) return prev;
      return {
        ...prev,
        typing: null,
        timeline: [...prev.timeline, incoming],
      };
    });
  }, []);
  const handleGuestSocketExpired = useCallback(() => {
    clearGuestVerifiedSession(helperId, businessId);
    toast.error(t('helperProfile.messenger.guestSessionExpired'));
    onGuestSessionExpired?.();
  }, [helperId, businessId, onGuestSessionExpired, t]);
  useGuestProfileChatSocket({
    enabled: Boolean(dockOpen),
    isGuest,
    guestToken: verifiedGuestSession?.guestToken || '',
    guestSessionId: verifiedGuestSession?.sessionId || '',
    expiresAt: verifiedGuestSession?.expiresAt ?? null,
    onMessage: handleGuestLiveMessage,
    onExpired: handleGuestSocketExpired,
  });

  const currentStatus =
    isProviderChatDestination(session.destination) ? session.helperStatus : session.oxsteedStatus;

  const handleDestinationChange = useCallback((dest: ChatDestination) => {
    // Dropdown exposes provider as `helper`; business-only profiles keep `business`.
    const resolved: ChatDestination =
      dest === 'helper' && businessId ? 'business' : dest;
    setSession(prev => ({
      ...prev,
      destination: resolved,
      status: isProviderChatDestination(resolved) ? prev.helperStatus : prev.oxsteedStatus,
    }));
    if (onDestinationChange) {
      onDestinationChange(resolved);
    }
  }, [onDestinationChange, businessId]);

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

  const applyAiFailureRouting = useCallback(async ({
    data,
    userMsg,
    destinationOverride,
  }: {
    data?: {
      aiFailed?: boolean;
      type?: string;
      providerOnline?: boolean;
      helperOnline?: boolean;
      suggestedAction?: string | null;
      authorType?: string;
      reply?: string | null;
      threadId?: string | null;
    } | null;
    userMsg: ChatMessage;
    destinationOverride?: ChatDestination;
  }) => {
    const providerOnline = Boolean(
      data?.providerOnline ?? data?.helperOnline ?? (session.helperStatus === 'live'),
    );
    const verifiedGuest = isGuest ? readGuestVerifiedSession(helperId, businessId) : null;
    const canLive = canVisitorLive({
      isAuthenticated: Boolean(user),
      guestVerified: Boolean(verifiedGuest),
    });
    const currentDest = destinationOverride || session.destination;
    const decision = data?.suggestedAction || data?.aiFailed || data?.type === 'ai_error'
      ? resolveAiFailureFromServer({
          suggestedAction: data?.suggestedAction ?? null,
          aiFailed: true,
          providerOnline,
          canLive,
          allowLiveChat,
          destination: currentDest,
          canBeProvider: true,
        })
      : resolveAiFailureRouting({
          aiFailed: true,
          destination: currentDest,
          providerOnline,
          canLive,
          allowLiveChat,
          canBeProvider: true,
        });

    // Prefer auto-switch + retry into live when safe (one shot).
    if (decision.autoRetryLive && !autoRetryLiveRef.current) {
      autoRetryLiveRef.current = true;
      const providerDest: ChatDestination = businessId ? 'business' : 'helper';
      if (decision.autoSwitchHelper || !isProviderChatDestination(currentDest)) {
        handleDestinationChange(providerDest);
      }
      setRoutingNotice({ kind: 'ai_to_helper' });
      setEscalationOpen(false);
      const switchBanner: TimelineEvent = {
        id: `evt-${Date.now()}-ai-to-helper`,
        itemType: 'system',
        eventType: 'message_queued',
        content: t('helperProfile.chat.aiUnavailableConnecting', { name: helperName }),
        timestamp: new Date().toISOString(),
      };
      setSession(prev => ({
        ...prev,
        destination: providerDest,
        status: prev.helperStatus,
        typing: { authorType: 'helper_ai', authorLabel: helperName },
        timeline: [...prev.timeline, switchBanner],
      }));

      try {
        const guestHeaders = verifiedGuest
          ? {
              'X-Guest-Profile-Token': verifiedGuest.guestToken,
              'X-Guest-Session-Id': verifiedGuest.sessionId,
            }
          : undefined;
        const retryRes = await api.post('/chat/profile-message', {
          helperId,
          ...(businessId ? { businessId } : {}),
          destination: providerDest,
          ...(isGuest ? {
            guestName: guestName.trim(),
            guestEmail: guestEmail.trim(),
            guestSessionId: verifiedGuest?.sessionId,
          } : {}),
          language: localStorage.getItem('oxs:language') || 'en',
          messages: [...session.timeline, userMsg]
            .filter(i => i.itemType === 'message')
            .map(i => {
              const m = i as ChatMessage;
              return {
                role: m.authorType === 'user' ? 'user' : 'assistant',
                content: m.content,
              };
            }),
        }, guestHeaders ? { headers: guestHeaders } : undefined);
        const retryData = retryRes.data;
        if (retryData?.type === 'live') {
          if (retryData.conversationId) setConversationId(retryData.conversationId);
          setThreadId(null);
          const waiting: TimelineEvent = {
            id: `evt-${Date.now()}-live`,
            itemType: 'system',
            eventType: 'message_sent',
            content: t('messages.messageSentWaiting', { name: helperName }),
            timestamp: new Date().toISOString(),
          };
          setSession(prev => ({
            ...prev,
            typing: null,
            timeline: [...prev.timeline, waiting],
          }));
          return;
        }
      } catch {
        /* fall through to escalation / verify UI */
      } finally {
        autoRetryLiveRef.current = false;
      }
    }

    const errMsg: ChatMessage = {
      id: `msg-${Date.now()}-err`,
      itemType: 'message',
      authorType: (data?.authorType as ChatMessage['authorType']) || (currentDest === 'helper' ? 'helper_ai' : 'oxsteed_ai'),
      content: t('messages.aiError'),
      timestamp: new Date().toISOString(),
    };
    const events: TimelineItem[] = [errMsg];

    if (decision.showVerifyBanner) {
      setRoutingNotice({ kind: 'verify_for_live' });
      events.push({
        id: `evt-${Date.now()}-verify`,
        itemType: 'system',
        eventType: 'message_queued',
        content: t('helperProfile.chat.verifyToReachHuman', { name: helperName }),
        timestamp: new Date().toISOString(),
      } as TimelineEvent);
    } else if (decision.showEscalationPanel || decision.action === 'escalate_support') {
      setRoutingNotice({ kind: 'escalate_support' });
      setEscalationOpen(true);
      events.push({
        id: `evt-${Date.now()}-escalate`,
        itemType: 'system',
        eventType: 'message_queued',
        content: t('helperProfile.chat.aiUnavailableEscalate'),
        timestamp: new Date().toISOString(),
      } as TimelineEvent);
    } else {
      setRoutingNotice(null);
    }

    setSession(prev => ({
      ...prev,
      typing: null,
      timeline: [...prev.timeline, ...events],
    }));
  }, [
    allowLiveChat,
    businessId,
    guestEmail,
    guestName,
    handleDestinationChange,
    helperId,
    helperName,
    isGuest,
    session,
    t,
    user,
  ]);

  const handleSend = useCallback(async (text: string, attachment?: { url: string; key: string | null; name: string; size: number; mimeType: string }) => {
    if (sending) return;

    if (isGuest && isProviderChatDestination(session.destination)) {
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
      typing:   { authorType: isProviderChatDestination(session.destination) ? 'helper_ai' : 'oxsteed_ai', authorLabel: t('helperProfile.chat.aiAssistant') },
      timeline: [...prev.timeline, userMsg],
    }));
    setSending(true);
    setEscalationOpen(false);

    try {
      const verifiedGuest = isGuest ? readGuestVerifiedSession(helperId, businessId) : null;
      const guestHeaders = verifiedGuest
        ? {
            'X-Guest-Profile-Token': verifiedGuest.guestToken,
            'X-Guest-Session-Id': verifiedGuest.sessionId,
          }
        : undefined;
      const { data } = await api.post('/chat/profile-message', {
        helperId,
        ...(businessId ? { businessId } : {}),
        destination: session.destination,
        ...(isGuest && isProviderChatDestination(session.destination) ? {
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim(),
          guestSessionId: verifiedGuest?.sessionId,
        } : {}),
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
      }, guestHeaders ? { headers: guestHeaders } : undefined);

      if (data?.aiFailed || data?.type === 'ai_error') {
        await applyAiFailureRouting({ data, userMsg });
        return;
      }

      if (data.type === 'live') {
        if (data.conversationId) setConversationId(data.conversationId);
        setThreadId(null);
        setRoutingNotice(null);
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
        if (data.threadId) setThreadId(data.threadId);
        const aiMsg: ChatMessage = {
          id:         `msg-${Date.now()}-reply`,
          itemType:   'message',
          authorType: data.authorType || (isProviderChatDestination(session.destination) ? 'helper_ai' : 'oxsteed_ai'),
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
        if (isProviderChatDestination(session.destination) && isGuest) {
          const verified = readGuestVerifiedSession(helperId, businessId);
          if (data.helperOnline && verified) {
            events.push({
              id:        `evt-${Date.now()}-note`,
              itemType:  'system',
              eventType: 'message_queued',
              content:   t('helperProfile.messenger.guestLiveWaiting', { name: helperName }),
              timestamp: new Date().toISOString(),
            } as TimelineEvent);
          } else if (!data.helperOnline) {
            events.push({
              id:        `evt-${Date.now()}-offline`,
              itemType:  'system',
              eventType: 'message_queued',
              content:   t('helperProfile.messenger.guestOfflineAi', { name: helperName }),
              timestamp: new Date().toISOString(),
            } as TimelineEvent);
          }
        } else if (data.helperOnline && !user && isProviderChatDestination(session.destination)) {
          events.push({
            id:        `evt-${Date.now()}-note`,
            itemType:  'system',
            eventType: 'message_queued',
            content:   t('messages.helperOnlineSignIn', { name: helperName }),
            timestamp: new Date().toISOString(),
          } as TimelineEvent);
        }
        setSession(prev => ({
          ...prev,
          typing:   null,
          timeline: [...prev.timeline, aiMsg, ...events],
        }));
      }
    } catch (err: unknown) {
      const axiosData = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      await applyAiFailureRouting({
        data: {
          aiFailed: true,
          type: 'ai_error',
          providerOnline: Boolean(axiosData?.providerOnline ?? session.helperStatus === 'live'),
          helperOnline: Boolean(axiosData?.helperOnline ?? session.helperStatus === 'live'),
          suggestedAction: (axiosData?.suggestedAction as string | undefined) ?? null,
          authorType: isProviderChatDestination(session.destination) ? 'helper_ai' : 'oxsteed_ai',
        },
        userMsg,
      });
    } finally {
      setSending(false);
    }
  }, [helperId, businessId, session, user, helperName, sending, t, isGuest, guestName, guestEmail, guestContactSaved, applyAiFailureRouting, allowLiveChat]);


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
  const supportHandoff = React.useMemo(() => {
    const returnTo = typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : undefined;
    return buildSupportEscalationHandoff({
      helperId,
      businessId,
      helperName,
      returnTo,
      timeline: session.timeline,
    });
  }, [helperId, businessId, helperName, session.timeline]);
  const isOffline     = currentStatus === 'offline';
  /** Guest inquiries are persisted server-side even when the helper is offline */
  const guestWritesAlways = isGuest && isProviderChatDestination(session.destination);
  const availabilityPickerAllowed = canShowAvailabilityPicker({
    destination: session.destination,
    businessId,
    helperId,
  });
  // Propose / schedule / quote-accept may force-open the picker even if the toggle is hidden.
  const mountAvailabilityPicker = availabilityPickerAllowed
    || (showAvailability && Boolean(businessId || helperId));
  // Helper/business destination always keeps AI messaging available when offline.
  // OxSteed destination may still surface an offline wall (rare).
  const showOfflineWall = isOffline && !guestWritesAlways && !isProviderChatDestination(session.destination);
  const composerStatus =
    isProviderChatDestination(session.destination)
      ? 'ai_assistant'
      : guestWritesAlways
        ? 'ai_assistant'
        : isOffline
          ? 'offline'
          : 'ai_assistant';

  const displayTimeline = React.useMemo(() => {
    const msgs = session.timeline.filter((item) => {
      if (session.destination === 'oxsteed' && item.itemType === 'booking_event') return false;
      return true;
    });
    if (msgs.length > 0) return msgs;
    const welcome: ChatMessage = {
      id: 'welcome-msg',
      itemType: 'message',
      authorType: isProviderChatDestination(session.destination) ? 'helper_ai' : 'oxsteed_ai',
      content: isProviderChatDestination(session.destination)
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

        {isGuest && isProviderChatDestination(session.destination) && verifiedGuestSession ? (
          <p
            className={`text-xs rounded-lg px-2.5 py-1.5 border ${
              helperIsLive
                ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-300'
                : 'border-amber-700/50 bg-amber-950/30 text-amber-200'
            }`}
            role="status"
          >
            {helperIsLive
              ? t('helperProfile.messenger.guestLiveBanner')
              : t('helperProfile.messenger.guestOfflineBanner')}
          </p>
        ) : null}

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

      {/* ── Bidirectional routing notices (AI ↔ human) ── */}
      {routingNotice?.kind === 'ai_to_helper' && (
        <div
          className="mx-4 my-2 p-3 rounded-xl border border-amber-600/40 bg-amber-950/40 text-amber-100 text-xs"
          role="status"
        >
          {t('helperProfile.chat.aiUnavailableConnecting', { name: helperName })}
        </div>
      )}
      {routingNotice?.kind === 'fallback_to_ai' && isProviderChatDestination(session.destination) && (
        <div
          className="mx-4 my-2 p-3 rounded-xl border border-sky-700/50 bg-sky-950/40 text-sky-100 text-xs flex items-start justify-between gap-2"
          role="status"
        >
          <span>{t('helperProfile.chat.providerOfflineAiFallback', { name: helperName })}</span>
          <button
            type="button"
            className="text-sky-300 underline shrink-0"
            onClick={() => setRoutingNotice(null)}
          >
            {t('common.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </div>
      )}
      {routingNotice?.kind === 'offer_connect_live' && isProviderChatDestination(session.destination) && helperIsLive && (
        <div
          className="mx-4 my-2 p-3 rounded-xl border border-emerald-700/50 bg-emerald-950/40 text-emerald-100 text-xs flex flex-wrap items-center justify-between gap-2"
          role="status"
        >
          <span>{t('helperProfile.chat.providerBackOnline', { name: helperName })}</span>
          <button
            type="button"
            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            onClick={() => {
              handleDestinationChange('helper');
              setRoutingNotice(null);
              toast.success(t('helperProfile.chat.connectedLiveToast', { name: helperName }));
            }}
          >
            {t('helperProfile.chat.connectLiveCta', { name: helperName })}
          </button>
        </div>
      )}
      {routingNotice?.kind === 'verify_for_live' && (
        <div
          className="mx-4 my-2 p-3 rounded-xl border border-orange-600/40 bg-orange-950/40 text-orange-100 text-xs"
          role="status"
        >
          <p>{t('helperProfile.chat.verifyToReachHuman', { name: helperName })}</p>
          {!user ? (
            <Link to="/login" className="inline-block mt-1.5 font-semibold underline text-orange-200">
              {t('auth.signIn') || 'Sign in'}
            </Link>
          ) : null}
        </div>
      )}
      {(routingNotice?.kind === 'escalate_support' || escalationOpen) && (
        <div
          className="mx-4 my-2 p-3 rounded-xl border border-violet-600/40 bg-violet-950/50 text-violet-100 text-xs space-y-2"
          role="region"
          aria-label={t('helperProfile.chat.escalationPanelAria')}
        >
          <p className="font-semibold text-violet-50">{t('helperProfile.chat.aiUnavailableEscalateTitle')}</p>
          <p>{t('helperProfile.chat.aiUnavailableEscalate')}</p>
          <Link
            to={{ pathname: supportHandoff.pathname, search: supportHandoff.search }}
            state={supportHandoff.state}
            className="inline-flex items-center justify-center w-full sm:w-auto px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
          >
            {t('helperProfile.chat.talkToHumanCta')}
          </Link>
          <button
            type="button"
            className="block text-violet-300/80 underline"
            onClick={() => { setEscalationOpen(false); setRoutingNotice(null); }}
          >
            {t('helperProfile.chat.dismissHandoff')}
          </button>
        </div>
      )}

      {/* ── Sign-in prompt when helper is live but user isn't auth'd ── */}
      {helperIsLive && !user && isProviderChatDestination(session.destination) && !isGuest && (
        <SignInPrompt helperName={helperName} />
      )}

      {isGuest && isProviderChatDestination(session.destination) && !isDockMode && (
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
                isAuthenticated={Boolean(user)}
                guestVerified={Boolean(isGuest && readGuestVerifiedSession(helperId, businessId))}
                guestAuthHeaders={(() => {
                  const v = isGuest ? readGuestVerifiedSession(helperId, businessId) : null;
                  return v
                    ? {
                        'X-Guest-Profile-Token': v.guestToken,
                        'X-Guest-Session-Id': v.sessionId,
                      }
                    : null;
                })()}
                onQuoteAccepted={(data) => {
                  const q = data?.quote || data;
                  const kind = q?.kind;
                  const id = q?.id;
                  if (kind && id) {
                    setSchedulingQuote({ kind, id, token: q?.token });
                  }
                  setProposingBookingId(null);
                  setShowAvailability(true);
                  const evt: TimelineEvent = {
                    id: `evt-${Date.now()}-quote-accepted`,
                    itemType: 'system',
                    eventType: 'quote_accepted',
                    content: quoteEventContent('accepted', q?.title || '', t),
                    timestamp: new Date().toISOString(),
                    metadata: { quoteKind: kind, quoteId: id },
                  };
                  if (!data?.alreadyAccepted) {
                    setSession((prev) => ({ ...prev, timeline: [...prev.timeline, evt] }));
                  }
                }}
                onQuoteDeclined={(data, action) => {
                  const q = data?.quote || data;
                  const evt: TimelineEvent = {
                    id: `evt-${Date.now()}-quote-declined`,
                    itemType: 'system',
                    eventType: 'quote_declined',
                    content: quoteEventContent('declined', q?.title || '', t),
                    timestamp: new Date().toISOString(),
                    metadata: { action },
                  };
                  setSession((prev) => ({ ...prev, timeline: [...prev.timeline, evt] }));
                }}
                onQuoteRequestVerify={() => {
                  onGuestSessionExpired?.();
                }}
                isProviderView={isProviderActor}
                onRefundRequest={(target) => { setRefundTarget(target); setShowCreditRefund(true); }}
                conversationId={conversationId}
                onProposeTime={({ booking }) => {
                  setProposingBookingId(booking?.id || null);
                  setSchedulingQuote(null);
                  setShowAvailability(true);
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Availability (helper/business live chat) ───────── */}
      {mountAvailabilityPicker ? (
        <>
          {availabilityPickerAllowed ? (
          <button
            type="button"
            className={`messenger-availability-toggle${showAvailability ? ' is-open' : ''}`}
            onClick={() => setShowAvailability((v) => !v)}
            aria-expanded={showAvailability}
          >
            <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
            {t('helperProfile.messenger.availabilityToggle')}
          </button>
          ) : null}
          <MessengerAvailabilityPicker
            helperId={helperId}
            businessId={businessId}
            open={showAvailability}
            onClose={() => {
              setShowAvailability(false);
              setProposingBookingId(null);
            }}
            onSelectSlot={async (slot) => {
              const locale = localStorage.getItem('oxs:language') || 'en';
              const tz = slot.timezone || resolveClientTimezone();

              if (proposingBookingId) {
                const payload = buildProposeBookingPayload({ ...slot, timezone: tz });
                if (!payload) return;
                try {
                  await api.post(`/chat/booking-requests/${proposingBookingId}/propose`, payload);
                  try {
                    window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', {
                      detail: { bookingId: proposingBookingId },
                    }));
                  } catch { /* ignore */ }
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  setShowAvailability(false);
                  setProposingBookingId(null);
                  setSchedulingQuote(null);
                } catch (err: any) {
                  const code = err?.response?.data?.code;
                  toast.error(
                    code === 'conflict'
                      ? t('helperProfile.messenger.slotBookingConflict')
                      : t('helperProfile.messenger.slotBookingFailed'),
                  );
                }
                return;
              }

              if (schedulingQuote?.kind && schedulingQuote?.id) {
                const verified = isGuest ? readGuestVerifiedSession(helperId, businessId) : null;
                try {
                  const { data } = await api.post(
                    `/chat/quotes/${schedulingQuote.kind}/${schedulingQuote.id}/schedule`,
                    {
                      token: schedulingQuote.token,
                      helperId,
                      businessId,
                      serviceId: slot.serviceId,
                      serviceName: slot.serviceName || helperName,
                      requestedDate: slot.date,
                      requestedStartTime: slot.start.length === 5 ? `${slot.start}:00` : slot.start,
                      requestedEndTime: slot.end.length === 5 ? `${slot.end}:00` : slot.end,
                      startIso: slot.startIso,
                      endIso: slot.endIso,
                      timezone: tz,
                    },
                    verified
                      ? {
                          headers: {
                            'X-Guest-Profile-Token': verified.guestToken,
                            'X-Guest-Session-Id': verified.sessionId,
                          },
                        }
                      : undefined,
                  );
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  const whenBits = `${slot.date} ${slot.start}–${slot.end}`;
                  const confirm: TimelineEvent = {
                    id: `evt-${Date.now()}-quote-scheduled`,
                    itemType: 'booking_event',
                    eventType: 'quote_scheduled',
                    content: `${quoteEventContent('scheduled', data?.quote?.title || '', t)} · ${whenBits}`,
                    timestamp: new Date().toISOString(),
                    metadata: {
                      quoteKind: schedulingQuote.kind,
                      quoteId: schedulingQuote.id,
                      bookingId: data?.bookingId,
                      appointmentId: data?.appointmentId,
                    },
                  };
                  setSession((prev) => ({ ...prev, timeline: [...prev.timeline, confirm] }));
                  setSchedulingQuote(null);
                  setShowAvailability(false);
                  return;
                } catch (err: any) {
                  const code = err?.response?.data?.code;
                  toast.error(
                    code === 'conflict'
                      ? t('helperProfile.messenger.slotBookingConflict')
                      : t('helperProfile.messenger.slotBookingFailed'),
                  );
                  return;
                }
              }

              
              // Provider inbox/profile schedule with no quote: durable booking for conversation customer
              if (isProviderActor && conversationId) {
                try {
                  const tz = slot.timezone || resolveClientTimezone();
                  const textMsg = buildSlotRequestMessage({
                    date: slot.date,
                    start: slot.start,
                    end: slot.end,
                    providerName: helperName,
                    locale: localStorage.getItem('oxs:language') || 'en',
                    t,
                    serviceId: slot.serviceId,
                    serviceName: slot.serviceName,
                    timezone: tz,
                  });
                  const { data } = await api.post('/chat/booking-requests', {
                    conversationId,
                    helperId,
                    businessId,
                    serviceId: slot.serviceId,
                    serviceName: slot.serviceName || helperName || 'Service request',
                    requestedDate: slot.date,
                    requestedStartTime: slot.start.length === 5 ? `${slot.start}:00` : slot.start,
                    requestedEndTime: slot.end.length === 5 ? `${slot.end}:00` : slot.end,
                    startIso: slot.startIso,
                    endIso: slot.endIso,
                    timezone: tz,
                    description: textMsg || undefined,
                    source: 'messenger_provider_schedule',
                  });
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  try {
                    window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', {
                      detail: { bookingId: data?.booking?.id || data?.bookingId },
                    }));
                  } catch { /* ignore */ }
                  const whenBits = `${slot.date} ${slot.start}–${slot.end}`;
                  const confirm: TimelineEvent = {
                    id: `evt-${Date.now()}-booking`,
                    itemType: 'booking_event',
                    eventType: 'booking_requested',
                    content: buildSlotConfirmationContent({
                      whenLabel: whenBits,
                      serviceName: slot.serviceName || '',
                      bookingId: data?.booking?.id || data?.bookingId,
                      t,
                    }),
                    timestamp: new Date().toISOString(),
                    metadata: {
                      bookingId: data?.booking?.id || data?.bookingId,
                      serviceId: slot.serviceId,
                      serviceName: slot.serviceName,
                      timezone: tz,
                    },
                  };
                  setSession((prev) => ({
                    ...prev,
                    timeline: [...prev.timeline, confirm],
                  }));
                  setShowAvailability(false);
                  setProposingBookingId(null);
                  setSchedulingQuote(null);
                } catch (err: any) {
                  const code = err?.response?.data?.code;
                  const agreements = err?.response?.data?.agreements;
                  if (code === 'agreement_required') {
                    const title = agreements?.[0]?.title;
                    toast.error(
                      title
                        ? t('helperProfile.messenger.agreementRequiredScheduleNamed', { title })
                        : t('helperProfile.messenger.agreementRequiredSchedule'),
                    );
                  } else {
                    toast.error(
                      code === 'conflict'
                        ? t('helperProfile.messenger.slotBookingConflict')
                        : t('helperProfile.messenger.slotBookingFailed'),
                    );
                  }
                }
                return;
              }

const textMsg = buildSlotRequestMessage({
                date: slot.date,
                start: slot.start,
                end: slot.end,
                providerName: helperName,
                locale,
                t,
                serviceId: slot.serviceId,
                serviceName: slot.serviceName,
                timezone: tz,
              });
              if (!textMsg) return;
              setShowAvailability(false);

              const payload = buildMessengerBookingPayload({
                helperId,
                businessId,
                serviceId: slot.serviceId,
                serviceName: slot.serviceName || helperName,
                date: slot.date,
                start: slot.start,
                end: slot.end,
                startIso: slot.startIso,
                endIso: slot.endIso,
                timezone: tz,
                guestSessionId: readGuestVerifiedSession(helperId, businessId)?.sessionId,
                description: textMsg,
              });

              let bookingMeta: { bookingId?: string; appointmentId?: string } = {};
              try {
                if (user && payload) {
                  const row = await createBookingRequest({
                    helperId: payload.helperId,
                    businessId: payload.businessId,
                    serviceName: payload.serviceName,
                    requestedDate: payload.requestedDate,
                    requestedStartTime: payload.requestedStartTime,
                    requestedEndTime: payload.requestedEndTime,
                    description: payload.description,
                    confirmationHours: 24,
                    conversationId: (session as any)?.conversationId || undefined,
                    serviceId: payload.serviceId,
                    timezone: payload.timezone,
                    source: 'messenger_picker',
                  });
                  bookingMeta = { bookingId: row?.id || row?.bookingId };
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                } else if (isGuest && payload) {
                  const verified = readGuestVerifiedSession(helperId, businessId);
                  if (!verified) {
                    toast.error(t('helperProfile.messenger.guestSessionExpired'));
                    onGuestSessionExpired?.();
                    return;
                  }
                  const { data } = await api.post(
                    '/chat/sessions/guest/booking-request',
                    payload,
                    {
                      headers: {
                        'X-Guest-Profile-Token': verified.guestToken,
                        'X-Guest-Session-Id': verified.sessionId,
                      },
                    },
                  );
                  bookingMeta = {
                    appointmentId: data?.appointmentId || data?.appointment?.id,
                    bookingId: data?.bookingId,
                  };
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                }
              } catch (err: any) {
                const code = err?.response?.data?.code;
                const agreements = err?.response?.data?.agreements;
                if (code === 'agreement_required') {
                  const title = agreements?.[0]?.title;
                  toast.error(
                    title
                      ? t('helperProfile.messenger.agreementRequiredScheduleNamed', { title })
                      : t('helperProfile.messenger.agreementRequiredSchedule'),
                  );
                } else {
                  toast.error(
                    code === 'conflict'
                      ? t('helperProfile.messenger.slotBookingConflict')
                      : t('helperProfile.messenger.slotBookingFailed'),
                  );
                }
              }

              // Optimistic confirmation chip in the timeline
              const whenBits = `${slot.date} ${slot.start}–${slot.end}`;
              const confirm: TimelineEvent = {
                id: `evt-${Date.now()}-booking`,
                itemType: 'booking_event',
                eventType: 'booking_requested',
                content: buildSlotConfirmationContent({
                  whenLabel: whenBits,
                  serviceName: slot.serviceName || '',
                  bookingId: bookingMeta.bookingId,
                  appointmentId: bookingMeta.appointmentId,
                  t,
                }),
                timestamp: new Date().toISOString(),
                metadata: {
                  ...bookingMeta,
                  serviceId: slot.serviceId,
                  serviceName: slot.serviceName,
                  timezone: tz,
                  marker: textMsg,
                },
              };
              setSession((prev) => ({
                ...prev,
                timeline: [...prev.timeline, confirm],
              }));

              // Still post the structured chat message so the provider sees intent in-thread
              const withBookingMarker = bookingMeta.bookingId
                ? appendBookingRequestMarker(textMsg, {
                    id: bookingMeta.bookingId,
                    status: 'pending',
                    date: slot.date,
                    start: slot.start,
                    end: slot.end,
                    serviceName: slot.serviceName || '',
                    serviceId: slot.serviceId,
                  })
                : textMsg;
              await handleSend(withBookingMarker);
            }}
          />
        </>
      ) : null}

      {/* ── Composer ────────────────────────────────────────── */}
      {isProviderActor ? (
        <ProviderMessengerToolbar
          onQuote={() => setShowProviderQuoteShare(true)}
          onPaymentRequest={() => setShowProviderPayReqShare(true)}
          onAgreement={() => setShowProviderAgreementShare(true)}
          onPop={() => setShowProviderPopShare(true)}
          onSchedule={() => {
            setProposingBookingId(null);
            setShowAvailability(true);
          }}
          onContact={() => setShowProviderContact(true)}
          onRefund={() => setShowCreditRefund(true)}
          showRefund={Boolean(refundTarget)}
        />
      ) : null}
      <MessageComposer
        status={composerStatus}
        onSend={handleSend}
        compact={!!(isGuest && isProviderChatDestination(session.destination)) && !roomy}
        roomy={roomy}
        hint={
          isGuest && isProviderChatDestination(session.destination) && guestContactSaved ? (
            <span className="text-emerald-400/90">{t('messages.guestComposerHint')}</span>
          ) : isGuest && isProviderChatDestination(session.destination) ? (
            <span>{t('messages.guestComposerLocked')}</span>
          ) : undefined
        }
        disabled={!!(isGuest && isProviderChatDestination(session.destination) && !guestContactSaved)}
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
          {isGuest && isProviderChatDestination(session.destination)
            ? t('messages.guestFooterNote')
            : helperIsLive && user
            ? t('messages.helperWillReceive', { name: helperName })
            : t('messages.aiMonitored')}
        </p>
      </div>
      )}

      {isProviderActor && showProviderQuoteShare ? (
        <QuoteSharePanel
          open={showProviderQuoteShare}
          onClose={() => setShowProviderQuoteShare(false)}
          kind={businessId ? 'business' : 'helper'}
          businessId={businessId || null}
          conversationId={conversationId || null}
          onShared={() => setShowProviderQuoteShare(false)}
        />
      ) : null}
      {isProviderActor && showProviderPopShare ? (
        <PopSharePanel
          open={showProviderPopShare}
          onClose={() => setShowProviderPopShare(false)}
          conversationId={conversationId || null}
          businessId={businessId || null}
          onShared={() => setShowProviderPopShare(false)}
        />
      ) : null}
      {isProviderActor && showProviderAgreementShare ? (
        <AgreementSharePanel
          open={showProviderAgreementShare}
          onClose={() => setShowProviderAgreementShare(false)}
          conversationId={conversationId || null}
          businessId={businessId || null}
          onShared={() => setShowProviderAgreementShare(false)}
        />
      ) : null}
      {isProviderActor && showProviderPayReqShare ? (
        <PaymentRequestSharePanel
          open={showProviderPayReqShare}
          onClose={() => setShowProviderPayReqShare(false)}
          conversationId={conversationId || null}
          businessId={businessId || null}
          onShared={() => setShowProviderPayReqShare(false)}
        />
      ) : null}
      {isProviderActor && showProviderContact ? (
        <ConversationContactDrawer
          open={showProviderContact}
          onClose={() => setShowProviderContact(false)}
          conversationId={conversationId || null}
        />
      ) : null}

      {showCreditRefund ? (
        <CreditRefundPanel
          open={showCreditRefund}
          onClose={() => { setShowCreditRefund(false); setRefundTarget(null); }}
          conversationId={conversationId}
          paymentRequestId={refundTarget?.paymentRequestId || null}
          popId={refundTarget?.popId || null}
          creditTxnId={refundTarget?.creditTxnId || null}
          maxAmountCents={refundTarget?.amountCents || null}
          currency={refundTarget?.currency || 'USD'}
          onRefunded={() => { setShowCreditRefund(false); setRefundTarget(null); }}
        />
      ) : null}
    </div>
  );
};

export default ChatPanel;
