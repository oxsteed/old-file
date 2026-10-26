// S-04 / N-02 / F-22: restaurant staff time clock on the "My shift" tab.
// Clock in / out, breaks, my recent punches, my published shifts and
// time-off requests, all on the business staff API (the same records
// payroll and the manager scheduler use). Work dates are business-local
// (computed by the server).
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import { apiErrorMessage } from './foodShared';

const TIME_OFF_TYPES = ['vacation', 'sick', 'personal', 'unpaid', 'other'];

function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default function RestaurantTimeClockCard({ restaurant }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const businessId = restaurant?.business_id;
  const base = `/businesses/${businessId}/staff`;
  const [entries, setEntries] = useState([]);
  const [open, setOpen] = useState(null);
  const [shifts, setShifts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(false);
  const [timeOff, setTimeOff] = useState({ request_type: 'vacation', start_date: todayIso(), end_date: todayIso(), reason: '' });

  const fmt = useCallback((value, opts) => {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(i18n.language, opts).format(d);
  }, [i18n.language]);
  const fmtTime = (v) => fmt(v, { hour: 'numeric', minute: '2-digit' });
  const fmtDay = (v) => fmt(v.length === 10 ? `${v}T12:00:00` : v, { weekday: 'short', month: 'short', day: 'numeric' });

  const load = useCallback(async () => {
    if (!businessId) return;
    try {
      const [mine, shiftRes, offRes] = await Promise.all([
        api.get(`${base}/time-entries/mine`),
        api.get(`${base}/shifts`, { params: { user_id: user?.id, from: todayIso() } }),
        api.get(`${base}/time-off`),
      ]);
      setEntries(Array.isArray(mine.data?.entries) ? mine.data.entries : []);
      setOpen(mine.data?.open_entry || null);
      const shiftRows = Array.isArray(shiftRes.data) ? shiftRes.data : (shiftRes.data?.shifts || []);
      setShifts(shiftRows.filter((s) => !user?.id || String(s.user_id) === String(user.id)).slice(0, 10));
      const offRows = Array.isArray(offRes.data) ? offRes.data : (offRes.data?.requests || []);
      setRequests(offRows.filter((r) => !user?.id || String(r.user_id) === String(user.id)).slice(0, 10));
    } catch {
      /* the card stays usable; actions report their own errors */
    }
  }, [base, businessId, user?.id]);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, okKey) => {
    setBusy(true);
    try {
      await fn();
      toast.success(t(okKey));
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, t('food.timeClock.actionError')));
    } finally {
      setBusy(false);
    }
  };

  const onBreak = open && Array.isArray(open.breaks) && open.breaks.some((b) => b && !b.ended_at);

  const submitTimeOff = (e) => {
    e.preventDefault();
    if (!timeOff.start_date || !timeOff.end_date || timeOff.end_date < timeOff.start_date) {
      toast.error(t('food.timeClock.timeOffInvalid'));
      return;
    }
    act(() => api.post(`${base}/time-off`, { ...timeOff, restaurant_id: restaurant.id }), 'food.timeClock.timeOffSent')
      .then(() => setTimeOff((f) => ({ ...f, reason: '' })));
  };

  if (!businessId) return null;

  return (
    <section className="fd-card fd-myshift-section" aria-label={t('food.timeClock.title')}>
      <h3>{t('food.timeClock.title')}</h3>
      <p className="fd-card-meta" role="status" aria-live="polite">
        {open
          ? (onBreak ? t('food.timeClock.onBreakSince', { time: fmtTime(open.breaks.find((b) => !b.ended_at).started_at) })
            : t('food.timeClock.clockedInSince', { time: fmtTime(open.clock_in_at) }))
          : t('food.timeClock.clockedOut')}
      </p>
      <div className="fd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!open && (
          <button type="button" className="fd-btn" disabled={busy}
            onClick={() => act(() => api.post(`${base}/clock-in`, { source: 'web' }), 'food.timeClock.clockedInOk')}
            data-track="restaurant_time_clock_in">
            {t('food.timeClock.clockIn')}
          </button>
        )}
        {open && !onBreak && (
          <button type="button" className="fd-btn fd-btn-secondary" disabled={busy}
            onClick={() => act(() => api.post(`${base}/time-entries/${open.id}/break`, { action: 'start' }), 'food.timeClock.breakStarted')}
            data-track="restaurant_time_break_start">
            {t('food.timeClock.startBreak')}
          </button>
        )}
        {open && onBreak && (
          <button type="button" className="fd-btn fd-btn-secondary" disabled={busy}
            onClick={() => act(() => api.post(`${base}/time-entries/${open.id}/break`, { action: 'end' }), 'food.timeClock.breakEnded')}
            data-track="restaurant_time_break_end">
            {t('food.timeClock.endBreak')}
          </button>
        )}
        {open && (
          <button type="button" className="fd-btn" disabled={busy || onBreak}
            onClick={() => act(() => api.post(`${base}/clock-out/${open.id}`, {}), 'food.timeClock.clockedOutOk')}
            data-track="restaurant_time_clock_out">
            {t('food.timeClock.clockOut')}
          </button>
        )}
      </div>

      <h4>{t('food.timeClock.myShifts')}</h4>
      {shifts.length === 0 ? <p className="fd-card-meta">{t('food.timeClock.noShifts')}</p> : (
        <ul className="fd-list">
          {shifts.map((s) => (
            <li key={s.id}>{fmtDay(String(s.shift_date).slice(0, 10))} · <bdi dir="ltr">{String(s.start_time || '').slice(0, 5)}–{String(s.end_time || '').slice(0, 5)}</bdi>{s.role ? ` · ${s.role}` : ''}</li>
          ))}
        </ul>
      )}

      <h4>{t('food.timeClock.recentPunches')}</h4>
      {entries.length === 0 ? <p className="fd-card-meta">{t('food.timeClock.noPunches')}</p> : (
        <ul className="fd-list">
          {entries.slice(0, 10).map((e) => (
            <li key={e.id}>
              {fmtDay(String(e.entry_date).slice(0, 10))} · <bdi dir="ltr">{fmtTime(e.clock_in_at)}–{e.clock_out_at ? fmtTime(e.clock_out_at) : '…'}</bdi>
              {e.hours != null && ` · ${t('food.timeClock.hours', { hours: Number(e.hours).toFixed(2) })}`}
            </li>
          ))}
        </ul>
      )}

      <h4>{t('food.timeClock.timeOff')}</h4>
      <form onSubmit={submitTimeOff} className="fd-ops-form" data-track="ui.e15af3906a.1">
        <div className="fd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <div className="fd-field">
            <label htmlFor="tc-off-type">{t('food.timeClock.timeOffType')}</label>
            <select id="tc-off-type" value={timeOff.request_type} onChange={(e) => setTimeOff((f) => ({ ...f, request_type: e.target.value }))}>
              {TIME_OFF_TYPES.map((type) => <option key={type} value={type}>{t(`food.timeClock.timeOffTypes.${type}`)}</option>)}
            </select>
          </div>
          <div className="fd-field">
            <label htmlFor="tc-off-start">{t('food.timeClock.from')}</label>
            <input id="tc-off-start" type="date" value={timeOff.start_date} onChange={(e) => setTimeOff((f) => ({ ...f, start_date: e.target.value }))} required />
          </div>
          <div className="fd-field">
            <label htmlFor="tc-off-end">{t('food.timeClock.to')}</label>
            <input id="tc-off-end" type="date" value={timeOff.end_date} onChange={(e) => setTimeOff((f) => ({ ...f, end_date: e.target.value }))} required />
          </div>
        </div>
        <div className="fd-field">
          <label htmlFor="tc-off-reason">{t('food.timeClock.reason')}</label>
          <input id="tc-off-reason" value={timeOff.reason} maxLength={2000} onChange={(e) => setTimeOff((f) => ({ ...f, reason: e.target.value }))} />
        </div>
        <button type="submit" className="fd-btn fd-btn-secondary" disabled={busy} data-track="restaurant_time_off_request">
          {t('food.timeClock.requestTimeOff')}
        </button>
      </form>
      {requests.length > 0 && (
        <ul className="fd-list" aria-label={t('food.timeClock.myRequests')}>
          {requests.map((r) => (
            <li key={r.id}>
              {t(`food.timeClock.timeOffTypes.${r.request_type}`, r.request_type)} · {fmtDay(String(r.start_date).slice(0, 10))}–{fmtDay(String(r.end_date).slice(0, 10))} · {t(`food.timeClock.status.${r.status}`, r.status)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
