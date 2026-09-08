import React from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';
import BookingFlow from '../components/booking/BookingFlow';

/**
 * Direct-booking route for a business.
 *
 * Mirrors `BookHelperPage` but targets a business entity. The booking server
 * resolves the receiving helper from `businesses.user_id` (the owner) when the
 * caller does not specify one, so a customer can book a business without
 * choosing a specific team member.
 *
 * Query: businessName (optional display name)
 */
export default function BookBusinessPage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const businessName = searchParams.get('businessName') || '';

  if (!id) {
    return (
      <PageShell>
        <p>{t('booking.invalidBusiness', { defaultValue: 'Business not found.' })}</p>
        <Link to="/helpers">{t('booking.backToDirectory')}</Link>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageMeta
        title={
          businessName
            ? `Book ${businessName} | OxSteed`
            : t('booking.pageTitle')
        }
        description={t('booking.pageDescription')}
      />
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <Link
            to={`/businesses/public/${id}`}
            style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}
          >
            ← {t('booking.backToProfile')}
          </Link>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
          {businessName
            ? t('booking.bookBusinessHeading', {
                businessName,
                defaultValue: `Book ${businessName}`,
              })
            : t('booking.pageHeading')}
        </h1>
        <p
          style={{
            color: 'var(--muted-text)',
            marginBottom: '1.5rem',
            fontSize: '0.95rem',
          }}
        >
          {t('booking.businessIntro', {
            defaultValue:
              'Pick a date and time that works for you. The business will confirm before the slot is locked.',
          })}
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
          <span style={{ fontWeight: 600 }}>
            {t('booking.orPostPublic')}
          </span>{' '}
          <Link
            to={`/post-job?businessId=${encodeURIComponent(id)}${
              businessName ? `&businessName=${encodeURIComponent(businessName)}` : ''
            }`}
          >
            {t('booking.postJobInstead')}
          </Link>
        </div>
        <BookingFlow businessId={id} businessName={businessName} />
      </div>
    </PageShell>
  );
}
