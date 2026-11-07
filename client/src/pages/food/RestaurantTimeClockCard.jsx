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

// datetime-local value (local wall clock) from an ISO instant.
function toLocalInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  // Phase 4 Track B: the employee's own PTO balances, shown next to
  // the request form for the selected type.
  const [balances, setBalances] = useState([]);
  // Phase 2: optional staff PIN (only used where the store requires
  // one) and the employee punch-correction flow.
  const [staffPin, setStaffPin] = useState('');
  const [myCorrections, setMyCorrections] = useState([]);
  const [correctionFor, setCorrectionFor] = useState(null);
  const [correctionForm, setCorrectionForm] = useState({ clock_in_at: '', clock_out_at: '', reason: '' });

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
      const [mine, shiftRes, offRes, corrRes, balRes] = await Promise.all([
        api.get(`${base}/time-entries/mine`),
        api.get(`${base}/shifts`, { params: { user_id: user?.id, from: todayIso() } }),
        api.get(`${base}/time-off`),
        api.get(`${base}/time-entry-corrections/mine`).catch(() => ({ data: [] })),
        api.get(`${base}/time-off/balances`).catch(() => ({ data: { balances: [] } })),
      ]);
      setBalances(Array.isArray(balRes.data?.balances) ? balRes.data.balances : []);
      setEntries(Array.isArray(mine.data?.entries) ? mine.data.entries : []);
      setOpen(mine.data?.open_entry || null);
      const shiftRows = Array.isArray(shiftRes.data) ? shiftRes.data : (shiftRes.data?.shifts || []);
      setShifts(shiftRows.filter((s) => !user?.id || String(s.user_id) === String(user.id)).slice(0, 10));
      const offRows = Array.isArray(offRes.data) ? offRes.data : (offRes.data?.requests || []);
      setRequests(offRows.filter((r) => !user?.id || String(r.user_id) === String(user.id)).slice(0, 10));
      setMyCorrections(Array.isArray(corrRes.data) ? corrRes.data : []);
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

  // Phase 7 (gap 17) + item 63: meal-break attestation at clock-out.
  // On a qualifying shift the server blocks clock-out (409
  // break_attestation_required) until the worker attests or waives with
  // a reason; the prompt then reopens and Skip is hidden, because
  // skipping would just 409 again. It only shows for shifts long
  // enough that a meal break could be required (the jurisdiction
  // decides the exact threshold).
  const [attestPrompt, setAttestPrompt] = useState(false);
  const [attestRequired, setAttestRequired] = useState(false);
  const [attestWaiver, setAttestWaiver] = useState(false);
  const [attestWaiverReason, setAttestWaiverReason] = useState('');
  const openHours = open?.clock_in_at
    ? (Date.now() - new Date(open.clock_in_at).getTime()) / 3600000
    : 0;

  const clockOut = async (breakAttestation) => {
    setBusy(true);
    try {
      const res = await api.post(`${base}/clock-out/${open.id}`, breakAttestation ? { breakAttestation } : {});
      toast.success(t('food.timeClock.clockedOutOk'));
      const data = res.data || {};
      if (Number(data.meal_break_premium_hours) > 0) {
        toast(t('food.timeClock.attestationPremium'), { icon: 'ℹ️' });
      }
      if (data.break_attestation_disputed) {
        toast(t('food.timeClock.attestationDisputed'), { icon: '⚠️' });
      }
      setAttestPrompt(false);
      setAttestRequired(false);
      setAttestWaiver(false);
      setAttestWaiverReason('');
      await load();
    } catch (err) {
      // Item 63: the server blocks a qualifying clock-out with 409
      // until the worker attests or waives. Reopen the prompt (hiding
      // Skip) so the worker can answer and resubmit instead of seeing
      // a generic failure.
      if (err?.response?.status === 409
        && (err?.response?.data?.code === 'break_attestation_required'
          || err?.response?.data?.error === 'break_attestation_required')) {
        setAttestPrompt(true);
        setAttestRequired(true);
        toast.error(t('food.timeClock.attestationRequired'));
      } else {
        toast.error(apiErrorMessage(err, t('food.timeClock.actionError')));
      }
    } finally {
      setBusy(false);
    }
  };

  const onClockOutClick = () => {
    if (openHours >= 4 && !attestPrompt) {
      setAttestPrompt(true);
      return;
    }
    clockOut(null);
  };

  const confirmWaiver = () => {
    if (!attestWaiverReason.trim()) {
      toast.error(t('food.timeClock.attestationWaiverReasonRequired'));
      return;
    }
    clockOut({ mealBreakTaken: false, waived: true, waiverReason: attestWaiverReason.trim() });
  };

  // Phase 2 punch proof: the device location is sent best-effort so
  // a store with a geofence configured can verify the punch. A denied
  // or unavailable location never blocks clock-in: the server only
  // enforces the geofence when the punch actually carries coordinates.
  const clockIn = async () => {
    const pos = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => resolve(null),
        { timeout: 5000, maximumAge: 60000 }
      );
    });
    await act(
      () => api.post(`${base}/clock-in`, {
        source: 'web',
        ...(pos || {}),
        ...(staffPin ? { staff_pin: staffPin } : {}),
      }),
      'food.timeClock.clockedInOk'
    ).then(() => setStaffPin(''));
  };

  const pendingCorrectionFor = (entryId) => myCorrections.find((c) => c.entry_id === entryId && c.status === 'pending');

  const openCorrection = (entry) => {
    setCorrectionFor(entry.id);
    setCorrectionForm({
      clock_in_at: toLocalInput(entry.clock_in_at),
      clock_out_at: toLocalInput(entry.clock_out_at),
      reason: '',
    });
  };

  const submitCorrection = (e) => {
    e.preventDefault();
    if (!correctionForm.reason.trim()) {
      toast.error(t('food.timeClock.correctionInvalid'));
      return;
    }
    const body = { reason: correctionForm.reason.trim() };
    if (correctionForm.clock_in_at) body.clock_in_at = new Date(correctionForm.clock_in_at).toISOString();
    if (correctionForm.clock_out_at) body.clock_out_at = new Date(correctionForm.clock_out_at).toISOString();
    act(
      () => api.post(`${base}/time-entries/${correctionFor}/corrections`, body),
      'food.timeClock.correctionSent'
    ).then(() => { setCorrectionFor(null); setCorrectionForm({ clock_in_at: '', clock_out_at: '', reason: '' }); });
  };

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
            onClick={clockIn}
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
            onClick={onClockOutClick}
            data-track="restaurant_time_clock_out">
            {t('food.timeClock.clockOut')}
          </button>
        )}
      </div>
      {open && attestPrompt && (
        <div className="fd-card" role="group" aria-label={t('food.timeClock.attestationQuestion')}>
          <p><strong>{t('food.timeClock.attestationQuestion')}</strong></p>
          <div className="fd-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="fd-btn fd-btn-sm" disabled={busy}
              onClick={() => clockOut({ mealBreakTaken: true })}
              data-track="restaurant_time_break_attest_taken">
              {t('food.timeClock.attestationTaken')}
            </button>
            <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy}
              onClick={() => setAttestWaiver(true)}
              data-track="restaurant_time_break_attest_waive">
              {t('food.timeClock.attestationWaived')}
            </button>
            <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy}
              onClick={() => clockOut({ mealBreakTaken: false })}
              data-track="restaurant_time_break_attest_missed">
              {t('food.timeClock.attestationMissed')}
            </button>
            {!attestRequired && (
              <button type="button" className="fd-btn fd-btn-sm fd-btn-secondary" disabled={busy}
                onClick={() => clockOut(null)}
                data-track="restaurant_time_break_attest_skip">
                {t('food.timeClock.attestationSkip')}
              </button>
            )}
          </div>
          {attestWaiver && (
            <div className="fd-field" style={{ marginTop: 8 }}>
              <label htmlFor="tc-waiver-reason">{t('food.timeClock.attestationWaiverReason')}</label>
              <input
                id="tc-waiver-reason"
                type="text"
                value={attestWaiverReason}
                onChange={(e) => setAttestWaiverReason(e.target.value)}
                placeholder={t('food.timeClock.attestationWaiverReasonPlaceholder')}
              />
              <button type="button" className="fd-btn fd-btn-sm" disabled={busy} onClick={confirmWaiver}
                data-track="restaurant_time_break_attest_waive_confirm">
                {t('food.timeClock.attestationConfirmWaiver')}
              </button>
            </div>
          )}
        </div>
      )}
      {!open && (
        <div className="fd-field tc-pin-field">
          <label htmlFor="tc-staff-pin">{t('food.timeClock.staffPin')}</label>
          <input
            id="tc-staff-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={staffPin}
            maxLength={32}
            onChange={(e) => setStaffPin(e.target.value)}
            placeholder={t('food.timeClock.staffPinPlaceholder')}
          />
        </div>
      )}

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
              {e.system_closed && <span className="fd-badge-system-closed">{t('food.timeClock.systemClosed')}</span>}
              {e.clock_out_at && !pendingCorrectionFor(e.id) && correctionFor !== e.id && (
                <button type="button" className="fd-btn fd-btn-secondary tc-inline-btn" disabled={busy}
                  onClick={() => openCorrection(e)}
                  data-track="restaurant_time_correction_request">
                  {t('food.timeClock.requestCorrection')}
                </button>
              )}
              {pendingCorrectionFor(e.id) && <span className="fd-card-meta tc-correction-pending">{t('food.timeClock.correctionPending')}</span>}
              {correctionFor === e.id && (
                <form onSubmit={submitCorrection} className="fd-ops-form tc-correction-form" data-track="ui.e15af3906a.2">
                  <div className="fd-row">
                    <div className="fd-field">
                      <label htmlFor={`tc-corr-in-${e.id}`}>{t('food.timeClock.correctionClockIn')}</label>
                      <input id={`tc-corr-in-${e.id}`} type="datetime-local" value={correctionForm.clock_in_at} onChange={(ev) => setCorrectionForm((f) => ({ ...f, clock_in_at: ev.target.value }))} />
                    </div>
                    <div className="fd-field">
                      <label htmlFor={`tc-corr-out-${e.id}`}>{t('food.timeClock.correctionClockOut')}</label>
                      <input id={`tc-corr-out-${e.id}`} type="datetime-local" value={correctionForm.clock_out_at} onChange={(ev) => setCorrectionForm((f) => ({ ...f, clock_out_at: ev.target.value }))} />
                    </div>
                  </div>
                  <div className="fd-field">
                    <label htmlFor={`tc-corr-reason-${e.id}`}>{t('food.timeClock.correctionReason')}</label>
                    <input id={`tc-corr-reason-${e.id}`} value={correctionForm.reason} maxLength={1000} onChange={(ev) => setCorrectionForm((f) => ({ ...f, reason: ev.target.value }))} required />
                  </div>
                  <div className="fd-row">
                    <button type="submit" className="fd-btn fd-btn-secondary" disabled={busy} data-track="restaurant_time_correction_send">{t('food.timeClock.sendCorrection')}</button>
                    <button type="button" className="fd-btn fd-btn-secondary" disabled={busy} onClick={() => setCorrectionFor(null)} data-track="ui.e15af3906a.3">{t('common.cancel')}</button>
                  </div>
                </form>
              )}
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
        {(() => {
          const balance = balances.find((b) => b.request_type === timeOff.request_type);
          if (!balance) return null;
          const unit = balance.unit === 'hours' ? t('food.timeClock.balanceUnitHours') : t('food.timeClock.balanceUnitDays');
          return <p className="fd-card-meta">{t('food.timeClock.balanceRemaining', { balance: Number(balance.balance), unit })}</p>;
        })()}
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
