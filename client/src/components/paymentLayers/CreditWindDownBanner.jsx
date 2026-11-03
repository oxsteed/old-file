import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { formatDay } from './creditLicenceClient';
import './CreditLicencePanels.css';

/**
 * Shown to every Credit holder while an orderly wind-down is active
 * (licence readiness §10): the redemption deadline and what happens to
 * money that is not cashed out by then.
 */
export default function CreditWindDownBanner() {
  const { t, i18n } = useTranslation();
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/payment-layers/credit/wind-down').then(({ data }) => { if (alive) setStatus(data); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!status?.active) return null;
  return (
    <section className="ox-licence-banner" role="alert" aria-labelledby="credit-wind-down-h" dir={i18n.dir?.()}>
      <h2 id="credit-wind-down-h">{t('paymentRail.windDown.title')}</h2>
      <p>{t('paymentRail.windDown.body', { date: formatDay(status.deadline, i18n.language) })}</p>
      <p>{t('paymentRail.windDown.after')}</p>
    </section>
  );
}
