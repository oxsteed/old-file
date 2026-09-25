// client/src/components/calendar/BusinessCalendarView.jsx
//
// Per-business calendar view used inside the Business Hub. Combines:
//   - business_events (internal events: team meetings, deliveries, etc.)
//   - appointments tied to the business via appointments.business_id
//
// Views: week, agenda. Categories are colour-coded.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, ChevronLeft, ChevronRight, Clock, Eye, Filter, MapPin, Plus, Tag,
  Trash2, Users, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  getBusinessCalendar,
  createBusinessEvent,
  updateBusinessEvent,
  deleteBusinessEvent,
} from '../../api/businesses';
import '../../styles/BusinessCalendarView.css';

const CATEGORIES = [
  { id: 'team_meeting', labelKey: 'teamMeeting', color: '#6366f1' },
  { id: 'delivery', labelKey: 'delivery', color: '#0ea5e9' },
  { id: 'supplier_visit', labelKey: 'supplierVisit', color: '#14b8a6' },
  { id: 'vehicle_maintenance', labelKey: 'vehicleMaintenance', color: '#84cc16' },
  { id: 'training', labelKey: 'training', color: '#f59e0b' },
  { id: 'marketing', labelKey: 'marketing', color: '#ec4899' },
  { id: 'inspection', labelKey: 'inspection', color: '#a855f7' },
  { id: 'site_visit', labelKey: 'siteVisit', color: '#06b6d4' },
  { id: 'admin', labelKey: 'admin', color: '#64748b' },
  { id: 'holiday', labelKey: 'holiday', color: '#ef4444' },
  { id: 'time_off', labelKey: 'timeOff', color: '#f97316' },
  { id: 'other', labelKey: 'other', color: '#9ca3af' },
];

const APPOINTMENT_COLOR = '#f97316';

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday start
  x.setDate(x.getDate() - diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function isSameDay(a, b) { return a.toDateString() === b.toDateString(); }
function formatDay(d, locale) { return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' }); }
function formatTime(d, locale) { return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }); }

function toLocalInput(date) {
  const d = new Date(date);
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 16);
}

function categoryColor(id) {
  const c = CATEGORIES.find((x) => x.id === id);
  return c ? c.color : '#9ca3af';
}

function categoryLabel(category, t) {
  return t(`calendar.business.categories.${category?.labelKey || category?.id || 'other'}`, { defaultValue: category?.labelKey || category?.id || '' });
}

