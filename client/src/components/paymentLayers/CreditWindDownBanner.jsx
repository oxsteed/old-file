import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { formatDay } from './creditLicenceClient';
import { PAYOUT_DESTINATIONS_ANCHOR } from './CreditWindDownDestinations';
import './CreditLicencePanels.css';

/**
 * Shown to every Credit holder while an orderly wind-down is active
 * (licence readiness §10): the redemption deadline and what happens to
 * money that is not cashed out by then. Signed-in holders also get a link
 * to their payout accounts (gap fill 1), which stay available even when
 * cash-out is off.
 */
export default function CreditWindDownBanner() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState(null);
  const [mine, setMine] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/payment-layers/credit/wind-down').then(({ data }) => {
      if (!alive) return;
      setStatus(data);
      if (!data?.active) return;
      api.get('/payment-layers/credit/wind-down/mine').then(({ data: own }) => { if (alive) setMine(own); }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!status?.active) return null;
  return (
    <section className="ox-licence-banner" role="alert" aria-labelledby="credit-wind-down-h" dir={i18n.dir?.()}>
      <h2 id="credit-wind-down-h">{t('paymentRail.windDown.title')}</h2>
      <p>{t('paymentRail.windDown.body', { date: formatDay(status.deadline, i18n.language) })}</p>
      <p>{t('paymentRail.windDown.after')}</p>
      {mine?.destinations_allowed && (
        <p>
          <Link className="ox-licence-link" to={`/wallet#${PAYOUT_DESTINATIONS_ANCHOR}`}>
            {mine.needs_destination ? t('paymentRail.windDown.addDestination') : t('paymentRail.windDown.manageDestinations')}
          </Link>
        </p>
      )}
    </section>
  );
}
