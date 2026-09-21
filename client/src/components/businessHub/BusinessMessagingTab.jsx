import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Send, Archive, Plus, Search } from 'lucide-react';
import '../../styles/BusinessMessagingTab.css';

export function BusinessMessagingTab({ businessId }) {
  const { t } = useTranslation();
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [conversationType, setConversationType] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewConversationModal, setShowNewConversationModal] = useState(false);

  const loadConversations = async () => {
    if (!businessId) return;
    try {
      setLoading(true);
      const response = await api.get(`/businesses/${businessId}/messages`, {
        params: { type: conversationType === 'all' ? undefined : conversationType, search }
      });
      const raw = response.data;
      const list = Array.isArray(raw?.conversations)
        ? raw.conversations
        : (Array.isArray(raw) ? raw : []);
      setConversations(list);
    } catch (error) {
      toast.error(t('businessMessaging.toastLoadConversationsFailed'));
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [businessId, conversationType, search]);

  // Load conversation messages
  const openConversation = async (conversationId) => {
    try {
      const response = await api.get(
        `/businesses/${businessId}/messages/${conversationId}`
      );
      setSelectedConversation(response.data);
      setMessages(Array.isArray(response.data?.messages) ? response.data.messages : []);
    } catch (error) {
      toast.error(t('businessMessaging.toastLoadConversationFailed'));
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
      setMessages([...(Array.isArray(messages) ? messages : []), response.data]);
      setMessageText('');
      // Reload conversations to update last_message_at
      loadConversations();
    } catch (error) {
      toast.error(t('businessMessaging.toastSendFailed'));
    }
  };

  // Archive conversation
  const handleArchiveConversation = async (conversationId) => {
    try {
      await api.post(
        `/businesses/${businessId}/messages/${conversationId}/archive`
      );
      toast.success(t('businessMessaging.toastArchived'));
      loadConversations();
      setSelectedConversation(null);
    } catch (error) {
      toast.error(t('businessMessaging.toastArchiveFailed'));
    }
  };

  const handleNewConversation = async (type, data) => {
    try {
      await api.post(`/businesses/${businessId}/messages`, {
        conversation_type: type,
        ...data
      });
      toast.success(t('businessMessaging.toastCreated'));
      setShowNewConversationModal(false);
      loadConversations();
    } catch (error) {
      toast.error(t('businessMessaging.toastCreateFailed'));
    }
  };

  const getConversationTypeLabel = (type) => {
    const labels = {
      team: t('businessMessaging.type.team'),
      customer: t('businessMessaging.type.customer')
    };
    return labels[type] || t('businessMessaging.type.unknown');
  };

  return (
    <div className="bmt-messaging-container">
      <div className="bmt-conversations-list">
        <div className="bmt-header">
          <h3>{t('businessMessaging.title')}</h3>
          <button
            onClick={() => setShowNewConversationModal(true)}
            className="bmt-btn-new"
            aria-label={t('businessMessaging.newConversation')}
          >
            <Plus size={18} />
          </button>
        </div>

        <div className="bmt-type-filter">
          {['all', 'team', 'customer'].map((type) => (
            <button
              key={type}
              onClick={() => setConversationType(type)}
              className={`bmt-filter-btn ${conversationType === type ? 'active' : ''}`}
            >
              {type === 'all'
                ? t('businessMessaging.filterAll')
                : type === 'team'
                  ? t('businessMessaging.filterTeam')
                  : t('businessMessaging.filterCustomer')}
            </button>
          ))}
        </div>

        <div className="bmt-search">
          <Search size={16} />
          <input
            type="text"
            placeholder={t('businessMessaging.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('businessMessaging.searchAria')}
          />
        </div>

        <div className="bmt-conv-list">
          {loading ? (
            <div className="bmt-loading">{t('businessMessaging.loading')}</div>
          ) : conversations.length === 0 ? (
            <div className="bmt-empty">{t('businessMessaging.empty')}</div>
          ) : (
            conversations.map(conv => (
              <div
                key={conv.id}
                onClick={() => openConversation(conv.id)}
                className={`bmt-conv-item ${selectedConversation?.id === conv.id ? 'active' : ''}`}
                >
                  <div className="bmt-conv-main">
                    <div className="bmt-conv-title">
                    {conv.conversation_type === 'team' ? t('businessMessaging.teamChat') : conv.customer_name || conv.customer_email}
                    </div>
                    <div className="bmt-conv-preview">
                      {conv.subject}
                  </div>
                </div>
                  <div className="bmt-conv-meta">
                  <span className={`bmt-badge ${conv.conversation_type}`}>
                    {getConversationTypeLabel(conv.conversation_type)}
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
                <h4>{selectedConversation.customer_name || t('businessMessaging.teamChat')}</h4>
                <span className={`bmt-status ${selectedConversation.conversation_type}`}>
                  {getConversationTypeLabel(selectedConversation.conversation_type)}
                </span>
              </div>
              <button
                onClick={() => handleArchiveConversation(selectedConversation.id)}
                className="bmt-btn-archive"
                aria-label={t('businessMessaging.ariaArchive')}
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
                <div className="bmt-no-messages">{t('businessMessaging.noMessages')}</div>
              )}
            </div>

            <div className="bmt-msg-input">
              <textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder={t('businessMessaging.messagePlaceholder')}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) handleSendMessage();
                }}
                aria-label={t('businessMessaging.messageAria')}
              />
              <button
                onClick={handleSendMessage}
                disabled={!messageText.trim()}
                className="bmt-btn-send"
                aria-label={t('businessMessaging.sendAria')}
              >
                <Send size={18} />
              </button>
            </div>
          </>
        ) : (
          <div className="bmt-no-selection">
            {t('businessMessaging.noSelection')}
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
  const { t } = useTranslation();
  const [type, setType] = useState('team');
  const [data, setData] = useState({ customer_name: '', customer_email: '', subject: '' });

  const handleSubmit = () => {
    if (type === 'customer' && !data.customer_email) {
      toast.error(t('businessMessaging.customerEmailRequired'));
      return;
    }
    onSubmit(type, data);
  };

  return (
    <div className="bmt-modal-overlay" onClick={onClose}>
      <div className="bmt-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('businessMessaging.newConversation')}</h3>
        <div className="bmt-form-group">
          <label>{t('businessMessaging.formType')}</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="team">{t('businessMessaging.type.team')}</option>
            <option value="customer">{t('businessMessaging.type.customer')}</option>
          </select>
        </div>

        {type === 'customer' && (
          <>
            <div className="bmt-form-group">
              <label>{t('businessMessaging.customerName')}</label>
              <input
                type="text"
                value={data.customer_name}
                onChange={(e) => setData({ ...data, customer_name: e.target.value })}
                placeholder={t('businessMessaging.customerNamePlaceholder')}
              />
            </div>
            <div className="bmt-form-group">
              <label>
                {t('businessMessaging.customerEmail')}
                {' '}
                *
              </label>
              <input
                type="email"
                value={data.customer_email}
                onChange={(e) => setData({ ...data, customer_email: e.target.value })}
                placeholder={t('businessMessaging.customerEmailPlaceholder')}
                required
              />
            </div>
          </>
        )}

        <div className="bmt-form-group">
          <label>{t('businessMessaging.subject')}</label>
          <input
            type="text"
            value={data.subject}
            onChange={(e) => setData({ ...data, subject: e.target.value })}
            placeholder={t('businessMessaging.subjectPlaceholder')}
          />
        </div>

        <div className="bmt-modal-buttons">
          <button onClick={onClose} className="bmt-btn-cancel">{t('businessMessaging.cancel')}</button>
          <button onClick={handleSubmit} className="bmt-btn-create">{t('businessMessaging.create')}</button>
        </div>
      </div>
    </div>
  );
}
