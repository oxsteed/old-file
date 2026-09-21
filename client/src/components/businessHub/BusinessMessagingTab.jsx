import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Archive, Plus, Search, Send } from 'lucide-react';
import ConversationThread from '../messaging/ConversationThread';
import '../../styles/BusinessMessagingTab.css';

/**
 * Business Hub messaging workspace.
 * Deals = main /messages conversations for this business (full provider tools).
 * Team = legacy business_conversations text inbox.
 */
export function BusinessMessagingTab({ businessId }) {
  const { t } = useTranslation();
  const [mode, setMode] = useState('deals');

  const [dealConversations, setDealConversations] = useState([]);
  const [selectedDealId, setSelectedDealId] = useState(null);
  const [dealsLoading, setDealsLoading] = useState(false);
  const [dealSearch, setDealSearch] = useState('');

  const loadDeals = useCallback(async () => {
    if (!businessId) return;
    try {
      setDealsLoading(true);
      const { data } = await api.get('/messages/conversations', {
        params: { business_id: businessId },
      });
      const list = Array.isArray(data?.conversations)
        ? data.conversations
        : Array.isArray(data)
          ? data
          : [];
      setDealConversations(list);
    } catch {
      toast.error(t('businessMessaging.toastLoadConversationsFailed'));
      setDealConversations([]);
    } finally {
      setDealsLoading(false);
    }
  }, [businessId, t]);

  useEffect(() => {
    if (mode === 'deals') loadDeals();
  }, [mode, loadDeals]);

  const filteredDeals = useMemo(() => {
    const q = dealSearch.trim().toLowerCase();
    if (!q) return dealConversations;
    return dealConversations.filter((c) => {
      const hay = [
        c.other_user_name,
        c.customer_name,
        c.subject,
        c.last_message_preview,
        c.last_message,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [dealConversations, dealSearch]);

  const [teamConversations, setTeamConversations] = useState([]);
  const [selectedTeam, setSelectedTeam] = useState(null);
  const [teamMessages, setTeamMessages] = useState([]);
  const [messageText, setMessageText] = useState('');
  const [conversationType, setConversationType] = useState('all');
  const [teamSearch, setTeamSearch] = useState('');
  const [teamLoading, setTeamLoading] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);

  const loadTeam = useCallback(async () => {
    if (!businessId) return;
    try {
      setTeamLoading(true);
      const response = await api.get(`/businesses/${businessId}/messages`, {
        params: {
          type: conversationType === 'all' ? undefined : conversationType,
          search: teamSearch || undefined,
        },
      });
      const raw = response.data;
      const list = Array.isArray(raw?.conversations)
        ? raw.conversations
        : Array.isArray(raw)
          ? raw
          : [];
      setTeamConversations(list);
    } catch {
      toast.error(t('businessMessaging.toastLoadConversationsFailed'));
      setTeamConversations([]);
    } finally {
      setTeamLoading(false);
    }
  }, [businessId, conversationType, teamSearch, t]);

  useEffect(() => {
    if (mode === 'team') loadTeam();
  }, [mode, loadTeam]);

  const openTeam = async (conversationId) => {
    try {
      const response = await api.get(`/businesses/${businessId}/messages/${conversationId}`);
      setSelectedTeam(response.data);
      setTeamMessages(Array.isArray(response.data?.messages) ? response.data.messages : []);
    } catch {
      toast.error(t('businessMessaging.toastLoadConversationFailed'));
    }
  };

  const sendTeamMessage = async () => {
    if (!messageText.trim() || !selectedTeam) return;
    try {
      const response = await api.post(
        `/businesses/${businessId}/messages/${selectedTeam.id}`,
        { content: messageText, message_type: 'text' },
      );
      setTeamMessages((prev) => [...(Array.isArray(prev) ? prev : []), response.data]);
      setMessageText('');
      loadTeam();
    } catch {
      toast.error(t('businessMessaging.toastSendFailed'));
    }
  };

  const archiveTeam = async (conversationId) => {
    try {
      await api.post(`/businesses/${businessId}/messages/${conversationId}/archive`);
      toast.success(t('businessMessaging.toastArchived'));
      loadTeam();
      setSelectedTeam(null);
    } catch {
      toast.error(t('businessMessaging.toastArchiveFailed'));
    }
  };

  const createTeamConversation = async (type, data) => {
    try {
      await api.post(`/businesses/${businessId}/messages`, {
        conversation_type: type,
        ...data,
      });
      toast.success(t('businessMessaging.toastCreated'));
      setShowNewModal(false);
      loadTeam();
    } catch {
      toast.error(t('businessMessaging.toastCreateFailed'));
    }
  };

  const typeLabel = (type) => {
    if (type === 'team') return t('businessMessaging.type.team');
    if (type === 'customer') return t('businessMessaging.type.customer');
    return t('businessMessaging.type.unknown');
  };

  return (
    <div className="bmt-messaging-container">
      <div className="bmt-mode-tabs" role="tablist" aria-label={t('businessMessaging.modeTabsAria')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'deals'}
          className={`bmt-filter-btn ${mode === 'deals' ? 'active' : ''}`}
          onClick={() => setMode('deals')}
        >
          {t('businessMessaging.modeDeals')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'team'}
          className={`bmt-filter-btn ${mode === 'team' ? 'active' : ''}`}
          onClick={() => setMode('team')}
        >
          {t('businessMessaging.modeTeam')}
        </button>
      </div>

      {mode === 'deals' ? (
        <>
          <div className="bmt-conversations-list">
            <div className="bmt-header">
              <h3>{t('businessMessaging.dealsTitle')}</h3>
            </div>
            <div className="bmt-search">
              <Search size={16} aria-hidden />
              <input
                type="text"
                placeholder={t('businessMessaging.searchPlaceholder')}
                value={dealSearch}
                onChange={(e) => setDealSearch(e.target.value)}
                aria-label={t('businessMessaging.searchAria')}
              />
            </div>
            {dealsLoading ? (
              <p className="bmt-empty">{t('common.loading')}</p>
            ) : filteredDeals.length === 0 ? (
              <p className="bmt-empty">{t('businessMessaging.dealsEmpty')}</p>
            ) : (
              <ul className="bmt-list">
                {filteredDeals.map((conv) => (
                  <li key={conv.id}>
                    <button
                      type="button"
                      className={`bmt-conversation-item ${selectedDealId === conv.id ? 'active' : ''}`}
                      onClick={() => setSelectedDealId(conv.id)}
                    >
                      <div className="bmt-conversation-name">
                        {conv.other_user_name || conv.customer_name || t('businessMessaging.customer')}
                      </div>
                      <div className="bmt-conversation-preview">
                        {conv.last_message_preview || conv.last_message || ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bmt-thread-pane">
            {selectedDealId ? (
              <ConversationThread
                conversationId={selectedDealId}
                role="helper"
                onBack={() => setSelectedDealId(null)}
              />
            ) : (
              <div className="bmt-empty-thread">
                <p>{t('businessMessaging.selectDeal')}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bmt-conversations-list">
            <div className="bmt-header">
              <h3>{t('businessMessaging.title')}</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
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
                  type="button"
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
              <Search size={16} aria-hidden />
              <input
                type="text"
                placeholder={t('businessMessaging.searchPlaceholder')}
                value={teamSearch}
                onChange={(e) => setTeamSearch(e.target.value)}
                aria-label={t('businessMessaging.searchAria')}
              />
            </div>
            {teamLoading ? (
              <p className="bmt-empty">{t('common.loading')}</p>
            ) : teamConversations.length === 0 ? (
              <p className="bmt-empty">{t('businessMessaging.empty')}</p>
            ) : (
              <ul className="bmt-list">
                {teamConversations.map((conv) => (
                  <li key={conv.id}>
                    <button
                      type="button"
                      className={`bmt-conversation-item ${selectedTeam?.id === conv.id ? 'active' : ''}`}
                      onClick={() => openTeam(conv.id)}
                    >
                      <div className="bmt-conversation-name">
                        {conv.customer_name || conv.subject || typeLabel(conv.conversation_type)}
                      </div>
                      <div className="bmt-conversation-meta">{typeLabel(conv.conversation_type)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bmt-thread-pane">
            {selectedTeam ? (
              <>
                <div className="bmt-thread-header">
                  <div>
                    <h4>
                      {selectedTeam.customer_name ||
                        selectedTeam.subject ||
                        t('businessMessaging.conversation')}
                    </h4>
                    <span>{typeLabel(selectedTeam.conversation_type)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => archiveTeam(selectedTeam.id)}
                    aria-label={t('businessMessaging.archive')}
                  >
                    <Archive size={16} />
                  </button>
                </div>
                <div className="bmt-messages">
                  {(Array.isArray(teamMessages) ? teamMessages : []).map((msg) => (
                    <div key={msg.id} className="bmt-message">
                      <div className="bmt-message-author">{msg.sender_name || msg.sender_id}</div>
                      <div className="bmt-message-body">{msg.content}</div>
                    </div>
                  ))}
                </div>
                <div className="bmt-composer">
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={t('businessMessaging.messagePlaceholder')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendTeamMessage();
                    }}
                  />
                  <button type="button" onClick={sendTeamMessage} aria-label={t('businessMessaging.send')}>
                    <Send size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className="bmt-empty-thread">
                <p>{t('businessMessaging.selectConversation')}</p>
              </div>
            )}
          </div>
          {showNewModal ? (
            <NewConversationModal
              onClose={() => setShowNewModal(false)}
              onCreate={createTeamConversation}
              t={t}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function NewConversationModal({ onClose, onCreate, t }) {
  const [type, setType] = useState('customer');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [subject, setSubject] = useState('');

  return (
    <div className="bmt-modal-backdrop" role="dialog" aria-modal="true">
      <div className="bmt-modal">
        <h4>{t('businessMessaging.newConversation')}</h4>
        <label>
          {t('businessMessaging.formType')}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="customer">{t('businessMessaging.type.customer')}</option>
            <option value="team">{t('businessMessaging.type.team')}</option>
          </select>
        </label>
        {type === 'customer' ? (
          <>
            <label>
              {t('businessMessaging.customerName')}
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
            </label>
            <label>
              {t('businessMessaging.customerEmail')}
              <input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
            </label>
          </>
        ) : null}
        <label>
          {t('businessMessaging.subject')}
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <div className="bmt-modal-actions">
          <button type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button
            type="button"
            onClick={() =>
              onCreate(type, {
                customer_name: customerName,
                customer_email: customerEmail,
                subject,
              })
            }
          >
            {t('common.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BusinessMessagingTab;
