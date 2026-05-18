import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  CalendarDays,
  Clock3,
  Loader2,
  MapPinned,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import axios from '../api/axios';
import { useAuth } from '../context/AuthContext';
import PageShell from '../components/PageShell';
import PageMeta from '../components/PageMeta';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) return 'Not set';
  const start = new Date(`2000-01-01T${startTime}`);
  const end = new Date(`2000-01-01T${endTime}`);
  return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function SummaryCard({ icon: Icon, label, value, hint, accent = 'text-white' }) {
  return (
    <div className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-500">{label}</span>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
          <Icon className="h-4.5 w-4.5 text-gray-300" />
        </div>
      </div>
      <div className={`text-3xl font-semibold ${accent}`}>{value}</div>
      <p className="mt-2 text-sm leading-6 text-gray-500">{hint}</p>
    </div>
  );
}

function SectionPanel({ icon: Icon, eyebrow, title, children, aside = null }) {
  return (
    <section className="rounded-[30px] border border-gray-800 bg-[#0d1016] p-5 lg:p-6">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-gray-800 bg-gray-900/80">
            <Icon className="h-5 w-5 text-gray-300" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-gray-500">{eyebrow}</p>
            <h2 className="text-2xl font-semibold text-white">{title}</h2>
          </div>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export default function ConsultantAvailabilityPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const consultantId = user?.id;
  const [availability, setAvailability] = useState([]);
  const [blockedDates, setBlockedDates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newAvailability, setNewAvailability] = useState({
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  });
  const [newBlockedDate, setNewBlockedDate] = useState({
    blockedDate: '',
    reason: '',
  });

  useEffect(() => {
    if (!consultantId) return;
    loadAvailability();
    loadBlockedDates();
  }, [consultantId]);

  const loadAvailability = async () => {
    if (!consultantId) return;
    try {
      setLoading(true);
      const response = await axios.get(`/scheduling/consultants/${consultantId}/availability`);
      setAvailability(response.data || []);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load availability');
    } finally {
      setLoading(false);
    }
  };

  const loadBlockedDates = async () => {
    if (!consultantId) return;
    try {
      const response = await axios.get(`/scheduling/consultants/${consultantId}/blocked-dates`);
      setBlockedDates(response.data || []);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load blocked dates');
    }
  };

  const handleSaveAvailability = async () => {
    if (!consultantId || loading) return;
    try {
      if (!newAvailability.startTime || !newAvailability.endTime) {
        toast.error('Set both start and end time');
        return;
      }

      setLoading(true);
      await axios.post(`/scheduling/consultants/${consultantId}/availability`, newAvailability);
      toast.success(t('scheduling.availabilitySaved') || 'Availability saved');
      setNewAvailability({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      });
      await loadAvailability();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to save availability');
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlockedDate = async () => {
    if (!consultantId || loading) return;
    try {
      if (!newBlockedDate.blockedDate) {
        toast.error(t('scheduling.dateRequired') || 'Please select a date');
        return;
      }

      setLoading(true);
      await axios.post(`/scheduling/consultants/${consultantId}/blocked-dates`, newBlockedDate);
      toast.success(t('scheduling.blockedDateAdded') || 'Blocked date added');
      setNewBlockedDate({ blockedDate: '', reason: '' });
      await loadBlockedDates();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to add blocked date');
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveBlockedDate = async (dateId) => {
    if (!consultantId) return;
    try {
      setLoading(true);
      await axios.delete(`/scheduling/consultants/${consultantId}/blocked-dates/${dateId}`);
      toast.success(t('scheduling.blockedDateRemoved') || 'Blocked date removed');
      await loadBlockedDates();
    } catch (err) {
      toast.error(t('common.errorUpdating') || 'Failed to remove blocked date');
    } finally {
      setLoading(false);
    }
  };

  const slotsByDay = useMemo(() => {
    const grouped = new Map();
    DAYS_OF_WEEK.forEach((day) => grouped.set(day.value, []));
    availability.forEach((slot) => {
      const daySlots = grouped.get(slot.day_of_week) || [];
      daySlots.push(slot);
      grouped.set(slot.day_of_week, daySlots);
    });
    return grouped;
  }, [availability]);

  const activeDaysCount = useMemo(
    () => DAYS_OF_WEEK.filter((day) => (slotsByDay.get(day.value) || []).some((slot) => slot.is_active)).length,
    [slotsByDay]
  );

  const nextBlockedDate = useMemo(() => {
    const sorted = [...blockedDates].sort((a, b) => new Date(a.blocked_date) - new Date(b.blocked_date));
    return sorted[0] || null;
  }, [blockedDates]);

  return (
    <PageShell>
      <PageMeta
        title="Consultant Availability"
        description="Manage your recurring consultant schedule, time off, and referral readiness."
        url={`${window.location.origin}/consultant-availability`}
      />

      <div className="min-h-screen bg-[#06080d] text-gray-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[34px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.2),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_26%),#0d1016] p-6 lg:p-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Consultant schedule control
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                  Keep your local launch calendar bookable and clear.
                </h1>
                <p className="mt-4 text-sm leading-7 text-gray-300 lg:text-base">
                  Set weekly hours, block time off, and keep OxSteed’s referral routing aligned with when you can actually serve
                  businesses in-market or virtually.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/consulting/contractor-dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Contractor dashboard
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={Clock3}
              label="Active days"
              value={loading ? '...' : activeDaysCount}
              hint="Days in your weekly schedule currently marked as available."
            />
            <SummaryCard
              icon={CalendarDays}
              label="Weekly slots"
              value={loading ? '...' : availability.length}
              hint="Recurring schedule entries OxSteed can use for planning and handoff."
            />
            <SummaryCard
              icon={ShieldCheck}
              label="Blocked dates"
              value={loading ? '...' : blockedDates.length}
              hint="Days you’ve protected for travel, holidays, or offline work."
            />
            <SummaryCard
              icon={MapPinned}
              label="Next time off"
              value={
                loading
                  ? '...'
                  : nextBlockedDate
                    ? new Date(nextBlockedDate.blocked_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : 'None'
              }
              hint="Your next blocked date currently scheduled in the system."
              accent="text-orange-300"
            />
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
            <SectionPanel
              icon={CalendarClock}
              eyebrow="Schedule Builder"
              title={t('scheduling.recurringSchedule') || 'Recurring Weekly Schedule'}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">What this controls</p>
                  <p className="mt-1 max-w-xs text-sm leading-6 text-gray-400">
                    Your weekly schedule helps OxSteed coordinate referrals, calls, and business-launch touchpoints.
                  </p>
                </div>
              }
            >
              <p className="mb-5 text-sm leading-6 text-gray-400">
                {t('scheduling.recurringDesc') || 'Set your regular working hours for each day of the week'}.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('scheduling.dayOfWeek') || 'Day of Week'}
                  </label>
                  <select
                    value={newAvailability.dayOfWeek}
                    onChange={(e) => setNewAvailability({ ...newAvailability, dayOfWeek: parseInt(e.target.value, 10) })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>{day.label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      {t('scheduling.startTime') || 'Start Time'}
                    </label>
                    <input
                      type="time"
                      value={newAvailability.startTime}
                      onChange={(e) => setNewAvailability({ ...newAvailability, startTime: e.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      {t('scheduling.endTime') || 'End Time'}
                    </label>
                    <input
                      type="time"
                      value={newAvailability.endTime}
                      onChange={(e) => setNewAvailability({ ...newAvailability, endTime: e.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                    />
                  </div>
                </div>
              </div>

              <label className="mt-4 flex items-center justify-between rounded-2xl border border-gray-800 bg-[#111318] px-4 py-3 text-sm text-white">
                <span>{t('scheduling.active') || 'Active'}</span>
                <input
                  type="checkbox"
                  checked={newAvailability.isActive}
                  onChange={(e) => setNewAvailability({ ...newAvailability, isActive: e.target.checked })}
                  className="h-4 w-4 accent-orange-500"
                />
              </label>

              <div className="mt-5">
                <button
                  onClick={handleSaveAvailability}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {loading ? (t('common.saving') || 'Saving...') : (t('common.save') || 'Save Availability')}
                </button>
              </div>
            </SectionPanel>

            <SectionPanel
              icon={Clock3}
              eyebrow="Live Weekly View"
              title={t('scheduling.currentSchedule') || 'Your Current Schedule'}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Loaded now</p>
                  <p className="mt-1 text-xl font-semibold text-white">{loading ? '...' : availability.length}</p>
                </div>
              }
            >
              {availability.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {DAYS_OF_WEEK.map((day) => {
                    const daySlots = slotsByDay.get(day.value) || [];
                    const hasActive = daySlots.some((slot) => slot.is_active);

                    return (
                      <article key={day.value} className="rounded-[24px] border border-gray-800 bg-[#111318] p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h3 className="text-lg font-semibold text-white">{day.label}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${hasActive ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border border-gray-700 bg-gray-900/70 text-gray-400'}`}>
                            {hasActive ? (t('scheduling.active') || 'Active') : (t('scheduling.inactive') || 'Inactive')}
                          </span>
                        </div>

                        {daySlots.length ? (
                          <div className="space-y-2">
                            {daySlots.map((slot) => (
                              <div key={slot.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 px-3 py-2.5">
                                <div className="text-sm font-medium text-white">
                                  {formatTimeRange(slot.start_time, slot.end_time)}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {slot.is_active ? 'Available for referrals and scheduling' : 'Stored but currently turned off'}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/40 px-3 py-5 text-sm text-gray-500">
                            No recurring hours saved for this day yet.
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
                    <CalendarClock className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">No schedule saved yet</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    Add recurring hours so OxSteed can route launch consultations and local follow-ups with more confidence.
                  </p>
                </div>
              )}
            </SectionPanel>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
            <SectionPanel
              icon={ShieldCheck}
              eyebrow="Time Off"
              title={t('scheduling.blockedDates') || 'Block Your Time Off'}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Use this for</p>
                  <p className="mt-1 max-w-xs text-sm leading-6 text-gray-400">
                    Travel, holidays, onsite launch weeks, or any period when OxSteed should not schedule around you.
                  </p>
                </div>
              }
            >
              <p className="mb-5 text-sm leading-6 text-gray-400">
                {t('scheduling.blockedDatesDesc') || 'Mark dates when you are unavailable (holidays, vacation, etc.)'}.
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('scheduling.date') || 'Date'}
                  </label>
                  <input
                    type="date"
                    value={newBlockedDate.blockedDate}
                    onChange={(e) => setNewBlockedDate({ ...newBlockedDate, blockedDate: e.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('scheduling.reason') || 'Reason'}
                  </label>
                  <input
                    type="text"
                    placeholder="Vacation, travel, launch week, holiday..."
                    value={newBlockedDate.reason}
                    onChange={(e) => setNewBlockedDate({ ...newBlockedDate, reason: e.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                  />
                </div>
              </div>

              <div className="mt-5">
                <button
                  onClick={handleAddBlockedDate}
                  disabled={loading}
                  className="inline-flex items-center gap-2 rounded-2xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  {loading ? (t('common.saving') || 'Saving...') : (t('scheduling.addBlockedDate') || 'Add Blocked Date')}
                </button>
              </div>
            </SectionPanel>

            <SectionPanel
              icon={CalendarDays}
              eyebrow="Protected Dates"
              title={t('scheduling.timeOff') || 'Your Time Off'}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Protected</p>
                  <p className="mt-1 text-xl font-semibold text-white">{loading ? '...' : blockedDates.length}</p>
                </div>
              }
            >
              {blockedDates.length ? (
                <div className="space-y-3">
                  {[...blockedDates]
                    .sort((a, b) => new Date(a.blocked_date) - new Date(b.blocked_date))
                    .map((blocked) => (
                      <article key={blocked.id} className="flex flex-col gap-3 rounded-[24px] border border-gray-800 bg-[#111318] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <div className="text-base font-semibold text-white">
                            {new Date(blocked.blocked_date).toLocaleDateString('en-US', {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </div>
                          <div className="mt-1 text-sm text-gray-400">{blocked.reason || 'Time blocked with no reason added yet.'}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveBlockedDate(blocked.id)}
                          disabled={loading}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t('common.remove') || 'Remove'}
                        </button>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
                    <ShieldCheck className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">No blocked dates yet</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    Add your travel days and blackout dates here so referral assignments and scheduling stay realistic.
                  </p>
                </div>
              )}
            </SectionPanel>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
