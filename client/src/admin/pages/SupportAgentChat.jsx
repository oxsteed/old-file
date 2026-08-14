import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import {
  MessageSquare,
  Send,
  RefreshCw,
  Search,
  MessagesSquare,
  Inbox,
  UserRound,
} from 'lucide-react';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportEmptyState,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

export default function SupportAgentChat() {
  const { businessId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [selectedConv, setSelectedConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.get('/support/conversations', {
        params: { business_id: businessId },
      });
      const nextConversations = res.data.conversations || [];
      setConversations(nextConversations);
      setSelectedConv((current) => (
        current
          ? nextConversations.find((conversation) => conversation.id === current.id) || current
          : null
      ));
    } catch (err) {
      console.error('Failed to load conversations:', err);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const handleSupportEvent = () => loadConversations();
    window.addEventListener('oxs:admin-support-ticket', handleSupportEvent);
    return () => window.removeEventListener('oxs:admin-support-ticket', handleSupportEvent);
  }, [loadConversations]);

  useEffect(() => {
    if (selectedConv) {
      setMessages(selectedConv.messages || []);
    }
  }, [selectedConv]);

  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConv) return;
    try {
      await adminApi.post(`/support/conversations/${selectedConv.id}/message`, {
        message: messageText,
      });
      setMessageText('');
      loadConversations();
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  const filteredConversations = conversations.filter((conv) => {
    const haystack = `${conv.customer_name || ''} ${conv.customer_email || ''} ${conv.last_message || ''}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });

  return (
    <SupportPageShell>
      <SupportHero
        icon={MessagesSquare}
        eyebrow="Live Conversations"
        title="Support chat"
        description="Handle real-time conversations with customers from a cleaner split view that keeps queue context and message flow side by side."
        actions={(
          <SupportActionButton icon={RefreshCw} onClick={loadConversations} tone="secondary">
            Refresh
          </SupportActionButton>
        )}
        stats={[
          {
            icon: Inbox,
            label: 'Conversations',
            value: conversations.length,
            detail: 'Threads available in the current support workspace.',
          },
          {
            icon: MessageSquare,
            label: 'Selected thread',
            value: selectedConv ? 'Open' : 'None',
            detail: selectedConv ? selectedConv.customer_name : 'Choose a customer thread to begin.',
            tone: 'text-orange-300',
          },
          {
            icon: Send,
            label: 'Messages',
            value: messages.length,
            detail: 'Visible messages in the current thread.',
            tone: 'text-blue-300',
          },
          {
            icon: Search,
            label: 'Search',
            value: search ? 'Filtered' : 'All',
            detail: search ? `Query: ${search}` : 'Browsing the full conversation list.',
            tone: 'text-green-300',
          },
        ]}
      />

      <div className="grid min-h-[62vh] grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <SupportPanel
          title="Conversation list"
          subtitle={`${filteredConversations.length} thread${filteredConversations.length === 1 ? '' : 's'} in the current view.`}
          className="min-h-0"
        >
          <div className="mb-4">
            <div className="relative">
              <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="Search conversations..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full rounded-2xl border border-gray-700 bg-gray-900 py-3 pl-11 pr-4 text-sm text-white focus:border-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredConversations.length === 0 ? (
              <SupportEmptyState
                icon={MessageSquare}
                title="No conversations"
                body="When customer threads are available, they will appear here for quick triage and response."
              />
            ) : (
              filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => setSelectedConv(conv)}
                  className={`w-full rounded-2xl border p-4 text-left transition ${
                    selectedConv?.id === conv.id
                      ? 'border-orange-500/40 bg-orange-500/10'
                      : 'border-gray-800 bg-gray-900/70 hover:border-gray-700 hover:bg-gray-900'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{conv.customer_name}</div>
                      <div className="mt-1 text-xs text-gray-500">{conv.customer_email}</div>
                    </div>
                    <SupportTag tone="blue">Live</SupportTag>
                  </div>
                  <div className="mt-3 max-h-[3.2rem] overflow-hidden text-sm leading-6 text-gray-400">
                    {conv.last_message || 'No message preview available.'}
                  </div>
                  <div className="mt-3 text-xs text-gray-600">{conv.created_at}</div>
                </button>
              ))
            )}
          </div>
        </SupportPanel>

        {selectedConv ? (
          <div className="flex min-h-0 flex-col rounded-[28px] border border-gray-800 bg-gray-950/90">
            <div className="flex items-center justify-between border-b border-gray-800 px-6 py-5">
              <div>
                <div className="text-lg font-semibold text-white">{selectedConv.customer_name}</div>
                <div className="mt-1 text-sm text-gray-500">{selectedConv.customer_email}</div>
              </div>
              <SupportActionButton icon={RefreshCw} onClick={loadConversations} tone="secondary">
                Refresh thread
              </SupportActionButton>
            </div>

            <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.05),transparent_30%)] px-6 py-5">
              <div className="space-y-4">
                {messages.map((msg, idx) => (
                  <div key={msg.id || idx} className={`flex ${(msg.is_from_agent ?? msg.is_agent) ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-3xl px-4 py-3 text-sm leading-7 ${
                      (msg.is_from_agent ?? msg.is_agent)
                        ? 'rounded-tr-md bg-orange-600 text-white'
                        : 'rounded-tl-md border border-gray-800 bg-gray-900 text-gray-200'
                    }`}
                    >
                      <div>{msg.text || msg.content}</div>
                      <div className={`mt-2 text-xs ${(msg.is_from_agent ?? msg.is_agent) ? 'text-orange-100' : 'text-gray-500'}`}>
                        {msg.created_at}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-800 px-6 py-5">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                />
                <button
                  onClick={handleSendMessage}
                  className="rounded-2xl bg-orange-600 px-4 py-3 text-white transition hover:bg-orange-700"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <SupportPanel
            title="Conversation workspace"
            subtitle="Choose a customer thread to start responding."
            className="min-h-0"
          >
            <SupportEmptyState
              icon={UserRound}
              title="Select a conversation"
              body="Open any thread from the left to review its message history and reply in real time."
            />
          </SupportPanel>
        )}
      </div>
    </SupportPageShell>
  );
}
