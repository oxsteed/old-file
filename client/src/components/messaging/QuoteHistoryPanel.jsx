import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, FileText, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import QuoteCard from '../helperProfile/chat/QuoteCard';

export default function QuoteHistoryPanel({
  mode = 'provider',
  open = true,
  kind = 'all',
  businessId = null,
  guestSessionId = null,
  guestAuthHeaders = null,
  helperId = null,
  payeeBusinessId = null,
  conversationId = null,
  onClose,
  onOpenQuote,
  onAccepted,
}) {
  const { t } = useTranslation();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const guestToken = guestAuthHeaders?.['X-Guest-Profile-Token'];
  const guestSessionHeader = guestAuthHeaders?.['X-Guest-Session-Id'];
  const stableGuestAuthHeaders = useMemo(
    () => guestToken && guestSessionHeader
      ? {
          'X-Guest-Profile-Token': guestToken,
          'X-Guest-Session-Id': guestSessionHeader,
        }
      : null,
    [guestToken, guestSessionHeader],
  );

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');
    const request = mode === 'guest'
      ? api.get('/chat/quotes/guest-history', {
          params: guestSessionId ? { guestSessionId } : undefined,
          headers: stableGuestAuthHeaders || undefined,
        })
      : api.get('/chat/quotes/history', {
          params: { kind, ...(businessId ? { businessId } : {}) },
        });
    request.then(({ data }) => {
      if (!cancelled) setQuotes(Array.isArray(data?.quotes) ? data.quotes : []);
    }).catch((err) => {
      if (!cancelled) setError(err?.response?.data?.error || t('messages.quoteHistory.failed'));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [open, mode, kind, businessId, guestSessionId, stableGuestAuthHeaders, t]);

  if (!open) return null;

  const guestMode = mode === 'guest';
  return (
    <section
      className={guestMode ? 'quote-history-overlay' : 'messages-quote-history'}
      role={guestMode ? 'dialog' : 'region'}
      aria-modal={guestMode ? 'true' : undefined}
      aria-label={t(guestMode ? 'messages.quoteHistory.guestTitle' : 'messages.quoteHistory.title')}
    >
      <header className="quote-history-head">
        <div>
          <p className="quote-history-kicker"><FileText size={15} aria-hidden /> {t('messages.quoteHistory.eyebrow')}</p>
          <h2>{t(guestMode ? 'messages.quoteHistory.guestTitle' : 'messages.quoteHistory.title')}</h2>
        </div>
        {guestMode && (
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="quote-history-close">
            <X size={18} aria-hidden />
          </button>
        )}
      </header>

      <div className="quote-history-body">
        {loading ? (
          <p className="quote-history-state" role="status"><Loader2 size={16} className="animate-spin" aria-hidden /> {t('messages.quoteHistory.loading')}</p>
        ) : error ? (
          <p className="quote-history-state is-error" role="alert">{error}</p>
        ) : quotes.length === 0 ? (
          <p className="quote-history-state">{t('messages.quoteHistory.empty')}</p>
        ) : quotes.map((quote) => (
          <article className="quote-history-item" key={`${quote.kind}:${quote.id}`}>
            {(quote.recipient_name || quote.provider_name || quote.job_title || quote.business_name) && (
              <p className="quote-history-context">
                {guestMode
                  ? quote.provider_name
                  : quote.recipient_name || t('messages.quoteHistory.customer')}
                {quote.job_title ? ` · ${quote.job_title}` : ''}
                {quote.business_name ? ` · ${quote.business_name}` : ''}
              </p>
            )}
            <QuoteCard
              initialQuote={quote}
              isProvider={!guestMode}
              isAuthenticated={false}
              guestVerified={guestMode}
              guestAuthHeaders={stableGuestAuthHeaders}
              readOnly={!guestMode}
              compact
              conversationId={quote.conversation_id || conversationId}
              payeeBusinessId={quote.kind === 'business' ? (quote.business_id || payeeBusinessId) : payeeBusinessId}
              payeeHelperId={helperId}
              onAccepted={onAccepted}
            />
            {!guestMode && (quote.conversation_id || quote.guest_session_id || quote.job_id) && (
              <button type="button" className="quote-history-open" onClick={() => onOpenQuote?.(quote)}>
                <ArrowUpRight size={15} aria-hidden />
                {quote.conversation_id || quote.guest_session_id
                  ? t('messages.quoteHistory.openConversation')
                  : t('messages.quoteHistory.openJob')}
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
