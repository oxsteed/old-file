import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { connectCalendar, disconnectCalendar, getCalendarConnections, getInterviewAvailability, saveInterviewAvailability } from '../../../api/careers';
import { ActionButton, Field, Loading, LoadError, Notice, useCareerErrors, useLoad } from '../ui';
import { availabilityErrors, minutesToTime, timeToMinutes } from '../../../features/careers/marketplaceModel';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Interviewer's weekly availability and Google/Outlook free-busy connections. */
export default function SchedulingPanel({ ctx }) {
  const { t } = useTranslation();
  const errorText = useCareerErrors();
  const avail = useLoad(() => getInterviewAvailability(ctx), [ctx.employerType, ctx.businessId]);
  const calendars = useLoad(() => getCalendarConnections(), []);
  const [timezone, setTimezone] = useState('');
  const [windows, setWindows] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  useEffect(() => {
    if (!avail.data) return;
    setTimezone(avail.data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    setWindows(avail.data.windows || []);
  }, [avail.data]);
  const setRow = (i, patch) => setWindows((list) => list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const save = async () => {
    const errs = availabilityErrors(windows);
    setRowErrors(errs);
    if (Object.keys(errs).length) return;
    try { avail.setData(await saveInterviewAvailability(ctx, { timezone, windows })); toast.success(t('careers.mk.scheduling.saved')); } catch (err) { toast.error(errorText(err)); }
  };
  const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const calendarResult = params.get('calendar');

  if (avail.loading && !avail.data) return <Loading />;
  return (
    <div className="ox-careers-grid">
      <LoadError error={avail.error} onRetry={avail.reload} />
      <section className="ox-careers-section">
        <h3>{t('careers.mk.scheduling.availabilityTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.scheduling.availabilityHint')}</p>
        <Field label={t('careers.mk.scheduling.timezone')} htmlFor="avail-tz">
          <input id="avail-tz" dir="ltr" value={timezone} onChange={(e) => setTimezone(e.target.value)} list="avail-tz-list" />
        </Field>
        <datalist id="avail-tz-list">
          {(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []).map((z) => <option key={z} value={z} />)}
        </datalist>
        {windows.map((w, i) => (
          <div key={i} className="ox-careers-row ox-careers-app">
            <select aria-label={t('careers.mk.scheduling.day')} value={w.weekday} onChange={(e) => setRow(i, { weekday: Number(e.target.value) })}>
              {DAYS.map((d, n) => <option key={d} value={n}>{t(`careers.weekday.${d}`)}</option>)}
            </select>
            <input type="time" aria-label={t('careers.mk.scheduling.from')} value={minutesToTime(w.start_minute)} onChange={(e) => setRow(i, { start_minute: timeToMinutes(e.target.value) })} />
            <input type="time" aria-label={t('careers.mk.scheduling.to')} value={minutesToTime(w.end_minute)} onChange={(e) => setRow(i, { end_minute: timeToMinutes(e.target.value) })} />
            <button type="button" className="ox-careers-btn" onClick={() => setWindows((list) => list.filter((_, j) => j !== i))}>{t('careers.mk.scheduling.remove')}</button>
            {rowErrors[i] ? <p className="ox-careers-error" role="alert">{t(`careers.mk.scheduling.rowError.${rowErrors[i]}`)}</p> : null}
          </div>
        ))}
        <div className="ox-careers-actions">
          <button type="button" className="ox-careers-btn" onClick={() => setWindows((list) => [...list, { weekday: 1, start_minute: 540, end_minute: 1020 }])}>{t('careers.mk.scheduling.addWindow')}</button>
          <button type="button" className="ox-careers-btn" onClick={() => setWindows([1, 2, 3, 4, 5].map((d) => ({ weekday: d, start_minute: 540, end_minute: 1020 })))}>{t('careers.mk.scheduling.weekdays')}</button>
          <button type="button" className="ox-careers-btn primary" onClick={save}>{t('careers.mk.common.save')}</button>
        </div>
      </section>
      <section className="ox-careers-section">
        <h3>{t('careers.mk.scheduling.calendarsTitle')}</h3>
        <p className="ox-careers-subtle">{t('careers.mk.scheduling.calendarsHint')}</p>
        {calendarResult === 'connected' ? <Notice tone="success">{t('careers.mk.scheduling.connected')}</Notice> : null}
        {calendarResult === 'error' ? <Notice tone="error">{t('careers.mk.scheduling.connectFailed')}</Notice> : null}
        <LoadError error={calendars.error} onRetry={calendars.reload} />
        {(calendars.data || []).map((c) => (
          <div key={c.provider} className="ox-careers-row ox-careers-app">
            <strong>{t(`careers.mk.scheduling.provider.${c.provider}`)}</strong>
            {c.connected ? <span className="ox-careers-chip ok">{t('careers.mk.scheduling.isConnected')}</span> : null}
            {c.needs_reconnect ? <span className="ox-careers-chip warn">{t('careers.mk.scheduling.reconnect')}</span> : null}
            {!c.available ? <span className="ox-careers-subtle">{t('careers.mk.scheduling.notConfigured')}</span> : null}
            {c.available && (!c.connected || c.needs_reconnect) ? (
              <ActionButton primary onClick={async () => {
                const r = await connectCalendar(c.provider, `${window.location.pathname}${window.location.search}`);
                if (r?.url) window.location.assign(r.url);
              }}
              >{t('careers.mk.scheduling.connect')}</ActionButton>
            ) : null}
            {c.connected ? <ActionButton onClick={async () => { await disconnectCalendar(c.provider); calendars.reload(); }}>{t('careers.mk.scheduling.disconnect')}</ActionButton> : null}
          </div>
        ))}
        <p className="ox-careers-subtle">{t('careers.mk.scheduling.icsFallback')}</p>
      </section>
    </div>
  );
}
