import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { formatMoney, toMinor } from '../../shared/money.js';
import usePaymentLayersConfig from '../../hooks/usePaymentLayersConfig';

const PROTECTION = { stripe: 3, credit: 2, offline: 1 };

function newKey() {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

function errorText(t, err) {
  const code = err?.response?.data?.code;
  return t(`paymentRail.reasons.${code}`, { defaultValue: t('paymentRail.genericError') });
}

/** Rail switch (#6): only before work starts, both parties must agree. */
function RailSwitchSection({ job, onChanged }) {
  const { t } = useTranslation();
  const [state, setState] = useState(null);
  const [target, setTarget] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/payment-layers/jobs/${job.id}/rail-switch`).then(({ data }) => setState(data)).catch(() => setState(null));
  }, [job.id]);
  useEffect(() => { load(); }, [load]);
  if (!state?.can_switch) return null;

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); load(); onChanged?.(); } catch (err) { toast.error(errorText(t, err)); } finally { setBusy(false); }
  };
  const pending = state.pending;
  const mine = Boolean(pending?.requested_by_me);
  const available = (state.options || []).filter((o) => o.available);

  return (
    <section aria-labelledby="rail-switch-h" className="mt-4">
      <h3 id="rail-switch-h" className="font-semibold">{t('paymentRail.switch.title')}</h3>
      <p className="text-sm">{t('paymentRail.switch.current', { rail: t(`paymentRail.rails.${state.rail}.title`) })}</p>
      {pending ? (
        <div className="text-sm mt-2" role="status">
          <p>{t('paymentRail.switch.pending', { from: t(`paymentRail.rails.${pending.from_rail}.title`), to: t(`paymentRail.rails.${pending.to_rail}.title`) })}</p>
          {!mine && (
            <div className="flex flex-col gap-2 mt-2">
              {pending.to_rail === 'offline' && (
                <label className="flex gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t('paymentRail.offlineAck')}</label>
              )}
              <div className="flex gap-2">
                <button type="button" className="px-3 py-2 bg-orange-500 text-white rounded" disabled={busy || (pending.to_rail === 'offline' && !ack)}
                  onClick={() => run(() => api.post(`/payment-layers/jobs/${job.id}/rail-switch/${pending.id}/respond`, { accept: true, offline_ack: ack }))}>
                  {t('paymentRail.switch.accept')}
                </button>
                <button type="button" className="px-3 py-2 border rounded" disabled={busy}
                  onClick={() => run(() => api.post(`/payment-layers/jobs/${job.id}/rail-switch/${pending.id}/respond`, { accept: false }))}>
                  {t('paymentRail.switch.decline')}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : available.length > 0 && (
        <div className="flex flex-col gap-2 mt-2 text-sm">
          <label>
            <span className="block">{t('paymentRail.switch.choose')}</span>
            <select value={target} onChange={(e) => { setTarget(e.target.value); setAck(false); }} className="border rounded p-1">
              <option value="">—</option>
              {available.map((o) => <option key={o.rail} value={o.rail}>{t(`paymentRail.rails.${o.rail}.title`)}</option>)}
            </select>
          </label>
          {target && (PROTECTION[target] || 0) < (PROTECTION[state.rail] || 0) && (
            <p className="text-xs">{t('paymentRail.switch.lessProtected')}</p>
          )}
          {target === 'offline' && (
            <label className="flex gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t('paymentRail.offlineAck')}</label>
          )}
          <button type="button" className="px-3 py-2 border rounded self-start" disabled={busy || !target || (target === 'offline' && !ack)}
            onClick={() => run(() => api.post(`/payment-layers/jobs/${job.id}/rail-switch`, { to_rail: target, offline_ack: ack }))}>
            {t('paymentRail.switch.request')}
          </button>
          <p className="text-xs">{t('paymentRail.switch.consentNote')}</p>
        </div>
      )}
    </section>
  );
}

/** Offline rail: each side confirms money changed hands (not covered). */
function OfflineConfirmSection({ job }) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.get(`/payment-layers/jobs/${job.id}/offline-payment`).then(({ data }) => setConfirmation(data.confirmation)).catch(() => {});
  }, [job.id]);
  useEffect(() => { load(); }, [load]);
  const confirm = async () => {
    setBusy(true);
    try { await api.post(`/payment-layers/jobs/${job.id}/offline-payment/confirm`, { acknowledge_not_covered: true }); toast.success(t('paymentRail.offline.confirmed')); load(); }
    catch (err) { toast.error(errorText(t, err)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="offline-h" className="mt-4 text-sm">
      <h3 id="offline-h" className="font-semibold">{t('paymentRail.offline.title')}</h3>
      <p>{t('paymentRail.offline.notCovered')}</p>
      <p>{t('paymentRail.offline.status', {
        customer: confirmation?.customer_confirmed_at ? t('paymentRail.offline.yes') : t('paymentRail.offline.no'),
        helper: confirmation?.helper_confirmed_at ? t('paymentRail.offline.yes') : t('paymentRail.offline.no'),
      })}</p>
      <label className="flex gap-2 mt-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />{t('paymentRail.offlineAck')}</label>
      <button type="button" className="mt-2 px-3 py-2 border rounded" disabled={busy || !ack} onClick={confirm}>{t('paymentRail.offline.confirm')}</button>
    </section>
  );
}

/** Tips (#9): the helper gets the tip minus only processing costs. */
function TipSection({ job, currency }) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState('');
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tips, setTips] = useState([]);
  const minor = toMinor(value, currency);
  const load = useCallback(() => {
    api.get(`/payment-layers/jobs/${job.id}/tips`).then(({ data }) => setTips(data.tips || [])).catch(() => {});
  }, [job.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!minor || minor <= 0) { setQuote(null); return undefined; }
    const timer = setTimeout(() => {
      api.post(`/payment-layers/jobs/${job.id}/tips/quote`, { amount_minor: minor }).then(({ data }) => setQuote(data)).catch(() => setQuote(null));
    }, 300);
    return () => clearTimeout(timer);
  }, [job.id, minor]);
  const send = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/payment-layers/jobs/${job.id}/tips`, { amount_minor: minor }, { headers: { 'Idempotency-Key': newKey() } });
      if (data?.client_secret) toast(t('paymentRail.tips.confirmCard'));
      else toast.success(t('paymentRail.tips.sent'));
      setValue(''); load();
    } catch (err) { toast.error(errorText(t, err)); } finally { setBusy(false); }
  };
  const fmt = (m) => formatMoney(Number(m), currency, i18n.language);
  return (
    <section aria-labelledby="tip-h" className="mt-4 text-sm">
      <h3 id="tip-h" className="font-semibold">{t('paymentRail.tips.title')}</h3>
      <label className="block">
        <span className="block">{t('paymentRail.tips.amount', { currency })}</span>
        <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="border rounded p-1" dir="ltr" />
      </label>
      {quote && quote.processing_cost_minor !== null && (
        <p className="text-xs mt-1">{t('paymentRail.tips.breakdown', { cost: fmt(quote.processing_cost_minor), helper: fmt(quote.helper_receives_minor) })}</p>
      )}
      <p className="text-xs">{t('paymentRail.tips.noPlatformFee')}</p>
      <button type="button" className="mt-2 px-3 py-2 border rounded" disabled={busy || !minor || minor <= 0 || quote?.tippable === false} onClick={send}>{t('paymentRail.tips.send')}</button>
      {tips.length > 0 && (
        <ul className="mt-2">
          {tips.map((tip) => <li key={tip.id}>{fmt(tip.amount_minor)} · {t(`paymentRail.tips.status.${tip.status}`, { defaultValue: tip.status })}</li>)}
        </ul>
      )}
    </section>
  );
}

