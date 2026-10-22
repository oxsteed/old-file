import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  ArrowLeft,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../hooks/useAuth';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import './PayByQrPage.css';

const MIN_AMOUNT_CENTS = 600; // $6
const MAX_AMOUNT_CENTS = 10_000_000; // $100,000
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECEIPT_POLL_INTERVAL_MS = 2000;
const RECEIPT_POLL_ATTEMPTS = 8;

function formatMoney(cents, currency = 'USD', language = 'en') {
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency,
    }).format((cents || 0) / 100);
  } catch {
    return `$${((cents || 0) / 100).toFixed(2)}`;
  }
}

function PayForm({ info }) {
  const { t, i18n } = useTranslation();
  const isFixed = info.amount_cents != null;
  const [amountDollars, setAmountDollars] = useState('');
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [starting, setStarting] = useState(false);
  const [creditPaid, setCreditPaid] = useState(null);
  const checkoutRequestRef = useRef(null);

  const amountCents = isFixed ? info.amount_cents : (() => {
    const parsed = Number.parseFloat(amountDollars);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  })();

  // P1-302: payer-facing, localized messages for the known refusal codes.
  const checkoutErrorMessage = (err) => {
    const code = err?.response?.data?.code;
    if (code === 'recipient_unavailable') return t('qrPay.recipientUnavailable');
    if (code === 'qr_public_url_missing') return t('qrPay.temporarilyUnavailable');
    if (code === 'feature_disabled') return t('qrPay.creditUnavailable');
    const message = err?.response?.data?.error || err?.response?.data?.message;
    return message || t('qrPay.checkoutError', { defaultValue: 'Could not start checkout. Please try again.' });
  };

  const submitPayment = async (method) => {
    setFormError('');

    let cents = amountCents;
    if (!isFixed) {
      if (cents == null || cents < MIN_AMOUNT_CENTS || cents > MAX_AMOUNT_CENTS) {
        setFormError(t('qrPay.amountInvalid', { defaultValue: 'Enter an amount between $6 and $100,000.' }));
        return;
      }
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setFormError(t('qrPay.emailInvalid', { defaultValue: 'Enter a valid email address.' }));
      return;
    }

    setStarting(true);
    try {
      const payload = {};
      if (!isFixed && cents != null) payload.amount_cents = cents;
      if (trimmedEmail) payload.payer_email = trimmedEmail;
      if (method === 'credit') payload.payment_method = 'credit';
      const fingerprint = `${info.code}|${method}|${cents}|${trimmedEmail.toLowerCase()}`;
      if (checkoutRequestRef.current?.fingerprint !== fingerprint) {
        const requestId = typeof crypto?.randomUUID === 'function'
          ? crypto.randomUUID()
          : `qr-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
        checkoutRequestRef.current = { fingerprint, requestId };
      }
      const { data } = await api.post(`/qr-payments/pay/${info.code}/checkout`, payload, {
        headers: { 'Idempotency-Key': checkoutRequestRef.current.requestId },
      });
      if (method === 'credit') {
        // P1-303: Credit settles immediately; no Stripe redirect.
        if (data?.status !== 'paid') throw new Error('credit payment not settled');
        setCreditPaid({ amount_cents: cents });
        setStarting(false);
        return;
      }
      const url = data?.url;
      if (!url) throw new Error('missing checkout url');
      window.location.href = url;
    } catch (err) {
      setFormError(checkoutErrorMessage(err));
      setStarting(false);
    }
  };

  const handlePay = (event) => {
    event.preventDefault();
    submitPayment('card');
  };

  if (creditPaid) {
    return (
      <div className="pbq-state" role="status">
        <CheckCircle2 size={56} className="pbq-success-icon" aria-hidden="true" />
        <h2>{t('qrPay.successTitle', { defaultValue: 'Payment successful' })}</h2>
        <p>{t('qrPay.creditPaidBody', { amount: formatMoney(creditPaid.amount_cents, info.currency, i18n.language), name: info.recipient_name })}</p>
        <Link to="/" className="pbq-btn pbq-btn-secondary">{t('qrPay.backHome', { defaultValue: 'Back to home' })}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={handlePay} className="pbq-form" noValidate data-track="ui.f9b00354a4.1" data-track-private>
      <div className="pbq-recipient">
        <span className="pbq-avatar" aria-hidden="true">
          <BadgeDollarSign size={26} />
        </span>
        <div>
          <p className="pbq-recipient-label">{t('qrPay.payTo', { defaultValue: 'Pay' })}</p>
          <h2>{info.recipient_name}</h2>
          {info.label && <p className="pbq-for-label">{info.label}</p>}
        </div>
      </div>

      <div className="pbq-amount-display" aria-live="polite">
        {isFixed ? (
          <>
            <span className="pbq-amount-label">{t('qrPay.amountToPay', { defaultValue: 'Amount to pay' })}</span>
            <strong>{formatMoney(info.amount_cents, info.currency, i18n.language)}</strong>
          </>
        ) : (
          <div className="pbq-field">
            <label htmlFor="pbq-amount">{t('qrPay.amountInputLabel', { defaultValue: 'Amount (USD)' })}</label>
            <div className="pbq-amount-input">
              <span aria-hidden="true">$</span>
              <input
                id="pbq-amount"
                type="number"
                min="1"
                max="100000"
                step="0.01"
                inputMode="decimal"
                value={amountDollars}
                onChange={(e) => setAmountDollars(e.target.value)}
                placeholder={t('qrPay.enterAmount', { defaultValue: 'Enter amount' })}
                className="pbq-input"
              />
            </div>
          </div>
        )}
      </div>

      <div className="pbq-field">
        <label htmlFor="pbq-email">
          <Mail size={14} aria-hidden="true" />
          {t('qrPay.emailLabel', { defaultValue: 'Email for receipt (optional)' })}
        </label>
        <input
          id="pbq-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('qrPay.emailPlaceholder', { defaultValue: 'you@example.com' })}
          className="pbq-input"
        />
      </div>

      {formError && (
        <p className="pbq-error" role="alert">
          <AlertCircle size={15} aria-hidden="true" />
          {formError}
        </p>
      )}

      <button type="submit" className="pbq-btn pbq-btn-primary" disabled={starting} data-track="ui.f9b00354a4.2">
        <Lock size={16} aria-hidden="true" />
        {starting
          ? t('qrPay.paying', { defaultValue: 'Starting secure checkout...' })
          : amountCents
            ? t('qrPay.payButtonAmount', {
                amount: formatMoney(amountCents, info.currency, i18n.language),
                defaultValue: 'Pay {{amount}}',
              })
            : t('qrPay.payButton', { defaultValue: 'Pay' })}
      </button>

      {info.credit_enabled && (
        <button type="button" className="pbq-btn pbq-btn-secondary" disabled={starting} onClick={() => submitPayment('credit')} data-track="ui.f9b00354a4.3" data-track-private>
          {t('qrPay.payWithCredit')}
        </button>
      )}

      <p className="pbq-secure-note">
        <Lock size={13} aria-hidden="true" />
        {t('qrPay.secureNote', { defaultValue: 'Secure payment powered by Stripe. You do not need an account.' })}
      </p>
    </form>
  );
}

function SuccessView({ code }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('polling'); // polling | succeeded | pending | expired
  const [receipt, setReceipt] = useState(null);
  // P1-298: bumping the round restarts polling from the "still confirming"
  // state, so the page is no longer a dead end. The server reconciles a
  // pending row directly with Stripe on every receipt read.
  const [round, setRound] = useState(0);

  const sessionId = searchParams.get('session_id');

  const fetchReceipt = useCallback(async () => {
    if (!sessionId) return null;
    const { data } = await api.get(`/qr-payments/pay/${code}/receipt`, { params: { session_id: sessionId } });
    return data;
  }, [code, sessionId]);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer;

    const poll = async () => {
      attempts += 1;
      try {
        const data = await fetchReceipt();
        if (cancelled) return;
        setReceipt(data);
        if (data?.status === 'succeeded' || data?.status === 'expired') {
          setStatus(data.status);
          return;
        }
      } catch {
        // Keep polling on transient errors; the timeout below ends it.
      }
      if (!cancelled) {
        if (attempts >= RECEIPT_POLL_ATTEMPTS) {
          setStatus('pending');
        } else {
          timer = window.setTimeout(poll, RECEIPT_POLL_INTERVAL_MS);
        }
      }
    };

    if (!sessionId) {
      setStatus('pending');
      return undefined;
    }
    setStatus('polling');
    poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [fetchReceipt, sessionId, round]);

  const details = receipt ? (
    <dl className="pbq-receipt">
      <div><dt>{t('qrPay.receiptAmount')}</dt><dd>{formatMoney(receipt.amount_cents, receipt.currency, i18n.language)}</dd></div>
      {receipt.recipient_name && <div><dt>{t('qrPay.receiptTo')}</dt><dd>{receipt.recipient_name}</dd></div>}
      {receipt.label && <div><dt>{t('qrPay.receiptFor')}</dt><dd>{receipt.label}</dd></div>}
      {receipt.created_at && <div><dt>{t('qrPay.receiptDate')}</dt><dd>{new Date(receipt.created_at).toLocaleString(i18n.language)}</dd></div>}
    </dl>
  ) : null;

  if (status === 'polling') {
    return (
      <div className="pbq-state" role="status">
        <Loader2 className="pbq-spin" size={32} aria-hidden="true" />
        <h2>{t('qrPay.successPending', { defaultValue: 'Confirming your payment...' })}</h2>
      </div>
    );
  }

  if (status === 'succeeded' && receipt) {
    return (
      <div className="pbq-state">
        <CheckCircle2 size={56} className="pbq-success-icon" aria-hidden="true" />
        <h2>{t('qrPay.successTitle', { defaultValue: 'Payment successful' })}</h2>
        <p>
          {t('qrPay.successBody', {
            amount: formatMoney(receipt.amount_cents, receipt.currency, i18n.language),
            defaultValue: 'Your payment of {{amount}} was received. Thank you!',
          })}
        </p>
        {details}
        <div className="pbq-success-actions">
          {user && (
            <Link to="/my-bookings" className="pbq-btn pbq-btn-primary">
              {t('qrPay.viewMyBookings', { defaultValue: 'View my bookings' })}
            </Link>
          )}
          <Link to="/" className="pbq-btn pbq-btn-secondary">
            {t('qrPay.backHome', { defaultValue: 'Back to home' })}
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="pbq-state">
        <AlertCircle size={48} aria-hidden="true" />
        <h2>{t('qrPay.expiredTitle')}</h2>
        <p>{t('qrPay.expiredBody')}</p>
        <Link to={`/pay/${code}`} className="pbq-btn pbq-btn-primary">{t('qrPay.tryAgain')}</Link>
      </div>
    );
  }

  return (
    <div className="pbq-state">
      <Clock3 size={48} aria-hidden="true" />
      <h2>{t('qrPay.successPending', { defaultValue: 'Confirming your payment...' })}</h2>
      <p>{t('qrPay.stillConfirmingBody')}</p>
      {details}
      <div className="pbq-success-actions">
        {sessionId && (
          <button type="button" className="pbq-btn pbq-btn-primary" onClick={() => setRound((n) => n + 1)} data-track="ui.f9b00354a4.4">
            {t('qrPay.checkAgain')}
          </button>
        )}
        <Link to="/" className="pbq-btn pbq-btn-secondary">
          {t('qrPay.backHome', { defaultValue: 'Back to home' })}
        </Link>
      </div>
    </div>
  );
}

export default function PayByQrPage() {
  const { t } = useTranslation();
  const { code } = useParams();
  const location = useLocation();
  const isSuccess = location.pathname.endsWith('/success');

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setInfo(null);
    api.get(`/qr-payments/pay/${code}`)
      .then(({ data }) => {
        if (cancelled) return;
        if (!data?.ready) {
          setNotFound(true);
        } else {
          setInfo({ ...data, code });
        }
      })
      .catch((err) => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [code]);

  const renderBody = () => {
    if (loading) {
      return (
        <div className="pbq-state" role="status">
          <Loader2 className="pbq-spin" size={32} aria-hidden="true" />
          <p>{t('qrPay.loading', { defaultValue: 'Loading...' })}</p>
        </div>
      );
    }
    if (notFound || !info) {
      return (
        <div className="pbq-state">
          <AlertCircle size={48} aria-hidden="true" />
          <h2>{t('qrPay.notFoundTitle', { defaultValue: 'Payment link unavailable' })}</h2>
          <p>{t('qrPay.notFoundBody', { defaultValue: 'This payment link is invalid or no longer active.' })}</p>
          <Link to="/" className="pbq-btn pbq-btn-secondary">
            {t('qrPay.backHome', { defaultValue: 'Back to home' })}
          </Link>
        </div>
      );
    }
    if (isSuccess) return <SuccessView code={code} />;
    return <PayForm info={info} />;
  };

  return (
    <PageShell>
      <PageMeta title={t('qrPay.payPageTitle', { defaultValue: 'Pay with QR' })} />
      <div className="pbq-page">
        <Link to="/" className="pbq-back">
          <ArrowLeft size={15} aria-hidden="true" />
          OxSteed
        </Link>
        <div className="pbq-card">
          {renderBody()}
        </div>
      </div>
    </PageShell>
  );
}
