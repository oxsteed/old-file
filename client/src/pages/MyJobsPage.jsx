import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import api from '../api/axios';
import { cancelBookingRequest } from '../api/bookings';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import CustomerCalendarView from '../components/calendar/CustomerCalendarView';

// 'matched' = has at least one bid but is still open for more bids; displayed as "Open"
const OPEN_STATUSES = ['open', 'published', 'matched'];
const STATUS_FILTERS = ['all', 'open', 'published', 'in_progress', 'completed', 'cancelled'];

const STATUS_COLORS = {
  open:        'bg-emerald-500/15 text-emerald-400',
  published:   'bg-emerald-500/15 text-emerald-400',
  matched:     'bg-emerald-500/15 text-emerald-400',
  in_progress: 'bg-blue-500/15 text-blue-400',
  completed:   'bg-gray-500/15 text-gray-400',
  cancelled:   'bg-red-500/15 text-red-400',
};

function StatusBadge({ status }) {
  const { t } = useTranslation();
  const label = OPEN_STATUSES.includes(status)
    ? t('dashboard.jobs.open')
    : status === 'in_progress'
      ? t('dashboard.jobs.inProgress')
      : status === 'completed'
        ? t('dashboard.jobs.completed')
        : status === 'cancelled'
          ? t('jobs.cancelled', { defaultValue: 'Cancelled' })
          : status;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STATUS_COLORS[status] || 'bg-gray-700 text-gray-400'}`}>
      {label}
    </span>
  );
}

function BidCountBadge({ count }) {
  const { t } = useTranslation();
  if (!count && count !== 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
      count > 0 ? 'bg-orange-500/15 text-orange-400' : 'bg-gray-700/40 text-gray-500'
    }`}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
      </svg>
      {count > 0
        ? t('myJobs.bids', { count, defaultValue: '{{count}} bid(s)' })
        : t('myJobs.noBids', { defaultValue: 'No bids yet' })}
    </span>
  );
}