function EventModal({ open, initial, onClose, onSave, onDelete, canManage, t }) {
  const [draft, setDraft] = useState(() => initial);
  useEffect(() => { setDraft(initial); }, [initial]);
  if (!open || !draft) return null;

  const update = (patch) => setDraft({ ...draft, ...patch });

  return (
    <div className="bcv-modal-backdrop" role="dialog" aria-modal="true">
      <div className="bcv-modal">
        <div className="bcv-modal-head">
          <h3>{draft.raw_id ? t('calendar.business.editEvent') : t('calendar.business.newEvent')}</h3>
          <button type="button" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </div>

        <div className="bcv-modal-body">
          <label className="bcv-field">
            <span>{t('calendar.business.title')}</span>
            <input
              autoFocus
              value={draft.title || ''}
              onChange={(e) => update({ title: e.target.value })}
              maxLength={200}
              placeholder={t('calendar.business.titlePlaceholder')}
              disabled={!canManage}
            />
          </label>

          <div className="bcv-grid-2">
            <label className="bcv-field">
              <span>{t('calendar.business.category')}</span>
              <select value={draft.category} onChange={(e) => update({ category: e.target.value })} disabled={!canManage}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
              </select>
            </label>
            <label className="bcv-field">
              <span>{t('calendar.status')}</span>
              <select value={draft.status || 'scheduled'} onChange={(e) => update({ status: e.target.value })} disabled={!canManage}>
                <option value="scheduled">{t('calendar.business.scheduled')}</option>
                <option value="completed">{t('calendar.statusCompleted')}</option>
                <option value="cancelled">{t('calendar.statusCancelled')}</option>
              </select>
            </label>
          </div>

          <div className="bcv-grid-2">
            <label className="bcv-field">
              <span>{t('calendar.startTime')}</span>
              <input
                type="datetime-local"
                value={draft.starts_at ? toLocalInput(draft.starts_at) : ''}
                onChange={(e) => update({ starts_at: new Date(e.target.value).toISOString() })}
                disabled={!canManage}
              />
            </label>
            <label className="bcv-field">
              <span>{t('calendar.endTime')}</span>
              <input
                type="datetime-local"
                value={draft.ends_at ? toLocalInput(draft.ends_at) : ''}
                onChange={(e) => update({ ends_at: new Date(e.target.value).toISOString() })}
                disabled={!canManage}
              />
            </label>
          </div>

          <label className="bcv-field">
            <span>{t('calendar.location')}</span>
            <input
              value={draft.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              placeholder={t('calendar.business.locationPlaceholder')}
              maxLength={255}
              disabled={!canManage}
            />
          </label>

          <label className="bcv-field">
            <span>{t('calendar.business.notesOptional')}</span>
            <textarea
              rows={4}
              value={draft.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              maxLength={4000}
              disabled={!canManage}
            />
          </label>

          <div className="bcv-grid-2">
            <label className="bcv-field">
              <span>{t('calendar.business.reminder')}</span>
              <select
                value={draft.remind_minutes == null ? '' : String(draft.remind_minutes)}
                onChange={(e) => update({ remind_minutes: e.target.value === '' ? null : Number(e.target.value) })}
                disabled={!canManage}
              >
                <option value="">{t('calendar.business.noReminder')}</option>
                <option value="15">{t('calendar.business.minutes', { count: 15 })}</option>
                <option value="30">{t('calendar.business.minutes', { count: 30 })}</option>
                <option value="60">{t('calendar.business.hours', { count: 1 })}</option>
                <option value="240">{t('calendar.business.hours', { count: 4 })}</option>
                <option value="1440">{t('calendar.business.days', { count: 1 })}</option>
              </select>
            </label>
            <label className="bcv-field">
              <span>{t('calendar.recurrence')}</span>
              <select value={draft.recurrence || 'none'} onChange={(e) => update({ recurrence: e.target.value })} disabled={!canManage}>
                <option value="none">{t('calendar.noRecurrence')}</option>
                <option value="daily">{t('calendar.recDaily')}</option>
                <option value="weekly">{t('calendar.recWeekly')}</option>
                <option value="biweekly">{t('calendar.business.biweekly')}</option>
                <option value="monthly">{t('calendar.recMonthly')}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="bcv-modal-foot">
          {canManage && draft.raw_id ? (
            <button type="button" className="bcv-btn danger" onClick={() => onDelete(draft)}>
              <Trash2 size={14} /> {t('common.delete')}
            </button>
          ) : <span />}
          <div className="bcv-modal-actions">
            <button type="button" className="bcv-btn ghost" onClick={onClose}>{t('common.cancel')}</button>
            {canManage && (
              <button type="button" className="bcv-btn primary" onClick={() => onSave(draft)}>
                {draft.raw_id ? t('calendar.business.saveChanges') : t('calendar.business.createEvent')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BusinessCalendarView({ bizId, canManage = true }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [viewMode, setViewMode] = useState('week'); // 'week' | 'agenda'
  const [items, setItems] = useState({ events: [], appointments: [] });
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState(null);

  const weekStart = useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const weekEnd   = useMemo(() => addDays(weekStart, 7), [weekStart]);
  const rangeFrom = useMemo(() => addDays(weekStart, -1), [weekStart]);
  const rangeTo   = useMemo(() => addDays(weekEnd, 7), [weekEnd]);

  const loadCalendar = useCallback(async () => {
    if (!bizId) return;
    setLoading(true);
    try {
      const data = await getBusinessCalendar(bizId, {
        from: rangeFrom.toISOString(),
        to:   rangeTo.toISOString(),
      });
      setItems({
        events: Array.isArray(data?.events) ? data.events : [],
        appointments: Array.isArray(data?.appointments) ? data.appointments : [],
      });
    } catch (err) {
      toast.error(t('calendar.errorLoading'));
      setItems({ events: [], appointments: [] });
    } finally {
      setLoading(false);
    }
  }, [bizId, rangeFrom, rangeTo]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  const allItems = useMemo(() => {
    const merged = [
      ...items.events.map((e) => ({ ...e, _color: e.color || categoryColor(e.category) })),
      ...items.appointments.map((a) => ({ ...a, _color: APPOINTMENT_COLOR })),
    ];
    return merged
      .filter((i) => (categoryFilter === 'all' ? true : i.category === categoryFilter))
      .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
  }, [items, categoryFilter]);

  const weekItems = useMemo(() => allItems.filter((i) => {
    const s = new Date(i.starts_at);
    return s >= weekStart && s < weekEnd;
  }), [allItems, weekStart, weekEnd]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const openNewEvent = (when) => {
    const start = when || new Date(anchorDate);
    start.setHours(start.getHours() + 1, 0, 0, 0);
    const end = new Date(start);
    end.setHours(end.getHours() + 1);
    setModalDraft({
      kind: 'event',
      title: '',
      category: 'team_meeting',
      status: 'scheduled',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      description: '',
      location: '',
      remind_minutes: null,
      recurrence: 'none',
    });
    setModalOpen(true);
  };

  const openExisting = (item) => {
    if (item.kind === 'appointment') {
      // Read-only preview for now
      setModalDraft({ ...item, _readOnly: true });
      setModalOpen(true);
      return;
    }
    setModalDraft({ ...item });
    setModalOpen(true);
  };

  const handleSave = async (draft) => {
    if (!draft.title?.trim()) { toast.error(t('calendar.business.addTitle')); return; }
    if (new Date(draft.ends_at) <= new Date(draft.starts_at)) { toast.error(t('calendar.endAfterStart')); return; }
    try {
      const payload = {
        title: draft.title,
        description: draft.description,
        location: draft.location,
        category: draft.category,
        status: draft.status,
        starts_at: draft.starts_at,
        ends_at: draft.ends_at,
        remind_minutes: draft.remind_minutes,
        recurrence: draft.recurrence,
      };
      if (draft.raw_id) {
        await updateBusinessEvent(bizId, draft.raw_id, payload);
        toast.success(t('calendar.business.eventUpdated'));
      } else {
        await createBusinessEvent(bizId, payload);
        toast.success(t('calendar.business.eventAdded'));
      }
      setModalOpen(false);
      loadCalendar();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || t('calendar.business.saveFailed');
      toast.error(typeof msg === 'string' ? msg : t('calendar.business.saveFailed'));
    }
  };

  const handleDelete = async (draft) => {
    if (!draft.raw_id) { setModalOpen(false); return; }
    try {
      await deleteBusinessEvent(bizId, draft.raw_id);
      toast.success(t('calendar.business.eventRemoved'));
      setModalOpen(false);
      loadCalendar();
    } catch {
      toast.error(t('calendar.business.deleteFailed'));
    }
  };

  const goPrev = () => setAnchorDate(addDays(anchorDate, viewMode === 'agenda' ? -7 : -7));
  const goNext = () => setAnchorDate(addDays(anchorDate, viewMode === 'agenda' ? 7 : 7));
  const goToday = () => setAnchorDate(new Date());

  const visibleCategories = useMemo(() => {
    const set = new Set(items.events.map((e) => e.category));
    return CATEGORIES.filter((c) => set.has(c.id));
  }, [items.events]);

  return (
    <div className="bcv-root">
      <div className="bcv-toolbar">
        <div className="bcv-toolbar-nav">
          <button type="button" className="bcv-btn ghost" onClick={goPrev} aria-label={t('calendar.business.previousWeek')}><ChevronLeft size={16} /></button>
          <button type="button" className="bcv-btn ghost" onClick={goToday}>{t('calendar.today')}</button>
          <button type="button" className="bcv-btn ghost" onClick={goNext} aria-label={t('calendar.business.nextWeek')}><ChevronRight size={16} /></button>
          <span className="bcv-range-label">
            {formatDay(weekStart, locale)} - {formatDay(addDays(weekStart, 6), locale)}
          </span>
        </div>
        <div className="bcv-toolbar-right">
          <div className="bcv-view-switch" role="tablist" aria-label={t('calendar.business.calendarView')}>
            <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>{t('calendar.week')}</button>
            <button type="button" className={viewMode === 'agenda' ? 'active' : ''} onClick={() => setViewMode('agenda')}>{t('calendar.agenda')}</button>
          </div>
          <label className="bcv-filter">
            <Filter size={14} />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={t('calendar.business.filterCategory')}>
              <option value="all">{t('calendar.filterAll')} {t('calendar.business.categoriesWord')}</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{categoryLabel(c, t)}</option>)}
            </select>
          </label>
          {canManage && (
            <button type="button" className="bcv-btn primary" onClick={() => openNewEvent(new Date())}>
              <Plus size={14} /> {t('calendar.business.newEvent')}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bcv-empty">{t('calendar.business.loading')}</div>
      ) : viewMode === 'week' ? (
        <WeekView
          days={days}
          items={weekItems}
          onOpen={openExisting}
          onCreate={canManage ? openNewEvent : null}
          locale={locale}
          t={t}
        />
      ) : (
        <AgendaView items={allItems} onOpen={openExisting} locale={locale} t={t} />
      )}

      {visibleCategories.length > 0 && (
        <div className="bcv-legend" aria-label={t('calendar.business.categoryLegend')}>
          {visibleCategories.map((c) => (
            <span key={c.id}><i style={{ background: c.color }} />{categoryLabel(c, t)}</span>
          ))}
          {items.appointments.length > 0 && (
            <span><i style={{ background: APPOINTMENT_COLOR }} />{t('calendar.business.customerAppointment')}</span>
          )}
        </div>
      )}

      <EventModal
        open={modalOpen}
        initial={modalDraft}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        onDelete={handleDelete}
        canManage={canManage && modalDraft?.kind !== 'appointment'}
        t={t}
      />
    </div>
  );
}

function WeekView({ days, items, onOpen, onCreate, locale, t }) {
  const today = new Date();
  return (
    <div className="bcv-week">
      {days.map((day) => {
        const dayItems = items.filter((i) => isSameDay(new Date(i.starts_at), day));
        const isToday = isSameDay(day, today);
        return (
          <section key={day.toISOString()} className={'bcv-day' + (isToday ? ' today' : '')}>
            <header>
              <strong>{day.toLocaleDateString(locale, { weekday: 'short' })}</strong>
              <span>{day.getDate()}</span>
              {onCreate && (
                <button
                  type="button"
                  className="bcv-day-add"
                  aria-label={t('calendar.business.addEventOn', { date: formatDay(day, locale) })}
                  onClick={() => onCreate(new Date(day))}
                ><Plus size={12} /></button>
              )}
            </header>
            <div className="bcv-day-list">
              {dayItems.length === 0 ? (
                <p className="bcv-day-empty">{t('calendar.business.nothingScheduled')}</p>
              ) : dayItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="bcv-event-chip"
                  style={{ borderLeftColor: i._color }}
                  onClick={() => onOpen(i)}
                >
                  <span className="bcv-event-time">{formatTime(new Date(i.starts_at), locale)}</span>
                  <span className="bcv-event-title">{i.title}</span>
                  {i.location && <span className="bcv-event-loc"><MapPin size={10} /> {i.location}</span>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AgendaView({ items, onOpen, locale, t }) {
  if (items.length === 0) {
    return <div className="bcv-empty">{t('calendar.business.noUpcomingEvents')} <strong>{t('calendar.business.toAddOne')}</strong></div>;
  }
  const grouped = items.reduce((acc, item) => {
    const key = new Date(item.starts_at).toDateString();
    (acc[key] = acc[key] || []).push(item);
    return acc;
  }, {});
  return (
    <div className="bcv-agenda">
      {Object.entries(grouped).map(([dayKey, dayItems]) => (
        <section key={dayKey} className="bcv-agenda-day">
          <header>
            <CalendarDays size={14} />
            {formatDay(new Date(dayKey), locale)}
          </header>
          <ul>
            {dayItems.map((i) => (
              <li key={i.id}>
                <button type="button" className="bcv-agenda-item" onClick={() => onOpen(i)}>
                  <span className="bcv-agenda-dot" style={{ background: i._color }} />
                  <span className="bcv-agenda-time">
                    <Clock size={12} /> {formatTime(new Date(i.starts_at), locale)} - {formatTime(new Date(i.ends_at), locale)}
                  </span>
                  <span className="bcv-agenda-title">{i.title}</span>
                  <span className="bcv-agenda-meta">
                    {i.kind === 'appointment' && i.customer_name ? <><Users size={11} /> {i.customer_name}</> : null}
                    {i.location ? <><MapPin size={11} /> {i.location}</> : null}
                    {i.kind === 'event' ? <><Tag size={11} /> {categoryLabel(CATEGORIES.find((c) => c.id === i.category) || { id: i.category }, t)}</> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
