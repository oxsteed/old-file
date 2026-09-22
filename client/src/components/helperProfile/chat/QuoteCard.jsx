import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X, MessageSquare, Calendar, Loader2, AlertTriangle, Wallet } from 'lucide-react';
import api from '../../../api/axios';
import {
  canCustomerRespond,
  formatCents,
  isQuoteExpired,
  parseQuoteMarker,
  toChatQuoteStatus,
} from './messengerQuotes.js';
import PayWithCreditModal from './PayWithCreditModal.jsx';
import { createMessageRequestId } from '../../../lib/messageRequestId';
import './MessengerDock.css';

/**
 * Rich quote card rendered inside chat timelines / inbox threads.
 */
export default function QuoteCard({
  markerText,
  initialQuote = null,
  kind: kindProp = null,
  quoteId: idProp = null,
  token: tokenProp = '',
  isProvider = false,
  isAuthenticated = false,
  guestVerified = false,
  guestAuthHeaders = null,
  onAccepted,
  onDeclined,
  onRequestVerify,
  onStatusChange = null,
  conversationId = null,
  payeeBusinessId = null,
  payeeHelperId = null,
  onRequestSignIn,
  onCreditPaid,
  compact = false,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';

  const parsed = useMemo(
    () => (markerText ? parseQuoteMarker(markerText) : null),
    [markerText],
  );

  const kind = kindProp || parsed?.kind || initialQuote?.kind;
  const quoteId = idProp || parsed?.id || initialQuote?.id;
  const token = tokenProp || parsed?.token || initialQuote?.token || '';

  const [quote, setQuote] = useState(initialQuote);
  const [loading, setLoading] = useState(!initialQuote && Boolean(kind && quoteId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [showReason, setShowReason] = useState(false);
  const [showCreditPay, setShowCreditPay] = useState(false);
  const pendingResponseRef = useRef(null);

  const load = useCallback(async () => {
    if (!kind || !quoteId) return;
    setLoading(true);
    setError(null);
    try {
      const params = token ? { token } : {};
      const { data } = await api.get(`/chat/quotes/${kind}/${quoteId}`, {
        params,
        headers: guestAuthHeaders || undefined,
      });
      setQuote(data);
    } catch (err) {
      // Fall back to marker summary if fetch fails (token portal may still work)
      if (parsed) {
        setQuote({
          kind: parsed.kind,
          id: parsed.id,
          token: parsed.token,
          title: parsed.title,
          total_cents: parsed.totalCents,
          status: parsed.status,
          valid_until: parsed.validUntil,
          version: parsed.version,
          line_items: [],
        });
      } else {
        setError(t('helperProfile.messenger.quoteLoadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [kind, quoteId, token, guestAuthHeaders, parsed, t]);

  useEffect(() => {
    if (!initialQuote) load();
  }, [initialQuote, load]);

  const status = toChatQuoteStatus(kind, quote?.status || parsed?.status);
  const expired = isQuoteExpired(quote || parsed || {});
  const respondGate = canCustomerRespond(quote || { kind, status, valid_until: parsed?.validUntil }, {
    isAuthenticated,
    guestVerified,
  });

  const lineItems = Array.isArray(quote?.line_items) ? quote.line_items : [];

  const respond = async (action) => {
    if (!kind || !quoteId) return;
    if (!isAuthenticated && !guestVerified) {
      onRequestVerify?.();
      return;
    }
    if (expired || !respondGate.ok) return;
    setBusy(true);
    setError(null);
    try {
      const pending = pendingResponseRef.current;
      const clientRequestId = pending?.action === action
        ? pending.id
        : createMessageRequestId();
      pendingResponseRef.current = { action, id: clientRequestId };
      const { data } = await api.post(
        `/chat/quotes/${kind}/${quoteId}/respond`,
        {
          action,
          token: token || quote?.token,
          reason: action === 'request_changes' || action === 'decline' ? reason || undefined : undefined,
          clientRequestId,
        },
        { headers: guestAuthHeaders || undefined },
      );
      pendingResponseRef.current = null;
      setQuote(data.quote || { ...quote, status: action === 'accept' ? 'accepted' : 'declined' });
      onStatusChange?.(data.quote?.status || (action === 'accept' ? 'accepted' : 'declined'), data);
      if (action === 'accept') onAccepted?.(data);
      else onDeclined?.(data, action);
      setShowReason(false);
    } catch (err) {
      const code = err?.response?.data?.code;
      if (code === 'verify_required') {
        onRequestVerify?.();
        setError(t('helperProfile.messenger.quoteVerifyRequired'));
      } else if (code === 'expired') {
        setError(t('helperProfile.messenger.quoteExpired'));
        setQuote((q) => (q ? { ...q, status: 'expired', expired: true } : q));
      } else {
        setError(err?.response?.data?.error || t('helperProfile.messenger.quoteRespondError'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="messenger-quote-card messenger-quote-card--loading" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        <span>{t('helperProfile.messenger.quoteLoading')}</span>
      </div>
    );
  }

  if (!quote && !parsed) return null;

  const title = quote?.title || parsed?.title || t('helperProfile.messenger.quoteFallbackTitle');
  const total = quote?.total_cents ?? parsed?.totalCents ?? 0;
  const version = quote?.version || parsed?.version || 1;

  const statusLabel = t(`helperProfile.messenger.quoteStatus.${status}`, {
    defaultValue: status,
  });

  const showCustomerActions =
    !isProvider && status === 'sent' && !quote?.superseded_at;

  return (
    <div
      className={`messenger-quote-card${compact ? ' messenger-quote-card--compact' : ''}${expired ? ' is-expired' : ''}${status === 'superseded' ? ' is-superseded' : ''}`}
      data-status={status}
      data-kind={kind}
      role="article"
      aria-label={t('helperProfile.messenger.quoteCardAria', { title })}
    >
      <header className="messenger-quote-card__head">
        <div>
          <p className="messenger-quote-card__eyebrow">
            {t('helperProfile.messenger.quoteEyebrow')}
            {version > 1 ? ` · v${version}` : ''}
          </p>
          <h3 className="messenger-quote-card__title">{title}</h3>
        </div>
        <span className={`messenger-quote-card__badge messenger-quote-card__badge--${status}`}>
          {statusLabel}
        </span>
      </header>

      {lineItems.length > 0 && (
        <ul className="messenger-quote-card__lines">
          {lineItems.map((item, idx) => {
            const qty = Number(item.quantity) || 1;
            const unit =
              item.unit_price_cents != null
                ? Number(item.unit_price_cents)
                : Math.round(Number(item.unit_price || 0) * 100);
            return (
              <li key={`${item.description}-${idx}`}>
                <span>
                  {item.description}
                  {qty !== 1 ? ` × ${qty}` : ''}
                </span>
                <span>{formatCents(unit * qty, locale)}</span>
              </li>
            );
          })}
        </ul>
      )}

      <div className="messenger-quote-card__total">
        <span>{t('helperProfile.messenger.quoteTotal')}</span>
        <strong>{formatCents(total, locale)}</strong>
      </div>

      {(quote?.valid_until || parsed?.validUntil) && (
        <p className="messenger-quote-card__valid">
          {expired
            ? t('helperProfile.messenger.quoteExpiredOn', {
                date: formatQuoteDate(quote?.valid_until || parsed?.validUntil, locale),
              })
            : t('helperProfile.messenger.quoteValidUntil', {
                date: formatQuoteDate(quote?.valid_until || parsed?.validUntil, locale),
              })}
        </p>
      )}

      {expired && status === 'sent' && (
        <p className="messenger-quote-card__warn" role="alert">
          <AlertTriangle className="w-3.5 h-3.5" aria-hidden />
          {t('helperProfile.messenger.quoteExpired')}
        </p>
      )}

      {error && (
        <p className="messenger-quote-card__error" role="alert">
          {error}
        </p>
      )}

      {showCustomerActions && (
        <div className="messenger-quote-card__actions">
          {respondGate.reason === 'verify_required' ? (
            <button
              type="button"
              className="messenger-quote-card__btn messenger-quote-card__btn--secondary"
              onClick={() => onRequestVerify?.()}
            >
              {t('helperProfile.messenger.quoteVerifyToAccept')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="messenger-quote-card__btn messenger-quote-card__btn--primary"
                disabled={busy || expired}
                onClick={() => respond('accept')}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                {t('helperProfile.messenger.quoteAccept')}
              </button>
              <button
                type="button"
                className="messenger-quote-card__btn messenger-quote-card__btn--ghost"
                disabled={busy || expired}
                onClick={() => respond('decline')}
              >
                <X className="w-3.5 h-3.5" />
                {t('helperProfile.messenger.quoteDecline')}
              </button>
              <button
                type="button"
                className="messenger-quote-card__btn messenger-quote-card__btn--ghost"
                disabled={busy || expired}
                onClick={() => setShowReason((v) => !v)}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                {t('helperProfile.messenger.quoteRequestChanges')}
              </button>
            </>
          )}
        </div>
      )}

      {showReason && (
        <div className="messenger-quote-card__reason">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={t('helperProfile.messenger.quoteChangesPlaceholder')}
            aria-label={t('helperProfile.messenger.quoteChangesPlaceholder')}
          />
          <button
            type="button"
            className="messenger-quote-card__btn messenger-quote-card__btn--secondary"
            disabled={busy}
            onClick={() => respond('request_changes')}
          >
            {t('helperProfile.messenger.quoteSendChanges')}
          </button>
        </div>
      )}


      {!isProvider && (status === 'accepted' || status === 'sent') && !quote?.superseded_at && !expired && (
        <div className="messenger-quote-card__actions" style={{ marginTop: 8 }}>
          {isAuthenticated ? (
            <button
              type="button"
              className="messenger-quote-card__btn messenger-quote-card__btn--secondary"
              onClick={() => setShowCreditPay(true)}
            >
              <Wallet className="w-3.5 h-3.5" />
              {t('helperProfile.messenger.creditPayButton')}
            </button>
          ) : (
            <button
              type="button"
              className="messenger-quote-card__btn messenger-quote-card__btn--secondary"
              onClick={() => (onRequestSignIn || onRequestVerify)?.()}
            >
              {t('helperProfile.messenger.creditPaySignInCta')}
            </button>
          )}
        </div>
      )}

      <PayWithCreditModal
        open={showCreditPay}
        onClose={() => setShowCreditPay(false)}
        conversationId={conversationId}
        amountCents={total}
        currency={quote?.currency || 'USD'}
        quoteKind={kind}
        quoteId={quoteId}
        payeeBusinessId={payeeBusinessId}
        payeeHelperId={payeeHelperId}
        isAuthenticated={isAuthenticated}
        onRequestSignIn={onRequestSignIn || onRequestVerify}
        onPaid={(data) => onCreditPaid?.(data)}
      />

      {status === 'accepted' && !isProvider && (
        <button
          type="button"
          className="messenger-quote-card__btn messenger-quote-card__btn--primary messenger-quote-card__schedule"
          onClick={() => onAccepted?.({ quote, openAvailability: true, alreadyAccepted: true })}
        >
          <Calendar className="w-3.5 h-3.5" />
          {t('helperProfile.messenger.quoteSchedule')}
        </button>
      )}
    </div>
  );
}

function formatQuoteDate(value, locale) {
  try {
    const d = new Date(String(value).slice(0, 10) + 'T12:00:00');
    return d.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return String(value || '').slice(0, 10);
  }
}
