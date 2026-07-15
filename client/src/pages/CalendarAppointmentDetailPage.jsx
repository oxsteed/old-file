import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  MapPin,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import PageMeta from '../components/PageMeta';
import RescheduleModal from '../components/calendar/RescheduleModal';
import { useAuth } from '../hooks/useAuth';
import { formatDateTime } from '../lib/format';

function normalizeAppointment(responseData) {
  return responseData?.data || responseData || null;
}

function statusClass(status) {
  const map = {
    requested: 'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
    confirmed: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/20',
    in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/20',
    completed: 'bg-white/5 text-slate-200 border-white/10',
    cancelled: 'bg-rose-500/15 text-rose-300 border-rose-500/20',
    rescheduled: 'bg-violet-500/15 text-violet-300 border-violet-500/20',
  };
  return map[status] || 'bg-white/5 text-slate-300 border-white/10';
}

function Section({ title, children }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/75 p-5 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <CalendarDays size={18} className="text-orange-300" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function buildGoogleCalendarUrl(appointment) {
  const title = encodeURIComponent(appointment.service_description || 'OxSteed Appointment');
  const location = encodeURIComponent(appointment.location_address || '');
  const start = new Date(appointment.scheduled_start_time).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const end = new Date(appointment.scheduled_end_time).toISOString().replace(/[-:]/g, '').replace('.000', '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&location=${location}`;
}

export default function CalendarAppointmentDetailPage() {
  const { t } = useTranslation();
  const { appointmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showReschedule, setShowReschedule] = useState(false);

  const loadAppointment = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await api.get(`/calendar/appointments/${appointmentId}`);
      setAppointment(normalizeAppointment(response.data));
    } catch (err) {
      setError(err.response?.data?.error || t('calendar.errorLoading', { defaultValue: 'Failed to load appointment.' }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (appointmentId) loadAppointment();
  }, [appointmentId]);

  const isCustomer = String(appointment?.customer_id || '') === String(user?.id || '');
  const isHelper = String(appointment?.helper_id || '') === String(user?.id || '');
  const canConfirm = appointment?.status === 'requested' && isHelper;
  const canCancel = appointment && ['requested', 'confirmed'].includes(appointment.status);
  const canReschedule = canCancel;

  const startTime = useMemo(() => (appointment?.scheduled_start_time ? new Date(appointment.scheduled_start_time) : null), [appointment]);
  const endTime = useMemo(() => (appointment?.scheduled_end_time ? new Date(appointment.scheduled_end_time) : null), [appointment]);

  const handleConfirm = async () => {
    if (!canConfirm) return;
    try {
      setSaving(true);
      await api.post(`/calendar/appointments/${appointmentId}/confirm`);
      toast.success(t('calendar.appointmentConfirmed', { defaultValue: 'Appointment confirmed.' }));
      await loadAppointment();
    } catch (err) {
      toast.error(err.response?.data?.error || t('calendar.errorConfirming', { defaultValue: 'Failed to confirm appointment.' }));
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!canCancel) return;
    if (!cancelReason.trim()) {
      toast.error(t('calendar.provideCancelReason', { defaultValue: 'Please provide a cancellation reason.' }));
      return;
    }
    try {
      setSaving(true);
      await api.post(`/calendar/appointments/${appointmentId}/cancel`, { cancellation_reason: cancelReason.trim() });
      toast.success(t('calendar.appointmentCancelled', { defaultValue: 'Appointment cancelled.' }));
      setCancelReason('');
      setShowCancel(false);
      await loadAppointment();
    } catch (err) {
      toast.error(err.response?.data?.error || t('calendar.errorCancelling', { defaultValue: 'Failed to cancel appointment.' }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4">
          <div className="animate-pulse rounded-3xl border border-white/10 bg-white/5 p-8 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-white/10" />
            <div className="h-5 w-52 rounded bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !appointment) {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <PageMeta title={t('calendar.appointmentDetails', { defaultValue: 'Appointment Details' })} noIndex />
        <div className="mx-auto flex min-h-screen max-w-4xl items-center justify-center px-4 py-12">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-slate-950/80 p-8 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-rose-500/10 text-rose-300">
              <CalendarDays size={28} />
            </div>
            <h1 className="text-2xl font-semibold text-white">{t('calendar.appointmentUnavailable', { defaultValue: 'Appointment unavailable' })}</h1>
            <p className="mt-3 text-slate-300">{error || t('calendar.appointmentUnavailableBody', { defaultValue: 'We could not load this appointment.' })}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={loadAppointment}
                className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-5 py-3 font-semibold text-white transition hover:bg-orange-600"
              >
                <RefreshCw size={16} />
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                className="inline-flex items-center gap-2 rounded-full bg-white/5 px-5 py-3 font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <ArrowLeft size={16} />
                {t('nav.calendar', { defaultValue: 'Calendar' })}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const icalUrl = `/api/calendar/appointments/${appointment.id}/ical`;
  const googleUrl = buildGoogleCalendarUrl(appointment);
  const durationMinutes = endTime && startTime ? Math.max(0, Math.round((endTime - startTime) / 60000)) : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-950 to-slate-900 text-white">
      <PageMeta title={t('calendar.appointmentDetails', { defaultValue: 'Appointment Details' })} noIndex />

      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/calendar')}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
          >
            <ArrowLeft size={16} />
            {t('common.back', { defaultValue: 'Back' })}
          </button>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${statusClass(appointment.status)}`}>
            {String(appointment.status || 'requested').replace(/_/g, ' ')}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
          <div className="space-y-6">
            <Section title={appointment.service_description || t('calendar.appointmentDetails', { defaultValue: 'Appointment Details' })}>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.date', { defaultValue: 'Date' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{startTime ? startTime.toLocaleDateString() : t('common.notSet', { defaultValue: 'Not set' })}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.time', { defaultValue: 'Time' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {startTime && endTime
                      ? `${startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : t('common.notSet', { defaultValue: 'Not set' })}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.duration', { defaultValue: 'Duration' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">{durationMinutes ? `${durationMinutes} ${t('calendar.minutes', { defaultValue: 'minutes' })}` : t('common.notSet', { defaultValue: 'Not set' })}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.paymentExpectation', { defaultValue: 'Payment' })}</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {(appointment.payment_expectation || 'direct_to_helper').replace(/_/g, ' ')}
                  </div>
                </div>
              </div>
            </Section>

            <Section title={isCustomer ? t('calendar.helperInfo', { defaultValue: 'Helper' }) : t('calendar.customerInfo', { defaultValue: 'Customer' })}>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-500/15 text-sm font-semibold text-orange-200">
                  {(isCustomer ? appointment.helper_name : appointment.customer_name || '?').split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'}
                </div>
                <div>
                  <div className="font-semibold text-white">{isCustomer ? appointment.helper_name : appointment.customer_name}</div>
                  <div className="text-sm text-slate-400">
                    {isCustomer ? appointment.helper_email || '' : appointment.customer_email || ''}
                  </div>
                </div>
              </div>
            </Section>

            <Section title={t('calendar.serviceDetails', { defaultValue: 'Service details' })}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.location', { defaultValue: 'Location' })}</dt>
                  <dd className="mt-1 text-slate-100">{appointment.location_address || t('common.none', { defaultValue: 'None' })}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.job', { defaultValue: 'Job' })}</dt>
                  <dd className="mt-1 text-slate-100">{appointment.job_title || t('common.none', { defaultValue: 'None' })}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.customerNotes', { defaultValue: 'Customer notes' })}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-slate-100">{appointment.customer_notes || t('common.none', { defaultValue: 'None' })}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-[0.18em] text-slate-400">{t('calendar.helperNotes', { defaultValue: 'Helper notes' })}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-slate-100">{appointment.helper_notes || t('common.none', { defaultValue: 'None' })}</dd>
                </div>
              </dl>
            </Section>

            {(showCancel || !canCancel) && (
              <Section title={t('calendar.cancelReason', { defaultValue: 'Cancel appointment' })}>
                {!canCancel ? (
                  <p className="text-slate-300">{t('calendar.cancelUnavailable', { defaultValue: 'This appointment can no longer be cancelled.' })}</p>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      rows={4}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-orange-400/60"
                      placeholder={t('calendar.cancelReasonPlaceholder', { defaultValue: 'Tell the other party why you need to cancel.' })}
                    />
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => { setShowCancel(false); setCancelReason(''); }}
                        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/10"
                      >
                        {t('common.close', { defaultValue: 'Close' })}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancel}
                        disabled={saving}
                        className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
                      >
                        {saving ? t('common.saving', { defaultValue: 'Saving…' }) : t('calendar.cancelAppointment', { defaultValue: 'Cancel appointment' })}
                      </button>
                    </div>
                  </div>
                )}
              </Section>
            )}
          </div>

          <div className="space-y-6">
            <Section title={t('calendar.quickActions', { defaultValue: 'Quick actions' })}>
              <div className="flex flex-wrap gap-3">
                {canConfirm && (
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-60"
                  >
                    <CheckCircle2 size={15} />
                    {saving ? t('common.saving', { defaultValue: 'Saving…' }) : t('calendar.confirmAppointment', { defaultValue: 'Confirm' })}
                  </button>
                )}
                {canCancel && !showCancel && (
                  <button
                    type="button"
                    onClick={() => setShowCancel(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    <XCircle size={15} />
                    {t('calendar.cancelAppointment', { defaultValue: 'Cancel' })}
                  </button>
                )}
                {canReschedule && (
                  <button
                    type="button"
                    onClick={() => setShowReschedule(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                  >
                    <Clock3 size={15} />
                    {t('calendar.reschedule', { defaultValue: 'Reschedule' })}
                  </button>
                )}
                {appointment.job_id && (
                  <Link
                    to={`/jobs/${appointment.job_id}`}
                    className="inline-flex items-center gap-2 rounded-full bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600"
                  >
                    {t('calendar.viewJob', { defaultValue: 'View job' })}
                    <ExternalLink size={15} />
                  </Link>
                )}
              </div>
            </Section>

            <Section title={t('calendar.export', { defaultValue: 'Export' })}>
              <div className="flex flex-col gap-3">
                <a
                  href={icalUrl}
                  download={`oxsteed-appointment-${appointment.id}.ics`}
                  className="inline-flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  <span>{t('calendar.downloadIcal', { defaultValue: 'Download .ics' })}</span>
                  <ExternalLink size={15} />
                </a>
                <a
                  href={googleUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
                >
                  <span>{t('calendar.addToGoogle', { defaultValue: 'Add to Google Calendar' })}</span>
                  <ExternalLink size={15} />
                </a>
              </div>
            </Section>
          </div>
        </div>
      </div>

      {showReschedule && (
        <RescheduleModal
          appointment={appointment}
          isCustomer={isCustomer}
          onClose={() => setShowReschedule(false)}
          onRescheduled={loadAppointment}
        />
      )}
    </div>
  );
}
