import React, { useState, useCallback, useEffect, useRef } from 'react';
import { X, MessageCircle, Building2, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
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
  /** Rendered in a sidebar — no close button */
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
  destination,
  helperName,
}) => {
  const name = destination === 'helper' ? helperName : 'OxSteed Support';
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center py-10">
      <div className="w-12 h-12 rounded-full bg-gray-800 flex items-center justify-center">
        <MessageCircle className="w-6 h-6 text-gray-500" aria-hidden="true" />
      </div>
      <div>
        <p className="text-white font-medium">{name} is offline</p>
        <p className="text-gray-400 text-sm mt-1">
          Leave a message and they'll get back to you as soon as possible.
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
  if (destination === 'helper') return null;
  return (
    <div className="px-4 py-2 bg-brand-500/10 border-b border-brand-500/20 text-[10px] text-brand-400 text-center uppercase tracking-wider font-semibold">
      You are now talking to{' '}
      <span className="text-brand-300">OxSteed platform support</span>, not {helperName}.
    </div>
  );
};

// ── Sign-in prompt (shown to unauthenticated users when helper is live) ───────
const SignInPrompt: React.FC<{ helperName: string }> = ({ helperName }) => (
  <div className="px-4 py-2.5 bg-brand-500 text-white text-[11px] font-medium flex items-center justify-center gap-2">
    <LogIn className="w-3.5 h-3.5" />
    <span>
      {helperName} is online. {' '}
      <Link to="/login" className="underline decoration-white/50 hover:decoration-white">
        Sign in
      </Link>{' '}
      to send a real message — AI is responding in the meantime.
    </span>
  </div>
);

