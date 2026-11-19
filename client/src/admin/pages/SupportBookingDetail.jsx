// Admin → Support → Booking detail (PR #804 G-36).
// Read-only: support opens a booking to help the customer or helper.
// The API is GET /api/admin/support/bookings/:bookingId (requireAdmin +
// manage_support). Payment internals are redacted server-side; this page
// renders only what the endpoint returns. There are no actions here.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';

const money = (cents, language) => (cents == null
  ? '—'
  : new Intl.NumberFormat(language || 'en', { style: 'currency', currency: 'USD' }).format(cents / 100));

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{children ?? '—'}</dd>
    </div>
  );
}

export default function SupportBookingDetail() {
  const { t, i18n } = useTranslation();
  const { bookingId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    adminApi.get(`/admin/support/bookings/${bookingId}`)
      .then(({ data: payload }) => { if (!cancelled) setData(payload); })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.response?.status === 404
          ? t('adminSupportBooking.notFound')
          : t('adminSupportBooking.loadFailed'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [bookingId, t]);

  if (loading) return <p className="p-6 text-sm text-gray-500">{t('adminSupportBooking.loading')}</p>;
  if (error) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-600" role="alert">{error}</p>
        <Link to="/admin/support" className="mt-4 inline-block text-sm font-medium text-blue-600 underline">
          {t('adminSupportBooking.backToSupport')}
        </Link>
      </div>
    );
  }

  const { booking, appointment, payment, job } = data;
  return (
    <div className="space-y-6 p-6">
      <div>
        <Link to="/admin/support" className="text-sm font-medium text-blue-600 underline">
          {t('adminSupportBooking.backToSupport')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">{t('adminSupportBooking.title')}</h1>
        <p className="text-sm text-gray-500">{booking.id}</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold">{t('adminSupportBooking.booking')}</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t('adminSupportBooking.status')}>{booking.status}</Field>
          <Field label={t('adminSupportBooking.service')}>{booking.serviceName}</Field>
          <Field label={t('adminSupportBooking.requestedDate')}>{booking.requestedDate || '—'}</Field>
          <Field label={t('adminSupportBooking.time')}>{[booking.requestedStartTime, booking.requestedEndTime].filter(Boolean).join(' – ') || '—'}</Field>
          <Field label={t('adminSupportBooking.location')}>{booking.serviceLocation || '—'}</Field>
          <Field label={t('adminSupportBooking.description')}>{booking.description || '—'}</Field>
          <Field label={t('adminSupportBooking.customer')}>{booking.customer?.name || booking.customer?.id} {booking.customer?.email ? `(${booking.customer.email})` : ''}</Field>
          <Field label={t('adminSupportBooking.helper')}>{booking.helper ? `${booking.helper.name || booking.helper.id}${booking.helper.email ? ` (${booking.helper.email})` : ''}` : t('adminSupportBooking.unassigned')}</Field>
          <Field label={t('adminSupportBooking.bookedFor')}>{booking.recipient?.name || booking.recipient?.userId || '—'} {booking.recipient?.phone ? `(${booking.recipient.phone})` : ''}</Field>
          <Field label={t('adminSupportBooking.siteContact')}>{booking.siteContact?.name || '—'} {booking.siteContact?.phone ? `(${booking.siteContact.phone})` : ''}</Field>
          <Field label={t('adminSupportBooking.bookedBy')}>{booking.bookedByUserId || '—'}</Field>
          <Field label={t('adminSupportBooking.convertedJob')}>{job ? <Link to={`/admin/jobs/${job.id}`} className="text-blue-600 underline">{job.id}</Link> : '—'}</Field>
        </dl>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold">{t('adminSupportBooking.appointment')}</h2>
        {appointment ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label={t('adminSupportBooking.status')}>{appointment.status}</Field>
            <Field label={t('adminSupportBooking.scheduled')}>{appointment.scheduled_start_time ? new Date(appointment.scheduled_start_time).toLocaleString(i18n.language) : '—'}</Field>
            <Field label={t('adminSupportBooking.location')}>{appointment.location_address || '—'}</Field>
            <Field label={t('adminSupportBooking.description')}>{appointment.service_description || '—'}</Field>
            {appointment.cancellation_reason && <Field label={t('adminSupportBooking.cancellationReason')}>{appointment.cancellation_reason}</Field>}
          </dl>
        ) : (
          <p className="text-sm text-gray-500">{t('adminSupportBooking.noAppointment')}</p>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
        <h2 className="mb-3 text-lg font-semibold">{t('adminSupportBooking.payment')}</h2>
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label={t('adminSupportBooking.paymentStatus')}>{payment.status}</Field>
          <Field label={t('adminSupportBooking.paymentRequirement')}>{payment.requirement || '—'}</Field>
          <Field label={t('adminSupportBooking.amount')}>{money(payment.amountCents, i18n.language)}</Field>
          <Field label={t('adminSupportBooking.grossAmount')}>{money(payment.grossAmountCents, i18n.language)}</Field>
          <Field label={t('adminSupportBooking.promoDiscount')}>{money(payment.promoDiscountCents, i18n.language)}</Field>
          <Field label={t('adminSupportBooking.refundedAt')}>{payment.refundedAt ? new Date(payment.refundedAt).toLocaleString(i18n.language) : '—'}</Field>
        </dl>
        <p className="mt-3 text-xs text-gray-500">{t('adminSupportBooking.paymentNote')}</p>
      </section>
    </div>
  );
}
