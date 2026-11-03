import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { formatMoney } from '../../shared/money.js';
import usePaymentLayersConfig from '../../hooks/usePaymentLayersConfig';
import CreditPayoutDestinations from './CreditPayoutDestinations';
import { formatDay } from './creditLicenceClient';
import './CreditLicencePanels.css';

export const PAYOUT_DESTINATIONS_ANCHOR = 'credit-payout-destinations';

/**
 * Wind-down redemption payout accounts (licence readiness §10, gap fill 1).
 * While cash-out is on, CreditCashoutPanel already shows the accounts. When
 * cash-out is off and an orderly wind-down is active, a holder still needs
 * somewhere to receive their money back, so this section lets them add,
 * verify and remove their own bank accounts. The server applies the same
 * verification (micro-deposits or one-time code) and cooling-off rules.
 */
export default function CreditWindDownDestinations() {
  const { t, i18n } = useTranslation();
  const flags = usePaymentLayersConfig();
  const location = useLocation();
  const cashoutOn = Boolean(flags.CREDIT_CASHOUT);
  const [status, setStatus] = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [coolingOffDays, setCoolingOffDays] = useState(3);
  const scrolled = useRef(false);
  const lang = i18n.language;

  const load = useCallback(() => {
    if (cashoutOn) return;
    api.get('/payment-layers/credit/wind-down/mine').then(({ data }) => {
      setStatus(data);
      if (!data?.destinations_allowed) return;
      api.get('/payment-layers/payout-destinations').then(({ data: list }) => {
        setDestinations(list.destinations || []);
        if (Number.isFinite(Number(list.cooling_off_days))) setCoolingOffDays(Number(list.cooling_off_days));
      }).catch(() => {});
    }).catch(() => setStatus(null));
  }, [cashoutOn]);
  useEffect(() => { load(); }, [load]);

  const visible = !cashoutOn && Boolean(status?.destinations_allowed);
  useEffect(() => {
    if (!visible || scrolled.current || location.hash !== `#${PAYOUT_DESTINATIONS_ANCHOR}`) return;
    scrolled.current = true;
    document.getElementById(PAYOUT_DESTINATIONS_ANCHOR)?.scrollIntoView?.({ block: 'start' });
  }, [visible, location.hash]);
  if (!visible) return null;

  const holdings = status.holdings || [];
  const firstMissing = holdings.find((h) => h.destination === 'missing') || holdings[0] || null;
  return (
    <section id={PAYOUT_DESTINATIONS_ANCHOR} className="ox-credit-panel ox-licence-panel" aria-labelledby="wind-down-destinations-h" dir={i18n.dir?.()}>
      <div className="ox-credit-panel-heading"><div><h2 id="wind-down-destinations-h">{t('paymentRail.windDown.destinationsTitle')}</h2></div></div>
      <p className="ox-credit-panel-copy">{t('paymentRail.windDown.destinationsIntro', { date: formatDay(status.deadline, lang) })}</p>
      <div className="ox-licence-body">
        {holdings.length > 0 && (
          <ul className="ox-licence-list" aria-label={t('paymentRail.windDown.holdingsLabel')}>
            {holdings.map((h) => (
              <li key={`${h.account_type}-${h.currency}`}>
                <div>
                  <strong><bdi>{formatMoney(Number(h.snapshot_balance_minor), h.currency, lang)}</bdi></strong>
                  <span className={`ox-licence-status ox-licence-status-${h.destination}`}>
                    {h.destination === 'cooling_off'
                      ? t('paymentRail.windDown.destination.cooling_off', { date: formatDay(h.cooling_off_until, lang) })
                      : t(`paymentRail.windDown.destination.${h.destination}`)}
                  </span>
                  <small>{t(`paymentRail.windDown.holderStatus.${h.status}`, { defaultValue: t('paymentRail.windDown.holderStatus.pending') })}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
        <CreditPayoutDestinations
          destinations={destinations}
          coolingOffDays={coolingOffDays}
          defaultCountry=""
          defaultCurrency={firstMissing?.currency || ''}
          onChange={load}
        />
      </div>
    </section>
  );
}
