import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

const SESSION_STATUS_COLORS = {
  pending: '#FFA500',
  scheduled: '#0EA5E9',
  confirmed: '#10B981',
  completed: '#6B7280',
  cancelled: '#EF4444',
  no_show: '#DC2626',
};

const TIME_SLOTS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
  '16:00', '16:30', '17:00',
];

function getWeekDays(weekStart) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(d1, d2) {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function CalendarEvent({ session, onClick }) {
  const color = SESSION_STATUS_COLORS[session.status] || '#6B7280';
  return (
    <div
      onClick={() => onClick(session)}
      title={`${session.first_name} ${session.last_name}: ${session.service_tier}`}
      style={{
        background: color,
        color: 'white',
        borderRadius: '4px',
        padding: '0.2rem 0.4rem',
        fontSize: '0.72rem',
        fontWeight: 600,
        cursor: 'pointer',
        marginBottom: '2px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {session.scheduled_at
        ? `${new Date(session.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} `
        : ''}
      {session.first_name} {session.last_name}
    </div>
  );
}

function ScheduleModal({ session, consultants, onClose, onScheduled }) {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [consultant, setConsultant] = useState('');
  const [saving, setSaving] = useState(false);

  async function doSchedule() {
    if (!selectedDate || !selectedTime) {
      toast.error(t('adminConsultingScheduler.toast.selectDateTime'));
      return;
    }
    try {
      setSaving(true);
      const scheduled_at = new Date(`${selectedDate}T${selectedTime}`).toISOString();
      await axios.patch(`/consulting/admin/requests/${session.id}/status`, {
        status: 'scheduled',
        scheduled_at,
        meeting_url: meetingUrl,
        ...(consultant && { consultant_id: consultant }),
      });
      toast.success(t('adminConsultingScheduler.toast.sessionScheduled'));
      onScheduled();
      onClose();
    } catch {
      toast.error(t('adminConsultingScheduler.toast.scheduleFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function sendCalendarInvite() {
    try {
      await axios.post(`/consulting/admin/sessions/${session.id}/send-invite`);
      toast.success(t('adminConsultingScheduler.toast.inviteSent'));
    } catch {
      toast.error(t('adminConsultingScheduler.toast.inviteFailed'));
    }
  }

  async function decline() {
    if (!window.confirm(t('adminConsultingScheduler.confirm.decline'))) return;
    try {
      await axios.patch(`/consulting/admin/requests/${session.id}/status`, { status: 'cancelled' });
      toast.success(t('adminConsultingScheduler.toast.requestDeclined'));
      onScheduled();
      onClose();
    } catch {
      toast.error(t('adminConsultingScheduler.toast.declineFailed'));
    }
  }

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '540px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.2rem', fontWeight: 700 }}>
              {t('adminConsultingScheduler.scheduleModal.title', { name: `${session.first_name} ${session.last_name}` })}
            </h2>
            <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
              {session.email} · {session.service_tier} · {session.phone || t('adminConsultingScheduler.scheduleModal.noPhone')}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>×</button>
        </div>

        {session.description && (
          <div style={{ background: 'var(--color-bg)', padding: '0.75rem', borderRadius: '6px', marginBottom: '1.25rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            {session.description}
          </div>
        )}

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>{t('adminConsultingScheduler.scheduleModal.selectDate')}</label>
          <input type="date" style={inputStyle} value={selectedDate} onChange={e => setSelectedDate(e.target.value)} min={new Date().toISOString().slice(0, 10)} />
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>{t('adminConsultingScheduler.scheduleModal.selectTime')}</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.35rem' }}>
            {TIME_SLOTS.map(t => (
              <button key={t} onClick={() => setSelectedTime(t)} style={{
                padding: '0.4rem 0',
                borderRadius: '5px',
                border: selectedTime === t ? 'none' : '1px solid var(--color-border)',
                background: selectedTime === t ? 'var(--color-primary)' : 'var(--color-bg)',
                color: selectedTime === t ? 'white' : 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: selectedTime === t ? 600 : 400,
              }}>{t}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={labelStyle}>{t('adminConsultingScheduler.scheduleModal.meetingUrlLabel')}</label>
          <input type="url" placeholder={t('adminConsultingScheduler.scheduleModal.meetingUrlPlaceholder')} style={inputStyle} value={meetingUrl} onChange={e => setMeetingUrl(e.target.value)} />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={labelStyle}>{t('adminConsultingScheduler.scheduleModal.assignConsultant')}</label>
          <select style={inputStyle} value={consultant} onChange={e => setConsultant(e.target.value)}>
            <option value="">{t('adminConsultingScheduler.scheduleModal.selectConsultantPlaceholder')}</option>
            {consultants.map(c => (
              <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role}) - {c.active_sessions || 0} active</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button onClick={doSchedule} disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer', flex: 1 }}>
            {saving ? t('adminConsultingScheduler.scheduleModal.scheduling') : t('adminConsultingScheduler.scheduleModal.confirm')}
          </button>
          <button onClick={sendCalendarInvite} style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer' }}>
            {t('adminConsultingScheduler.scheduleModal.sendInvite')}
          </button>
          <button onClick={decline} style={{ padding: '0.6rem 1rem', borderRadius: '6px', border: '1px solid #EF4444', background: 'none', color: '#EF4444', fontWeight: 600, cursor: 'pointer' }}>
            {t('adminConsultingScheduler.scheduleModal.decline')}
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSessionModal({ consultants, onClose, onCreated }) {
  const { t } = useTranslation();
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', service_tier: 'initial', scheduled_date: '', scheduled_time: '', meeting_url: '', consultant_id: '', description: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.email || !form.scheduled_date || !form.scheduled_time) {
      toast.error(t('adminConsultingScheduler.toast.createRequiredFields'));
      return;
    }
    try {
      setSaving(true);
      const scheduled_at = new Date(`${form.scheduled_date}T${form.scheduled_time}`).toISOString();
      await axios.post('/consulting/admin/sessions/create', { ...form, scheduled_at });
      toast.success(t('adminConsultingScheduler.toast.sessionCreated'));
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminConsultingScheduler.toast.createFailed'));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle = { width: '100%', padding: '0.6rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.9rem', boxSizing: 'border-box' };
  const labelStyle = { display: 'block', fontWeight: 600, marginBottom: '0.35rem', fontSize: '0.85rem' };
  const fieldStyle = { marginBottom: '1rem' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: 'var(--color-surface)', borderRadius: '10px', padding: '2rem', maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 1.5rem', fontSize: '1.3rem', fontWeight: 700 }}>{t('adminConsultingScheduler.newSessionModal.title')}</h2>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.firstName')}</label>
              <input style={inputStyle} value={form.first_name} onChange={e => setForm({ ...form, first_name: e.target.value })} />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.lastName')}</label>
              <input style={inputStyle} value={form.last_name} onChange={e => setForm({ ...form, last_name: e.target.value })} />
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.email')}</label>
            <input type="email" style={inputStyle} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.serviceTier')}</label>
            <select style={inputStyle} value={form.service_tier} onChange={e => setForm({ ...form, service_tier: e.target.value })}>
              <option value="initial">Initial ($100)</option>
              <option value="foundation">Foundation</option>
              <option value="implementation">Implementation</option>
              <option value="transformation">Transformation</option>
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.date')}</label>
              <input type="date" style={inputStyle} value={form.scheduled_date} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} required />
            </div>
            <div style={fieldStyle}>
              <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.time')}</label>
              <select style={inputStyle} value={form.scheduled_time} onChange={e => setForm({ ...form, scheduled_time: e.target.value })} required>
                <option value="">{t('adminConsultingScheduler.newSessionModal.fields.timePlaceholder')}</option>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.meetingUrl')}</label>
            <input type="url" placeholder={t('adminConsultingScheduler.newSessionModal.fields.meetingUrlPlaceholder')} style={inputStyle} value={form.meeting_url} onChange={e => setForm({ ...form, meeting_url: e.target.value })} />
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.assignConsultant')}</label>
            <select style={inputStyle} value={form.consultant_id} onChange={e => setForm({ ...form, consultant_id: e.target.value })}>
              <option value="">{t('adminConsultingScheduler.newSessionModal.fields.unassigned')}</option>
              {consultants.map(c => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.role})</option>)}
            </select>
          </div>
          <div style={fieldStyle}>
            <label style={labelStyle}>{t('adminConsultingScheduler.newSessionModal.fields.notes')}</label>
            <textarea style={{ ...inputStyle, minHeight: '70px', resize: 'vertical', fontFamily: 'inherit' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>{t('adminConsultingScheduler.actions.cancel')}</button>
            <button type="submit" disabled={saving} style={{ padding: '0.6rem 1.25rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? t('adminConsultingScheduler.newSessionModal.actions.creating') : t('adminConsultingScheduler.newSessionModal.actions.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ConsultingScheduler() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [consultants, setConsultants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [selectedSession, setSelectedSession] = useState(null);
  const [showNewSession, setShowNewSession] = useState(false);
  const [view, setView] = useState('week');

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [sesRes, consRes] = await Promise.all([
        axios.get('/consulting/admin/requests?limit=200'),
        axios.get('/consulting/admin/consultants'),
      ]);
      setSessions(sesRes.data.requests || []);
      setConsultants(consRes.data || []);
    } catch {
      toast.error(t('adminConsultingScheduler.toast.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { loadData(); }, [loadData]);

  const weekDays = getWeekDays(weekStart);
  const pendingSessions = sessions.filter(s => s.status === 'pending');
  const scheduledSessions = sessions.filter(s => s.status === 'scheduled' || s.status === 'confirmed');

  const prevWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); };
  const nextWeek = () => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); };
  const today = () => setWeekStart(getMonday(new Date()));

  async function sendReminder(session) {
    try {
      await axios.post(`/consulting/admin/sessions/${session.id}/send-reminder`);
      toast.success(t('adminConsultingScheduler.toast.reminderSent'));
    } catch {
      toast.error(t('adminConsultingScheduler.toast.reminderFailed'));
    }
  }

  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const now = new Date();

  if (loading) {
    return (
      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem', color: 'var(--color-text-muted)' }}>{t('adminConsultingScheduler.loading')}</div>
    );
  }

  return (
    <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '2rem' }}>
      {/* Breadcrumb */}
      <nav style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
        <Link to="/admin" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t('adminConsultingScheduler.breadcrumb.admin')}</Link>
        {' / '}
        <Link to="/admin/consulting" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{t('adminConsultingScheduler.breadcrumb.consulting')}</Link>
        {' / '}
        <span>{t('adminConsultingScheduler.breadcrumb.scheduling')}</span>
      </nav>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.75rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>{t('adminConsultingScheduler.title')}</h1>
        <button onClick={() => setShowNewSession(true)} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: 'none', background: 'var(--color-primary)', color: 'white', fontWeight: 600, cursor: 'pointer' }}>
          {t('adminConsultingScheduler.actions.scheduleSession')}
        </button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {Object.entries(SESSION_STATUS_COLORS).map(([status, color]) => (
          <div key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: color, flexShrink: 0 }} />
            <span style={{ textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
          </div>
        ))}
      </div>

      {/* Calendar Header */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden', marginBottom: '2.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border)', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={prevWeek} style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>← Prev</button>
            <button onClick={today} style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>Today</button>
            <button onClick={nextWeek} style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text)' }}>Next →</button>
          </div>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
            Week of {weekStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </h2>
        </div>

        {/* Calendar Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(7, 1fr)`, minHeight: '200px' }}>
          {weekDays.map((day, i) => {
            const isToday = isSameDay(day, now);
            const daySessions = scheduledSessions.filter(s => {
              if (!s.scheduled_at) return false;
              return isSameDay(new Date(s.scheduled_at), day);
            });
            return (
              <div key={i} style={{ borderRight: i < 6 ? '1px solid var(--color-border)' : 'none', minHeight: '140px' }}>
                <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', background: isToday ? 'var(--color-primary)' : 'var(--color-bg)', color: isToday ? 'white' : 'var(--color-text)' }}>
                  <span>{DAY_NAMES[i]}</span>
                  <span style={{ marginLeft: '0.4rem', opacity: 0.7 }}>{day.getDate()}</span>
                </div>
                <div style={{ padding: '0.4rem 0.4rem' }}>
                  {daySessions.length === 0 ? (
                    <div style={{ fontSize: '0.75rem', color: 'var(--color-border)', textAlign: 'center', paddingTop: '0.5rem' }}>-</div>
                  ) : (
                    daySessions.map(s => (
                      <CalendarEvent key={s.id} session={s} onClick={setSelectedSession} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending Sessions */}
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem' }}>
        Pending Sessions to Schedule ({pendingSessions.length})
      </h2>

      {pendingSessions.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '2.5rem', textAlign: 'center', marginBottom: '2.5rem' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>No pending sessions. All requests have been processed.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.25rem', marginBottom: '2.5rem' }}>
          {pendingSessions.map(session => (
            <div key={session.id} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1rem' }}>{session.first_name} {session.last_name}</div>
                  <div style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{session.email}</div>
                </div>
                <span style={{ background: '#FFA500', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Pending</span>
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                <strong>Tier:</strong> {session.service_tier} &nbsp;|&nbsp; <strong>Phone:</strong> {session.phone || 'N/A'}
              </div>
              <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                <strong>Submitted:</strong> {new Date(session.created_at).toLocaleDateString()}
              </div>
              {session.preferred_date && (
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                  <strong>Preferred:</strong> {new Date(session.preferred_date).toLocaleDateString()} {session.preferred_time_slot ? `at ${session.preferred_time_slot}` : ''}
                </div>
              )}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <button onClick={() => setSelectedSession(session)} style={{ padding: '0.4rem 0.85rem', borderRadius: '6px', border: 'none', background: 'var(--color-primary)', color: 'white', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  Confirm Time
                </button>
                <button onClick={() => sendReminder(session)} style={{ padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                  Send Reminder
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scheduled Sessions Table */}
      <h2 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '1.25rem' }}>
        Scheduled Sessions ({scheduledSessions.length})
      </h2>

      {scheduledSessions.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '10px', padding: '2.5rem', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('adminConsultingScheduler.scheduled.empty')}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--color-surface)', borderRadius: '10px', overflow: 'hidden' }}>
            <thead>
              <tr>
                {['client', 'dateTime', 'tier', 'consultant', 'meeting', 'status', 'reminders', 'actions'].map((key) => (
                  <th key={key} style={{ background: 'var(--color-bg)', padding: '0.85rem 1rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', fontWeight: 600, fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                    {t(`adminConsultingScheduler.scheduled.table.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scheduledSessions.map(s => (
                <tr key={s.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ fontWeight: 600 }}>{s.first_name} {s.last_name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{s.email}</div>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', whiteSpace: 'nowrap', fontSize: '0.9rem' }}>
                    {s.scheduled_at ? new Date(s.scheduled_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('adminConsultingScheduler.scheduled.notSet')}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span style={{ background: '#8B5CF6', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>{s.service_tier}</span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.85rem', color: s.consultant_id ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {s.consultant_name || (s.consultant_id ? t('adminConsultingScheduler.scheduled.assigned') : t('adminConsultingScheduler.scheduled.unassigned'))}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    {s.meeting_url ? (
                      <a href={s.meeting_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', fontSize: '0.85rem', fontWeight: 600, textDecoration: 'none' }}>
                        {t('adminConsultingScheduler.scheduled.join')}
                      </a>
                    ) : <span style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>{t('adminConsultingScheduler.scheduled.noLink')}</span>}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <span style={{ background: SESSION_STATUS_COLORS[s.status] || '#6B7280', color: 'white', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.78rem', fontWeight: 600 }}>
                      {s.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.85rem 1rem', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                    {s.reminder_sent ? t('adminConsultingScheduler.scheduled.reminderSent') : t('adminConsultingScheduler.scheduled.reminderNotSent')}
                  </td>
                  <td style={{ padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <button onClick={() => setSelectedSession(s)} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-primary)', background: 'none', color: 'var(--color-primary)', fontSize: '0.78rem', cursor: 'pointer', fontWeight: 600 }}>
                        {t('adminConsultingScheduler.scheduled.edit')}
                      </button>
                      <button onClick={() => sendReminder(s)} style={{ padding: '0.3rem 0.6rem', borderRadius: '5px', border: '1px solid var(--color-border)', background: 'none', color: 'var(--color-text-muted)', fontSize: '0.78rem', cursor: 'pointer' }}>
                        {t('adminConsultingScheduler.scheduled.remind')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedSession && (
        <ScheduleModal
          session={selectedSession}
          consultants={consultants}
          onClose={() => setSelectedSession(null)}
          onScheduled={loadData}
        />
      )}

      {showNewSession && (
        <NewSessionModal
          consultants={consultants}
          onClose={() => setShowNewSession(false)}
          onCreated={loadData}
        />
      )}
    </div>
  );
}
