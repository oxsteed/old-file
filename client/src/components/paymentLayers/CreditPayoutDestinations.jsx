import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { toMinor } from '../../shared/money.js';
import { formatDay, reasonMessage } from './creditLicenceClient';

const EMPTY_FORM = { country_code: '', currency_code: '', holder_name: '', bank_name: '', bank_code: '', account_number: '', verification_method: 'micro_deposit' };

/**
 * Bank accounts a helper can cash out to (licence readiness §5): add one in
 * their own name, verify it (two micro-deposits or a one-time code sent in a
 * bank transfer reference), see the cooling-off date, and remove it.
 */
export default function CreditPayoutDestinations({ destinations, coolingOffDays, defaultCountry, defaultCurrency, onChange }) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState(null);
  const [verifying, setVerifying] = useState(null);
  const [busy, setBusy] = useState(false);

  const openForm = () => setForm({ ...EMPTY_FORM, country_code: defaultCountry || '', currency_code: defaultCurrency || '' });
  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const add = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.post('/payment-layers/payout-destinations', {
        ...form,
        country_code: form.country_code.trim().toUpperCase(),
        currency_code: form.currency_code.trim().toUpperCase(),
      });
      toast.success(t('paymentRail.destinations.added'));
      setForm(null);
      onChange?.();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  const verify = async (event) => {
    event.preventDefault();
    const destination = verifying.destination;
    const body = destination.verification_method === 'micro_deposit'
      ? { amounts_minor: [toMinor(verifying.first, destination.currency_code), toMinor(verifying.second, destination.currency_code)] }
      : { code: verifying.code.trim() };
    setBusy(true);
    try {
      await api.post(`/payment-layers/payout-destinations/${encodeURIComponent(destination.id)}/verify`, body);
      toast.success(t('paymentRail.destinations.verified'));
      setVerifying(null);
      onChange?.();
    } catch (err) {
      toast.error(reasonMessage(t, err));
      onChange?.();
    } finally { setBusy(false); }
  };

  const remove = async (destination) => {
    if (!window.confirm(t('paymentRail.destinations.removeConfirm', { last4: destination.account_last4 }))) return;
    setBusy(true);
    try {
      await api.delete(`/payment-layers/payout-destinations/${encodeURIComponent(destination.id)}`);
      toast.success(t('paymentRail.destinations.removed'));
      onChange?.();
    } catch (err) {
      toast.error(reasonMessage(t, err));
    } finally { setBusy(false); }
  };

  return (
    <div className="ox-licence-block" aria-labelledby="payout-destinations-h">
      <h3 id="payout-destinations-h">{t('paymentRail.destinations.title')}</h3>
      <p className="ox-licence-copy">{t('paymentRail.destinations.intro', { days: coolingOffDays })}</p>
      {destinations.length === 0 && <p className="ox-licence-copy" role="status">{t('paymentRail.destinations.none')}</p>}
      <ul className="ox-licence-list">
        {destinations.map((d) => (
          <li key={d.id}>
            <div>
              <strong>{d.bank_name} ···· <bdi dir="ltr">{d.account_last4}</bdi></strong>
              <span>{d.holder_name} · {d.country_code} · {d.currency_code}</span>
              <span className={`ox-licence-status ox-licence-status-${d.status}`}>{t(`paymentRail.destinations.status.${d.status}`, { defaultValue: d.status })}</span>
              {d.status === 'verified' && !d.first_payout_at && d.cooling_off_until && new Date(d.cooling_off_until) > new Date() && (
                <small>{t('paymentRail.destinations.coolingOff', { date: formatDay(d.cooling_off_until, i18n.language) })}</small>
              )}
              {d.status === 'pending_verification' && <small>{t('paymentRail.destinations.attemptsLeft', { count: d.attempts_left })}</small>}
            </div>
            <div className="ox-licence-actions">
              {d.status === 'pending_verification' && (
                <button type="button" disabled={busy} onClick={() => setVerifying({ destination: d, first: '', second: '', code: '' })}>{t('paymentRail.destinations.verify')}</button>
              )}
              <button type="button" disabled={busy} onClick={() => remove(d)}>{t('paymentRail.destinations.remove')}</button>
            </div>
          </li>
        ))}
      </ul>

      {verifying && (
        <form className="ox-licence-form" onSubmit={verify} aria-labelledby="verify-destination-h">
          <h4 id="verify-destination-h">{t('paymentRail.destinations.verifyTitle', { last4: verifying.destination.account_last4 })}</h4>
          {verifying.destination.verification_method === 'micro_deposit' ? (
            <>
              <p className="ox-licence-copy">{t('paymentRail.destinations.verifyMicroHelp')}</p>
              <label><span>{t('paymentRail.destinations.amount1', { currency: verifying.destination.currency_code })}</span>
                <input required inputMode="decimal" dir="ltr" value={verifying.first} onChange={(e) => setVerifying((v) => ({ ...v, first: e.target.value }))} /></label>
              <label><span>{t('paymentRail.destinations.amount2', { currency: verifying.destination.currency_code })}</span>
                <input required inputMode="decimal" dir="ltr" value={verifying.second} onChange={(e) => setVerifying((v) => ({ ...v, second: e.target.value }))} /></label>
            </>
          ) : (
            <>
              <p className="ox-licence-copy">{t('paymentRail.destinations.verifyCodeHelp')}</p>
              <label><span>{t('paymentRail.destinations.code')}</span>
                <input required dir="ltr" autoComplete="one-time-code" maxLength={12} value={verifying.code} onChange={(e) => setVerifying((v) => ({ ...v, code: e.target.value }))} /></label>
            </>
          )}
          <div className="ox-licence-actions">
            <button type="submit" disabled={busy}>{t('paymentRail.destinations.verify')}</button>
            <button type="button" disabled={busy} onClick={() => setVerifying(null)}>{t('paymentRail.common.close')}</button>
          </div>
        </form>
      )}

      {form ? (
        <form className="ox-licence-form" onSubmit={add} aria-labelledby="add-destination-h">
          <h4 id="add-destination-h">{t('paymentRail.destinations.add')}</h4>
          <label><span>{t('paymentRail.destinations.holderName')}</span><input required maxLength={140} value={form.holder_name} onChange={update('holder_name')} autoComplete="name" /></label>
          <label><span>{t('paymentRail.destinations.bankName')}</span><input required maxLength={140} value={form.bank_name} onChange={update('bank_name')} /></label>
          <label><span>{t('paymentRail.destinations.bankCode')}</span><input maxLength={40} dir="ltr" value={form.bank_code} onChange={update('bank_code')} /></label>
          <label><span>{t('paymentRail.destinations.accountNumber')}</span><input required maxLength={40} dir="ltr" autoComplete="off" value={form.account_number} onChange={update('account_number')} /></label>
          <label><span>{t('paymentRail.destinations.country')}</span><input required maxLength={2} dir="ltr" value={form.country_code} onChange={update('country_code')} /></label>
          <label><span>{t('paymentRail.destinations.currency')}</span><input required maxLength={3} dir="ltr" value={form.currency_code} onChange={update('currency_code')} /></label>
          <fieldset>
            <legend>{t('paymentRail.destinations.method')}</legend>
            <label className="ox-licence-inline"><input type="radio" name="verification_method" value="micro_deposit" checked={form.verification_method === 'micro_deposit'} onChange={update('verification_method')} /> {t('paymentRail.destinations.methodMicro')}</label>
            <label className="ox-licence-inline"><input type="radio" name="verification_method" value="one_time_code" checked={form.verification_method === 'one_time_code'} onChange={update('verification_method')} /> {t('paymentRail.destinations.methodCode')}</label>
          </fieldset>
          <div className="ox-licence-actions">
            <button type="submit" disabled={busy}>{t('paymentRail.destinations.save')}</button>
            <button type="button" disabled={busy} onClick={() => setForm(null)}>{t('paymentRail.common.close')}</button>
          </div>
        </form>
      ) : (
        <button type="button" className="ox-licence-secondary" onClick={openForm}>{t('paymentRail.destinations.add')}</button>
      )}
    </div>
  );
}
