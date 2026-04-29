import { useState, useEffect, useCallback, useRef } from 'react';
import { Send, Paperclip, Smile } from 'lucide-react';

export default function LiveChat({ apiBaseUrl, ticket, onNewMessage }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const messagesEndRef = useRef(null);
  const pollIntervalRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadMessages = useCallback(async () => {
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/support/tickets/${ticket.id}/messages`,
        {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`,
          },
        }
      );
      if (response.ok) {
        const data = await response.json();
        const incomingMessages = data.messages || [];

        // Check for new messages from support agents
        const oldAgentCount = messages.filter(m => m.sender_type === 'agent').length;
        const newAgentCount = incomingMessages.filter(m => m.sender_type === 'agent').length;

        if (newAgentCount > oldAgentCount) {
          setHasNewMessages(false);
          onNewMessage(0);
        }

        setMessages(incomingMessages);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
    setLoading(false);
  }, [apiBaseUrl, ticket.id, messages, onNewMessage]);

  useEffect(() => {
    loadMessages();
    // Poll for new messages every 5 seconds
    pollIntervalRef.current = setInterval(loadMessages, 5000);
    return () => clearInterval(pollIntervalRef.current);
  }, [loadMessages]);

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!newMessage.trim()) return;

    setSending(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/support/tickets/${ticket.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('accessToken') || ''}`,
          },
          body: JSON.stringify({
            message: newMessage,
            message_type: 'text',
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setMessages([...messages, data.message]);
        setNewMessage('');
        scrollToBottom();
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    }
    setSending(false);
  };

  if (loading) {
    return (
      <div className="widget-loading">
        <div className="widget-spinner" />
      </div>
    );
  }

  return (
    <div className="widget-chat-container">
      {/* Messages */}
      <div className="widget-messages-list">
        {messages.length === 0 ? (
          <div className="widget-empty-state">
            <p>No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              className={`widget-message ${msg.sender_type === 'customer' ? 'customer' : 'agent'}`}
            >
              <div className="widget-message-content">
                <p className="widget-message-text">{msg.message}</p>
                <span className="widget-message-time">
                  {new Date(msg.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <form onSubmit={handleSendMessage} className="widget-message-form">
        <div className="widget-message-input-wrapper">
          <button
            type="button"
            className="widget-attachment-button"
            aria-label="Attach file"
            disabled
            title="File attachments coming soon"
          >
            <Paperclip size={18} />
          </button>
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type your message..."
            className="widget-message-input"
            disabled={sending}
            maxLength={1000}
          />
          <button
            type="button"
            className="widget-emoji-button"
            aria-label="Add emoji"
            disabled
            title="Emoji coming soon"
          >
            <Smile size={18} />
          </button>
        </div>
        <button
          type="submit"
          className="widget-send-button"
          disabled={!newMessage.trim() || sending}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>

      {/* Agent Status */}
      <div className="widget-agent-status">
        <div className="widget-status-indicator online" />
        <span>Support team is typically available Mon-Fri 9am-5pm EST</span>
      </div>
    </div>
  );
}
