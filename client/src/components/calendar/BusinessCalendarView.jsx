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
import {
  getBusinessCalendar,
  createBusinessEvent,
  updateBusinessEvent,
  deleteBusinessEvent,
} from '../../api/businesses';
import '../../styles/BusinessCalendarView.css';

const CATEGORIES = [
  { id: 'team_meeting',         label: 'Team meeting',        color: '#6366f1' },
  { id: 'delivery',             label: 'Delivery',            color: '#0ea5e9' },
  { id: 'supplier_visit',       label: 'Supplier visit',      color: '#14b8a6' },
  { id: 'vehicle_maintenance',  label: 'Vehicle maintenance', color: '#84cc16' },
  { id: 'training',             label: 'Training',            color: '#f59e0b' },
  { id: 'marketing',            label: 'Marketing',           color: '#ec4899' },
  { id: 'inspection',           label: 'Inspection',          color: '#a855f7' },
  { id: 'site_visit',           label: 'Site visit',          color: '#06b6d4' },
  { id: 'admin',                label: 'Admin / paperwork',   color: '#64748b' },
  { id: 'holiday',              label: 'Holiday',             color: '#ef4444' },
  { id: 'time_off',             label: 'Time off',            color: '#f97316' },
  { id: 'other',                label: 'Other',               color: '#9ca3af' },
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
function formatDay(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
function formatTime(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

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

function EventModal({ open, initial, onClose, onSave, onDelete, canManage }) {
  const [draft, setDraft] = useState(() => initial);
  useEffect(() => { setDraft(initial); }, [initial]);
  if (!open || !draft) return null;

  const update = (patch) => setDraft({ ...draft, ...patch });

  return (
    <div className="bcv-modal-backdrop" role="dialog" aria-modal="true">
      <div className="bcv-modal">
        <div className="bcv-modal-head">
          <h3>{draft.raw_id ? 'Edit event' : 'New event'}</h3>
          <button type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="bcv-modal-body">
          <label className="bcv-field">
            <span>Title</span>
            <input
              autoFocus
              value={draft.title || ''}
              onChange={(e) => update({ title: e.target.value })}
              maxLength={200}
              placeholder="Team huddle, Supplies pickup, Quarterly review"
              disabled={!canManage}
            />
          </label>

          <div className="bcv-grid-2">
            <label className="bcv-field">
              <span>Category</span>
              <select value={draft.category} onChange={(e) => update({ category: e.target.value })} disabled={!canManage}>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="bcv-field">
              <span>Status</span>
              <select value={draft.status || 'scheduled'} onChange={(e) => update({ status: e.target.value })} disabled={!canManage}>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>
          </div>

          <div className="bcv-grid-2">
            <label className="bcv-field">
              <span>Starts</span>
              <input
                type="datetime-local"
                value={draft.starts_at ? toLocalInput(draft.starts_at) : ''}
                onChange={(e) => update({ starts_at: new Date(e.target.value).toISOString() })}
                disabled={!canManage}
              />
            </label>
            <label className="bcv-field">
              <span>Ends</span>
              <input
                type="datetime-local"
                value={draft.ends_at ? toLocalInput(draft.ends_at) : ''}
                onChange={(e) => update({ ends_at: new Date(e.target.value).toISOString() })}
                disabled={!canManage}
              />
            </label>
          </div>

          <label className="bcv-field">
            <span>Location</span>
            <input
              value={draft.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              placeholder="Office, 123 Main St, Zoom, etc."
              maxLength={255}
              disabled={!canManage}
            />
          </label>

          <label className="bcv-field">
            <span>Notes (optional)</span>
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
              <span>Reminder (minutes before)</span>
              <select
                value={draft.remind_minutes == null ? '' : String(draft.remind_minutes)}
                onChange={(e) => update({ remind_minutes: e.target.value === '' ? null : Number(e.target.value) })}
                disabled={!canManage}
              >
                <option value="">No reminder</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="240">4 hours</option>
                <option value="1440">1 day</option>
              </select>
            </label>
            <label className="bcv-field">
              <span>Repeat</span>
              <select value={draft.recurrence || 'none'} onChange={(e) => update({ recurrence: e.target.value })} disabled={!canManage}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
        </div>

        <div className="bcv-modal-foot">
          {canManage && draft.raw_id ? (
            <button type="button" className="bcv-btn danger" onClick={() => onDelete(draft)}>
              <Trash2 size={14} /> Delete
            </button>
          ) : <span />}
          <div className="bcv-modal-actions">
            <button type="button" className="bcv-btn ghost" onClick={onClose}>Cancel</button>
            {canManage && (
              <button type="button" className="bcv-btn primary" onClick={() => onSave(draft)}>
                {draft.raw_id ? 'Save changes' : 'Create event'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BusinessCalendarView({ bizId, canManage = true }) {
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
      toast.error('Could not load calendar');
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
    if (!draft.title?.trim()) { toast.error('Add a title'); return; }
    if (new Date(draft.ends_at) <= new Date(draft.starts_at)) { toast.error('End must be after start'); return; }
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
        toast.success('Event updated');
      } else {
        await createBusinessEvent(bizId, payload);
        toast.success('Event added to the calendar');
      }
      setModalOpen(false);
      loadCalendar();
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.error || 'Save failed';
      toast.error(typeof msg === 'string' ? msg : 'Save failed');
    }
  };

  const handleDelete = async (draft) => {
    if (!draft.raw_id) { setModalOpen(false); return; }
    try {
      await deleteBusinessEvent(bizId, draft.raw_id);
      toast.success('Event removed');
      setModalOpen(false);
      loadCalendar();
    } catch {
      toast.error('Could not delete event');
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
          <button type="button" className="bcv-btn ghost" onClick={goPrev} aria-label="Previous week"><ChevronLeft size={16} /></button>
          <button type="button" className="bcv-btn ghost" onClick={goToday}>Today</button>
          <button type="button" className="bcv-btn ghost" onClick={goNext} aria-label="Next week"><ChevronRight size={16} /></button>
          <span className="bcv-range-label">
            {formatDay(weekStart)} - {formatDay(addDays(weekStart, 6))}
          </span>
        </div>
        <div className="bcv-toolbar-right">
          <div className="bcv-view-switch" role="tablist" aria-label="Calendar view">
            <button type="button" className={viewMode === 'week' ? 'active' : ''} onClick={() => setViewMode('week')}>Week</button>
            <button type="button" className={viewMode === 'agenda' ? 'active' : ''} onClick={() => setViewMode('agenda')}>Agenda</button>
          </div>
          <label className="bcv-filter">
            <Filter size={14} />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Filter category">
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {canManage && (
            <button type="button" className="bcv-btn primary" onClick={() => openNewEvent(new Date())}>
              <Plus size={14} /> New event
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="bcv-empty">Loading calendar...</div>
      ) : viewMode === 'week' ? (
        <WeekView
          days={days}
          items={weekItems}
          onOpen={openExisting}
          onCreate={canManage ? openNewEvent : null}
        />
      ) : (
        <AgendaView items={allItems} onOpen={openExisting} />
      )}

      {visibleCategories.length > 0 && (
        <div className="bcv-legend" aria-label="Category legend">
          {visibleCategories.map((c) => (
            <span key={c.id}><i style={{ background: c.color }} />{c.label}</span>
          ))}
          {items.appointments.length > 0 && (
            <span><i style={{ background: APPOINTMENT_COLOR }} />Customer appointment</span>
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
      />
    </div>
  );
}

function WeekView({ days, items, onOpen, onCreate }) {
  const today = new Date();
  return (
    <div className="bcv-week">
      {days.map((day) => {
        const dayItems = items.filter((i) => isSameDay(new Date(i.starts_at), day));
        const isToday = isSameDay(day, today);
        return (
          <section key={day.toISOString()} className={'bcv-day' + (isToday ? ' today' : '')}>
            <header>
              <strong>{day.toLocaleDateString(undefined, { weekday: 'short' })}</strong>
              <span>{day.getDate()}</span>
              {onCreate && (
                <button
                  type="button"
                  className="bcv-day-add"
                  aria-label={`Add event on ${formatDay(day)}`}
                  onClick={() => onCreate(new Date(day))}
                ><Plus size={12} /></button>
              )}
            </header>
            <div className="bcv-day-list">
              {dayItems.length === 0 ? (
                <p className="bcv-day-empty">Nothing scheduled</p>
              ) : dayItems.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="bcv-event-chip"
                  style={{ borderLeftColor: i._color }}
                  onClick={() => onOpen(i)}
                >
                  <span className="bcv-event-time">{formatTime(new Date(i.starts_at))}</span>
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

function AgendaView({ items, onOpen }) {
  if (items.length === 0) {
    return <div className="bcv-empty">No upcoming events. Use <strong>New event</strong> to add one.</div>;
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
            {formatDay(new Date(dayKey))}
          </header>
          <ul>
            {dayItems.map((i) => (
              <li key={i.id}>
                <button type="button" className="bcv-agenda-item" onClick={() => onOpen(i)}>
                  <span className="bcv-agenda-dot" style={{ background: i._color }} />
                  <span className="bcv-agenda-time">
                    <Clock size={12} /> {formatTime(new Date(i.starts_at))} - {formatTime(new Date(i.ends_at))}
                  </span>
                  <span className="bcv-agenda-title">{i.title}</span>
                  <span className="bcv-agenda-meta">
                    {i.kind === 'appointment' && i.customer_name ? <><Users size={11} /> {i.customer_name}</> : null}
                    {i.location ? <><MapPin size={11} /> {i.location}</> : null}
                    {i.kind === 'event' ? <><Tag size={11} /> {(CATEGORIES.find((c) => c.id === i.category)?.label) || i.category}</> : null}
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
