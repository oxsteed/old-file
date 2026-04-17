import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, MessageCircle, Building2, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type {
  ChatSession,
  ChatDestination,
  ChatMessage,
  TimelineEvent,
  TimelineItem,
} from '../../../types/helperProfile';
import ChatDestinationDropdown from './ChatDestinationDropdown';
import StatusBadge from './StatusBadge';
import HandoffBanner from './HandoffBanner';
import ChatTimeline from './ChatTimeline';
import MessageComposer from './MessageComposer';
import api from '../../../api/axios';
import { useAuth } from '../../../context/AuthContext';
import { useSocket } from '../../../hooks/useSocket';

interface ChatPanelProps {
  session: ChatSession;
  helperName: string;
  helperId: string;
  /** When set, the chat is scoped to a business (used on /business/:id pages). */
  businessId?: string;
  /** 'sidebar' = embedded on desktop (no close btn). 'modal' = mobile drawer (shows close btn). */
  variant?: 'sidebar' | 'modal';
  onClose?: () => void;
  className?: string;
}

/** Check if the most recent handoff event is unacknowledged */
function getLastHandoff(items: TimelineItem[]): TimelineEvent | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.itemType === 'handoff') return item as TimelineEvent;
  }
  return null;
}

function getHandoffAgentName(destination: ChatDestination, helperName: string): string {
  return destination === 'helper' ? helperName : 'OxSteed Support Agent';
}

// ── Offline / Message-mode empty state ───────────────────────────────────────
const UnavailableState: React.FC<{ destination: ChatDestination; helperName: string }> = ({
  destination, helperName,
}) => {
  const { t } = useTranslation();
  const name = destination === 'helper' ? helperName : 'OxSteed Support';
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
}> = ({ destination, helperName }) => {
  const { t } = useTranslation();
  if (destination === 'helper') return null;
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 bg-violet-900/20 border-b border-violet-800/50"
      aria-label="You are talking to OxSteed platform support"
    >
      <Building2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" aria-hidden="true" />
      <p className="text-xs text-violet-300">
        {t('messages.talkingToSupport', { name: helperName, support: t('messages.oxsteedSupport') })}
      </p>
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
  variant = 'sidebar',
  onClose,
  className = '',
}) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { socket } = useSocket();

  const [session,          setSession]          = useState<ChatSession>(initialSession);
  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [sending,          setSending]          = useState(false);
  const [conversationId,   setConversationId]   = useState<string | null>(null);
  // threadId ties this chat session to server-side Redis history (AI mode only).
  // null until the first AI response is received; echoed back on every subsequent send.
  const [threadId,         setThreadId]         = useState<string | null>(null);

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

    socket.on('message:new', handleNewMessage);
    return () => { socket.off('message:new', handleNewMessage); };
  }, [socket, conversationId]);

  const currentStatus =
    session.destination === 'helper' ? session.helperStatus : session.oxsteedStatus;

  const lastHandoff = !handoffDismissed ? getLastHandoff(session.timeline) : null;

  const handleDestinationChange = useCallback((dest: ChatDestination) => {
    setSession(prev => ({
      ...prev,
      destination: dest,
      status: dest === 'helper' ? prev.helperStatus : prev.oxsteedStatus,
    }));
    setHandoffDismissed(false);
  }, []);

  const handleSend = useCallback(async (text: string) => {
    if (sending) return;

    const userMsg: ChatMessage = {
      id:         `msg-${Date.now()}`,
      itemType:   'message',
      authorType: 'user',
      content:    text,
      timestamp:  new Date().toISOString(),
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
        // Live replies don't use thread memory — clear any stale threadId so
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
  }, [helperId, session, user, helperName, sending, t]);

  const helperIsLive  = session.helperStatus === 'live';
  const isOffline     = currentStatus === 'offline';

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

  // Whether to show the close button — always show it when variant is 'modal',
  // even if onClose is undefined (fall back to a no-op so the button is never invisible)
  const showCloseButton = variant === 'modal';
  const handleClose = onClose ?? (() => {});

  return (
    <div
      className={`flex flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden ${className}`}
      aria-label="Chat panel"
      role="region"
    >
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-800 space-y-3 flex-shrink-0">
        {/* Title row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-brand-400" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-white">{t('messages.chat')}</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={currentStatus} />
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
          onChange={handleDestinationChange}
        />
      </div>

      {/* ── Context banner (when OxSteed selected) ─────────── */}
      <DestinationContextBanner
        destination={session.destination}
        helperName={helperName}
      />

      {/* ── Sign-in prompt when helper is live but user isn't auth'd ── */}
      {helperIsLive && !user && session.destination === 'helper' && (
        <SignInPrompt helperName={helperName} />
      )}

      {/* ── Handoff banner ─────────────────────────────────── */}
      {lastHandoff && (
        <HandoffBanner
          destination={session.destination}
          agentName={getHandoffAgentName(session.destination, helperName)}
          onDismiss={() => setHandoffDismissed(true)}
        />
      )}

      {/* ── Timeline / Empty state ──────────────────────────── */}
      {isOffline ? (
        <UnavailableState
          destination={session.destination}
          helperName={helperName}
        />
      ) : (
        <ChatTimeline
          items={displayTimeline}
          helperName={helperName}
          typing={sending ? session.typing : null}
        />
      )}

      {/* ── Composer ────────────────────────────────────────── */}
      <MessageComposer
        status={isOffline ? 'offline' : 'ai_assistant'}
        onSend={handleSend}
        placeholder={
          session.destination === 'oxsteed'
            ? t('messages.typeMessage')
            : helperIsLive && user
            ? t('messages.chatWith', { name: helperName })
            : undefined
        }
      />

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-950/40 border-t border-gray-800/50 flex-shrink-0">
        <p className="text-xs text-gray-600 text-center">
          {helperIsLive && user
            ? t('messages.helperWillReceive', { name: helperName })
            : t('messages.aiMonitored')}
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
