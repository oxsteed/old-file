import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatMoney, toMinor } from '../../shared/money.js';
import usePaymentLayersConfig from '../../hooks/usePaymentLayersConfig';
import CreditPayoutDestinations from './CreditPayoutDestinations';
import {
  CANCELABLE_CASHOUT_STATUSES, OPEN_DISPUTE_STATUSES, formatDay, newIdempotencyKey, reasonMessage,
} from './creditLicenceClient';
import './CreditLicencePanels.css';

/**
 * Helper Credit cash-out (licence readiness §5 and §7): identity and KYC
 * tier, the hold period and limits, verified bank destinations with a
 * cooling-off period, an emailed step-up code for large amounts, cancel
 * before the bank instruction leaves, and "not received" disputes with the
 * dates we must answer by.
 */
export default function CreditCashoutPanel() {
  const { t, i18n } = useTranslation();
  const flags = usePaymentLayersConfig();
  const enabled = Boolean(flags.CREDIT_CASHOUT);
  const [eligibility, setEligibility] = useState(null);
  const [cashouts, setCashouts] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [coolingOffDays, setCoolingOffDays] = useState(3);
  const [disputes, setDisputes] = useState([]);
  const [value, setValue] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [stepup, setStepup] = useState(null);
  const [stepupCode, setStepupCode] = useState('');
  const [reporting, setReporting] = useState(null);
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(null);
  const disputeKey = useRef(null);

  const load = useCallback(() => {
    if (!enabled) return;
    api.get('/payment-layers/cashout/eligibility').then(({ data }) => setEligibility(data)).catch(() => setEligibility(null));
    api.get('/payment-layers/cashout').then(({ data }) => setCashouts(data.cashouts || [])).catch(() => {});
    api.get('/payment-layers/payout-destinations').then(({ data }) => {
      setDestinations(data.destinations || []);
      if (Number.isFinite(Number(data.cooling_off_days))) setCoolingOffDays(Number(data.cooling_off_days));
    }).catch(() => {});
    api.get('/payment-layers/cashout/disputes').then(({ data }) => setDisputes(data.disputes || [])).catch(() => {});
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  if (!enabled || !eligibility) return null;

  const currency = eligibility.currency || 'USD';
  const lang = i18n.language;
  const fmt = (m, c = currency) => formatMoney(Number(m), c, lang);
  const minor = toMinor(value, currency);
  const usable = destinations.filter((d) => d.status === 'verified' && (!eligibility.currency || d.currency_code === eligibility.currency));
  const selected = usable.find((d) => d.id === destinationId) || null;
  const needsStepup = eligibility.stepup_from_minor !== null && eligibility.stepup_from_minor !== undefined
    && Number.isSafeInteger(minor) && minor >= Number(eligibility.stepup_from_minor);
  const openDisputeFor = (cashoutId) => disputes.find((d) => d.cashout_id === cashoutId && OPEN_DISPUTE_STATUSES.includes(d.status));

  const resetForm = () => {
    setValue(''); setStepup(null); setStepupCode(''); attemptKey.current = null;
  };

  const send = async (stepupFields = {}) => {
    if (!attemptKey.current) attemptKey.current = newIdempotencyKey();
    setBusy(true);
    try {
      await api.post('/payment-layers/cashout', { amount_minor: minor, destination_id: destinationId, ...stepupFields }, { headers: { 'Idempotency-Key': attemptKey.current } });
      toast.success(t('paymentRail.cashout.requested'));
      resetForm();
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
      if (err?.response?.status === 409 || err?.response?.status === 400) attemptKey.current = null;
    } finally { setBusy(false); }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!needsStepup) { await send(); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/payment-layers/cashout/stepup-challenges', { amount_minor: minor });
      setStepup({ id: data?.challenge?.id, expiresAt: data?.challenge?.expiresAt });
      setStepupCode('');
      toast.success(t('paymentRail.cashout.stepupSent'));
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  const confirmStepup = (event) => {
    event.preventDefault();
    send({ stepup_challenge_id: stepup.id, stepup_code: stepupCode.trim() });
  };

  const cancel = async (cashout) => {
    if (!window.confirm(t('paymentRail.cashout.cancelConfirm', { amount: fmt(cashout.amount_minor, cashout.currency) }))) return;
    setBusy(true);
    try {
      await api.post(`/payment-layers/cashout/${encodeURIComponent(cashout.id)}/cancel`);
      toast.success(t('paymentRail.cashout.cancelled'));
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  const report = async (event) => {
    event.preventDefault();
    if (!disputeKey.current) disputeKey.current = newIdempotencyKey();
    setBusy(true);
    try {
      await api.post(`/payment-layers/cashout/${encodeURIComponent(reporting.cashout.id)}/dispute`, { description: reporting.description }, { headers: { 'Idempotency-Key': disputeKey.current } });
      toast.success(t('paymentRail.cashout.notReceivedSent'));
      setReporting(null);
      disputeKey.current = null;
      load();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  return (
    <section className="ox-credit-panel ox-licence-panel" aria-labelledby="cashout-h" dir={i18n.dir?.()}>
      <div className="ox-credit-panel-heading"><div><h2 id="cashout-h">{t('paymentRail.cashout.title')}</h2></div></div>
      <p className="ox-credit-panel-copy">{t('paymentRail.cashout.rules', { days: eligibility.hold_days })}</p>
      {!eligibility.available && eligibility.reason && <p className="ox-credit-panel-copy" role="status">{t(`paymentRail.reasons.${eligibility.reason}`, { defaultValue: t('paymentRail.genericError') })}</p>}
      {eligibility.currency && <p className="ox-credit-panel-copy">{t('paymentRail.cashout.available', { amount: fmt(eligibility.available_minor) })}</p>}

      <div className="ox-licence-body">
        {eligibility.currency && (
          <div id="credit-payout-destinations">
          <CreditPayoutDestinations
            destinations={destinations}
            coolingOffDays={coolingOffDays}
            defaultCountry={eligibility.country}
            defaultCurrency={eligibility.currency}
            onChange={load}
          />
          </div>
        )}

        {eligibility.available && (
          <form className="ox-licence-form" onSubmit={submit} aria-labelledby="cashout-form-h">
            <h3 id="cashout-form-h">{t('paymentRail.cashout.submit')}</h3>
            {usable.length === 0 && <p className="ox-licence-copy" role="status">{t('paymentRail.cashout.noVerifiedDestination')}</p>}
            <label><span>{t('paymentRail.cashout.amount', { currency })}</span>
              <input inputMode="decimal" dir="ltr" value={value} disabled={Boolean(stepup)} onChange={(e) => { setValue(e.target.value); attemptKey.current = null; }} /></label>
            <label><span>{t('paymentRail.cashout.payTo')}</span>
              <select required value={destinationId} disabled={Boolean(stepup)} onChange={(e) => { setDestinationId(e.target.value); attemptKey.current = null; }}>
                <option value="">{t('paymentRail.cashout.chooseDestination')}</option>
                {usable.map((d) => <option key={d.id} value={d.id}>{d.bank_name} ···· {d.account_last4}</option>)}
              </select></label>
            {selected && !selected.first_payout_at && selected.cooling_off_until && new Date(selected.cooling_off_until) > new Date() && (
              <p className="ox-licence-copy" role="note">{t('paymentRail.cashout.availableOn', { date: formatDay(selected.cooling_off_until, lang) })}</p>
            )}
            {needsStepup && !stepup && <p className="ox-licence-copy" role="note">{t('paymentRail.cashout.stepupNeeded')}</p>}
            {!stepup && (
              <button type="submit" disabled={busy || !minor || minor <= 0 || !destinationId}>{t('paymentRail.cashout.submit')}</button>
            )}
          </form>
        )}

        {stepup && (
          <form className="ox-licence-form" onSubmit={confirmStepup} aria-labelledby="cashout-stepup-h">
            <h3 id="cashout-stepup-h">{t('paymentRail.cashout.stepupTitle')}</h3>
            <p className="ox-licence-copy">{t('paymentRail.cashout.stepupSent')}</p>
            <label><span>{t('paymentRail.cashout.stepupCode')}</span>
              <input required dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={stepupCode} onChange={(e) => setStepupCode(e.target.value.replace(/\D/g, ''))} /></label>
            <div className="ox-licence-actions">
              <button type="submit" disabled={busy || !stepupCode}>{t('paymentRail.cashout.confirm')}</button>
              <button type="button" disabled={busy} onClick={resetForm}>{t('paymentRail.common.close')}</button>
            </div>
          </form>
        )}

        {cashouts.length > 0 && (
          <div className="ox-licence-block" aria-labelledby="cashout-history-h">
            <h3 id="cashout-history-h">{t('paymentRail.cashout.history')}</h3>
            <ul className="ox-licence-list">
              {cashouts.map((c) => {
                const open = openDisputeFor(c.id);
                return (
                  <li key={c.id}>
                    <div>
                      <strong>{fmt(c.amount_minor, c.currency)}</strong>
                      <span className={`ox-licence-status ox-licence-status-${c.status}`}>{t(`paymentRail.cashout.status.${c.status}`, { defaultValue: c.status })}</span>
                      <small>{formatDay(c.created_at, lang)}</small>
                      {c.available_at && ['requested', 'held_for_review'].includes(c.status) && <small>{t('paymentRail.cashout.availableOn', { date: formatDay(c.available_at, lang) })}</small>}
                      {c.review_reason && <small>{t('paymentRail.cashout.underReview')}</small>}
                      {open && <small>{t('paymentRail.cashout.disputeDue', { date: formatDay(open.resolution_due_at, lang) })}</small>}
                    </div>
                    <div className="ox-licence-actions">
                      {CANCELABLE_CASHOUT_STATUSES.includes(c.status) && <button type="button" disabled={busy} onClick={() => cancel(c)}>{t('paymentRail.cashout.cancel')}</button>}
                      {c.status === 'paid' && !open && <button type="button" disabled={busy} onClick={() => { disputeKey.current = null; setReporting({ cashout: c, description: '' }); }}>{t('paymentRail.cashout.notReceived')}</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {reporting && (
          <form className="ox-licence-form" onSubmit={report} aria-labelledby="cashout-dispute-h">
            <h3 id="cashout-dispute-h">{t('paymentRail.cashout.notReceivedTitle', { amount: fmt(reporting.cashout.amount_minor, reporting.cashout.currency) })}</h3>
            <p className="ox-licence-copy">{t('paymentRail.cashout.notReceivedHelp')}</p>
            <label><span>{t('paymentRail.cashout.notReceivedDescription')}</span>
              <textarea required maxLength={4000} rows={4} value={reporting.description} onChange={(e) => setReporting((r) => ({ ...r, description: e.target.value }))} /></label>
            <div className="ox-licence-actions">
              <button type="submit" disabled={busy || !reporting.description.trim()}>{t('paymentRail.cashout.notReceivedSubmit')}</button>
              <button type="button" disabled={busy} onClick={() => setReporting(null)}>{t('paymentRail.common.close')}</button>
            </div>
          </form>
        )}

        {disputes.length > 0 && (
          <div className="ox-licence-block" aria-labelledby="cashout-disputes-h">
            <h3 id="cashout-disputes-h">{t('paymentRail.cashout.disputesTitle')}</h3>
            <ul className="ox-licence-list">
              {disputes.map((d) => (
                <li key={d.id}>
                  <div>
                    {d.amount_minor !== undefined && d.currency && <strong>{fmt(d.amount_minor, d.currency)}</strong>}
                    <span className={`ox-licence-status ox-licence-status-${d.status}`}>{t(`paymentRail.cashout.disputeStatus.${d.status}`, { defaultValue: d.status })}</span>
                    <small>{formatDay(d.notified_at, lang)}</small>
                    {OPEN_DISPUTE_STATUSES.includes(d.status) && <small>{t('paymentRail.cashout.disputeDue', { date: formatDay(d.resolution_due_at, lang) })}</small>}
                    {d.resolution && <p>{d.resolution}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
