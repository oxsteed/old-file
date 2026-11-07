// Availability editor — Phase 3 Track C. The employee's weekly
// availability (day-of-week windows, wall-clock start/end) backed by
// the existing list/replace availability endpoints. The server caps
// the list at 42 windows and rejects duplicates and inverted ranges;
// those errors surface here. Saving re-reads the list from the server
// (round-trip read-back), so what is shown after a save is what the
// server stored, not optimistic local state. Availability is
// day-of-week plus wall-clock only: no timezone is assumed, and
// nothing here checks it against published shifts yet (that is
// Phase 4 conflict validation).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import { apiErrorMessage } from './foodShared';

const MAX_WINDOWS = 42;

// 2026-11-01 is a Sunday, so day d (0-6) names the weekday in the
// viewer's locale through Intl instead of a hardcoded list.
function dayName(day, locale) {
  const d = new Date(2026, 10, 1 + day);
  return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d);
}

function toInputTime(value) {
  return String(value || '').slice(0, 5);
}

function windowsFromServer(rows) {
  const days = Array.from({ length: 7 }, () => []);
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = Number(row.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    days[day].push({ start: toInputTime(row.start_time), end: toInputTime(row.end_time) });
  }
  return days;
}

export default function RestaurantAvailabilityPanel({ restaurant }) {
  const { t, i18n } = useTranslation();
  const businessId = restaurant?.business_id;
  const base = `/businesses/${businessId}/staff`;
  const [days, setDays] = useState(() => Array.from({ length: 7 }, () => []));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const idRef = useRef(0);
  const nextId = () => { idRef.current += 1; return idRef.current; };

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`${base}/availability`);
      const rows = Array.isArray(res.data?.windows) ? res.data.windows : [];
      setDays(windowsFromServer(rows).map((list) => list.map((w) => ({ ...w, id: nextId() }))));
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.shared.loadError')));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const total = days.reduce((sum, list) => sum + list.length, 0);

  const addWindow = (day) => {
    if (total >= MAX_WINDOWS) return;
    setDays((prev) => prev.map((list, index) => (
      index === day ? [...list, { id: nextId(), start: '09:00', end: '17:00' }] : list
    )));
    setNotice('');
  };

  const removeWindow = (day, id) => {
    setDays((prev) => prev.map((list, index) => (
      index === day ? list.filter((w) => w.id !== id) : list
    )));
    setNotice('');
  };

  const changeWindow = (day, id, field, value) => {
    setDays((prev) => prev.map((list, index) => (
      index === day
        ? list.map((w) => (w.id === id ? { ...w, [field]: value } : w))
        : list
    )));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const windows = days.flatMap((list, day) => list.map((w) => ({
        day_of_week: day,
        start_time: w.start,
        end_time: w.end,
      })));
      await api.put(`${base}/availability`, { windows });
      // Round-trip read-back: show what the server stored.
      const res = await api.get(`${base}/availability`);
      const rows = Array.isArray(res.data?.windows) ? res.data.windows : [];
      setDays(windowsFromServer(rows).map((list) => list.map((w) => ({ ...w, id: nextId() }))));
      setNotice(t('food.employeePortal.availability.saved'));
    } catch (err) {
      setError(apiErrorMessage(err, t('food.employeePortal.availability.saveError')));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="ep-panel">
        <p className="ep-empty">{t('food.common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="ep-panel">
      <p className="ep-note">{t('food.employeePortal.availability.intro')}</p>
      {error && <p className="ep-empty" role="alert">{error}</p>}
      <form onSubmit={save} className="ep-form">
        {days.map((list, day) => (
          <section className="ep-section" key={day} aria-label={dayName(day, i18n.language)}>
            <h2>{dayName(day, i18n.language)}</h2>
            {list.length === 0 ? (
              <p className="ep-empty">{t('food.employeePortal.availability.noWindows')}</p>
            ) : (
              list.map((w) => (
                <div className="ep-window-row" key={w.id}>
                  <label className="ep-field">
                    <span>{t('food.employeePortal.availability.start')}</span>
                    <input
                      type="time"
                      value={w.start}
                      onChange={(event) => changeWindow(day, w.id, 'start', event.target.value)}
                      required
                    />
                  </label>
                  <label className="ep-field">
                    <span>{t('food.employeePortal.availability.end')}</span>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(event) => changeWindow(day, w.id, 'end', event.target.value)}
                      required
                    />
                  </label>
                  <button
                    type="button"
                    className="fd-btn fd-btn-secondary"
                    onClick={() => removeWindow(day, w.id)}
                  >
                    {t('food.employeePortal.availability.remove')}
                  </button>
                </div>
              ))
            )}
            <div>
              <button
                type="button"
                className="fd-btn fd-btn-secondary"
                onClick={() => addWindow(day)}
                disabled={total >= MAX_WINDOWS}
              >
                {t('food.employeePortal.availability.addWindow')}
              </button>
            </div>
          </section>
        ))}
        {total >= MAX_WINDOWS && (
          <p className="ep-note">{t('food.employeePortal.availability.maxReached')}</p>
        )}
        <div>
          <button type="submit" className="fd-btn" disabled={saving}>
            {t('food.employeePortal.availability.save')}
          </button>
        </div>
      </form>
      {notice && <p className="ep-notice" role="status">{notice}</p>}
      <p className="ep-note">{t('food.employeePortal.availability.notCheckedNote')}</p>
    </div>
  );
}
