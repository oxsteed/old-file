import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, ArrowLeft } from 'lucide-react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

/**
 * Read-only view for a guest profile inquiry (visitor had no OxSteed account).
 * IDs in the URL look like guest-123 — natural key is the numeric suffix.
 */
export default function HelperGuestInquiryPage() {
  const { inquiryId } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const parsed = useMemo(() => {
    const raw = String(inquiryId || '');
    const num = raw.replace(/^guest-/i, '');
    const id = parseInt(num, 10);
    return Number.isFinite(id) ? id : null;
  }, [inquiryId]);

  const payloadKey = parsed != null ? `oxs:guest-inquiry:${parsed}` : null;
  const payload = useMemo(() => {
    if (!payloadKey) return null;
    try {
      const raw = sessionStorage.getItem(payloadKey);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }, [payloadKey]);

  const guestName = payload?.guestName || '';
  const guestEmail = payload?.guestEmail || '';
  const message = payload?.message || '';
  const createdAt = payload?.createdAt || '';

  const mailto =
    guestEmail && guestName
      ? `mailto:${guestEmail}?subject=${encodeURIComponent(
          `${t('messages.guestInquiryReplySubject')} — OxSteed`
        )}&body=${encodeURIComponent(
          `${t('messages.guestInquiryReplyBody', { name: guestName })}\n\n`
        )}`
      : guestEmail
      ? `mailto:${guestEmail}`
      : '';

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <Navbar />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-8">
        <button
          type="button"
          onClick={() => navigate('/helper/messages')}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-6"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('messages.backToInbox')}
        </button>

        {!parsed ? (
          <p className="text-gray-400">{t('messages.guestInquiryInvalid')}</p>
        ) : !payload ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-6">
            <h1 className="text-lg font-semibold text-white mb-2">{t('messages.guestInquiryUnavailable')}</h1>
            <p className="text-sm text-gray-400">{t('messages.guestInquiryUnavailableHint')}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-orange-400/90">
                  {t('messages.guestInquiryBadge')}
                </p>
                <h1 className="text-xl font-semibold text-white mt-1">{guestName}</h1>
                <p className="text-sm text-gray-400 mt-0.5">{guestEmail}</p>
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
              <p className="text-xs text-gray-500 mb-2">{t('messages.guestInquiryMessageLabel')}</p>
              <p className="text-sm text-gray-200 whitespace-pre-wrap">{message}</p>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
