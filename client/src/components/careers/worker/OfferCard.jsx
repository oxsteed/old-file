import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { decideCareerOffer } from '../../../api/careers';
import { formatCountdown, formatDate, formatOfferPay, formatWhen } from '../../../features/careers/careersModel';
import { ActionButton, ErrorNotice, Notice } from '../ui';

export default function OfferCard({ offer, timezone, onDecided }) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null);
  const decide = async (decision) => {
    setError(null);
    try {
      const r = await decideCareerOffer(offer.id, decision);
      setPending(r.pending_conditions || []);
      onDecided?.(r);
    } catch (err) {
      setError(err);
    }
  };
  return (
    <div className="ox-careers-app">
      <div className="ox-careers-row">
        <strong>{t('careers.offer.title', { title: offer.title })}</strong>
        <span className="ox-careers-chip">{t(`careers.offer.status.${offer.status}`)}</span>
      </div>
      <p>{t('careers.offer.pay', { pay: formatOfferPay(offer, i18n.language), period: t(`careers.period.${offer.pay_period}`) })}</p>
      {offer.start_date ? <p>{t('careers.offer.start', { date: formatDate(offer.start_date, i18n.language) })}</p> : null}
      {offer.employer_model === 'oxsteed_eor' ? <p>{t('careers.offer.eor')}</p> : null}
      {offer.is_conditional && offer.conditions?.length ? (
        <p>{t('careers.offer.conditions', { list: offer.conditions.map((c) => t(`careers.offer.condition.${c}`)).join(', ') })}</p>
      ) : null}
      {offer.status === 'pending' && offer.expires_at ? <p className="ox-careers-subtle">{t('careers.offer.expires', { when: formatWhen(offer.expires_at, timezone, i18n.language) })}{formatCountdown(offer.expires_at, i18n.language) ? ` (${formatCountdown(offer.expires_at, i18n.language)})` : ''}</p> : null}
      {pending?.length ? <Notice>{t('careers.offer.pendingConditions', { list: pending.map((c) => t(`careers.offer.condition.${c}`)).join(', ') })}</Notice> : null}
      <ErrorNotice error={error} />
      {offer.status === 'pending' ? (
        <div className="ox-careers-actions">
          <ActionButton primary onClick={() => decide('accept')}>{t('careers.offer.accept')}</ActionButton>
          <ActionButton danger confirm={t('careers.offer.declineConfirm')} onClick={() => decide('decline')}>{t('careers.offer.decline')}</ActionButton>
        </div>
      ) : null}
    </div>
  );
}