// ── Main ChatPanel ────────────────────────────────────────────────────────────
const ChatPanel: React.FC<ChatPanelProps> = ({
  session: initialSession,
  helperName,
  helperId,
  variant = 'sidebar',
  onClose,
  className = '',
}) => {
  const { user } = useAuth();
  const { socket } = useSocket();

  const [session, setSession] = useState(initialSession);
  const [handoffDismissed, setHandoffDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);

  // ── Keyboard support ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

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
      } catch {
        /* silent */
      }
    };

    checkStatus();
    // Re-check every 30s while panel is mounted
    const interval = setInterval(checkStatus, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [helperId]);

  // ── Real-time: listen for helper replies via Socket.IO ───────────────────
  useEffect(() => {
    if (!socket || !conversationId) return;

    const handleNewMessage = (payload: { conversationId: string; message: any }) => {
      if (payload.conversationId !== conversationId) return;
      const msg = payload.message;
      
      const timelineMsg: ChatMessage = {
        id: String(msg.id),
        itemType: 'message',
        authorType: 'helper_human',
        content: msg.content,
        timestamp: msg.created_at || new Date().toISOString(),
      };

      setSession(prev => ({
        ...prev,
        typing: null,
        timeline: [...prev.timeline, timelineMsg],
      }));
    };

    socket.on('message:new', handleNewMessage);
    return () => {
      socket.off('message:new', handleNewMessage);
    };
  }, [socket, conversationId]);

  const currentStatus = session.destination === 'helper' ? session.helperStatus : session.oxsteedStatus;
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

    // Optimistically add user message to timeline
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      itemType: 'message',
      authorType: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setSession(prev => ({
      ...prev,
      typing: { authorType: session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai', authorLabel: 'AI Assistant' },
      timeline: [...prev.timeline, userMsg],
    }));

    setSending(true);

    try {
      const { data } = await api.post('/chat/profile-message', {
        helperId,
        destination: session.destination,
        messages: [...session.timeline, userMsg]
          .filter(i => i.itemType === 'message')
          .map(i => {
            const m = i as ChatMessage;
            return {
              role: m.authorType === 'user' ? 'user' : 'assistant',
              content: m.content,
            };
          }),
      });

      if (data.type === 'live') {
        // Save conversationId so we can listen for real-time replies
        if (data.conversationId) setConversationId(data.conversationId);
        
        // Show "waiting for reply" status event
        const waiting: TimelineEvent = {
          id: `evt-${Date.now()}`,
          itemType: 'system',
          eventType: 'message_sent',
          content: `Message sent — ${helperName} will reply shortly.`,
          timestamp: new Date().toISOString(),
        };
        setSession(prev => ({ ...prev, typing: null, timeline: [...prev.timeline, waiting] }));
      } else {
        // AI reply
        const aiMsg: ChatMessage = {
          id: `msg-${Date.now()}-reply`,
          itemType: 'message',
          authorType: data.authorType || (session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai'),
          content: data.reply || "I'm sorry, I couldn't generate a response. Please try again.",
          timestamp: new Date().toISOString(),
        };

        // If helper was actually online but user isn't auth'd, add a status note
        const events: TimelineItem[] = [];
        if (data.helperOnline && !user && session.destination === 'helper') {
          const note: TimelineEvent = {
            id: `evt-${Date.now()}-note`,
            itemType: 'system',
            eventType: 'message_queued',
            content: `${helperName} is online — sign in to send them a direct message.`,
            timestamp: new Date().toISOString(),
          };
          events.push(note);
        }

        setSession(prev => ({ ...prev, typing: null, timeline: [...prev.timeline, aiMsg, ...events] }));
      }
    } catch {
      const errMsg: ChatMessage = {
        id: `msg-${Date.now()}-err`,
        itemType: 'message',
        authorType: 'oxsteed_ai',
        content: "Sorry, I'm having trouble right now. Please try again or contact support@oxsteed.com.",
        timestamp: new Date().toISOString(),
      };
      setSession(prev => ({ ...prev, typing: null, timeline: [...prev.timeline, errMsg] }));
    } finally {
      setSending(false);
    }
  }, [helperId, session, user, helperName, sending]);

  const helperIsLive = session.helperStatus === 'live';
  const isOffline = currentStatus === 'offline';

  // Inject a welcome message into an empty timeline so users know what to ask
  const displayTimeline = React.useMemo(() => {
    const msgs = session.timeline.filter((item) => {
      if (session.destination === 'oxsteed' && item.itemType === 'booking_event') return false;
      return true;
    });

    if (msgs.length > 0) return msgs;

    // No messages yet — prepend a synthetic welcome bubble
    const welcome: ChatMessage = {
      id: 'welcome-msg',
      itemType: 'message',
      authorType: session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai',
      content: session.destination === 'helper' 
        ? `Hi! I'm ${helperName}'s AI assistant. Ask me about their services, availability, or pricing — I'm happy to help.`
        : "Hi! I'm OxSteed's support assistant. Ask me anything about how the platform works.",
      timestamp: new Date().toISOString(),
    };
    return [welcome];
  }, [session.timeline, session.destination, helperName]);

  return (
    <div className={`flex flex-col bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-xl ${className}`}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800">
        {/* Title row */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Chat</h2>
            <StatusBadge status={currentStatus} />
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label="Close chat"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Destination dropdown */}
        <div className="px-3 pb-3">
          <ChatDestinationDropdown
            value={session.destination}
            onChange={handleDestinationChange}
            helperName={helperName}
          />
        </div>
      </div>

      {/* ── Context banner (when OxSteed selected) ─────────── */}
      <DestinationContextBanner destination={session.destination} helperName={helperName} />

      {/* ── Sign-in prompt when helper is live but user isn't auth'd ── */}
      {helperIsLive && !user && session.destination === 'helper' && (
        <SignInPrompt helperName={helperName} />
      )}

      {/* ── Handoff banner ─────────────────────────────────── */}
      {lastHandoff && (
        <HandoffBanner 
          event={lastHandoff} 
          agentName={getHandoffAgentName(session.destination, helperName)} 
          onDismiss={() => setHandoffDismissed(true)}
        />
      )}

      {/* ── Timeline / Empty state ──────────────────────────── */}
      <div className="flex-1 min-h-0 flex flex-col bg-gray-950/50">
        {isOffline ? (
          <UnavailableState destination={session.destination} helperName={helperName} />
        ) : (
          <ChatTimeline
            items={displayTimeline}
            typing={session.typing}
            className="flex-1"
          />
        )}
      </div>

      {/* ── Composer ────────────────────────────────────────── */}
      <div className="flex-shrink-0 p-3 bg-gray-900/50 border-t border-gray-800">
        <MessageComposer 
          onSend={handleSend} 
          disabled={sending} 
          placeholder={isOffline ? "Leave a message..." : "Ask a question..."}
        />
      </div>

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-900/80 border-t border-gray-800 flex items-center justify-between">
        <span className="text-[10px] text-gray-500 font-medium">
          {helperIsLive && user 
            ? `${helperName} is online and will receive your message` 
            : 'AI assistant · Conversations monitored for safety'}
        </span>
      </div>
    </div>
  );
};

export default ChatPanel;
