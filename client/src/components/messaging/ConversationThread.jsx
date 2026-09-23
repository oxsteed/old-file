import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Archive, ArrowLeft, Calculator, ChevronDown, Globe, Paperclip, Receipt, RotateCcw } from 'lucide-react';
import { useConversationChat } from '../../hooks/useConversationChat';
import AutoTranslatedMessage from '../AutoTranslatedMessage';
import MessageReactions from '../MessageReactions';
import FinancialAdvisorPanel from '../FinancialAdvisorPanel';
import ConversationComposer from './ConversationComposer';
import { parseInlineAttachments, attachmentLabel, isImageAttachment } from '../../utils/messageAttachments';
import QuoteCard from '../helperProfile/chat/QuoteCard';
import QuoteSharePanel from '../helperProfile/chat/QuoteSharePanel';
import PopSharePanel from '../helperProfile/chat/PopSharePanel';
import AgreementSharePanel from '../helperProfile/chat/AgreementSharePanel';
import ProofOfPaymentCard from '../helperProfile/chat/ProofOfPaymentCard';
import AgreementCard from '../helperProfile/chat/AgreementCard';
import PaymentRequestCard from '../helperProfile/chat/PaymentRequestCard';
import BookingRequestCard from '../helperProfile/chat/BookingRequestCard';
import PaymentRequestSharePanel from '../helperProfile/chat/PaymentRequestSharePanel';
import ProviderMessengerToolbar from './ProviderMessengerToolbar';
import MessageBubbleActions from './MessageBubbleActions';
import ReportModal from '../ReportModal';
import ConversationContactDrawer from './ConversationContactDrawer';
import CreditRefundPanel from '../helperProfile/chat/CreditRefundPanel';
import MessengerAvailabilityPicker from '../helperProfile/chat/MessengerAvailabilityPicker';
import { parseQuoteMarker, stripQuoteMarkers } from '../helperProfile/chat/messengerQuotes.js';
import { parsePopMarker, stripPopMarkers } from '../helperProfile/chat/messengerPop.js';
import { parseAgreementMarker, stripAgreementMarkers } from '../helperProfile/chat/messengerAgreements.js';
import { parsePaymentRequestMarker, stripPaymentRequestMarkers } from '../helperProfile/chat/messengerCreditPay.js';
import {
  parseBookingRequestMarker,
  stripBookingRequestMarkers,
  appendBookingRequestMarker,
  buildProposeBookingPayload,
  buildBookingRequestMarker,
  buildInboxScheduleBookingBody,
} from '../helperProfile/chat/messengerBookingRequests.js';
import {
  buildMessengerBookingPayload,
  buildSlotRequestMessage,
  resolveClientTimezone,
} from '../helperProfile/chat/messengerAvailability.js';
import '../helperProfile/chat/MessengerDock.css';
import './SharedMessengerShell.css';
import api from '../../api/axios';
import { createMessageRequestId } from '../../lib/messageRequestId';
import { uploadBusinessMessageAttachment } from '../../api/businessMessaging';
import toast from 'react-hot-toast';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function MessageAttachments({ attachments }) {
  if (!attachments?.length) return null;
  return (
    <div className="messages-bubble-files">
      {attachments.map((att) => (
        isImageAttachment(att) ? (
          <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer">
            <img src={att.url} alt={attachmentLabel(att)} />
          </a>
        ) : (
          <a key={att.url} href={att.url} target="_blank" rel="noopener noreferrer">
            <Paperclip size={14} aria-hidden />
            {attachmentLabel(att)}
          </a>
        )
      ))}
    </div>
  );
}

