import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, ArrowLeft } from 'lucide-react';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';

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
  const rawId = inquiryId || params.inquiryId;
  const [fetchError, setFetchError] = useState(null);

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
        <div className="messages-guest-card">
          <div className="messages-guest-card-head">
            <div>
              <p className="messages-kicker">{t('messages.guestInquiryBadge')}</p>
              <h1>{guestName}</h1>
              <p>{guestEmail}</p>
              {createdAt && (
                <p className="messages-guest-time">{new Date(createdAt).toLocaleString()}</p>
              )}
            </div>
            {mailto && (
              <a href={mailto} className="messages-guest-mail">
                <Mail size={16} aria-hidden />
                {t('messages.replyByEmail')}
              </a>
            )}
          </div>
          <div className="messages-guest-card-body">
            <p className="messages-kicker">{t('messages.guestInquiryMessageLabel')}</p>
            <p className="messages-guest-message">{message}</p>
          </div>
        </div>
      )}
    </div>
  );
}
