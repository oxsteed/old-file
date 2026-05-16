import React, { useState, useEffect } from 'react';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Send, Archive, Plus, Search } from 'lucide-react';
import '../../styles/BusinessMessagingTab.css';

export function BusinessMessagingTab({ businessId }) {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [conversationType, setConversationType] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);

  // Load conversations
  useEffect(() => {
    loadConversations();
  }, [conversationType, search]);

  const loadConversations = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/businesses/${businessId}/messages`, {
        params: { type: conversationType === 'all' ? undefined : conversationType, search }
      });
      setConversations(response.data.conversations || []);
    } catch (error) {
      toast.error('Failed to load conversations');
    } finally {
      setLoading(false);
    }
  };

  // Load conversation messages
  const openConversation = async (conversationId) => {
    try {
      const response = await api.get(
        `/businesses/${businessId}/messages/${conversationId}`
      );
      setSelectedConversation(response.data);
      setMessages(response.data.messages || []);
    } catch (error) {
      toast.error('Failed to load conversation');
    }
  };

  // Send message
  const handleSendMessage = async () => {
    if (!messageText.trim() || !selectedConversation) return;

    try {
      const response = await api.post(
        `/businesses/${businessId}/messages/${selectedConversation.id}`,
        { content: messageText, message_type: 'text' }
      );
      setMessages([...(messages || []), response.data]);
      setMessageText('');
      // Reload conversations to update last_message_at
      loadConversations();
    } catch (error) {
      toast.error('Failed to send message');
    }
  };

  // Archive conversation
  const handleArchiveConversation = async (conversationId) => {
    try {
      await api.post(
        `/businesses/${businessId}/messages/${conversationId}/archive`
      );
      toast.success('Conversation archived');
      loadConversations();
      setSelectedConversation(null);
    } catch (error) {
      toast.error('Failed to archive conversation');
    }
  };

  const handleNewConversation = async (type, data) => {
    try {
      await api.post(`/businesses/${businessId}/messages`, {
        conversation_type: type,
        ...data
      });
      toast.success('Conversation created');
      setShowNewConversationModal(false);
      loadConversations();
    } catch (error) {
      toast.error('Failed to create conversation');
    }
  };

  return (
    <div className="bmt-messaging-container">
      <div className="bmt-conversations-list">
        <div className="bmt-header">
          <h3>Conversations</h3>
          <button
            onClick={() => setShowNewConversationModal(true)}
            className="bmt-btn-new"
            aria-label="New conversation"
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="bmt-type-filter">
          {['all', 'team', 'customer'].map(type => (
            <button
              key={type}
              onClick={() => setConversationType(type)}
              className={`bmt-filter-btn ${conversationType === type ? 'active' : ''}`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        <div className="bmt-search">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search conversations"
          />
        </div>

        <div className="bmt-conv-list">
          {loading ? (
            <div className="bmt-loading">Loading conversations...</div>
          ) : conversations.length === 0 ? (
            <div className="bmt-empty">No conversations</div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => openConversation(conv.id)}
                className={`bmt-conv-item ${selectedConversation?.id === conv.id ? 'active' : ''}`}
              >
                <div className="bmt-conv-main">
                  <div className="bmt-conv-title">
                    {conv.conversation_type === 'team' ? 'Team Chat' : conv.customer_name || conv.customer_email}
                  </div>
                  <div className="bmt-conv-preview">
                    {conv.subject}
                  </div>
                </div>
                <div className="bmt-conv-meta">
                  <span className={`bmt-badge ${conv.conversation_type}`}>
                    {conv.conversation_type}
                  </span>
                  {conv.last_message_at && (
                    <div className="bmt-conv-time">
                      {new Date(conv.last_message_at).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="bmt-message-view">
        {selectedConversation ? (
          <>
            <div className="bmt-msg-header">
              <div>
                <h4>{selectedConversation.customer_name || 'Team Chat'}</h4>
                <span className={`bmt-status ${selectedConversation.conversation_type}`}>
                  {selectedConversation.conversation_type}
                </span>
              </div>
              <button
                onClick={() => handleArchiveConversation(selectedConversation.id)}
                className="bmt-btn-archive"
                aria-label="Archive conversation"
              >
                <Archive size={18} />
              </button>
            </div>

            <div className="bmt-messages">
              {messages && messages.length > 0 ? (
                messages.map(msg => (
                  <div key={msg.id} className={`bmt-msg ${msg.sender_type}`}>
                    <div className="bmt-msg-sender">{msg.sender_name}</div>
                    <div className="bmt-msg-content">{msg.content}</div>
                    <div className="bmt-msg-time">
                      {new Date(msg.created_at).toLocaleString()}
                    </div>
                  </div>
                ))
              ) : (
                <div className="bmt-no-messages">No messages yet</div>
              )}
            </div>

            <div className="bmt-msg-input">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type a message..."
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) handleSendMessage();
                }}
                aria-label="Message input"
              />
              <button
                onClick={handleSendMessage}
                disabled={!messageText.trim()}
                className="bmt-btn-send"
                aria-label="Send message"
              >
                <Send size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="bmt-no-selection">
            Select a conversation to start messaging
          </div>
        )}
      </div>

      {showNewConversationModal && (
        <NewConversationModal
          onClose={() => setShowNewConversationModal(false)}
          onSubmit={handleNewConversation}
        />
      )}
    </div>
  );
}

function NewConversationModal({ onClose, onSubmit }) {
  const [type, setType] = useState('team');
  const [data, setData] = useState({ customer_name: '', customer_email: '', subject: '' });

  const handleSubmit = () => {
    if (type === 'customer' && !data.customer_email) {
      alert('Customer email is required');
      return;
    }
    onSubmit(type, data);
  };

  return (
    <div className="bmt-modal-overlay" onClick={onClose}>
      <div className="bmt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>New Conversation</h3>
        <div className="bmt-form-group">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="team">Team Chat</option>
            <option value="customer">Customer Message</option>
          </select>
        </div>

        {type === 'customer' && (
          <>
            <div className="bmt-form-group">
              <label>Customer Name</label>
              <input
                type="text"
                value={data.customer_name}
                onChange={(e) => setData({ ...data, customer_name: e.target.value })}
                placeholder="Customer name"
              />
            </div>
            <div className="bmt-form-group">
              <label>Customer Email *</label>
              <input
                type="email"
                value={data.customer_email}
                onChange={(e) => setData({ ...data, customer_email: e.target.value })}
                placeholder="customer@example.com"
                required
              />
            </div>
          </>
        )}

        <div className="bmt-form-group">
          <label>Subject</label>
          <input
            type="text"
            value={data.subject}
            onChange={(e) => setData({ ...data, subject: e.target.value })}
            placeholder="Conversation subject"
          />
        </div>

        <div className="bmt-modal-buttons">
          <button onClick={onClose} className="bmt-btn-cancel">Cancel</button>
          <button onClick={handleSubmit} className="bmt-btn-create">Create</button>
        </div>
      </div>
    </div>
  );
}
