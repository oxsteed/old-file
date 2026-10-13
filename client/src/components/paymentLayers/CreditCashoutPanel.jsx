import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatMoney, toMinor } from '../../shared/money.js';
import usePaymentLayersConfig from '../../hooks/usePaymentLayersConfig';

function newKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

/** Helper Credit cash-out (#14): ID check, 7-day hold, caps, licensed partner. */
export default function CreditCashoutPanel() {
  const { t, i18n } = useTranslation();
  const flags = usePaymentLayersConfig();
  const [eligibility, setEligibility] = useState(null);
  const [cashouts, setCashouts] = useState([]);
  const [value, setValue] = useState('');
  const [destination, setDestination] = useState('');
  const [busy, setBusy] = useState(false);
  const enabled = Boolean(flags.CREDIT_CASHOUT);

  const load = useCallback(() => {
    if (!enabled) return;
    api.get('/payment-layers/cashout/eligibility').then(({ data }) => setEligibility(data)).catch(() => setEligibility(null));
    api.get('/payment-layers/cashout').then(({ data }) => setCashouts(data.cashouts || [])).catch(() => {});
  }, [enabled]);
  useEffect(() => { load(); }, [load]);
  if (!enabled || !eligibility) return null;

  const currency = eligibility.currency || 'USD';
  const fmt = (m) => formatMoney(Number(m), currency, i18n.language);
  const minor = toMinor(value, currency);
  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/payment-layers/cashout', { amount_minor: minor, destination_ref: destination }, { headers: { 'Idempotency-Key': newKey() } });
      toast.success(t('paymentRail.cashout.requested'));
      setValue(''); load();
    } catch (err) {
      toast.error(t(`paymentRail.reasons.${err.response?.data?.code}`, { defaultValue: t('paymentRail.genericError') }));
    } finally { setBusy(false); }
  };

  return (
    <section className="border rounded-lg p-4 mt-4 text-sm" aria-labelledby="cashout-h" dir={i18n.dir?.()}>
      <h2 id="cashout-h" className="text-lg font-semibold">{t('paymentRail.cashout.title')}</h2>
      <p>{t('paymentRail.cashout.rules', { days: eligibility.hold_days })}</p>
      {!eligibility.available && eligibility.reason && <p role="status">{t(`paymentRail.reasons.${eligibility.reason}`)}</p>}
      {eligibility.currency && <p>{t('paymentRail.cashout.available', { amount: fmt(eligibility.available_minor) })}</p>}
      {eligibility.available && (
        <div className="flex flex-col gap-2 mt-2">
          <label><span className="block">{t('paymentRail.cashout.amount', { currency })}</span>
            <input inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} className="border rounded p-1" /></label>
          <label><span className="block">{t('paymentRail.cashout.destination')}</span>
            <input dir="ltr" value={destination} onChange={(e) => setDestination(e.target.value)} className="border rounded p-1" /></label>
          <button type="button" className="px-3 py-2 border rounded self-start" disabled={busy || !minor || minor <= 0 || !destination.trim()} onClick={submit}>
            {t('paymentRail.cashout.submit')}</button>
        </div>
      )}
      {cashouts.length > 0 && (
        <ul className="mt-2">
          {cashouts.map((c) => <li key={c.id}>{formatMoney(c.amount_minor, c.currency, i18n.language)} · {t(`paymentRail.cashout.status.${c.status}`, { defaultValue: c.status })}</li>)}
        </ul>
      )}
    </section>
  );
}
