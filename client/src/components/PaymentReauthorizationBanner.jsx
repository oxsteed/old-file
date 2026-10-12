import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { loadStripe } from '@stripe/stripe-js';
import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import api from '../api/axios';
import { bannerModel, formatCents, jobNeedsPaymentCheck, reauthErrorKey } from '../utils/paymentReauthModel';
import './PaymentReauthorizationBanner.css';

function newKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

function CardConfirmForm({ intent, amountLabel, onDone, onCancel }) {
  const { t } = useTranslation();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setCardError('');
    try {
      // confirmCardPayment runs any SCA / 3-D Secure step in the browser.
      const { error } = await stripe.confirmCardPayment(intent.client_secret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      // Server truth either way: a decline is recorded, a success is applied.
      const { data } = await api.post(`/jobs/${intent.jobId}/payment-reauthorization/${intent.attempt.id}/confirm`, {});
      if (data?.status === 'authorized') { onDone('authorized'); return; }
      if (error || data?.status === 'declined') { setCardError(error?.message || t('jobPaymentReauth.declined')); return; }
      onDone(data?.status === 'processing' ? 'processing' : 'refresh');
    } catch (err) {
      setCardError(t(`jobPaymentReauth.errors.${reauthErrorKey(err.response?.data?.code)}`));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} aria-label={t('jobPaymentReauth.cardFormLabel')}>
      <label className="prb-card-field">
        <span>{t('jobPaymentReauth.cardLabel')}</span>
        <div className="prb-card-element"><CardElement options={{ hidePostalCode: false, style: { base: { fontSize: '16px' } } }} /></div>
      </label>
      <p className="prb-muted">{t('jobPaymentReauth.cardHelp')}</p>
      {cardError && <p className="prb-error" role="alert">{cardError}</p>}
      <div className="prb-actions">
        <button type="submit" className="prb-btn prb-btn-primary" disabled={submitting || !stripe}>
          {submitting ? t('jobPaymentReauth.processing') : t('jobPaymentReauth.confirmCard', { amount: amountLabel })}
        </button>
        <button type="button" className="prb-btn" onClick={onCancel} disabled={submitting}>{t('jobPaymentReauth.cancel')}</button>
      </div>
    </form>
  );
}

/**
 * Shown on the job and work-agreement pages while an approved change order
 * waits for the customer to authorize the higher price.
 *
 * @param {{ jobId: string, job?: object, alwaysCheck?: boolean, onResolved?: () => void }} props
 */
export default function PaymentReauthorizationBanner({ jobId, job = null, alwaysCheck = false, onResolved }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [intent, setIntent] = useState(null);
  const [notice, setNotice] = useState('');
  const headingId = useRef(`prb-${newKey()}`).current;
  const shouldCheck = alwaysCheck || jobNeedsPaymentCheck(job);

  const load = useCallback(async () => {
    if (!jobId || !shouldCheck) { setState(null); return; }
    try {
      const { data } = await api.get(`/jobs/${jobId}/payment-reauthorization`);
      setState(data);
    } catch {
      setState(null);
    }
  }, [jobId, shouldCheck]);

  useEffect(() => { load(); }, [load]);

  const model = useMemo(() => bannerModel(state), [state]);
  const stripePromise = useMemo(() => {
    if (!intent) return null;
    const key = intent.publishable_key || import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY;
    // Direct charge on the helper's connected account, same as the first payment.
    return key ? loadStripe(key, { stripeAccount: intent.stripe_account_id }) : null;
  }, [intent]);

  if (!model) return null;
  const money = (c) => formatCents(c, i18n.language);

  const finish = (outcome) => {
    setIntent(null);
    if (outcome === 'authorized') toast.success(t('jobPaymentReauth.authorized'));
    if (outcome === 'repriced') toast.success(t('jobPaymentReauth.repriced'));
    setNotice(outcome === 'processing' ? t('jobPaymentReauth.checking') : '');
    load();
    if (outcome === 'authorized' || outcome === 'repriced') onResolved?.();
  };

  const start = async (method) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/jobs/${jobId}/payment-reauthorization`, { method }, { headers: { 'Idempotency-Key': newKey() } });
      if (data?.status === 'requires_confirmation') {
        if (!data.publishable_key && !import.meta.env?.VITE_STRIPE_PUBLISHABLE_KEY) { setError(t('jobPaymentReauth.errors.stripeMissing')); return; }
        setIntent({ ...data, jobId });
      } else {
        finish(data?.status === 'repriced' ? 'repriced' : 'authorized');
      }
    } catch (err) {
      setError(t(`jobPaymentReauth.errors.${reauthErrorKey(err.response?.data?.code)}`));
      if (err.response?.data?.code === 'payment_reauthorization_not_required') { load(); onResolved?.(); }
    } finally {
      setBusy(false);
    }
  };

  const amount = money(model.targetCents ?? model.creditCents);
  return (
    <section className="prb-card" role="region" aria-labelledby={headingId} data-testid="payment-reauth-banner">
      <h2 id={headingId}>{t(model.mode === 'waiting' ? 'jobPaymentReauth.waitingTitle' : 'jobPaymentReauth.title')}</h2>
      {model.mode === 'waiting' && <p>{t('jobPaymentReauth.helperBody')}</p>}
      {model.mode === 'card' && <p>{t('jobPaymentReauth.customerBody', { target: money(model.targetCents), authorized: money(model.authorizedCents) })}</p>}
      {model.mode === 'reprice' && <p>{t('jobPaymentReauth.repriceBody', { target: money(model.targetCents) })}</p>}
      {model.mode === 'credit' && <p>{t('jobPaymentReauth.creditBody', { amount })}</p>}
      {model.notice && !intent && <p className="prb-error" role="alert">{t(`jobPaymentReauth.${model.notice}`)}</p>}
      {model.expiresAt && <p className="prb-muted">{t('jobPaymentReauth.expiresAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(model.expiresAt)) })}</p>}
      {notice && <p role="status">{notice}</p>}
      {error && <p className="prb-error" role="alert">{error}</p>}
      {intent && stripePromise && (
        <Elements stripe={stripePromise} options={{ locale: i18n.language === 'ht' ? 'fr' : i18n.language }}>
          <CardConfirmForm intent={intent} amountLabel={money(intent.attempt?.amount_cents)} onDone={finish} onCancel={() => setIntent(null)} />
        </Elements>
      )}
      {!intent && model.mode !== 'waiting' && (
        <div className="prb-actions">
          {model.mode === 'card' && <button type="button" className="prb-btn prb-btn-primary" onClick={() => start('card')} disabled={busy}>
            {busy ? t('jobPaymentReauth.processing') : t('jobPaymentReauth.authorizeCard', { amount })}</button>}
          {model.mode === 'reprice' && <button type="button" className="prb-btn prb-btn-primary" onClick={() => start('card')} disabled={busy}>
            {busy ? t('jobPaymentReauth.processing') : t('jobPaymentReauth.updateAmount', { amount })}</button>}
          {model.mode === 'credit' && <>
            <button type="button" className="prb-btn prb-btn-primary" onClick={() => start('credit')} disabled={busy}>
              {busy ? t('jobPaymentReauth.processing') : t('jobPaymentReauth.holdCredit', { amount })}</button>
            <Link className="prb-btn" to="/wallet">{t('jobPaymentReauth.addCredit')}</Link>
          </>}
        </div>
      )}
    </section>
  );
}
