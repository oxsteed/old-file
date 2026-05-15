/**
 * Business Messaging Component
 * Main UI for team messaging, customer chat, and real-time communication
 */

import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import './BusinessMessaging.css';

export default function BusinessMessaging({ businessId, currentUserId }) {
  const { t } = useTranslation();
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [showNewChannelModal, setShowNewChannelModal] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelType, setNewChannelType] = useState('team');
  const messagesEndRef = useRef(null);

  // Load channels on mount
  useEffect(() => {
    loadChannels();
  }, [businessId]);

  // Load messages when channel changes
  useEffect(() => {
    if (selectedChannel) {
      loadMessages(selectedChannel.id);
    }
  }, [selectedChannel]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadChannels = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`/api/businesses/${businessId}/messaging/channels`);
      setChannels(response.data.data);
      // Auto-select first channel
      if (response.data.data.length > 0) {
        setSelectedChannel(response.data.data[0]);
      }
    } catch (error) {
      console.error('Failed to load channels:', error);
      // Toast error notification here
    } finally {
      setLoading(false);
    }
  };

  const loadMessages = async (channelId) => {
    try {
      const response = await axios.get(
        `/api/businesses/${businessId}/messaging/channels/${channelId}/messages`
      );
      setMessages(response.data.data);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChannel) return;

    try {
      await axios.post(
        `/api/businesses/${businessId}/messaging/channels/${selectedChannel.id}/messages`,
        {
          content: newMessage.trim(),
          messageType: 'text',
        }
      );
      setNewMessage('');
      // Reload messages
      loadMessages(selectedChannel.id);
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleCreateChannel = async (e) => {
    e.preventDefault();
    if (!newChannelName.trim()) return;

    try {
      const response = await axios.post(
        `/api/businesses/${businessId}/messaging/channels`,
        {
          name: newChannelName.trim(),
          type: newChannelType,
        }
      );
      setChannels([...channels, response.data.data]);
      setNewChannelName('');
      setShowNewChannelModal(false);
    } catch (error) {
      console.error('Failed to create channel:', error);
    }
  };

  const handleAddReaction = async (messageId, emoji) => {
    try {
      await axios.post(
        `/api/businesses/${businessId}/messaging/channels/${selectedChannel.id}/messages/${messageId}/react`,
        { emoji }
      );
      loadMessages(selectedChannel.id);
    } catch (error) {
      console.error('Failed to add reaction:', error);
    }
  };

  return (
    <div className="business-messaging">
      {/* Sidebar - Channel List */}
      <div className="bm-sidebar">
        <div className="bm-sidebar-header">
          <h3>{t('messaging.channels')}</h3>
          <button
            className="bm-btn-new-channel"
            onClick={() => setShowNewChannelModal(true)}
            title={t('common.create')}
          >
            +
          </button>
        </div>

        <div className="bm-channel-list">
          {channels.map(channel => (
            <div
              key={channel.id}
              className={`bm-channel-item ${selectedChannel?.id === channel.id ? 'active' : ''}`}
              onClick={() => setSelectedChannel(channel)}
            >
              <div className="bm-channel-badge">
                {channel.type === 'team' ? '👥' : '💬'}
              </div>
              <div className="bm-channel-info">
                <div className="bm-channel-name">{channel.name}</div>
                <div className="bm-channel-members">{channel.memberCount} members</div>
              </div>
              {channel.unreadCount > 0 && (
                <div className="bm-unread-badge">{channel.unreadCount}</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Content - Messages */}
      <div className="bm-main">
        {selectedChannel ? (
          <>
            {/* Channel Header */}
            <div className="bm-header">
              <div className="bm-channel-title">
                <h2>{selectedChannel.name}</h2>
                <p className="bm-channel-desc">{selectedChannel.description}</p>
              </div>
              <div className="bm-header-actions">
                {/* Add members button */}
                <button className="bm-btn-secondary" title={t('common.settings')}>
                  ⚙️
                </button>
              </div>
            </div>

            {/* Messages List */}
            <div className="bm-messages">
              {messages.length === 0 ? (
                <div className="bm-empty-state">
                  <p>{t('messaging.noMessages')}</p>
                </div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={msg.id} className="bm-message-item">
                    <div className="bm-message-avatar">
                      {msg.senderPhoto ? (
                        <img src={msg.senderPhoto} alt={msg.senderName} />
                      ) : (
                        <div className="bm-avatar-placeholder">
                          {msg.senderName?.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="bm-message-content">
                      <div className="bm-message-header">
                        <strong>{msg.senderName}</strong>
                        <time>
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </time>
                      </div>
                      <div className="bm-message-text">{msg.content}</div>
                      {msg.reactions?.length > 0 && (
                        <div className="bm-message-reactions">
                          {msg.reactions.map(emoji => (
                            <span key={emoji} className="bm-reaction">
                              {emoji}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Quick reaction buttons */}
                    <div className="bm-message-actions">
                      <button
                        className="bm-reaction-btn"
                        onClick={() => handleAddReaction(msg.id, '👍')}
                        title="Like"
                      >
                        👍
                      </button>
                      <button
                        className="bm-reaction-btn"
                        onClick={() => handleAddReaction(msg.id, '❤️')}
                        title="Love"
                      >
                        ❤️
                      </button>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <form className="bm-input-form" onSubmit={handleSendMessage}>
              <input
                type="text"
                className="bm-input"
                placeholder={t('messaging.typeMessage')}
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
              />
              <button type="submit" className="bm-btn-send" disabled={!newMessage.trim()}>
                {t('common.send')}
              </button>
            </form>
          </>
        ) : (
          <div className="bm-empty-state">
            <p>{t('messaging.selectChannel')}</p>
          </div>
        )}
      </div>

      {/* New Channel Modal */}
      {showNewChannelModal && (
        <div className="bm-modal-overlay" onClick={() => setShowNewChannelModal(false)}>
          <div className="bm-modal" onClick={e => e.stopPropagation()}>
            <h3>{t('messaging.createChannel')}</h3>
            <form onSubmit={handleCreateChannel}>
              <input
                type="text"
                placeholder={t('messaging.channelName')}
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
                required
              />
              <select value={newChannelType} onChange={e => setNewChannelType(e.target.value)}>
                <option value="team">{t('messaging.teamChannel')}</option>
                <option value="customer">{t('messaging.customerChannel')}</option>
              </select>
              <div className="bm-modal-actions">
                <button type="button" onClick={() => setShowNewChannelModal(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="bm-btn-primary">
                  {t('common.create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