export default function ConversationThread({
  conversationId,
  role = 'customer',
  providerMode = role === 'helper',
  onBack,
  onArchive,
  onRestore,
  businessId: workspaceBusinessId = null,
}) {
  const { t } = useTranslation();
  const isBusinessConversation = Boolean(workspaceBusinessId);
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [showQuoteShare, setShowQuoteShare] = useState(false);
  const [showPopShare, setShowPopShare] = useState(false);
  const [showAgreementShare, setShowAgreementShare] = useState(false);
  const [showPaymentRequestShare, setShowPaymentRequestShare] = useState(false);
  const [showCreditRefund, setShowCreditRefund] = useState(false);
  const [refundTarget, setRefundTarget] = useState(null);
  const [showContactDrawer, setShowContactDrawer] = useState(false);
  const [showQuoteSchedule, setShowQuoteSchedule] = useState(false);
  const [schedulingQuote, setSchedulingQuote] = useState(null);
  const [proposingBookingId, setProposingBookingId] = useState(null);
  const pendingBookingRequestIdRef = useRef(null);
  const [reportUserOpen, setReportUserOpen] = useState(false);
  const [translateEnabled, setTranslateEnabled] = useState(() => {
    try { return localStorage.getItem('oxs:msg-translate') !== 'off'; } catch { return true; }
  });

  const toggleTranslate = () => {
    setTranslateEnabled((value) => {
      const next = !value;
      try { localStorage.setItem('oxs:msg-translate', next ? 'on' : 'off'); } catch {}
      return next;
    });
  };

  const chat = useConversationChat(conversationId, {
    listenProfileChat: providerMode,
    businessId: workspaceBusinessId,
  });

  const {
    messages, fetchMessages, otherName, helperBusiness, jobTitle, otherUserId, jobId, helperId, businessId,
    legacyConversationId, businessConversationType,
    newMessage, loading, loadError, sending, notFound, otherTyping, showSeen, lastSentByMe,
    stickToBottom, messagesEndRef, threadRef, inputRef, isArchived,
    handleInputChange, handleBlur, sendMessage, retryMessage,
    handleThreadScroll, scrollToLatest, user,
  } = chat;

  const artifactConversationId = isBusinessConversation ? legacyConversationId : conversationId;
  const isBusinessCustomerConversation = !isBusinessConversation || businessConversationType === 'customer';
  const canUseProviderTools = providerMode
    && !isArchived
    && isBusinessCustomerConversation
    && Boolean(artifactConversationId);
  const archiveAction = isArchived ? onRestore : onArchive;

  const handleDeleteMessage = async (messageId) => {
    if (isBusinessConversation) return;
    if (!window.confirm(t('messages.deleteConfirm'))) return;
    try {
      await api.delete(`/messages/conversations/${conversationId}/${messageId}`);
    } catch (error) {
      console.error('Failed to delete message:', error);
    }
  };

  const handleEditMessage = (messageId) => {
    if (isBusinessConversation) return;
    const msg = messages.find((item) => item.id === messageId);
    if (msg) {
      setEditingId(messageId);
      setEditText(parseInlineAttachments(msg.content).text || msg.content);
    }
  };

  const handleSaveEdit = async (messageId) => {
    if (!editText.trim()) {
      setEditingId(null);
      return;
    }
    try {
      await api.put(`/messages/conversations/${conversationId}/${messageId}`, {
        content: editText,
      });
      setEditingId(null);
      setEditText('');
    } catch (error) {
      console.error('Failed to edit message:', error);
    }
  };

  const handleBlockUser = async () => {
    if (!otherUserId || !window.confirm(t('messages.blockConfirm', { defaultValue: 'Block this person from messaging you?' }))) return;
    try {
      await api.post(`/messages/users/${otherUserId}/block`);
      toast.success(t('messages.userBlocked', { defaultValue: 'User blocked.' }));
    } catch (error) {
      toast.error(error.response?.data?.error || t('messages.blockFailed', { defaultValue: 'Could not block this user.' }));
    }
  };

  const starters = role === 'helper'
    ? [
        t('messages.starters.helper.thanks'),
        t('messages.starters.helper.when'),
        t('messages.starters.helper.details'),
      ]
    : [
        t('messages.starters.customer.available'),
        t('messages.starters.customer.quote'),
        t('messages.starters.customer.photos'),
      ];

  const profileHref = otherUserId && (role === 'customer' || String(helperId) === String(otherUserId))
    ? `/helpers/${otherUserId}`
    : null;

  if (loading) {
    return (
      <div className="messages-thread-loading">
        <div className="messages-spinner" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="messages-thread-empty">
        <p>{t('messages.conversationNotFound')}</p>
        <button type="button" onClick={onBack}>
          {t('messages.backToMessages')}
        </button>
      </div>
    );
  }

  return (
    <section className="messages-thread" aria-label={t('messages.chatWith', { name: otherName || '...' })}>
      <header className="messages-thread-head">
        <button type="button" className="messages-back mobile-only" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden />
          {t('common.back')}
        </button>
        <div className="messages-thread-person">
          <div className={`messages-avatar${role === 'helper' ? ' helper' : ''}`}>
            {(otherName || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            {profileHref ? (
              <Link to={profileHref} className="messages-thread-name">
                {otherName || (role === 'helper' ? t('messages.customer') : t('common.helper'))}
              </Link>
            ) : (
              <h1 className="messages-thread-name">
                {otherName || (role === 'helper' ? t('messages.customer') : t('common.helper'))}
              </h1>
            )}
            {helperBusiness && (
              <p className="messages-business">
                {role === 'helper' ? t('messages.via', { name: helperBusiness }) : helperBusiness}
              </p>
            )}
            {jobTitle && jobId && (
              <Link to={`/jobs/${jobId}`} className="messages-job">
                {t('messages.re', { title: jobTitle })}
              </Link>
            )}
            {jobTitle && !jobId && (
              <p className="messages-job">{t('messages.re', { title: jobTitle })}</p>
            )}
          </div>
        </div>
        <div className="messages-thread-actions">
          {archiveAction ? (
            <button
              type="button"
              className="messages-thread-action-icon"
              onClick={archiveAction}
              aria-label={isArchived ? t('messages.restore') : t('messages.archive')}
              title={isArchived ? t('messages.restore') : t('messages.archive')}
            >
              {isArchived ? <RotateCcw size={16} aria-hidden /> : <Archive size={16} aria-hidden />}
              <span className="messages-thread-action-label">
                {isArchived ? t('messages.restore') : t('messages.archive')}
              </span>
            </button>
          ) : null}
          {/* Provider deal chips live only in ProviderMessengerToolbar (no header duplicate). */}
          {!isBusinessConversation && !canUseProviderTools && !isArchived ? (
            <button
              type="button"
              className="messages-thread-action-icon"
              onClick={() => setShowPopShare(true)}
              aria-label={t('messages.popShare.title')}
              title={t('messages.popShare.title')}
            >
              <Receipt size={16} aria-hidden />
              <span className="messages-thread-action-label">{t('messages.popShare.button')}</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`messages-thread-action-icon${translateEnabled ? ' on' : ''}`}
            onClick={toggleTranslate}
            aria-pressed={translateEnabled}
            aria-label={translateEnabled ? t('messages.translateOff') : t('messages.translateOn')}
            title={translateEnabled ? t('messages.translateOff') : t('messages.translateOn')}
          >
            <Globe size={16} aria-hidden />
            <span className="messages-thread-action-label">
              {translateEnabled ? t('messages.translateOff') : t('messages.translateOn')}
            </span>
          </button>
          <button
            type="button"
            className={`messages-thread-action-icon${showAdvisor ? ' on' : ''}`}
            onClick={() => setShowAdvisor((value) => !value)}
            aria-label={t('messages.shell.aiAdvisorAria')}
            title={t('messages.shell.aiAdvisorAria')}
            aria-pressed={showAdvisor}
          >
            <Calculator size={16} aria-hidden />
            <span className="messages-thread-action-label">{t('messages.shell.aiAdvisorAria')}</span>
          </button>
        </div>
      </header>

      {loadError && (
        <div className="messages-inline-alert" role="alert">
          <p>{t('messages.loadFailed')}</p>
          <div className="messages-inline-alert-actions">
            <button type="button" onClick={fetchMessages} disabled={loading}>
              {t('messages.retry')}
            </button>
            <Link to="/support/escalation">{t('messages.contactSupport')}</Link>
          </div>
        </div>
      )}

      {canUseProviderTools ? (
        <ProviderMessengerToolbar
          onQuote={() => setShowQuoteShare(true)}
          onPaymentRequest={() => setShowPaymentRequestShare(true)}
          onAgreement={() => setShowAgreementShare(true)}
          onPop={() => setShowPopShare(true)}
          onSchedule={() => { setProposingBookingId(null); setSchedulingQuote(schedulingQuote || { kind: businessId ? 'business' : 'helper', id: null }); setShowQuoteSchedule(true); }}
          onRefund={() => setShowCreditRefund(true)}
          onContact={() => setShowContactDrawer(true)}
          showRefund={Boolean(refundTarget)}
        />
      ) : null}


      <div
        ref={threadRef}
        className="messages-thread-scroll"
        onScroll={handleThreadScroll}
      >
        {messages.length === 0 && (
          <p className="messages-thread-note">
            {role === 'helper' ? t('messages.noMessagesReply') : t('messages.noMessagesStart')}
          </p>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender_id === user?.id;
          const isLastFromMe = showSeen && msg.id === lastSentByMe?.id;
          const isEditing = editingId === msg.id;
          const parsed = parseInlineAttachments(msg.content);
          const attachments = [
            ...(Array.isArray(msg.attachments) ? msg.attachments : []),
            ...parsed.attachments,
          ];
          return (
            <div key={msg.id} className={`messages-bubble-wrap ${isMe ? 'mine' : 'theirs'}`}>
              {!isMe && msg.sender_name && (
                <span className="messages-bubble-author">{msg.sender_name}</span>
              )}
              {isEditing ? (
                <div className="messages-edit-box">
                  <textarea
                    value={editText}
                    onChange={(event) => setEditText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleSaveEdit(msg.id);
                      }
                      if (event.key === 'Escape') setEditingId(null);
                    }}
                    rows={2}
                    autoFocus
                  />
                  <div>
                    <button type="button" onClick={() => handleSaveEdit(msg.id)}>{t('common.save')}</button>
                    <button type="button" onClick={() => setEditingId(null)}>{t('common.cancel')}</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={`messages-bubble ${isMe ? 'mine' : 'theirs'}${msg._failed ? ' failed' : ''}${msg._pending ? ' pending' : ''}`}>
                    {(() => {
                      const quoteParsed = parseQuoteMarker(msg.content);
                      const popParsed = parsePopMarker(msg.content);
                      const agreementParsed = parseAgreementMarker(msg.content);
                      const payReqParsed = parsePaymentRequestMarker(msg.content);
                      const bookingReqParsed = parseBookingRequestMarker(msg.content);
                      let displayText = parsed.text || msg.content || '';
                      if (quoteParsed) displayText = stripQuoteMarkers(displayText);
                      if (popParsed) displayText = stripPopMarkers(displayText);
                      if (agreementParsed) displayText = stripAgreementMarkers(displayText);
                      if (payReqParsed) displayText = stripPaymentRequestMarkers(displayText);
                      if (bookingReqParsed) displayText = stripBookingRequestMarkers(displayText);
                      return (
                        <>
                          {displayText ? (
                            <AutoTranslatedMessage
                              text={displayText}
                              enabled={translateEnabled}
                              incomingOnly
                              isOwnMessage={isMe}
                            />
                          ) : null}
                          {quoteParsed ? (
                            <QuoteCard
                              markerText={msg.content}
                              isProvider={canUseProviderTools}
                              readOnly={isArchived}
                              isAuthenticated
                              guestVerified={false}
                              conversationId={artifactConversationId}
                              payeeBusinessId={businessId}
                              payeeHelperId={helperId}
                              onAccepted={(data) => {
                                const q = data?.quote || data;
                                if (q?.kind && q?.id) {
                                  setSchedulingQuote({ kind: q.kind, id: q.id, token: q.token });
                                  setShowQuoteSchedule(true);
                                }
                              }}
                            />
                          ) : null}
                          {popParsed ? (
                            <ProofOfPaymentCard
                              markerText={msg.content}
                              isProvider={canUseProviderTools}
                              readOnly={isArchived}
                              onRefundRequest={(target) => {
                                setRefundTarget(target);
                                setShowCreditRefund(true);
                              }}
                            />
                          ) : null}
                          {payReqParsed ? (
                            <PaymentRequestCard
                              markerText={msg.content}
                              conversationId={artifactConversationId}
                              isProvider={canUseProviderTools}
                              readOnly={isArchived}
                              isAuthenticated
                              payeeBusinessId={businessId}
                              payeeHelperId={helperId}
                            />
                          ) : null}
                          {agreementParsed ? (
                            <AgreementCard
                              markerText={msg.content}
                              isProvider={canUseProviderTools}
                              readOnly={isArchived}
                              isAuthenticated
                            />
                          ) : null}
                          {bookingReqParsed ? (
                            <BookingRequestCard
                              markerText={msg.content}
                              isProvider={canUseProviderTools}
                              readOnly={isArchived}
                              isAuthenticated
                              conversationId={artifactConversationId}
                              onProposeTime={({ booking }) => {
                                setProposingBookingId(booking?.id || null);
                                setSchedulingQuote(null);
                                setShowQuoteSchedule(true);
                              }}
                            />
                          ) : null}
                        </>
                      );
                    })()}
                    <MessageAttachments attachments={attachments} />
                    {msg.updated_at && msg.updated_at > msg.created_at && (
                      <span className="messages-edited">{t('messages.edited')}</span>
                    )}
                  </div>
                  {!isBusinessConversation && !msg._pending && !msg._failed && (
                    <MessageReactions
                    conversationId={artifactConversationId}
                      messageId={msg.id}
                      reactions={msg.reactions || []}
                    />
                  )}
                  <div className="messages-bubble-meta">
                    {msg._pending && <span>{t('messages.sending')}</span>}
                    {msg._failed && (
                      <span className="failed">
                        {t('messages.failed')}
                        <button type="button" onClick={() => retryMessage(msg.id)}>
                          {t('messages.retry')}
                        </button>
                      </span>
                    )}
                    {!msg._pending && !msg._failed && <span>{formatTime(msg.created_at)}</span>}
                    {isLastFromMe && !msg._pending && !msg._failed && (
                      <span className="seen">{t('messages.seen')}</span>
                    )}
                    <MessageBubbleActions
                      onCopy={() => navigator.clipboard.writeText(parsed.text || msg.content || '')}
                      onEdit={() => handleEditMessage(msg.id)}
                      onDelete={() => handleDeleteMessage(msg.id)}
                      onReport={() => setReportUserOpen(true)}
                      onBlock={handleBlockUser}
                      canEdit={isMe && !isBusinessConversation}
                      canDelete={isMe && !isBusinessConversation}
                      canModerate={!isBusinessConversation && !isMe && Boolean(otherUserId)}
                    />
                  </div>
                </>
              )}
            </div>
          );
        })}
        {otherTyping && (
          <div className="messages-bubble-wrap theirs" aria-live="polite">
            <div className="messages-typing" aria-label={t('messages.typing')}>
              <span /><span /><span />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {reportUserOpen && otherUserId && (
        <ReportModal
          userId={otherUserId}
          userName={otherName || t('messages.user', { defaultValue: 'this user' })}
          conversationId={conversationId}
          onClose={() => setReportUserOpen(false)}
          onSuccess={() => setReportUserOpen(false)}
        />
      )}

      {!stickToBottom && (
        <button type="button" className="messages-jump-latest" onClick={() => scrollToLatest('smooth')}>
          <ChevronDown size={16} aria-hidden />
          {t('messages.jumpToLatest')}
        </button>
      )}

      
      {showQuoteSchedule && (schedulingQuote || proposingBookingId) && (
        <div className="messages-quote-schedule-wrap" style={{ padding: '0.5rem 0.75rem' }}>
          <MessengerAvailabilityPicker
            helperId={helperId}
            businessId={businessId}
            open={showQuoteSchedule}
            onClose={() => { setShowQuoteSchedule(false); setSchedulingQuote(null); setProposingBookingId(null); }}
            onSelectSlot={async (slot) => {
              try {
                if (proposingBookingId) {
                  const payload = buildProposeBookingPayload(slot);
                  await api.post(`/chat/booking-requests/${proposingBookingId}/propose`, payload || {
                    requestedDate: slot.date,
                    requestedStartTime: slot.start.length === 5 ? `${slot.start}:00` : slot.start,
                    requestedEndTime: slot.end.length === 5 ? `${slot.end}:00` : slot.end,
                    startIso: slot.startIso,
                    endIso: slot.endIso,
                    timezone: slot.timezone,
                  });
                  try {
                    window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', {
                      detail: { bookingId: proposingBookingId },
                    }));
                  } catch { /* ignore */ }
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  fetchMessages?.();
                } else if (schedulingQuote?.kind && schedulingQuote?.id) {
                  const clientRequestId = pendingBookingRequestIdRef.current || createMessageRequestId();
                  pendingBookingRequestIdRef.current = clientRequestId;
                  await api.post(`/chat/quotes/${schedulingQuote.kind}/${schedulingQuote.id}/schedule`, {
                    token: schedulingQuote.token,
                    helperId,
                    businessId,
                    serviceId: slot.serviceId,
                    serviceName: slot.serviceName,
                    requestedDate: slot.date,
                    requestedStartTime: slot.start.length === 5 ? `${slot.start}:00` : slot.start,
                    requestedEndTime: slot.end.length === 5 ? `${slot.end}:00` : slot.end,
                    startIso: slot.startIso,
                    endIso: slot.endIso,
                    timezone: slot.timezone,
                    clientRequestId,
                  });
                  pendingBookingRequestIdRef.current = null;
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  fetchMessages?.();
                } else {
                  // Inbox Schedule with no quote: create durable booking_request + card marker
                  const tz = slot.timezone || resolveClientTimezone();
                  const textMsg = buildSlotRequestMessage({
                    date: slot.date,
                    start: slot.start,
                    end: slot.end,
                    providerName: otherName || '',
                    locale: localStorage.getItem('oxs:language') || 'en',
                    t,
                    serviceId: slot.serviceId,
                    serviceName: slot.serviceName,
                    timezone: tz,
                  });
                  const body = buildInboxScheduleBookingBody({
                    conversationId: artifactConversationId,
                    helperId,
                    businessId,
                    serviceId: slot.serviceId,
                    serviceName: slot.serviceName || otherName || 'Service request',
                    date: slot.date,
                    start: slot.start,
                    end: slot.end,
                    startIso: slot.startIso,
                    endIso: slot.endIso,
                    timezone: tz,
                    description: textMsg || null,
                    source: 'messenger_inbox_schedule',
                  });
                  if (!body) {
                    toast.error(t('helperProfile.messenger.slotBookingFailed'));
                    return;
                  }
                  const clientRequestId = pendingBookingRequestIdRef.current || createMessageRequestId();
                  pendingBookingRequestIdRef.current = clientRequestId;
                  body.clientRequestId = clientRequestId;
                  const { data } = await api.post('/chat/booking-requests', body);
                  pendingBookingRequestIdRef.current = null;
                  toast.success(t('helperProfile.messenger.slotBookingToast'));
                  try {
                    window.dispatchEvent(new CustomEvent('oxs:booking-chat-updated', {
                      detail: { bookingId: data?.booking?.id || data?.bookingId },
                    }));
                  } catch { /* ignore */ }
                  fetchMessages?.();
                }
                setShowQuoteSchedule(false);
                setSchedulingQuote(null);
                setProposingBookingId(null);
              } catch (err) {
                console.error('schedule/propose failed', err);
                const code = err?.response?.data?.code;
                const agreements = err?.response?.data?.agreements;
                if (code === 'agreement_required') {
                  const title = agreements?.[0]?.title;
                  toast.error(
                    title
                      ? t('helperProfile.messenger.agreementRequiredScheduleNamed', {
                          title,
                          defaultValue: `Accept "{{title}}" before scheduling.`,
                        })
                      : t('helperProfile.messenger.agreementRequiredSchedule', {
                          defaultValue: 'Accept the required agreement before scheduling.',
                        }),
                  );
                } else if (code === 'conflict') {
                  toast.error(t('helperProfile.messenger.slotBookingConflict'));
                } else {
                  toast.error(t('helperProfile.messenger.slotBookingFailed'));
                }
              }
            }}
          />
        </div>
      )}
      {showQuoteShare && (
        <QuoteSharePanel
          open={showQuoteShare}
          onClose={() => setShowQuoteShare(false)}
          kind={businessId ? 'business' : 'helper'}
          businessId={businessId}
          conversationId={artifactConversationId}
          onShared={(data) => {
            // Optimistic append if socket lags
            if (data?.message) {
              /* useConversationChat will pick up via socket */
            }
            setShowQuoteShare(false);
          }}
        />
      )}
      {showPopShare && (
        <PopSharePanel
          open={showPopShare}
          onClose={() => setShowPopShare(false)}
          conversationId={artifactConversationId}
          businessId={businessId}
          onShared={() => setShowPopShare(false)}
        />
      )}
      {showAgreementShare && (
        <AgreementSharePanel
          open={showAgreementShare}
          onClose={() => setShowAgreementShare(false)}
          conversationId={artifactConversationId}
          businessId={businessId}
          onShared={() => setShowAgreementShare(false)}
        />
      )}
      {showContactDrawer && !isBusinessConversation && (
        <ConversationContactDrawer
          open={showContactDrawer}
          onClose={() => setShowContactDrawer(false)}
          conversationId={artifactConversationId}
        />
      )}
      {showCreditRefund && (
        <CreditRefundPanel
          open={showCreditRefund}
          onClose={() => { setShowCreditRefund(false); setRefundTarget(null); }}
          conversationId={artifactConversationId}
          paymentRequestId={refundTarget?.paymentRequestId || null}
          popId={refundTarget?.popId || null}
          creditTxnId={refundTarget?.creditTxnId || null}
          maxAmountCents={refundTarget?.amountCents || null}
          currency={refundTarget?.currency || 'USD'}
          onRefunded={() => { setShowCreditRefund(false); setRefundTarget(null); }}
        />
      )}
      {showPaymentRequestShare && (
        <PaymentRequestSharePanel
          open={showPaymentRequestShare}
          onClose={() => setShowPaymentRequestShare(false)}
          conversationId={artifactConversationId}
          businessId={businessId}
          onShared={() => setShowPaymentRequestShare(false)}
        />
      )}
      {isArchived ? (
        <div className="messages-archived-notice" role="status">
          <p>{t('messages.archivedReadOnly', { defaultValue: 'This conversation is archived. Restore it to continue messaging.' })}</p>
          {onRestore ? (
            <button type="button" onClick={onRestore}>
              <RotateCcw size={15} aria-hidden />
              {t('messages.restore')}
            </button>
          ) : null}
        </div>
      ) : (
        <ConversationComposer
          conversationId={conversationId}
          value={newMessage}
          onChange={handleInputChange}
          onBlur={handleBlur}
          onSend={sendMessage}
          sending={sending}
          inputRef={inputRef}
          starters={starters}
          showStarters={messages.length === 0}
          placeholder={role === 'helper' ? t('messages.typeReply') : t('messages.typeAMessage')}
          uploadAttachment={isBusinessConversation
            ? (id, file) => uploadBusinessMessageAttachment(workspaceBusinessId, id, file)
            : undefined}
        />
      )}

      <FinancialAdvisorPanel isOpen={showAdvisor} onClose={() => setShowAdvisor(false)} />
    </section>
  );
}
