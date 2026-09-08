import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, ArrowLeft } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

/** UUID v4 pattern for guest_profile_chat_inbound.id */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Read-only view for a guest profile inquiry (visitor had no OxSteed account).
 * URL: /helper/messages/guest/:inquiryId (UUID, optional `guest-` prefix in storage keys).
 */
export default function HelperGuestInquiryPage() {
  const { inquiryId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);

  const inquiryUuid = useMemo(() => {
    const raw = String(inquiryId || '').trim();
    const stripped = raw.replace(/^guest-/i, '');
    return UUID_RE.test(stripped) ? stripped : null;
  }, [inquiryId]);

  const storageKey = inquiryUuid ? `oxs:guest-inquiry:${inquiryUuid}` : null;

  const [payload, setPayload] = useState(() => {
    if (!storageKey) return null;
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (!inquiryUuid) {
      setLoading(false);
      return;
    }
    if (!user) {
      setLoading(false);
      return;
    }
    if (payload?.guestEmail) {
      setLoading(false);
      return;
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
  }, [inquiryUuid, user]);

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

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <Navbar />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
          <p className="text-[var(--color-text-muted)]">{t('messages.guestInquirySignIn')}</p>
        </main>
        <Footer />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <button
          type="button"
          onClick={() => navigate('/helper/messages')}
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] mb-6"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('messages.backToInbox')}
        </button>

        {!inquiryUuid ? (
          <p className="text-[var(--color-text-muted)]">{t('messages.guestInquiryInvalid')}</p>
        ) : fetchError === 'forbidden' ? (
          <p className="text-[var(--color-text-muted)]">{t('messages.guestInquiryForbidden')}</p>
        ) : !payload ? (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
            <h1 className="text-lg font-semibold text-[var(--color-text)] mb-2">{t('messages.guestInquiryUnavailable')}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('messages.guestInquiryUnavailableHint')}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-orange-400/90">
                  {t('messages.guestInquiryBadge')}
                </p>
                <h1 className="text-xl font-semibold text-[var(--color-text)] mt-1">{guestName}</h1>
                <p className="text-sm text-[var(--color-text-muted)] mt-0.5">{guestEmail}</p>
                {createdAt && (
                  <p className="text-xs text-gray-600 mt-2">{new Date(createdAt).toLocaleString()}</p>
                )}
              </div>
              {mailto && (
                <a
                  href={mailto}
                  className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium"
                >
                  <Mail className="w-4 h-4" aria-hidden="true" />
                  {t('messages.replyByEmail')}
                </a>
              )}
            </div>
            <div className="px-5 py-5">
              <p className="text-xs text-[var(--color-text-faint)] mb-2">{t('messages.guestInquiryMessageLabel')}</p>
              <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-wrap">{message}</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