export default function MyJobsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [jobs, setJobs] = useState([]);
  const [bookingRequests, setBookingRequests] = useState([]);
  const [bidCounts, setBidCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('jobs'); // 'jobs', 'bookings', or 'calendar'
  const [calendarViewMode, setCalendarViewMode] = useState('month');
  const [calendarSelectedDate, setCalendarSelectedDate] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Cancellation modal state
  const [cancelModal, setCancelModal] = useState({ type: null, id: null, isOpen: false }); // type: 'job' or 'booking'
  const [cancelReason, setCancelReason] = useState('');
  const [canceling, setCanceling] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [jobsRes, bookingsRes] = await Promise.all([
        api.get('/jobs/me/list'),
        api.get('/bookings/')
      ]);

      const jobsData = Array.isArray(jobsRes.data) ? jobsRes.data : (jobsRes.data?.jobs || []);
      setJobs(jobsData);

      // Booking requests from { success: true, data: [...] }
      const bookingsData = Array.isArray(bookingsRes.data?.data) ? bookingsRes.data.data : [];
      setBookingRequests(bookingsData);

      // Fetch bid counts for all open jobs in parallel (best effort)
      // 'matched' = has bids but still accepting more — treat as open
      const openIds = jobsData
        .filter(j => OPEN_STATUSES.includes(j.status) || j.status === 'in_progress')
        .map(j => j.id);

      if (openIds.length > 0) {
        const results = await Promise.allSettled(
          openIds.map(id => api.get(`/bids/job/${id}`))
        );
        const counts = {};
        results.forEach((r, idx) => {
          if (r.status === 'fulfilled') {
            const bids = Array.isArray(r.value.data) ? r.value.data : (r.value.data?.bids || []);
            counts[openIds[idx]] = bids.length;
          }
        });
        setBidCounts(counts);
      }
    } catch (err) {
      console.error('MyJobsPage: failed to load jobs', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const handleCancelJob = useCallback(async () => {
    if (!cancelModal.id || cancelModal.type !== 'job') return;
    setCanceling(true);
    try {
      await api.post(`/jobs/${cancelModal.id}/cancel`, { reason: cancelReason });
      toast.success(t('myJobs.jobCancelled', { defaultValue: 'Job cancelled successfully' }));
      setCancelModal({ type: null, id: null, isOpen: false });
      setCancelReason('');
      fetchJobs();
    } catch (err) {
      const message = err.response?.data?.error || t('myJobs.cancelError', { defaultValue: 'Failed to cancel job' });
      toast.error(message);
    } finally {
      setCanceling(false);
    }
  }, [cancelModal, cancelReason, fetchJobs, t]);

  const handleCancelBooking = useCallback(async () => {
    if (!cancelModal.id || cancelModal.type !== 'booking') return;
    setCanceling(true);
    try {
      await cancelBookingRequest(cancelModal.id);
      toast.success(t('myJobs.bookingCancelled', { defaultValue: 'Booking request cancelled' }));
      setCancelModal({ type: null, id: null, isOpen: false });
      setCancelReason('');
      fetchJobs();
    } catch (err) {
      const message = err.response?.data?.error || t('myJobs.cancelError', { defaultValue: 'Failed to cancel booking' });
      toast.error(message);
    } finally {
      setCanceling(false);
    }
  }, [cancelModal, fetchJobs, t]);

  const isOpenStatus = (status) => OPEN_STATUSES.includes(status);

  const displayed = filter === 'all'
    ? jobs
    : jobs.filter(j => j.status === filter || (filter === 'open' && isOpenStatus(j.status)));

  const counts = STATUS_FILTERS.reduce((acc, s) => {
    acc[s] = s === 'all'
      ? jobs.length
      : jobs.filter(j => j.status === s || (s === 'open' && isOpenStatus(j.status))).length;
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex flex-col bg-gray-950">
      <PageMeta title={t('dashboard.myJobs')} noIndex />
      <Navbar />
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-8">

        {/* Header with Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">{t('dashboard.myJobs')}</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {activeTab === 'jobs'
                ? t('myJobs.subtitle', { defaultValue: 'Jobs you have posted' })
                : t('myJobs.bookingRequests', { defaultValue: 'Your booking requests' })}
            </p>
          </div>
          <Link
            to="/post-job"
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {t('dashboard.postJob')}
          </Link>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mb-6 border-b border-gray-700/40">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-4 py-3 text-sm font-semibold transition border-b-2 ${
              activeTab === 'jobs'
                ? 'text-white border-orange-500'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {t('dashboard.myJobs')} ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('bookings')}
            className={`px-4 py-3 text-sm font-semibold transition border-b-2 ${
              activeTab === 'bookings'
                ? 'text-white border-orange-500'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {t('myJobs.bookingRequests', { defaultValue: 'Booking Requests' })} ({bookingRequests.length})
          </button>
          <button
            onClick={() => setActiveTab('calendar')}
            className={`px-4 py-3 text-sm font-semibold transition border-b-2 ${
              activeTab === 'calendar'
                ? 'text-white border-orange-500'
                : 'text-gray-400 border-transparent hover:text-gray-300'
            }`}
          >
            {t('myJobs.calendar', { defaultValue: 'Calendar' })}
          </button>
        </div>

        {/* Status filter tabs - only show for jobs tab */}
        {activeTab === 'jobs' && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  filter === s
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {s === 'all'
                  ? `${t('dashboard.jobs.all', { defaultValue: 'All' })} (${counts.all})`
                  : s === 'open'
                    ? `${t('dashboard.jobs.open')} (${counts.open})`
                    : s === 'published'
                      ? null  // merged into "open" tab
                      : `${t(`dashboard.jobs.${s === 'in_progress' ? 'inProgress' : s}`, { defaultValue: s })} (${counts[s] || 0})`
                }
              </button>
            )).filter(Boolean)}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center justify-between">
            <span>{t('myJobs.loadError', { defaultValue: 'Failed to load jobs.' })}</span>
            <button onClick={fetchJobs} className="text-orange-400 hover:text-orange-300 font-medium">
              {t('dashboard.pulse.retry')}
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-gray-900/60 border border-gray-700/40 rounded-2xl p-5 animate-pulse">
                <div className="h-4 bg-gray-800 rounded w-2/5 mb-3" />
                <div className="h-3 bg-gray-800 rounded w-3/5" />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && (
          <>
            {activeTab === 'jobs' && displayed.length === 0 && (
              <div className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-12 text-center">
                <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <rect x="2" y="7" width="20" height="14" rx="2" strokeWidth={1.5}/>
                  <path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" strokeWidth={1.5}/>
                </svg>
                <p className="text-gray-400 text-sm mb-4">
                  {filter === 'all'
                    ? t('dashboard.jobs.noJobs')
                    : t('myJobs.noJobsInStatus', { status: filter, defaultValue: `No ${filter} jobs.` })}
                </p>
                {filter === 'all' && (
                  <Link
                    to="/post-job"
                    className="inline-flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition"
                  >
                    {t('dashboard.jobs.postFirst')}
                  </Link>
                )}
              </div>
            )}

            {activeTab === 'bookings' && bookingRequests.length === 0 && (
              <div className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-12 text-center">
                <svg className="w-12 h-12 text-gray-700 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                </svg>
                <p className="text-gray-400 text-sm">
                  {t('myJobs.noBookingRequests', { defaultValue: 'No booking requests yet' })}
                </p>
              </div>
            )}
          </>
        )}

        {/* Job list */}
        {!loading && activeTab === 'jobs' && displayed.length > 0 && (
          <div className="space-y-3">
            {displayed.map(job => {
              const isOpen = isOpenStatus(job.status);
              const bidCount = bidCounts[job.id];
              const hasBids = bidCount > 0;
              return (
                <div
                  key={job.id}
                  className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-5 hover:border-gray-600 transition group"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <StatusBadge status={job.status} />
                        {isOpen && <BidCountBadge count={bidCount} />}
                        {job.is_urgent && (
                          <span className="bg-red-500/15 text-red-400 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                            {t('jobs.urgent', { defaultValue: 'Urgent' })}
                          </span>
                        )}
                      </div>
                      <h2 className="text-white font-semibold text-base group-hover:text-orange-400 transition truncate">
                        {job.title}
                      </h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {[job.category_name, job.location_city, job.location_state].filter(Boolean).join(' · ')}
                        {job.scheduled_date && (
                          <span> · {new Date(job.scheduled_date).toLocaleDateString()}</span>
                        )}
                      </p>
                      {job.budget_type && (job.budget_min || job.budget_max) && (
                        <p className="text-xs text-emerald-400 mt-1">
                          {job.budget_type === 'fixed'
                            ? `$${job.budget_max || job.budget_min}`
                            : job.budget_min && job.budget_max
                              ? `$${job.budget_min} – $${job.budget_max}`
                              : `$${job.budget_min || job.budget_max}`}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      <Link
                        to={`/jobs/${job.id}`}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition text-center"
                      >
                        {t('common.view', { defaultValue: 'View' })}
                      </Link>
                      {isOpen && hasBids && (
                        <Link
                          to={`/jobs/${job.id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition text-center"
                        >
                          {t('myJobs.reviewBids', { defaultValue: 'Review Bids' })}
                        </Link>
                      )}
                      {(isOpen || job.status === 'in_progress') && (
                        <button
                          onClick={() => setCancelModal({ type: 'job', id: job.id, isOpen: true })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition text-center"
                        >
                          {t('myJobs.cancel', { defaultValue: 'Cancel' })}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Assigned helper */}
                  {job.assigned_helper_id && job.preferred_helper_name && (
                    <div className="mt-3 pt-3 border-t border-gray-700/40 flex items-center gap-2">
                      <div className="w-5 h-5 rounded-full bg-blue-900/60 flex items-center justify-center flex-shrink-0 text-[10px] font-bold text-blue-300">
                        {job.preferred_helper_name.charAt(0).toUpperCase()}
                      </div>
                      <p className="text-xs text-gray-500">
                        {t('myJobs.assignedTo', { defaultValue: 'Assigned to' })}{' '}
                        <span className="text-gray-300 font-medium">{job.preferred_helper_name}</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div>
            {/* View Mode Controls */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setCalendarViewMode('month')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  calendarViewMode === 'month'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {t('calendar.month', { defaultValue: 'Month' })}
              </button>
              <button
                onClick={() => setCalendarViewMode('week')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  calendarViewMode === 'week'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {t('calendar.week', { defaultValue: 'Week' })}
              </button>
              <button
                onClick={() => setCalendarViewMode('day')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  calendarViewMode === 'day'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {t('calendar.day', { defaultValue: 'Day' })}
              </button>
              <button
                onClick={() => setCalendarViewMode('agenda')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  calendarViewMode === 'agenda'
                    ? 'bg-orange-500 text-white'
                    : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {t('calendar.agenda', { defaultValue: 'Agenda' })}
              </button>
            </div>

            {/* Legend */}
            <div className="mb-4 p-3 bg-gray-900/40 border border-gray-700/40 rounded-xl">
              <p className="text-xs font-semibold text-gray-300 mb-2">{t('calendar.legend', { defaultValue: 'Legend' })}:</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-gray-400">{t('myJobs.postedJob', { defaultValue: 'Posted Job' })}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-gray-400">{t('myJobs.directBooking', { defaultValue: 'Direct Booking' })}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-green-400 font-bold">■</span>
                  <span className="text-gray-400">{t('calendar.statusOpen', { defaultValue: 'Open' })}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-orange-400 font-bold">■</span>
                  <span className="text-gray-400">{t('calendar.statusAccepted', { defaultValue: 'Accepted' })}</span>
                </div>
              </div>
            </div>

            {/* Calendar Component */}
            <div className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-5">
              <CustomerCalendarView
                viewMode={calendarViewMode}
                selectedDate={calendarSelectedDate}
                onDateChange={setCalendarSelectedDate}
                onEventClick={setSelectedEvent}
              />
            </div>

            {/* Event Details Modal */}
            {selectedEvent && (
              <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
                <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-md w-full p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          selectedEvent.type === 'job'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-purple-500/15 text-purple-400'
                        }`}>
                          {selectedEvent.type === 'job'
                            ? t('myJobs.postedJob', { defaultValue: 'Posted Job' })
                            : t('myJobs.directBooking', { defaultValue: 'Direct Booking' })}
                        </span>
                      </div>
                      <h3 className="text-white font-semibold text-lg">{selectedEvent.title}</h3>
                    </div>
                    <button
                      onClick={() => setSelectedEvent(null)}
                      className="text-gray-400 hover:text-white transition"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="space-y-3 mb-5">
                    <div className="text-sm">
                      <p className="text-gray-500 text-xs mb-1">{t('myJobs.status', { defaultValue: 'Status' })}</p>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                        selectedEvent.status === 'open' || selectedEvent.status === 'published' || selectedEvent.status === 'matched'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : selectedEvent.status === 'in_progress'
                            ? 'bg-blue-500/15 text-blue-400'
                            : selectedEvent.status === 'completed'
                              ? 'bg-gray-500/15 text-gray-400'
                              : 'bg-red-500/15 text-red-400'
                      }`}>
                        {selectedEvent.status.charAt(0).toUpperCase() + selectedEvent.status.slice(1).replace(/_/g, ' ')}
                      </span>
                    </div>

                    <div className="text-sm">
                      <p className="text-gray-500 text-xs mb-1">{t('myJobs.dateTime', { defaultValue: 'Date & Time' })}</p>
                      <p className="text-gray-300">
                        {new Date(selectedEvent.scheduled_start_time).toLocaleDateString(undefined, {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {new Date(selectedEvent.scheduled_start_time).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {' – '}
                        {new Date(selectedEvent.scheduled_end_time).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>

                    {selectedEvent.price && (
                      <div className="text-sm">
                        <p className="text-gray-500 text-xs mb-1">{t('myJobs.price', { defaultValue: 'Price' })}</p>
                        <p className="text-emerald-400 font-semibold">${selectedEvent.price}</p>
                      </div>
                    )}

                    <div className="text-sm">
                      <p className="text-gray-500 text-xs mb-1">{t('myJobs.helper', { defaultValue: 'Helper' })}</p>
                      <p className="text-gray-300">{selectedEvent.helper_name}</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Link
                      to={selectedEvent.type === 'job' ? `/jobs/${selectedEvent.job_id}` : `/bookings/${selectedEvent.booking_id}`}
                      className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-xl transition text-center"
                    >
                      {t('common.view', { defaultValue: 'View' })}
                    </Link>
                    <button
                      onClick={() => setSelectedEvent(null)}
                      className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 font-semibold rounded-xl transition"
                    >
                      {t('common.close', { defaultValue: 'Close' })}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Booking Requests List */}
        {!loading && activeTab === 'bookings' && bookingRequests.length > 0 && (
          <div className="space-y-3">
            {bookingRequests.map(booking => {
              const statusColor = booking.status === 'pending'
                ? 'bg-yellow-500/15 text-yellow-400'
                : booking.status === 'accepted'
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : booking.status === 'completed'
                    ? 'bg-blue-500/15 text-blue-400'
                    : booking.status === 'declined' || booking.status === 'cancelled'
                      ? 'bg-red-500/15 text-red-400'
                      : booking.status === 'expired'
                        ? 'bg-gray-500/15 text-gray-400'
                        : 'bg-gray-700/15 text-gray-400';

              const startDate = new Date(booking.start_time || booking.requested_date);
              const endDate = new Date(booking.end_time || booking.requested_end_time);
              const createdDate = new Date(booking.created_at);

              return (
                <div
                  key={booking.id}
                  className="bg-gray-900/50 border border-gray-700/40 rounded-2xl p-5 hover:border-gray-600 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusColor}`}>
                          {t(`calendar.status${booking.status.charAt(0).toUpperCase() + booking.status.slice(1)}`,
                            { defaultValue: booking.status })}
                        </span>
                      </div>
                      <h2 className="text-white font-semibold text-base truncate">
                        {booking.service_name || t('calendar.service', { defaultValue: 'Service Request' })}
                      </h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('myJobs.requestedOn', { defaultValue: 'Requested on' })} {createdDate.toLocaleDateString()}
                      </p>

                      {/* Booking Details */}
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs text-gray-400">
                          📅 {startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                          {' '}
                          {startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                          {' – '}
                          {endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                        </p>
                        {booking.service_location && (
                          <p className="text-xs text-gray-400">
                            📍 {booking.service_location}
                          </p>
                        )}
                        {booking.price && (
                          <p className="text-xs text-emerald-400 font-medium">
                            💰 ${booking.price}
                          </p>
                        )}
                      </div>

                      {booking.description && (
                        <p className="text-xs text-gray-400 mt-2 line-clamp-2">
                          {booking.description}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {booking.status === 'pending' && booking.expires_at && (
                        <span className="text-xs text-gray-500">
                          {new Date(booking.expires_at) > new Date()
                            ? t('calendar.expiresIn', {
                                defaultValue: 'Expires in',
                                days: Math.ceil((new Date(booking.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
                              })
                            : t('calendar.expired', { defaultValue: 'Expired' })}
                        </span>
                      )}
                      <div className="flex gap-2">
                        <Link
                          to={`/bookings/${booking.id}`}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition"
                        >
                          {t('common.view', { defaultValue: 'View' })}
                        </Link>
                        {(booking.status === 'pending' || booking.status === 'accepted') && (
                          <button
                            onClick={() => setCancelModal({ type: 'booking', id: booking.id, isOpen: true })}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-400 transition"
                          >
                            {t('myJobs.cancel', { defaultValue: 'Cancel' })}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Cancellation Modal */}
        {cancelModal.isOpen && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-md w-full p-6">
              <h3 className="text-lg font-semibold text-white mb-4">
                {cancelModal.type === 'job'
                  ? t('myJobs.cancelJobTitle', { defaultValue: 'Cancel Job?' })
                  : t('myJobs.cancelBookingTitle', { defaultValue: 'Cancel Booking Request?' })}
              </h3>

              <p className="text-sm text-gray-400 mb-4">
                {cancelModal.type === 'job'
                  ? t('myJobs.cancelJobDesc', { defaultValue: 'This will remove your job posting. Helpers won\'t be able to bid anymore.' })
                  : t('myJobs.cancelBookingDesc', { defaultValue: 'This will cancel your booking request with the helper.' })}
              </p>

              {cancelModal.type === 'job' && (
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-300 mb-2">
                    {t('myJobs.cancelReasonLabel', { defaultValue: 'Reason (optional)' })}
                  </label>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder={t('myJobs.cancelReasonPlaceholder', { defaultValue: 'Tell us why you\'re cancelling...' })}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 resize-none"
                    rows="3"
                  />
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setCancelModal({ type: null, id: null, isOpen: false });
                    setCancelReason('');
                  }}
                  disabled={canceling}
                  className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 font-semibold rounded-lg transition"
                >
                  {t('common.keepCancel', { defaultValue: 'Keep it' })}
                </button>
                <button
                  onClick={cancelModal.type === 'job' ? handleCancelJob : handleCancelBooking}
                  disabled={canceling}
                  className="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold rounded-lg transition"
                >
                  {canceling
                    ? t('common.canceling', { defaultValue: 'Cancelling...' })
                    : t('myJobs.confirmCancel', { defaultValue: 'Yes, cancel' })}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  );
}