/**
 * Job page panel for the payment layers. Renders nothing while the rail
 * engine is off.
 */
export default function JobPaymentLayersPanel({ job, isOwner, isAssignedHelper, onChanged }) {
  const { t, i18n } = useTranslation();
  const flags = usePaymentLayersConfig();
  if (!flags.PAYMENT_RAILS || !job || (!isOwner && !isAssignedHelper) || !job.assigned_helper_id) return null;
  const currency = job.settlement_currency || job.currency_code || 'USD';
  const rail = job.payment_rail;
  const status = String(job.status);
  return (
    <section className="border rounded-lg p-4 mt-4" aria-labelledby="payment-layers-h" dir={i18n.dir?.()}>
      <h2 id="payment-layers-h" className="text-lg font-semibold">{t('paymentRail.panelTitle')}</h2>
      {rail && <p className="text-sm">{t('paymentRail.switch.current', { rail: t(`paymentRail.rails.${rail}.title`) })}</p>}
      <RailSwitchSection job={job} onChanged={onChanged} />
      {rail === 'offline' && <OfflineConfirmSection job={job} />}
      {flags.TIPS && isOwner && rail !== 'offline' && ['in_progress', 'completed', 'closed'].includes(status) && <TipSection job={job} currency={currency} />}
    </section>
  );
}
