import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, ArrowLeft, Send, Loader2 } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readStoredInquiry(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function GuestInquiryPanel({ inquiryId, embedded = false, onBack }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams();
  const { user } = useAuth();
  const { socket } = useSocket();
  const rawId = inquiryId || params.inquiryId;
  const [fetchError, setFetchError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const bottomRef = useRef(null);

  const inquiryUuid = useMemo(() => {
    const raw = String(rawId || '').trim();
    const stripped = raw.replace(/^guest-/i, '');
    return UUID_RE.test(stripped) ? stripped : null;
  }, [rawId]);

  const storageKey = inquiryUuid ? `oxs:guest-inquiry:${inquiryUuid}` : null;

  const [payload, setPayload] = useState(() => readStoredInquiry(storageKey));
  const [loading, setLoading] = useState(() => !readStoredInquiry(storageKey)?.guestEmail);

  useEffect(() => {
    const stored = readStoredInquiry(storageKey);
    setPayload(stored);
    setFetchError(null);
    setLoading(Boolean(inquiryUuid) && !stored?.guestEmail);
  }, [inquiryUuid, storageKey]);

  useEffect(() => {
    if (!inquiryUuid) {
      setLoading(false);
      return undefined;
    }
    if (!user) {
      setLoading(false);
      return undefined;
    }
    if (payload?.guestEmail) {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/messages/guest-inquiries/${inquiryUuid}`);
        if (cancelled) return;
        const next = {
          guestName: data.other_user_name,
          guestEmail: data.guest_email,
          message: data.guest_message_full || data.last_message,
          createdAt: data.last_message_at || data.created_at,
        };
        setPayload(next);
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch { /* quota */ }
        setFetchError(null);
      } catch (e) {
        if (!cancelled) setFetchError(e?.response?.status === 403 ? 'forbidden' : 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inquiryUuid, user, payload?.guestEmail, storageKey]);

  const loadMessages = useCallback(async () => {
    if (!inquiryUuid || !user) return;
    setLoadingMessages(true);
    try {
      const { data } = await api.get(`/messages/guest-inquiries/${inquiryUuid}/messages`);
      setMessages(Array.isArray(data) ? data : []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [inquiryUuid, user]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [messages.length]);

  // Live updates when guest sends (provider socket)
  useEffect(() => {
    if (!socket || !inquiryUuid) return undefined;
    const onPayload = (incoming) => {
      const sid =
        incoming?.guestSessionId ||
        incoming?.guestInquiryId ||
        incoming?.sessionId;
      if (sid != null && String(sid) !== String(inquiryUuid)) return;
      if (!incoming?.guestInquiry && !incoming?.message && !incoming?.messageId) return;
      const content = String(
        incoming?.message?.content ||
          incoming?.message?.message ||
          incoming?.message ||
          incoming?.content ||
          '',
      ).trim();
      if (!content) return;
      const senderType = String(
        incoming?.message?.sender_type ||
          incoming?.senderType ||
          incoming?.sender_type ||
          'guest',
      ).toLowerCase();
      const id = String(
        incoming?.message?.id ||
          incoming?.messageId ||
          `live-${Date.now()}`,
      );
      setMessages((prev) => {
        if (prev.some((m) => String(m.id) === id)) return prev;
        return [
          ...prev,
          {
            id,
            sender_type: senderType,
            sender_name: incoming?.senderName || incoming?.message?.sender_name || '',
            message: content,
            content,
            created_at: incoming?.message?.created_at || new Date().toISOString(),
          },
        ];
      });
    };
    socket.on('profile_chat:new_message', onPayload);
    socket.on('guest_chat:message', onPayload);
    return () => {
      socket.off('profile_chat:new_message', onPayload);
      socket.off('guest_chat:message', onPayload);
    };
  }, [socket, inquiryUuid]);

  const guestName = payload?.guestName || '';
  const guestEmail = payload?.guestEmail || '';
  const message = payload?.message || '';
  const createdAt = payload?.createdAt || '';

  const mailto =
    guestEmail && guestName
      ? `mailto:${guestEmail}?subject=${encodeURIComponent(
          `${t('messages.guestInquiryReplySubject')} - OxSteed`
        )}&body=${encodeURIComponent(
          `${t('messages.guestInquiryReplyBody', { name: guestName })}\n\n`
        )}`
      : guestEmail
        ? `mailto:${guestEmail}`
        : '';

  const goBack = () => {
    if (onBack) onBack();
    else navigate('/helper/messages');
  };

  const sendReply = async (event) => {
    event?.preventDefault?.();
    const text = draft.trim();
    if (!text || !inquiryUuid || sending) return;
    setSending(true);
    setSendError('');
    try {
      const { data } = await api.post(`/messages/guest-inquiries/${inquiryUuid}/messages`, {
        message: text,
      });
      setMessages((prev) => [...prev, data]);
      setDraft('');
    } catch (err) {
      setSendError(
        err?.response?.data?.error || t('messages.guestInquirySendError'),
      );
    } finally {
      setSending(false);
    }
  };

  if (!user) {
    return <p className="messages-thread-note">{t('messages.guestInquirySignIn')}</p>;
  }

  if (loading) {
    return (
      <div className="messages-thread-loading">
        <div className="messages-spinner" />
      </div>
    );
  }

  const threadMessages =
    messages.length > 0
      ? messages
      : message
        ? [
            {
              id: 'seed',
              sender_type: 'guest',
              sender_name: guestName,
              message,
              created_at: createdAt,
            },
          ]
        : [];

  return (
    <div className={`messages-guest-panel${embedded ? ' embedded' : ''}`}>
      {!embedded && (
        <button type="button" className="messages-back" onClick={goBack}>
          <ArrowLeft size={16} aria-hidden />
          {t('messages.backToInbox')}
        </button>
      )}

      {!inquiryUuid ? (
        <p className="messages-thread-note">{t('messages.guestInquiryInvalid')}</p>
      ) : fetchError === 'forbidden' ? (
        <p className="messages-thread-note">{t('messages.guestInquiryForbidden')}</p>
      ) : !payload ? (
        <div className="messages-guest-card">
          <h1>{t('messages.guestInquiryUnavailable')}</h1>
          <p>{t('messages.guestInquiryUnavailableHint')}</p>
        </div>
      ) : (
        <div className="messages-guest-card messages-guest-card--live">
          <div className="messages-guest-card-head">
            <div>
              <p className="messages-kicker">{t('messages.guestInquiryBadge')}</p>
              <h1>{guestName}</h1>
              <p>{guestEmail}</p>
              {createdAt && (
                <p className="messages-guest-time">{new Date(createdAt).toLocaleString()}</p>
              )}
              <p className="messages-guest-live-hint">{t('messages.guestInquiryLiveHint')}</p>
            </div>
            {mailto && (
              <a href={mailto} className="messages-guest-mail">
                <Mail size={16} aria-hidden />
                {t('messages.replyByEmail')}
              </a>
            )}
          </div>

          <div className="messages-guest-thread" role="log" aria-live="polite">
            {loadingMessages && threadMessages.length === 0 ? (
              <div className="messages-guest-thread-status">
                <Loader2 size={16} className="animate-spin" aria-hidden />
                {t('messages.guestInquiryLoadingThread')}
              </div>
            ) : null}
            {threadMessages.map((m) => {
              const fromGuest = String(m.sender_type || '').toLowerCase() === 'guest';
              return (
                <div
                  key={m.id}
                  className={`messages-guest-bubble${fromGuest ? ' is-guest' : ' is-helper'}`}
                >
                  <p className="messages-guest-bubble-meta">
                    {fromGuest
                      ? guestName || t('messages.guestInquiryBadge')
                      : m.sender_name || t('messages.you')}
                    {m.created_at
                      ? ` · ${new Date(m.created_at).toLocaleString()}`
                      : ''}
                  </p>
                  <p className="messages-guest-bubble-body">{m.message || m.content}</p>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form className="messages-guest-composer" onSubmit={sendReply}>
            {sendError ? (
              <p className="messages-guest-send-error" role="alert">{sendError}</p>
            ) : null}
            <textarea
              className="messages-guest-composer-input"
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('messages.guestInquiryReplyPlaceholder')}
              maxLength={4000}
              disabled={sending}
            />
            <button
              type="submit"
              className="messages-guest-composer-send"
              disabled={sending || !draft.trim()}
            >
              {sending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Send size={16} aria-hidden />
              )}
              {t('messages.guestInquirySendReply')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
