import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../api/axios';
import { formatMoney } from '../shared/money.js';

const RAIL_ORDER = ['stripe', 'credit', 'offline'];

/**
 * Rail choice at acceptance (payment layers). Reports
 * { ready, payload } to the parent; payload goes to POST /jobs/assign.
 */
export default function PaymentRailChooser({ bid, options, helperPolicies, onChange }) {
  const { t, i18n } = useTranslation();
  const rails = [...(options?.rails || [])].sort((a, b) => RAIL_ORDER.indexOf(a.rail) - RAIL_ORDER.indexOf(b.rail));
  const firstAvailable = rails.find((r) => r.available)?.rail || null;
  const [rail, setRail] = useState(firstAvailable);
  const [offlineAck, setOfflineAck] = useState(false);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const currency = options?.settlement_currency || 'USD';
  const amount = formatMoney(Number(options?.amount_minor ?? bid?.amount_cents), currency, i18n.language);
  const entry = rails.find((r) => r.rail === rail) || null;
  const quoteExpired = quote?.fx && new Date(quote.expires_at).getTime() <= Date.now();

  useEffect(() => {
    const creditPayment = rail === 'credit' && entry?.mode === 'payment';
    const ready = Boolean(entry?.available)
      && (rail !== 'offline' || offlineAck)
      && (!creditPayment || (quote && (!quote.fx || !quoteExpired)));
    onChange?.({
      ready,
      payload: {
        payment_rail: rail,
        payment_method: rail === 'offline' ? 'off_platform' : 'oxsteed',
        offline_ack: rail === 'offline' ? offlineAck : undefined,
        fx_quote_id: creditPayment && quote?.fx ? quote.quote_id : undefined,
        credit_quote_id: creditPayment && quote?.fx ? quote.credit_quote_id : undefined,
      },
    });
  }, [rail, offlineAck, quote, quoteExpired, entry, onChange]);

  const getQuote = async () => {
    setQuoting(true);
    setQuoteError('');
    try {
      const { data } = await api.post(`/payment-layers/jobs/${bid.job_id}/credit-quote`, { bid_id: bid.id });
      setQuote(data.quote);
    } catch (err) {
      setQuoteError(t(`paymentRail.reasons.${err.response?.data?.code}`, { defaultValue: t('paymentRail.quoteFailed') }));
    } finally {
      setQuoting(false);
    }
  };

  return (
    <fieldset className="space-y-3 mb-6" data-testid="payment-rail-chooser">
      <legend className="text-sm text-gray-700 dark:text-gray-300 mb-2">
        {t('paymentRail.amountLine', { amount, currency })}
      </legend>
      {rails.map((r) => {
        const id = `rail-${r.rail}`;
        const selected = rail === r.rail;
        return (
          <div key={r.rail} className={`border-2 rounded-lg p-4 ${selected ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20' : 'border-gray-300 dark:border-gray-600'} ${r.available ? '' : 'opacity-60'}`}>
            <label htmlFor={id} className="flex items-start gap-3 cursor-pointer">
              <input id={id} type="radio" name="payment-rail" value={r.rail} checked={selected} disabled={!r.available}
                onChange={() => { setRail(r.rail); setQuote(null); }} className="mt-1" />
              <span className="flex-1">
                <span className="block font-semibold">{t(`paymentRail.rails.${r.rail}.title`)}</span>
                <span className="block text-sm text-gray-600 dark:text-gray-400">
                  {r.rail === 'credit' && r.mode ? t(`paymentRail.rails.credit.${r.mode}`) : t(`paymentRail.rails.${r.rail}.body`)}
                </span>
                <span className="block text-xs mt-1">{t(`paymentRail.protection.${r.protection}`, { defaultValue: '' })}</span>
                {r.rail === 'stripe' && r.charge_model === 'platform_hold' && (
                  <span className="block text-xs mt-1">{t('paymentRail.chargedNowHeld')}</span>
                )}
                {r.rail === 'stripe' && Array.isArray(r.local_methods) && r.local_methods.length > 0 && (
                  <span className="block text-xs mt-1">{t('paymentRail.localMethods', { methods: r.local_methods.join(', ') })}</span>
                )}
                {!r.available && r.reason && (
                  <span className="block text-xs mt-1 text-red-700 dark:text-red-300">{t(`paymentRail.reasons.${r.reason}`, { defaultValue: t('paymentRail.unavailable') })}</span>
                )}
              </span>
            </label>

            {selected && r.rail === 'credit' && r.mode === 'payment' && (
              <div className="mt-3 text-sm" aria-live="polite">
                {!quote && (
                  <button type="button" className="px-3 py-2 border rounded" onClick={getQuote} disabled={quoting}>
                    {quoting ? t('paymentRail.quoting') : t('paymentRail.getEstimate')}
                  </button>
                )}
                {quote && !quote.fx && <p>{t('paymentRail.creditSameCurrency', { amount })}</p>}
                {quote?.fx && (
                  <div>
                    <p>{t('paymentRail.fxEstimate', {
                      amount: formatMoney(quote.total_source_minor, quote.source_currency, i18n.language),
                      target: amount,
                    })}</p>
                    <p className="text-xs">{t('paymentRail.fxFee', {
                      fee: formatMoney(quote.fee_minor, quote.source_currency, i18n.language),
                      percent: (quote.spread_bps / 100).toLocaleString(i18n.language, { maximumFractionDigits: 2 }),
                    })}</p>
                    <p className="text-xs">{t('paymentRail.fxRecordCurrency', { currency })}</p>
                    {quoteExpired && (
                      <button type="button" className="mt-2 px-3 py-2 border rounded" onClick={getQuote}>{t('paymentRail.refreshEstimate')}</button>
                    )}
                  </div>
                )}
                {quoteError && <p role="alert" className="text-red-700">{quoteError}</p>}
              </div>
            )}

            {selected && r.rail === 'offline' && (
              <div className="mt-3 text-sm">
                {helperPolicies?.custom_policy?.terms && <p className="mb-2">{helperPolicies.custom_policy.terms}</p>}
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={offlineAck} onChange={(e) => setOfflineAck(e.target.checked)} />
                  <span>{t('paymentRail.offlineAck')}</span>
                </label>
              </div>
            )}
          </div>
        );
      })}
      {!firstAvailable && <p role="alert" className="text-sm text-red-700">{t('paymentRail.noRails')}</p>}
    </fieldset>
  );
}
