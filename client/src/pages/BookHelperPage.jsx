import React from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import BookingFlow from '../components/booking/BookingFlow';

/**
 * Dedicated direct-booking route for a helper.
 * Query: helperName (optional display name)
 */
export default function BookHelperPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const helperName = searchParams.get('helperName') || '';

  if (!id) {
    return (
      <PageShell>
        <p>{t('booking.invalidHelper')}</p>
        <Link to="/helpers">{t('booking.backToDirectory')}</Link>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta
        title={t('booking.pageTitle')}
        description={t('booking.pageDescription')}
      />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <Link to={`/helpers/public/${id}`} style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            ← {t('booking.backToProfile')}
          </Link>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {t('booking.pageHeading')}
        </h1>
        <p style={{ color: 'var(--muted-text)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
          {t('booking.pageIntro')}
        </p>
        <div
          style={{
            marginBottom: '1.25rem',
            padding: '0.75rem 1rem',
            borderRadius: 12,
            border: '1px solid var(--border-color)',
            background: 'var(--card-bg)',
            fontSize: '0.9rem',
          }}
        >
          <span style={{ fontWeight: 600 }}>{t('booking.orPostPublic')}</span>{' '}
          <Link to={`/post-job?helperId=${encodeURIComponent(id)}&helperName=${encodeURIComponent(helperName)}`}>
            {t('booking.postJobInstead')}
          </Link>
        </div>
        <BookingFlow helperId={id} helperName={helperName} />
      </div>
    </PageShell>
  );
}
