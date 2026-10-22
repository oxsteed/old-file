import React, { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Clock, Users, LogIn, LogOut, Send, CalendarOff } from 'lucide-react';
import ConfirmDialog from '../../admin/lib/ConfirmDialog';

const TABS = ['shifts', 'time', 'timeOff'];

export function StaffScheduler({ businessId, isManager = false }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState('shifts');
  const [shifts, setShifts] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ user_id: '', shift_start: '', shift_end: '', role: '', notes: '' });
  // Review P1-5-F02: shifts only feed availability when they carry the staff
  // member's user id, so the form requires picking a team member.
  const [staffMembers, setStaffMembers] = useState([]);
  // S-24: the delete confirmation uses the app's ConfirmDialog instead of
  // window.confirm.
  const [deleteTarget, setDeleteTarget] = useState(null);
  // S-04: time-off request form state.
  const [timeOffForm, setTimeOffForm] = useState({ request_type: 'vacation', start_date: '', end_date: '', reason: '' });

  // S-24: stable ids so <label htmlFor> actually associates with its input.
  const staffFieldId = useId();
  const startFieldId = useId();
  const endFieldId = useId();
  const roleFieldId = useId();
  const toTypeFieldId = useId();
  const toStartFieldId = useId();
  const toEndFieldId = useId();
  const toReasonFieldId = useId();

  useEffect(() => {
    if (tab === 'shifts') loadShifts();
    else if (tab === 'time') loadTime();
    else loadTimeOff();
  }, [businessId, tab]);

  useEffect(() => {
    let cancelled = false;
    api.get(`/businesses/${businessId}/members`)
      .then((res) => {
        if (cancelled) return;
        const members = (res.data?.members || []).filter((m) => m.user_id && m.status === 'active');
        setStaffMembers(members);
      })
      .catch(() => { if (!cancelled) setStaffMembers([]); });
    return () => { cancelled = true; };
  }, [businessId]);

  const staffName = (m) => [m.first_name, m.last_name].filter(Boolean).join(' ') || m.member_email || m.user_id;

  const loadShifts = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/shifts`); setShifts(res.data || []); }
    catch { toast.error(t('businessHub.staffScheduler.toastLoadShiftsFail')); }
    finally { setLoading(false); }
  };

  const loadTime = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/time-entries`); setTimeEntries(res.data || []); }
    catch { toast.error(t('businessHub.staffScheduler.toastLoadTimeFail')); }
    finally { setLoading(false); }
  };

  const loadTimeOff = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/time-off`); setTimeOff(res.data?.requests || []); }
    catch { toast.error(t('businessHub.staffScheduler.timeOff.toastLoadFail')); }
    finally { setLoading(false); }
  };

  const saveShift = async () => {
    if (!form.user_id) return toast.error(t('businessHub.staffScheduler.toastStaffRequired'));
    if (!form.shift_start || !form.shift_end) return toast.error(t('businessHub.staffScheduler.toastShiftTimesRequired'));
    try { await api.post(`/businesses/${businessId}/staff/shifts`, { ...form }); toast.success(t('businessHub.staffScheduler.toastShiftAdded')); setShowForm(false); setForm({ user_id: '', shift_start: '', shift_end: '', role: '', notes: '' }); loadShifts(); }
    catch { toast.error(t('businessHub.staffScheduler.toastShiftSaveFail')); }
  };

  // S-24: deletion goes through ConfirmDialog; the actual delete runs here.
  const confirmDeleteShift = async () => {
    if (!deleteTarget) return;
    try { await api.delete(`/businesses/${businessId}/staff/shifts/${deleteTarget}`); toast.success(t('businessHub.staffScheduler.toastDeleted')); loadShifts(); }
    catch { toast.error(t('common.failed')); }
  };

  // S-04: publish every draft shift so assigned staff are notified.
  // S-20: the response carries native jurisdiction warnings; they are
  // shown below the publish button until dismissed.
  const [ruleWarnings, setRuleWarnings] = useState([]);
  const publishDrafts = async () => {
    try {
      const res = await api.post(`/businesses/${businessId}/staff/shifts/publish`, {});
      toast.success(t('businessHub.staffScheduler.toastPublished', { count: res.data?.published ?? 0 }));
      setRuleWarnings(res.data?.rule_warnings || []);
      loadShifts();
    } catch { toast.error(t('businessHub.staffScheduler.toastPublishFail')); }
  };

  const clockIn = async () => {
    try { await api.post(`/businesses/${businessId}/staff/clock-in`); toast.success(t('businessHub.staffScheduler.toastClockedIn')); loadTime(); }
    catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.toastClockInFail')); }
  };

  const clockOut = async (id) => {
    try { await api.post(`/businesses/${businessId}/staff/clock-out/${id}`); toast.success(t('businessHub.staffScheduler.toastClockedOut')); loadTime(); }
    catch { toast.error(t('businessHub.staffScheduler.toastClockOutFail')); }
  };

  // S-04: time-off request lifecycle.
  const requestTimeOff = async () => {
    if (!timeOffForm.start_date || !timeOffForm.end_date) return toast.error(t('businessHub.staffScheduler.timeOff.toastDatesRequired'));
    try {
      const res = await api.post(`/businesses/${businessId}/staff/time-off`, { ...timeOffForm });
      const conflicts = res.data?.conflicts?.length || 0;
      toast.success(
        conflicts > 0
          ? t('businessHub.staffScheduler.timeOff.toastRequestedWithConflicts', { count: conflicts })
          : t('businessHub.staffScheduler.timeOff.toastRequested')
      );
      setTimeOffForm({ request_type: 'vacation', start_date: '', end_date: '', reason: '' });
      loadTimeOff();
    } catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.timeOff.toastRequestFail')); }
  };

  const decideTimeOff = async (id, decision) => {
    try { await api.post(`/businesses/${businessId}/staff/time-off/${id}/decide`, { decision }); toast.success(t('businessHub.staffScheduler.timeOff.toastDecided')); loadTimeOff(); }
    catch { toast.error(t('businessHub.staffScheduler.timeOff.toastDecideFail')); }
  };

  const cancelTimeOff = async (id) => {
    try { await api.post(`/businesses/${businessId}/staff/time-off/${id}/cancel`, {}); toast.success(t('businessHub.staffScheduler.timeOff.toastCancelled')); loadTimeOff(); }
    catch { toast.error(t('businessHub.staffScheduler.timeOff.toastCancelFail')); }
  };

  const formatDuration = (hours) => {
    if (!hours) return '-';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const draftCount = shifts.filter((s) => !s.published).length;
  const tabDefs = [
    ['shifts', t('businessHub.staffScheduler.tabs.shifts'), <Users size={14} />],
    ['time', t('businessHub.staffScheduler.tabs.timeEntries'), <Clock size={14} />],
    ['timeOff', t('businessHub.staffScheduler.tabs.timeOff'), <CalendarOff size={14} />],
  ];
  const activeTabIndex = Math.max(0, tabDefs.findIndex(([id]) => id === tab));

  // S-24: arrow-key navigation across tabs per the WAI-ARIA tab pattern.
  const onTabKeyDown = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabDefs[(activeTabIndex + dir + tabDefs.length) % tabDefs.length][0];
    setTab(next);
    document.getElementById(`staff-sched-tab-${next}`)?.focus();
  };

  const fmtDate = (v) => { try { return new Date(v).toLocaleDateString(i18n.language); } catch { return String(v).slice(0, 10); } };

  return (
    <div style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>{t('businessHub.staffScheduler.title')}</h3>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--muted-text)', fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={clockIn} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }} data-track="ui.34ed3b0a4c.1">
            <LogIn size={14} /> {t('businessHub.staffScheduler.clockIn')}
          </button>
          {tab === 'shifts' && <button onClick={() => setShowForm(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }} data-track="ui.34ed3b0a4c.2">
            <Plus size={14} /> {t('businessHub.staffScheduler.addShift')}
          </button>}
          {tab === 'shifts' && isManager && draftCount > 0 && (
            <button onClick={publishDrafts} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '0.5rem', padding: '0.6rem 1rem', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }} data-track="ui.34ed3b0a4c.8">
              <Send size={14} /> {t('businessHub.staffScheduler.publishDrafts', { count: draftCount })}
            </button>
          )}
        </div>
      </div>

      {/* S-20: jurisdiction warnings from the last publish. */}
      {ruleWarnings.length > 0 && (
        <div role="alert" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.ruleWarningsTitle', { count: ruleWarnings.length })}</strong>
            <button type="button" onClick={() => setRuleWarnings([])} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }} aria-label={t('common.dismiss')}>
              ✕
            </button>
          </div>
          <ul style={{ margin: 0, paddingInlineStart: '1.25rem', fontSize: '0.8125rem' }}>
            {ruleWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* S-24: real tab semantics — tablist/tab/tabpanel with aria-selected. */}
      <div role="tablist" aria-label={t('businessHub.staffScheduler.title')} onKeyDown={onTabKeyDown} style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem' }}>
        {tabDefs.map(([id, label, icon]) => (
          <button
            key={id}
            id={`staff-sched-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`staff-sched-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.25rem', border: 'none', background: 'transparent', cursor: 'pointer', color: tab === id ? '#f97316' : 'var(--muted-text)', borderBottom: tab === id ? '2px solid #f97316' : '2px solid transparent', fontWeight: tab === id ? 600 : 400, fontSize: '0.875rem' }}
            data-track="ui.34ed3b0a4c.3"
          >
            {icon} {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`staff-sched-panel-${tab}`} aria-labelledby={`staff-sched-tab-${tab}`}>
      {showForm && tab === 'shifts' && (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
          <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.newShift')}</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor={staffFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.fields.staff')}</label>
              <select id={staffFieldId} value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                <option value="">{t('businessHub.staffScheduler.fields.staffPlaceholder')}</option>
                {staffMembers.map(m => (
                  <option key={m.user_id} value={m.user_id}>{staffName(m)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={startFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.fields.start')}</label>
              <input id={startFieldId} type="datetime-local" value={form.shift_start} onChange={e => setForm(f => ({ ...f, shift_start: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label htmlFor={endFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.fields.end')}</label>
              <input id={endFieldId} type="datetime-local" value={form.shift_end} onChange={e => setForm(f => ({ ...f, shift_end: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label htmlFor={roleFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.fields.role')}</label>
              <input id={roleFieldId} type="text" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={() => setShowForm(false)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }} data-track="ui.34ed3b0a4c.4">{t('common.cancel')}</button>
            <button onClick={saveShift} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.5">{t('common.save')}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : tab === 'shifts' ? (
        shifts.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Users size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyShifts')}</p></div>
        : shifts.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {s.user_name || t('businessHub.staffScheduler.unassigned')}{s.role && ` · ${s.role}`}
                {!s.published && <span style={{ marginInlineStart: '0.5rem', fontSize: '0.7rem', fontWeight: 600, color: '#b45309', background: '#fef3c7', borderRadius: '999px', padding: '0.15rem 0.5rem' }}>{t('businessHub.staffScheduler.draftBadge')}</span>}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{new Date(s.shift_start).toLocaleString(i18n.language)} – {new Date(s.shift_end).toLocaleString(i18n.language)}</div>
            </div>
            <button onClick={() => setDeleteTarget(s.id)} aria-label={t('businessHub.staffScheduler.deleteShiftLabel')} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }} data-track="ui.34ed3b0a4c.6"><Trash2 size={14} /></button>
          </div>
        ))
      ) : tab === 'time' ? (
        timeEntries.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Clock size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyTime')}</p></div>
        : timeEntries.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.user_name}</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                {t('businessHub.staffScheduler.time.in')} {new Date(e.clock_in).toLocaleString(i18n.language)}{' '}
                {e.clock_out ? `· ${t('businessHub.staffScheduler.time.out')} ${new Date(e.clock_out).toLocaleString(i18n.language)}` : `· ${t('businessHub.staffScheduler.time.stillWorking')}`}
              </div>
            </div>
            <div style={{ fontWeight: 600, color: e.clock_out ? '#10b981' : '#f59e0b' }}>{formatDuration(parseFloat(e.hours))}</div>
            {!e.clock_out && <button onClick={() => clockOut(e.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.7"><LogOut size={12} /> {t('businessHub.staffScheduler.time.clockOut')}</button>}
          </div>
        ))
      ) : (
        <div>
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.timeOff.requestTitle')}</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label htmlFor={toTypeFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.timeOff.type')}</label>
                <select id={toTypeFieldId} value={timeOffForm.request_type} onChange={e => setTimeOffForm(f => ({ ...f, request_type: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                  {['vacation', 'sick', 'personal', 'unpaid', 'other'].map(k => (
                    <option key={k} value={k}>{t(`businessHub.staffScheduler.timeOff.types.${k}`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={toReasonFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.timeOff.reason')}</label>
                <input id={toReasonFieldId} type="text" value={timeOffForm.reason} onChange={e => setTimeOffForm(f => ({ ...f, reason: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label htmlFor={toStartFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.timeOff.start')}</label>
                <input id={toStartFieldId} type="date" value={timeOffForm.start_date} onChange={e => setTimeOffForm(f => ({ ...f, start_date: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label htmlFor={toEndFieldId} style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.timeOff.end')}</label>
                <input id={toEndFieldId} type="date" value={timeOffForm.end_date} onChange={e => setTimeOffForm(f => ({ ...f, end_date: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={requestTimeOff} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.9">{t('businessHub.staffScheduler.timeOff.request')}</button>
            </div>
          </div>
          {timeOff.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><CalendarOff size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.timeOff.empty')}</p></div>
          ) : timeOff.map(r => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{t(`businessHub.staffScheduler.timeOff.types.${r.request_type}`)}{isManager && r.user_name ? ` · ${r.user_name}` : ''}</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                  {fmtDate(r.start_date)} – {fmtDate(r.end_date)} · {t(`businessHub.staffScheduler.timeOff.status.${r.status}`)}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
              {r.status === 'pending' && isManager && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => decideTimeOff(r.id, 'approved')} style={{ padding: '0.4rem 0.75rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.10">{t('businessHub.staffScheduler.timeOff.approve')}</button>
                  <button onClick={() => decideTimeOff(r.id, 'denied')} style={{ padding: '0.4rem 0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.11">{t('businessHub.staffScheduler.timeOff.deny')}</button>
                </div>
              )}
              {r.status === 'pending' && !isManager && (
                <button onClick={() => cancelTimeOff(r.id)} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--app-text)' }} data-track="ui.34ed3b0a4c.12">{t('businessHub.staffScheduler.timeOff.cancel')}</button>
              )}
            </div>
          ))}
        </div>
      )}
      </div>

      <ConfirmDialog
        open={deleteTarget != null}
        title={t('businessHub.staffScheduler.confirmDeleteTitle')}
        message={t('businessHub.staffScheduler.confirmDeleteShift')}
        danger
        onConfirm={confirmDeleteShift}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
