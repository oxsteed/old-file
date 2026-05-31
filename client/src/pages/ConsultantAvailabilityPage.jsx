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
  { value: 0, labelKey: 'consultantAvailabilityPage.dayLabels.sunday' },
  { value: 1, labelKey: 'consultantAvailabilityPage.dayLabels.monday' },
  { value: 2, labelKey: 'consultantAvailabilityPage.dayLabels.tuesday' },
  { value: 3, labelKey: 'consultantAvailabilityPage.dayLabels.wednesday' },
  { value: 4, labelKey: 'consultantAvailabilityPage.dayLabels.thursday' },
  { value: 5, labelKey: 'consultantAvailabilityPage.dayLabels.friday' },
  { value: 6, labelKey: 'consultantAvailabilityPage.dayLabels.saturday' },
];

function formatTimeRange(startTime, endTime, t, locale) {
  if (!startTime || !endTime) return t('consultantAvailabilityPage.notSet');
  const start = new Date(`2000-01-01T${startTime}`);
  const end = new Date(`2000-01-01T${endTime}`);
  return `${start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
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
  const { t, i18n } = useTranslation();
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
      toast.error(t('consultantAvailabilityPage.errorLoadingAvailability') || t('common.errorLoading'));
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
      toast.error(t('consultantAvailabilityPage.errorLoadingBlockedDates') || t('common.errorLoading'));
    }
  };

  const handleSaveAvailability = async () => {
    if (!consultantId || loading) return;
    try {
      if (!newAvailability.startTime || !newAvailability.endTime) {
        toast.error(t('consultantAvailabilityPage.errorTimeRange'));
        return;
      }

      setLoading(true);
      await axios.post(`/scheduling/consultants/${consultantId}/availability`, newAvailability);
      toast.success(t('scheduling.availabilitySaved'));
      setNewAvailability({
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '17:00',
        isActive: true,
      });
      await loadAvailability();
    } catch (err) {
      toast.error(t('consultantAvailabilityPage.errorSavingAvailability') || t('common.errorUpdating'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlockedDate = async () => {
    if (!consultantId || loading) return;
    try {
      if (!newBlockedDate.blockedDate) {
        toast.error(t('consultantAvailabilityPage.dateRequired'));
        return;
      }

      setLoading(true);
      await axios.post(`/scheduling/consultants/${consultantId}/blocked-dates`, newBlockedDate);
      toast.success(t('scheduling.blockedDateAdded'));
      setNewBlockedDate({ blockedDate: '', reason: '' });
      await loadBlockedDates();
    } catch (err) {
      toast.error(t('consultantAvailabilityPage.errorAddingBlockedDate') || t('common.errorUpdating'));
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveBlockedDate = async (dateId) => {
    if (!consultantId) return;
    try {
      setLoading(true);
      await axios.delete(`/scheduling/consultants/${consultantId}/blocked-dates/${dateId}`);
      toast.success(t('scheduling.blockedDateRemoved'));
      await loadBlockedDates();
    } catch (err) {
      toast.error(t('consultantAvailabilityPage.errorRemovingBlockedDate') || t('common.errorUpdating'));
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
        title={t('consultantAvailabilityPage.metaTitle')}
        description={t('consultantAvailabilityPage.metaDescription')}
        url={`${window.location.origin}/consultant-availability`}
      />

      <div className="min-h-screen bg-[#06080d] text-gray-100">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <section className="overflow-hidden rounded-[34px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.2),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.12),_transparent_26%),#0d1016] p-6 lg:p-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-orange-200">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {t('consultantAvailabilityPage.badge')}
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white lg:text-4xl">
                  {t('consultantAvailabilityPage.heading')}
                </h1>
                <p className="mt-4 text-sm leading-7 text-gray-300 lg:text-base">
                  {t('consultantAvailabilityPage.intro')}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/consulting/contractor-dashboard"
                  className="inline-flex items-center gap-2 rounded-2xl border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:border-gray-500 hover:text-white"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('consultantAvailabilityPage.backToDashboard')}
                </Link>
              </div>
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={Clock3}
              label={t('consultantAvailabilityPage.summaryActiveDays')}
              value={loading ? '...' : activeDaysCount}
              hint={t('consultantAvailabilityPage.summaryActiveDaysHint')}
            />
            <SummaryCard
              icon={CalendarDays}
              label={t('consultantAvailabilityPage.summaryWeeklySlots')}
              value={loading ? '...' : availability.length}
              hint={t('consultantAvailabilityPage.summaryWeeklySlotsHint')}
            />
            <SummaryCard
              icon={ShieldCheck}
              label={t('consultantAvailabilityPage.summaryBlockedDates')}
              value={loading ? '...' : blockedDates.length}
              hint={t('consultantAvailabilityPage.summaryBlockedDatesHint')}
            />
            <SummaryCard
              icon={MapPinned}
              label={t('consultantAvailabilityPage.nextTimeOff')}
              value={
                loading
                  ? '...'
                  : nextBlockedDate
                    ? new Date(nextBlockedDate.blocked_date).toLocaleDateString(i18n.language, {
                      month: 'short',
                      day: 'numeric',
                    })
                    : t('consultantAvailabilityPage.none')
              }
              hint={t('consultantAvailabilityPage.summaryNextTimeOffHint')}
              accent="text-orange-300"
            />
          </section>

          <div className="mt-6 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
              <SectionPanel
              icon={CalendarClock}
              eyebrow={t('consultantAvailabilityPage.scheduleBuilder')}
              title={t('scheduling.recurringSchedule')}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('consultantAvailabilityPage.controlsHeading')}</p>
                  <p className="mt-1 max-w-xs text-sm leading-6 text-gray-400">
                    {t('consultantAvailabilityPage.controlsBody')}
                  </p>
                </div>
              }
            >
              <p className="mb-5 text-sm leading-6 text-gray-400">
                {t('scheduling.recurringDesc')}
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('scheduling.dayOfWeek')}
                  </label>
                  <select
                    value={newAvailability.dayOfWeek}
                    onChange={(e) => setNewAvailability({ ...newAvailability, dayOfWeek: parseInt(e.target.value, 10) })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-orange-500"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day.value} value={day.value}>{t(day.labelKey)}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      {t('scheduling.startTime')}
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
                      {t('scheduling.endTime')}
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
                <span>{t('scheduling.active')}</span>
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
                  {loading ? t('common.saving') : t('consultantAvailabilityPage.saveAvailability')}
                </button>
              </div>
            </SectionPanel>

            <SectionPanel
              icon={Clock3}
              eyebrow={t('consultantAvailabilityPage.liveWeeklyView')}
              title={t('scheduling.currentSchedule')}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('consultantAvailabilityPage.loadedNow')}</p>
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
                            <h3 className="text-lg font-semibold text-white">{t(day.labelKey)}</h3>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${hasActive ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border border-gray-700 bg-gray-900/70 text-gray-400'}`}>
                          {hasActive ? t('scheduling.active') : t('scheduling.inactive')}
                          </span>
                        </div>

                        {daySlots.length ? (
                          <div className="space-y-2">
                            {daySlots.map((slot) => (
                              <div key={slot.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 px-3 py-2.5">
                            <div className="text-sm font-medium text-white">
                                  {formatTimeRange(slot.start_time, slot.end_time, t, i18n.language)}
                                </div>
                                <div className="mt-1 text-xs text-gray-500">
                                  {slot.is_active
                                    ? t('consultantAvailabilityPage.slotActiveDesc')
                                    : t('consultantAvailabilityPage.slotInactiveDesc')}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/40 px-3 py-5 text-sm text-gray-500">
                            {t('consultantAvailabilityPage.noRecurringHours')}
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
                  <h3 className="text-lg font-semibold text-white">{t('consultantAvailabilityPage.noScheduleSaved')}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    {t('consultantAvailabilityPage.noScheduleSavedBody')}
                  </p>
                </div>
              )}
            </SectionPanel>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_1.35fr]">
            <SectionPanel
              icon={ShieldCheck}
              eyebrow={t('consultantAvailabilityPage.timeOff')}
              title={t('scheduling.blockedDates')}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('consultantAvailabilityPage.useFor')}</p>
                  <p className="mt-1 max-w-xs text-sm leading-6 text-gray-400">
                    {t('consultantAvailabilityPage.useForBody')}
                  </p>
                </div>
              }
            >
              <p className="mb-5 text-sm leading-6 text-gray-400">
                {t('scheduling.blockedDatesDesc')}
              </p>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    {t('scheduling.date')}
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
                    {t('scheduling.reason')}
                  </label>
                  <input
                    type="text"
                    placeholder={t('consultantAvailabilityPage.reasonPlaceholder')}
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
                  {loading ? t('common.saving') : t('scheduling.addBlockedDate')}
                </button>
              </div>
            </SectionPanel>

            <SectionPanel
              icon={CalendarDays}
              eyebrow={t('consultantAvailabilityPage.protectedDates')}
              title={t('scheduling.timeOff')}
              aside={
                <div className="rounded-2xl border border-gray-800 bg-gray-900/75 px-4 py-3 text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">{t('consultantAvailabilityPage.protectedDates')}</p>
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
                            {new Date(blocked.blocked_date).toLocaleDateString(i18n.language, {
                              weekday: 'long',
                              month: 'long',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </div>
                          <div className="mt-1 text-sm text-gray-400">{blocked.reason || t('consultantAvailabilityPage.noReasonAdded')}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveBlockedDate(blocked.id)}
                          disabled={loading}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          {t('common.remove')}
                        </button>
                      </article>
                    ))}
                </div>
              ) : (
                <div className="rounded-[26px] border border-dashed border-gray-700 bg-[#111318] px-5 py-10 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl border border-gray-800 bg-gray-900/80">
                    <ShieldCheck className="h-6 w-6 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white">{t('consultantAvailabilityPage.noBlockedDates')}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">
                    {t('consultantAvailabilityPage.noBlockedDatesBody')}
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
