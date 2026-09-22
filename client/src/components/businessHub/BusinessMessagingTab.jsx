import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Archive, Plus, Search, Send } from 'lucide-react';
import { createMessageRequestId } from '../../lib/messageRequestId';
import ConversationThread from '../messaging/ConversationThread';
import ConversationList from '../messaging/ConversationList';
import {
  conversationDisplayName,
  normalizeTeamConversationItem,
} from '../messaging/messengerShellState';
import '../../styles/BusinessMessagingTab.css';
import '../messaging/SharedMessengerShell.css';

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
  const [dealLoadError, setDealLoadError] = useState(false);
  const [dealSearch, setDealSearch] = useState('');

  const loadDeals = useCallback(async () => {
    if (!businessId) return;
    try {
      setDealsLoading(true);
      setDealLoadError(false);
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
      setDealLoadError(true);
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
  const [teamLoadError, setTeamLoadError] = useState(false);
  const [showNewModal, setShowNewModal] = useState(false);
  const [teamSending, setTeamSending] = useState(false);
  const [teamSendError, setTeamSendError] = useState('');
  const pendingTeamMessageIdRef = useRef(null);

  const loadTeam = useCallback(async () => {
    if (!businessId) return;
    try {
      setTeamLoading(true);
      setTeamLoadError(false);
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
      setTeamLoadError(true);
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
    if (!messageText.trim() || !selectedTeam || teamSending) return;
    const clientMessageId = pendingTeamMessageIdRef.current || createMessageRequestId();
    try {
      setTeamSending(true);
      setTeamSendError('');
      const response = await api.post(
        `/businesses/${businessId}/messages/${selectedTeam.id}`,
        { content: messageText, message_type: 'text', clientMessageId },
      );
      setTeamMessages((prev) => [...(Array.isArray(prev) ? prev : []), response.data]);
      setMessageText('');
      pendingTeamMessageIdRef.current = null;
      loadTeam();
    } catch {
      pendingTeamMessageIdRef.current = clientMessageId;
      setTeamSendError(t('businessMessaging.toastSendFailed'));
      toast.error(t('businessMessaging.toastSendFailed'));
    } finally {
      setTeamSending(false);
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
          <div className="bmt-conversations-list bmt-deals-list">
            <div className="bmt-header">
              <h3>{t('businessMessaging.dealsTitle')}</h3>
            </div>
            {dealLoadError && (
              <div className="messages-inline-alert" role="alert">
                <p>{t('businessMessaging.toastLoadConversationsFailed')}</p>
                <button type="button" onClick={loadDeals} disabled={dealsLoading}>
                  {t('messages.retry')}
                </button>
              </div>
            )}
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
            <ConversationList
              className="bmt-shared-list"
              items={filteredDeals}
              selectedId={selectedDealId}
              onSelect={(conv) => setSelectedDealId(conv.id)}
              loading={dealsLoading}
              empty={(
                <p className="bmt-empty">
                  {dealConversations.length === 0
                    ? t('businessMessaging.dealsEmpty')
                    : t('messages.shell.filteredEmpty')}
                </p>
              )}
              ariaLabel={t('businessMessaging.dealsTitle')}
            />
          </div>
          <div className="bmt-thread-pane">
            {selectedDealId ? (
              <ConversationThread
                conversationId={selectedDealId}
                role="helper"
                onBack={() => setSelectedDealId(null)}
              />
            ) : (
              <div className="bmt-empty-thread messages-thread-empty">
                <p>{t('businessMessaging.selectDeal')}</p>
                <p className="bmt-empty-hint">{t('messages.shell.selectDealHint')}</p>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bmt-conversations-list bmt-team-list">
            <div className="bmt-header">
              <h3>{t('businessMessaging.title')}</h3>
              <button
                type="button"
                onClick={() => setShowNewModal(true)}
                className="bmt-btn-new messages-thread-action-icon"
                aria-label={t('businessMessaging.newConversation')}
                title={t('businessMessaging.newConversation')}
              >
                <Plus size={18} aria-hidden />
              </button>
            </div>
            <div className="bmt-type-filter" role="tablist" aria-label={t('businessMessaging.filterAll')}>
              {['all', 'team', 'customer'].map((type) => (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={conversationType === type}
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
            {teamLoadError && (
              <div className="messages-inline-alert" role="alert">
                <p>{t('businessMessaging.toastLoadConversationsFailed')}</p>
                <button type="button" onClick={loadTeam} disabled={teamLoading}>
                  {t('messages.retry')}
                </button>
              </div>
            )}
            <ConversationList
              className="bmt-shared-list"
              items={teamConversations.map((conv) =>
                normalizeTeamConversationItem(conv, typeLabel(conv.conversation_type)),
              ).filter(Boolean)}
              selectedId={selectedTeam?.id ?? null}
              onSelect={(conv) => openTeam(conv.id)}
              loading={teamLoading}
              empty={(
                <p className="bmt-empty sms-list-empty">
                  {teamSearch.trim() || conversationType !== 'all'
                    ? t('messages.shell.filteredEmpty')
                    : t('businessMessaging.empty')}
                </p>
              )}
              ariaLabel={t('businessMessaging.title')}
              renderItem={(conv, { isActive, unread, onSelect }) => {
                const name = conversationDisplayName(
                  conv,
                  t('businessMessaging.conversation'),
                );
                const chip = typeLabel(conv.conversation_type);
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => onSelect?.(conv)}
                    className={`messages-row sms-conversation-row${unread ? ' unread' : ''}${isActive ? ' active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <div className="messages-avatar">
                      {(name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="messages-row-main">
                      <div className="messages-row-top">
                        <strong>{name}</strong>
                        <span className={`bmt-type-chip bmt-type-chip--${conv.conversation_type || 'unknown'}`}>
                          {chip}
                        </span>
                      </div>
                      <p className="messages-preview">
                        {conv.last_message_preview || chip}
                      </p>
                    </div>
                  </button>
                );
              }}
            />
          </div>
          <div className="bmt-thread-pane">
            {selectedTeam ? (
              <div className="messages-thread bmt-team-thread">
                <header className="messages-thread-head">
                  <div className="messages-thread-person">
                    <div className="messages-avatar">
                      {(
                        selectedTeam.customer_name ||
                        selectedTeam.subject ||
                        t('businessMessaging.conversation')
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div>
                      <h2 className="messages-thread-name">
                        {selectedTeam.customer_name ||
                          selectedTeam.subject ||
                          t('businessMessaging.conversation')}
                      </h2>
                      <p className="messages-business">
                        {typeLabel(selectedTeam.conversation_type)}
                      </p>
                    </div>
                  </div>
                  <div className="messages-thread-actions">
                    <button
                      type="button"
                      className="messages-thread-action-icon"
                      onClick={() => archiveTeam(selectedTeam.id)}
                      aria-label={t('businessMessaging.archive')}
                      title={t('businessMessaging.archive')}
                    >
                      <Archive size={16} aria-hidden />
                      <span className="visually-hidden">{t('businessMessaging.archive')}</span>
                    </button>
                  </div>
                </header>
                <div className="messages-thread-scroll bmt-team-messages">
                  {(Array.isArray(teamMessages) ? teamMessages : []).length === 0 ? (
                    <div className="messages-thread-empty bmt-team-empty-messages">
                      <p>{t('businessMessaging.noMessages')}</p>
                    </div>
                  ) : (
                    (Array.isArray(teamMessages) ? teamMessages : []).map((msg) => (
                      <div key={msg.id} className="messages-bubble-wrap theirs">
                        <div className="messages-bubble theirs">
                          <div className="bmt-team-msg-author">
                            {msg.sender_name || msg.sender_id}
                          </div>
                          <div>{msg.content}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="messages-composer bmt-team-composer">
                  {teamSendError ? (
                    <div className="messages-inline-alert" role="alert">
                      <span>{teamSendError}</span>
                      <button type="button" onClick={sendTeamMessage} disabled={teamSending}>
                        <Send size={13} aria-hidden />
                        {t('messages.retry')}
                      </button>
                    </div>
                  ) : null}
                  <input
                    type="text"
                    className="messages-composer-input"
                    value={messageText}
                    onChange={(e) => {
                      setMessageText(e.target.value);
                      if (teamSendError) {
                        setTeamSendError('');
                        pendingTeamMessageIdRef.current = null;
                      }
                    }}
                    placeholder={t('businessMessaging.messagePlaceholder')}
                    aria-label={t('businessMessaging.messageAria')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        sendTeamMessage();
                      }
                    }}
                    disabled={teamSending}
                  />
                  <button
                    type="button"
                    className="messages-composer-send"
                    onClick={sendTeamMessage}
                    disabled={teamSending || !messageText.trim()}
                    aria-label={t('businessMessaging.send')}
                    title={t('businessMessaging.send')}
                  >
                    <Send size={16} aria-hidden />
                  </button>
                </div>
              </div>
            ) : (
              <div className="bmt-empty-thread messages-thread-empty">
                <p>{t('businessMessaging.selectConversation')}</p>
                <p className="bmt-empty-hint">{t('messages.shell.selectTeamHint')}</p>
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
