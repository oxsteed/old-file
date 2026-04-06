import React, { useState, useCallback } from 'react';
import { X, MessageCircle, Building2 } from 'lucide-react';
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

interface ChatPanelProps {
  session: ChatSession;
  helperName: string;
  /** Rendered in a sidebar — no close button */
  variant?: 'sidebar' | 'modal';
  onClose?: () => void;
  className?: string;
}

/** Check if the most recent handoff event is unacknowledged */
function getLastHandoff(
  items: TimelineItem[],
): TimelineEvent | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.itemType === 'handoff') return item as TimelineEvent;
  }
  return null;
}

function getHandoffAgentName(
  destination: ChatDestination,
  helperName: string,
): string {
  return destination === 'helper' ? helperName : 'OxSteed Support Agent';
}

// ── Offline / Message-mode empty state ────────────────────────────────────────
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
        <p className="text-sm font-medium text-white">{name} is offline</p>
        <p className="text-xs text-gray-400 mt-1 leading-relaxed">
          Leave a message and they'll get back to you as soon as possible.
        </p>
      </div>
    </div>
  );
};

// ── OxSteed context banner ─────────────────────────────────────────────────────
const DestinationContextBanner: React.FC<{
  destination: ChatDestination;
  helperName: string;
}> = ({ destination, helperName }) => {
  if (destination === 'helper') return null;
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 bg-violet-900/20 border-b border-violet-800/50"
      aria-label="You are talking to OxSteed platform support"
    >
      <Building2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" aria-hidden="true" />
      <p className="text-xs text-violet-300">
        You are now talking to{' '}
        <span className="font-semibold">OxSteed platform support</span>, not {helperName}.
      </p>
    </div>
  );
};

// ── Main ChatPanel ─────────────────────────────────────────────────────────────
const ChatPanel: React.FC<ChatPanelProps> = ({
  session: initialSession,
  helperName,
  variant = 'sidebar',
  onClose,
  className = '',
}) => {
  const [session, setSession] = useState<ChatSession>(initialSession);
  const [handoffDismissed, setHandoffDismissed] = useState(false);

  const currentStatus =
    session.destination === 'helper' ? session.helperStatus : session.oxsteedStatus;

  const lastHandoff = !handoffDismissed ? getLastHandoff(session.timeline) : null;

  const handleDestinationChange = useCallback((dest: ChatDestination) => {
    setSession((prev) => ({ ...prev, destination: dest }));
    setHandoffDismissed(false); // Re-show handoff banner for the new destination
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        itemType: 'message',
        authorType: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };

      // Simulate an AI reply after a short delay (mock behaviour)
      setSession((prev) => ({
        ...prev,
        typing: { authorType: 'helper_ai', authorLabel: 'AI Assistant' },
        timeline: [...prev.timeline, userMsg],
      }));

      setTimeout(() => {
        const autoReply: ChatMessage = {
          id: `msg-${Date.now()}-reply`,
          itemType: 'message',
          authorType:
            session.destination === 'helper' ? 'helper_ai' : 'oxsteed_ai',
          content:
            session.destination === 'helper'
              ? "Thanks for your message! Carlos will review and confirm shortly. In the meantime, is there anything else I can help clarify?"
              : "Thanks for reaching out to OxSteed Support. A team member will review your message and follow up shortly.",
          timestamp: new Date().toISOString(),
        };

        // Also add a status event for message_mode
        const statusEvent: TimelineEvent | null =
          currentStatus === 'message_mode'
            ? {
                id: `evt-${Date.now()}`,
                itemType: 'system',
                eventType: 'message_queued',
                content: 'Message queued — reply expected within 4 hours',
                timestamp: new Date().toISOString(),
              }
            : null;

        setSession((prev) => ({
          ...prev,
          typing: null,
          timeline: [
            ...prev.timeline,
            autoReply,
            ...(statusEvent ? [statusEvent] : []),
          ],
        }));
      }, 1500);
    },
    [session.destination, currentStatus],
  );

  const isOffline = currentStatus === 'offline';

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
            <h2 className="text-sm font-semibold text-white">Chat</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={currentStatus} />
            {variant === 'modal' && onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                aria-label="Close chat"
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
          items={session.timeline.filter((item) => {
            // For OxSteed destination, only show system messages that aren't
            // helper-specific booking events (in a real app this filtering
            // would come from the API)
            if (session.destination === 'oxsteed') {
              if (item.itemType === 'booking_event') return false;
            }
            return true;
          })}
          helperName={helperName}
          typing={session.typing}
        />
      )}

      {/* ── Composer ────────────────────────────────────────── */}
      <MessageComposer
        status={currentStatus}
        onSend={handleSend}
        placeholder={
          session.destination === 'oxsteed'
            ? 'Ask OxSteed support…'
            : undefined
        }
      />

      {/* ── Footer ──────────────────────────────────────────── */}
      <div className="px-4 py-2 bg-gray-950/40 border-t border-gray-800/50 flex-shrink-0">
        <p className="text-xs text-gray-600 text-center">
          Secured by OxSteed · Conversations are monitored for safety
        </p>
      </div>
    </div>
  );
};

export default ChatPanel;
