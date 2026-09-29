import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, Mail, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import { deliveryDate, getPublicDeliveryTracking } from '../api/delivery';
import '../styles/DeliveryPage.css';

// Public delivery tracking: reachable at /t/:token with NO login required.
// Renders only the customer-safe projection the server allowlists
// (reference, status, milestones, ETA, approximate area, masked addresses,
// support contact). Never displays coordinates.
export default function PublicTrackingPage() {
  const { t, i18n } = useTranslation();
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const date = (value) => deliveryDate(value, i18n.language);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setFailure('');
    getPublicDeliveryTracking(token)
      .then((response) => { if (!cancelled) setData(response); })
      .catch((error) => {
        if (cancelled) return;
        const status = error?.response?.status;
        if (status === 404) setFailure('notFound');
        else if (status === 410) setFailure('expired');
        else setFailure('notFound');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const milestoneLabel = (milestone) =>
    t(`delivery.tracking.milestones.${milestone.key}`, { defaultValue: milestone.label || milestone.key });

  const renderBody = () => {
    if (loading) return <p role="status">{t('delivery.tracking.public.loading')}</p>;
    if (failure === 'expired') {
      return (
        <div className="delivery-panel">
          <h2>{t('delivery.tracking.public.expired')}</h2>
          <p>{t('delivery.tracking.public.expiredHint')}</p>
          <Link className="delivery-button delivery-button--secondary" to="/">{t('delivery.tracking.public.backHome')}</Link>
        </div>
      );
    }
    if (failure || !data) {
      return (
        <div className="delivery-panel">
          <h2>{t('delivery.tracking.public.notFound')}</h2>
          <Link className="delivery-button delivery-button--secondary" to="/">{t('delivery.tracking.public.backHome')}</Link>
        </div>
      );
    }

    const eta = data.eta || {};
    const milestones = data.milestones || [];
    const support = data.supportContact || {};
    return (
      <div className="delivery-detail-grid">
        <section className="delivery-panel">
          <div className="delivery-panel__heading">
            <div>
              <h2>{t('delivery.tracking.public.title')}</h2>
              <p>{t('delivery.tracking.public.subtitle')}</p>
            </div>
          </div>
          <dl className="delivery-breakdown">
            <div>
              <dt>{t('delivery.tracking.public.reference')}</dt>
              <dd>{data.reference}</dd>
            </div>
            <div>
              <dt>{t('delivery.tracking.public.status')}</dt>
              <dd>{data.status}</dd>
            </div>
            <div>
              <dt>{t('delivery.tracking.public.eta')}</dt>
              <dd>{eta.at ? date(eta.at) : t('delivery.tracking.public.etaUnavailable')}</dd>
            </div>
            <div>
              <dt>{t('delivery.tracking.public.pickup')}</dt>
              <dd>{data.maskedPickup || '—'}</dd>
            </div>
            <div>
              <dt>{t('delivery.tracking.public.dropoff')}</dt>
              <dd>{data.maskedDropoff || '—'}</dd>
            </div>
          </dl>
          <p className="delivery-tracking__area">
            <MapPin size={16} aria-hidden="true" />
            <span>
              {data.approximateArea
                ? t('delivery.tracking.public.area')
                : t('delivery.tracking.public.areaUnavailable')}
            </span>
          </p>
          {eta.freshness === 'stale' && (
            <p className="delivery-alert delivery-alert--warning" role="status">
              {t('delivery.tracking.public.staleEta')}
            </p>
          )}
        </section>

        <section className="delivery-panel">
          <h2>{t('delivery.tracking.public.title')}</h2>
          <ol className="delivery-timeline">
            {milestones.map((milestone) => (
              <li key={milestone.key}>
                <span
                  className={`delivery-timeline__dot${milestone.reached ? ' delivery-timeline__dot--done' : ''}`}
                  aria-hidden="true"
                >
                  {milestone.reached && <Check size={10} aria-hidden="true" />}
                </span>
                <div>
                  <strong>{milestoneLabel(milestone)}</strong>
                  {milestone.at && <time dateTime={milestone.at}>{date(milestone.at)}</time>}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="delivery-panel">
          <h2>{t('delivery.tracking.public.supportTitle')}</h2>
          <p>{t('delivery.tracking.public.supportHint')}</p>
          {support.email && (
            <p>
              <a href={`mailto:${support.email}`}>
                <Mail size={14} aria-hidden="true" /> {support.email}
              </a>
            </p>
          )}
          {support.path && (
            <p>
              <Link to={support.path}>{support.label || t('delivery.tracking.public.supportTitle')}</Link>
            </p>
          )}
        </section>
      </div>
    );
  };

  return (
    <PageShell>
      <PageMeta
        title={t('delivery.tracking.public.title')}
        description={t('delivery.tracking.public.subtitle')}
      />
      <div className="delivery-page" dir={i18n.dir()}>
        <header className="delivery-hero">
          <div>
            <h1>{data?.reference || t('delivery.tracking.public.title')}</h1>
            <p>{t('delivery.tracking.public.subtitle')}</p>
          </div>
        </header>
        {renderBody()}
      </div>
    </PageShell>
  );
}
