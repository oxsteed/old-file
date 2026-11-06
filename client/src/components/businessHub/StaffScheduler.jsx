import React, { useState, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../api/axios';
import toast from 'react-hot-toast';
import { Plus, Trash2, Clock, Users, LogIn, LogOut, Send, CalendarOff, Scale } from 'lucide-react';
import ConfirmDialog from '../../admin/lib/ConfirmDialog';
import StaffLaborRulesPanel from './StaffLaborRulesPanel';
import './StaffScheduler.css';

const TABS = ['shifts', 'time', 'timeOff'];

export function StaffScheduler({ businessId, isManager = false }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState('shifts');
  const [shifts, setShifts] = useState([]);
  const [timeEntries, setTimeEntries] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  // Phase 2: pending punch corrections awaiting a manager decision.
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ user_id: '', shift_start: '', shift_end: '', role: '', notes: '' });
  const [editingId, setEditingId] = useState(null);
  // Phase 4 Track A: structured violations block the save and are shown
  // inline on the form; availability warnings ride along with a
  // successful save instead of blocking it.
  const [formViolations, setFormViolations] = useState([]);
  const [saveWarnings, setSaveWarnings] = useState([]);
  // Phase 4 Track A: manager swap-approval queue (target-accepted only).
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapViolations, setSwapViolations] = useState({});
  // Review P1-5-F02: shifts only feed availability when they carry the staff
  // member's user id, so the form requires picking a team member.
  const [staffMembers, setStaffMembers] = useState([]);
  // S-24: the delete confirmation uses the app's ConfirmDialog instead of
  // window.confirm.
  const [deleteTarget, setDeleteTarget] = useState(null);
  // S-04: time-off request form state.
  const [timeOffForm, setTimeOffForm] = useState({ request_type: 'vacation', start_date: '', end_date: '', reason: '' });
  // Phase 4 Track B: PTO balances, copy-week, templates, forecast.
  const [balances, setBalances] = useState([]);
  const [copyForm, setCopyForm] = useState({ source_week_start: '', target_week_start: '' });
  const [copyResult, setCopyResult] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [forecastRange, setForecastRange] = useState({ from: '', to: '' });
  const [templates, setTemplates] = useState([]);
  const [templateForm, setTemplateForm] = useState({ name: '', week_start: '' });
  const [templateTargetWeek, setTemplateTargetWeek] = useState('');
  const [policyForm, setPolicyForm] = useState({ user_id: '', request_type: 'vacation', accrual_amount: '', accrual_unit: 'days', accrual_period: 'monthly', carryover_cap: '', initial_balance: '' });

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
    loadSwaps();
    loadForecast();
    loadTemplates();
  };

  // Phase 4 Track A: the manager approves swaps from this surface. Only
  // target-accepted requests wait on a manager; the rest are not theirs
  // to decide yet.
  const loadSwaps = async () => {
    if (!isManager) { setSwapRequests([]); return; }
    try {
      const res = await api.get(`/businesses/${businessId}/staff/shift-swaps`);
      setSwapRequests((res.data?.requests || []).filter((r) => r.status === 'target_accepted'));
    } catch { setSwapRequests([]); }
  };

  const decideSwap = async (id, decision) => {
    setSwapViolations((prev) => ({ ...prev, [id]: [] }));
    try {
      await api.post(`/businesses/${businessId}/staff/shift-swaps/${id}/${decision}`, {});
      toast.success(t(decision === 'approve' ? 'businessHub.staffScheduler.swaps.approved' : 'businessHub.staffScheduler.swaps.rejected'));
      loadSwaps();
      loadShifts();
    } catch (err) {
      const violations = err?.response?.data?.violations;
      if (err?.response?.status === 409 && Array.isArray(violations) && violations.length) {
        setSwapViolations((prev) => ({ ...prev, [id]: violations }));
        return;
      }
      toast.error(t(decision === 'approve' ? 'businessHub.staffScheduler.swaps.approveFail' : 'businessHub.staffScheduler.swaps.rejectFail'));
    }
  };

  // Phase 4 Track A: each violation code maps to one static locale key
  // so the message is localized from the code + params, never from
  // English sent by the server. Unknown codes fall back to the key the
  // server sent, then to the code itself.
  const violationText = (v) => {
    const p = v.params || {};
    switch (v.code) {
      case 'shift_overlap': return t('businessHub.staffScheduler.validation.shiftOverlap', p);
      case 'time_off_overlap': return t('businessHub.staffScheduler.validation.timeOffOverlap', p);
      case 'availability_outside_window': return t('businessHub.staffScheduler.validation.availabilityOutsideWindow', p);
      case 'availability_no_window': return t('businessHub.staffScheduler.validation.availabilityNoWindow', p);
      case 'minor_daily_hours': return t('businessHub.staffScheduler.validation.minorDailyHours', p);
      case 'minor_weekly_hours': return t('businessHub.staffScheduler.validation.minorWeeklyHours', p);
      case 'minor_latest_end': return t('businessHub.staffScheduler.validation.minorLatestEnd', p);
      case 'minor_under16_daily_hours': return p.schoolDay === 'school'
        ? t('businessHub.staffScheduler.validation.minorUnder16DailyHoursSchool', p)
        : t('businessHub.staffScheduler.validation.minorUnder16DailyHoursNonSchool', p);
      case 'minor_under16_weekly_hours': return p.schoolDay === 'school'
        ? t('businessHub.staffScheduler.validation.minorUnder16WeeklyHoursSchool', p)
        : t('businessHub.staffScheduler.validation.minorUnder16WeeklyHoursNonSchool', p);
      case 'minor_under16_window': return t('businessHub.staffScheduler.validation.minorUnder16Window', p);
      default: return v.message_key ? t(v.message_key, p) : v.code;
    }
  };

  const loadTime = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/businesses/${businessId}/staff/time-entries`); setTimeEntries(res.data || []);
      // Phase 2: managers review pending punch corrections on the time tab.
      if (isManager) {
        try {
          const corr = await api.get(`/businesses/${businessId}/staff/time-entry-corrections`, { params: { status: 'pending' } });
          setCorrections(Array.isArray(corr.data) ? corr.data : []);
        } catch { setCorrections([]); }
      }
    }
    catch { toast.error(t('businessHub.staffScheduler.toastLoadTimeFail')); }
    finally { setLoading(false); }
  };

  // Phase 2: run the close-of-day check for forgotten punches (same
  // sweep the nightly job runs) and decide a correction request.
  const runCloseStale = async () => {
    try {
      const res = await api.post(`/businesses/${businessId}/staff/time-entries/close-stale`, {});
      toast.success(t('businessHub.staffScheduler.closeStale.done', { count: res.data?.closed?.length ?? 0 }));
      loadTime();
    } catch { toast.error(t('businessHub.staffScheduler.closeStale.fail')); }
  };

  const decideCorrection = async (id, decision) => {
    try {
      await api.post(`/businesses/${businessId}/staff/time-entry-corrections/${id}/decide`, { decision });
      toast.success(t('businessHub.staffScheduler.corrections.decided'));
      loadTime();
    } catch { toast.error(t('businessHub.staffScheduler.corrections.decideFail')); }
  };

  const loadTimeOff = async () => {
    setLoading(true);
    try { const res = await api.get(`/businesses/${businessId}/staff/time-off`); setTimeOff(res.data?.requests || []); }
    catch { toast.error(t('businessHub.staffScheduler.timeOff.toastLoadFail')); }
    finally { setLoading(false); }
    loadBalances();
  };

  // Phase 4 Track B: PTO balances (own for staff, everyone for a
  // manager), copy-week, templates, and the scheduled-cost forecast.
  const loadBalances = async () => {
    try {
      const res = await api.get(`/businesses/${businessId}/staff/time-off/balances`);
      setBalances(res.data?.balances || []);
    } catch { setBalances([]); }
  };

  const balanceFor = (userId, type) => balances.find((b) => String(b.user_id) === String(userId) && b.request_type === type);

  const mondayOf = (iso) => {
    const d = new Date(`${iso}T12:00:00`);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  };

  const addDaysIso = (iso, days) => {
    const d = new Date(`${iso}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const loadForecast = async (from, to) => {
    if (!isManager) return;
    const rangeFrom = from || mondayOf(new Date().toISOString().slice(0, 10));
    const rangeTo = to || addDaysIso(rangeFrom, 6);
    setForecastRange({ from: rangeFrom, to: rangeTo });
    try {
      const res = await api.get(`/businesses/${businessId}/staff/shifts/forecast`, { params: { from: rangeFrom, to: rangeTo } });
      setForecast(res.data || null);
    } catch { setForecast(null); }
  };

  const loadTemplates = async () => {
    if (!isManager) return;
    try {
      const res = await api.get(`/businesses/${businessId}/staff/shift-templates`);
      setTemplates(res.data?.templates || []);
    } catch { setTemplates([]); }
  };

  const runCopyWeek = async () => {
    if (!copyForm.source_week_start || !copyForm.target_week_start) {
      return toast.error(t('businessHub.staffScheduler.copyWeek.toastWeeksRequired'));
    }
    try {
      const res = await api.post(`/businesses/${businessId}/staff/shifts/copy-week`, { ...copyForm });
      setCopyResult(res.data || null);
      toast.success(t('businessHub.staffScheduler.copyWeek.toastCopied', { count: res.data?.created?.length ?? 0, skipped: res.data?.skipped?.length ?? 0 }));
      loadShifts();
    } catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.copyWeek.toastFail')); }
  };

  const saveTemplate = async () => {
    if (!templateForm.name.trim() || !templateForm.week_start) {
      return toast.error(t('businessHub.staffScheduler.templates.toastNameWeekRequired'));
    }
    try {
      await api.post(`/businesses/${businessId}/staff/shift-templates`, { ...templateForm });
      toast.success(t('businessHub.staffScheduler.templates.toastSaved'));
      setTemplateForm({ name: '', week_start: '' });
      loadTemplates();
    } catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.templates.toastSaveFail')); }
  };

  const applyTemplate = async (id) => {
    if (!templateTargetWeek) return toast.error(t('businessHub.staffScheduler.templates.toastTargetWeekRequired'));
    try {
      const res = await api.post(`/businesses/${businessId}/staff/shift-templates/${id}/apply`, { target_week_start: templateTargetWeek });
      setCopyResult(res.data || null);
      toast.success(t('businessHub.staffScheduler.templates.toastApplied', { count: res.data?.created?.length ?? 0, skipped: res.data?.skipped?.length ?? 0 }));
      loadShifts();
    } catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.templates.toastApplyFail')); }
  };

  const deleteTemplate = async (id) => {
    try {
      await api.delete(`/businesses/${businessId}/staff/shift-templates/${id}`);
      toast.success(t('businessHub.staffScheduler.templates.toastDeleted'));
      loadTemplates();
    } catch { toast.error(t('businessHub.staffScheduler.templates.toastDeleteFail')); }
  };

  const savePolicy = async () => {
    if (!policyForm.user_id || policyForm.accrual_amount === '') {
      return toast.error(t('businessHub.staffScheduler.pto.toastPolicyRequired'));
    }
    try {
      await api.put(`/businesses/${businessId}/staff/members/${policyForm.user_id}/time-off-policy`, {
        request_type: policyForm.request_type,
        accrual_amount: Number(policyForm.accrual_amount),
        accrual_unit: policyForm.accrual_unit,
        accrual_period: policyForm.accrual_period,
        carryover_cap: policyForm.carryover_cap === '' ? null : Number(policyForm.carryover_cap),
        initial_balance: policyForm.initial_balance === '' ? null : Number(policyForm.initial_balance),
      });
      toast.success(t('businessHub.staffScheduler.pto.toastPolicySaved'));
      setPolicyForm({ user_id: '', request_type: 'vacation', accrual_amount: '', accrual_unit: 'days', accrual_period: 'monthly', carryover_cap: '', initial_balance: '' });
      loadBalances();
    } catch (err) { toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.pto.toastPolicyFail')); }
  };

  const grantAccrual = async () => {
    try {
      const res = await api.post(`/businesses/${businessId}/staff/time-off/accrue`, {});
      toast.success(t('businessHub.staffScheduler.pto.toastAccrualGranted', { count: res.data?.grants?.length ?? 0 }));
      loadBalances();
    } catch { toast.error(t('businessHub.staffScheduler.pto.toastAccrualFail')); }
  };

  const formatMoney = (cents, currency) => {
    if (cents == null) return '-';
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
    } catch { return `${(cents / 100).toFixed(2)}`; }
  };

  const formatBalance = (balance) => {
    if (!balance) return null;
    const amount = Number(balance.balance);
    const unitKey = balance.unit === 'hours' ? 'businessHub.staffScheduler.pto.unitHours' : 'businessHub.staffScheduler.pto.unitDays';
    return t('businessHub.staffScheduler.pto.remaining', { balance: amount, unit: t(unitKey) });
  };

  const saveShift = async () => {
    if (!form.user_id) return toast.error(t('businessHub.staffScheduler.toastStaffRequired'));
    if (!form.shift_start || !form.shift_end) return toast.error(t('businessHub.staffScheduler.toastShiftTimesRequired'));
    setFormViolations([]);
    try {
      const res = editingId
        ? await api.put(`/businesses/${businessId}/staff/shifts/${editingId}`, { ...form })
        : await api.post(`/businesses/${businessId}/staff/shifts`, { ...form });
      toast.success(t(editingId ? 'businessHub.staffScheduler.toastShiftUpdated' : 'businessHub.staffScheduler.toastShiftAdded'));
      // Phase 4 Track A: availability warnings do not block the save;
      // they are shown above the shift list until dismissed.
      if (res.data?.warnings?.length) setSaveWarnings(res.data.warnings);
      setShowForm(false); setEditingId(null); setForm({ user_id: '', shift_start: '', shift_end: '', role: '', notes: '' }); loadShifts();
    } catch (err) {
      const violations = err?.response?.data?.violations;
      if (err?.response?.status === 409 && Array.isArray(violations) && violations.length) {
        setFormViolations(violations);
        return;
      }
      toast.error(t('businessHub.staffScheduler.toastShiftSaveFail'));
    }
  };

  // Phase 4 Track A: the same form edits a shift, so update-time
  // conflicts surface inline exactly like create-time ones.
  const startEdit = (s) => {
    setForm({
      user_id: s.user_id || '',
      shift_start: String(s.shift_start || '').slice(0, 16),
      shift_end: String(s.shift_end || '').slice(0, 16),
      role: s.role || '',
      notes: s.notes || '',
    });
    setEditingId(s.id);
    setFormViolations([]);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormViolations([]);
  };

  // S-24: deletion goes through ConfirmDialog; the actual delete runs here.
  const confirmDeleteShift = async () => {
    if (!deleteTarget) return;
    try {
      const res = await api.delete(`/businesses/${businessId}/staff/shifts/${deleteTarget}`);
      toast.success(t('businessHub.staffScheduler.toastDeleted'));
      // S-20: cancelling a published shift inside the notice window owes predictability pay.
      if (res.data?.schedule_change?.premium_due) toast(t('businessHub.staffScheduler.labor.premiumToast', { code: res.data.schedule_change.jurisdiction_code }), { icon: '⚠️' });
      loadShifts();
    }
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
    } catch (err) {
      if (err?.response?.status === 409 && err?.response?.data?.code === 'insufficient_pto_balance') {
        toast.error(t('businessHub.staffScheduler.pto.toastInsufficient', { balance: err.response.data.balance, required: err.response.data.required }));
        return;
      }
      toast.error(err?.response?.data?.error || t('businessHub.staffScheduler.timeOff.toastRequestFail'));
    }
  };

  const decideTimeOff = async (id, decision) => {
    try { await api.post(`/businesses/${businessId}/staff/time-off/${id}/decide`, { decision }); toast.success(t('businessHub.staffScheduler.timeOff.toastDecided')); loadTimeOff(); }
    catch (err) {
      if (err?.response?.status === 409 && err?.response?.data?.code === 'insufficient_pto_balance') {
        toast.error(t('businessHub.staffScheduler.pto.toastInsufficient', { balance: err.response.data.balance, required: err.response.data.required }));
        return;
      }
      toast.error(t('businessHub.staffScheduler.timeOff.toastDecideFail'));
    }
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
    ...(isManager ? [['labor', t('businessHub.staffScheduler.tabs.labor'), <Scale size={14} />]] : []),
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
            <button type="button" onClick={() => setRuleWarnings([])} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }} aria-label={t('common.dismiss')} data-track="ui.34ed3b0a4c.13">
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

      {/* Phase 4 Track A: availability warnings from a saved shift. The
          save went through; these are notes for the manager, not errors. */}
      {saveWarnings.length > 0 && (
        <div role="status" style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong style={{ fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.validation.warningsTitle')}</strong>
            <button type="button" onClick={() => setSaveWarnings([])} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }} aria-label={t('common.dismiss')} data-track="ui.34ed3b0a4c.20">
              ✕
            </button>
          </div>
          <ul style={{ margin: 0, paddingInlineStart: '1.25rem', fontSize: '0.8125rem' }}>
            {saveWarnings.map((w, i) => (
              <li key={i}>{violationText(w)}</li>
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
          <h4 style={{ margin: '0 0 1rem' }}>{t(editingId ? 'businessHub.staffScheduler.editShift' : 'businessHub.staffScheduler.newShift')}</h4>
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
          {/* Phase 4 Track A: blocking conflicts stay on the form until fixed. */}
          {formViolations.length > 0 && (
            <div role="alert" style={{ marginTop: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem' }}>
              <strong style={{ fontSize: '0.875rem' }}>{t('businessHub.staffScheduler.validation.title')}</strong>
              <ul style={{ margin: '0.5rem 0 0', paddingInlineStart: '1.25rem', fontSize: '0.8125rem' }}>
                {formViolations.map((v, i) => (
                  <li key={i}>{violationText(v)}</li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button onClick={closeForm} style={{ padding: '0.5rem 1rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'transparent', color: 'var(--app-text)', cursor: 'pointer' }} data-track="ui.34ed3b0a4c.4">{t('common.cancel')}</button>
            <button onClick={saveShift} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.5">{t('common.save')}</button>
          </div>
        </div>
      )}

      {loading ? <p style={{ color: 'var(--muted-text)' }}>{t('common.loading')}</p> : tab === 'shifts' ? (
        <>
          {/* Phase 4 Track A: swaps the target already accepted, waiting on
              a manager. A validation failure stays on the request inline;
              the swap stays pending so it can be approved once fixed. */}
          {isManager && swapRequests.length > 0 && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.swaps.title')}</h4>
              {swapRequests.map((r) => {
                const requester = staffMembers.find((m) => String(m.user_id) === String(r.requester_user_id));
                const target = staffMembers.find((m) => String(m.user_id) === String(r.target_user_id));
                const violations = swapViolations[r.id] || [];
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', borderTop: '1px solid var(--border-color)', padding: '0.75rem 0' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {fmtDate(r.shift_date)} · {String(r.start_time || '').slice(0, 5)} – {String(r.end_time || '').slice(0, 5)}{r.role_label ? ` · ${r.role_label}` : ''}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                        {t('businessHub.staffScheduler.swaps.requestedBy', { name: requester ? staffName(requester) : '' })} · {t('businessHub.staffScheduler.swaps.offeredTo', { name: target ? staffName(target) : '' })}
                      </div>
                      {violations.length > 0 && (
                        <div role="alert" style={{ marginTop: '0.5rem', padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '0.5rem', fontSize: '0.8125rem' }}>
                          <strong>{t('businessHub.staffScheduler.validation.title')}</strong>
                          <ul style={{ margin: '0.25rem 0 0', paddingInlineStart: '1.25rem' }}>
                            {violations.map((v, i) => (
                              <li key={i}>{violationText(v)}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button onClick={() => decideSwap(r.id, 'approve')} style={{ padding: '0.4rem 0.75rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.18">{t('businessHub.staffScheduler.swaps.approve')}</button>
                      <button onClick={() => decideSwap(r.id, 'reject')} style={{ padding: '0.4rem 0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.19">{t('businessHub.staffScheduler.swaps.reject')}</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Phase 4 Track B: scheduled-cost forecast over draft shifts,
              copy-week, and shift templates (manager only). The forecast
              is a projection, not pay. */}
          {isManager && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.forecast.title')}</h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
                <div>
                  <label htmlFor="forecast-from" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.forecast.from')}</label>
                  <input id="forecast-from" type="date" value={forecastRange.from} onChange={(e) => setForecastRange((f) => ({ ...f, from: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <div>
                  <label htmlFor="forecast-to" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.forecast.to')}</label>
                  <input id="forecast-to" type="date" value={forecastRange.to} onChange={(e) => setForecastRange((f) => ({ ...f, to: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <button onClick={() => loadForecast(forecastRange.from, forecastRange.to)} style={{ padding: '0.5rem 1rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.21">{t('businessHub.staffScheduler.forecast.refresh')}</button>
              </div>
              {!forecast ? <p style={{ color: 'var(--muted-text)', fontSize: '0.875rem', margin: 0 }}>{t('businessHub.staffScheduler.forecast.empty')}</p> : (
                <div>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem' }}>
                    {t('businessHub.staffScheduler.forecast.totals', { hours: forecast.total_hours, overtime: forecast.total_overtime_hours, cost: formatMoney(forecast.total_cost_cents, forecast.currency_code) })}
                  </p>
                  {forecast.missing_wage_user_ids?.length > 0 && (
                    <p style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#b45309' }}>{t('businessHub.staffScheduler.forecast.missingWage', { count: forecast.missing_wage_user_ids.length })}</p>
                  )}
                  {forecast.per_person.map((p) => (
                    <div key={p.user_id} style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', borderTop: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
                      <span style={{ flex: 1, fontWeight: 600 }}>{p.user_name || p.user_id}</span>
                      <span>{t('businessHub.staffScheduler.forecast.hours', { hours: p.hours })}</span>
                      <span>{formatMoney(p.cost_cents, forecast.currency_code)}</span>
                      {p.projected_overtime && <span style={{ fontWeight: 600, color: '#b45309' }}>{t('businessHub.staffScheduler.forecast.overtimeFlag', { hours: p.overtime_hours })}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {isManager && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.copyWeek.title')}</h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label htmlFor="copy-source" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.copyWeek.sourceWeek')}</label>
                  <input id="copy-source" type="date" value={copyForm.source_week_start} onChange={(e) => setCopyForm((f) => ({ ...f, source_week_start: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <div>
                  <label htmlFor="copy-target" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.copyWeek.targetWeek')}</label>
                  <input id="copy-target" type="date" value={copyForm.target_week_start} onChange={(e) => setCopyForm((f) => ({ ...f, target_week_start: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <button onClick={runCopyWeek} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.22">{t('businessHub.staffScheduler.copyWeek.copy')}</button>
              </div>
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.copyWeek.hint')}</p>
              {copyResult && (
                <div style={{ marginTop: '1rem' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                    {t('businessHub.staffScheduler.copyWeek.result', { created: copyResult.created?.length ?? 0, skipped: copyResult.skipped?.length ?? 0 })}
                  </p>
                  {(copyResult.skipped || []).length > 0 && (
                    <ul style={{ margin: 0, paddingInlineStart: '1.25rem', fontSize: '0.8125rem' }}>
                      {copyResult.skipped.map((s, i) => {
                        const member = staffMembers.find((m) => String(m.user_id) === String(s.user_id));
                        return (
                          <li key={i}>
                            {member ? staffName(member) : s.user_id} · {s.shift_date} {s.start_time}–{s.end_time}
                            {(s.violations || []).map((v, j) => <span key={j}> · {violationText(v)}</span>)}
                            {s.reason === 'out_of_scope' && <span> · {t('businessHub.staffScheduler.copyWeek.outOfScope')}</span>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          {isManager && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.templates.title')}</h4>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '1rem' }}>
                <div>
                  <label htmlFor="template-name" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.templates.name')}</label>
                  <input id="template-name" type="text" value={templateForm.name} onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <div>
                  <label htmlFor="template-week" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.templates.week')}</label>
                  <input id="template-week" type="date" value={templateForm.week_start} onChange={(e) => setTemplateForm((f) => ({ ...f, week_start: e.target.value }))} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
                <button onClick={saveTemplate} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.23">{t('businessHub.staffScheduler.templates.save')}</button>
                <div>
                  <label htmlFor="template-target" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.templates.applyWeek')}</label>
                  <input id="template-target" type="date" value={templateTargetWeek} onChange={(e) => setTemplateTargetWeek(e.target.value)} style={{ padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)' }} />
                </div>
              </div>
              {templates.length === 0 ? <p style={{ color: 'var(--muted-text)', fontSize: '0.875rem', margin: 0 }}>{t('businessHub.staffScheduler.templates.empty')}</p> : templates.map((tpl) => (
                <div key={tpl.id} style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.875rem', borderTop: '1px solid var(--border-color)', padding: '0.5rem 0' }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{tpl.name} · {t('businessHub.staffScheduler.templates.shiftCount', { count: tpl.shift_count })}</span>
                  <button onClick={() => applyTemplate(tpl.id)} style={{ padding: '0.4rem 0.75rem', background: '#10b981', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.24">{t('businessHub.staffScheduler.templates.apply')}</button>
                  <button onClick={() => deleteTemplate(tpl.id)} style={{ padding: '0.4rem 0.75rem', background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--app-text)' }} data-track="ui.34ed3b0a4c.25">{t('common.delete')}</button>
                </div>
              ))}
            </div>
          )}
          {shifts.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Users size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyShifts')}</p></div>
        : shifts.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {s.user_name || t('businessHub.staffScheduler.unassigned')}{s.role && ` · ${s.role}`}
                {!s.published && <span style={{ marginInlineStart: '0.5rem', fontSize: '0.7rem', fontWeight: 600, color: '#b45309', background: '#fef3c7', borderRadius: '999px', padding: '0.15rem 0.5rem' }}>{t('businessHub.staffScheduler.draftBadge')}</span>}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{new Date(s.shift_start).toLocaleString(i18n.language)} – {new Date(s.shift_end).toLocaleString(i18n.language)}</div>
            </div>
            {isManager && <button onClick={() => startEdit(s)} aria-label={t('businessHub.staffScheduler.editShiftLabel', { name: s.user_name || '' })} style={{ padding: '0.4rem 0.75rem', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', color: 'var(--app-text)', borderRadius: '0.5rem', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.17">{t('common.edit')}</button>}
            <button onClick={() => setDeleteTarget(s.id)} aria-label={t('businessHub.staffScheduler.deleteShiftLabel')} style={{ padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer', color: '#ef4444' }} data-track="ui.34ed3b0a4c.6"><Trash2 size={14} /></button>
          </div>
        ))}
        </>
      ) : tab === 'time' ? (
        <div>
          {isManager && (
            <div className="staff-sched-corrections">
              <div className="staff-sched-corrections-head">
                <h4>{t('businessHub.staffScheduler.corrections.title')}</h4>
                <button onClick={runCloseStale} className="staff-sched-close-stale-btn" data-track="ui.34ed3b0a4c.14">
                  {t('businessHub.staffScheduler.closeStale.button')}
                </button>
              </div>
              {corrections.length === 0 ? (
                <p className="staff-sched-corrections-empty">{t('businessHub.staffScheduler.corrections.empty')}</p>
              ) : corrections.map((c) => (
                <div key={c.id} className="staff-sched-correction-row">
                  <div className="staff-sched-correction-text">
                    <div className="staff-sched-correction-title">{c.requester_name || c.user_name} · {fmtDate(c.entry_date)}</div>
                    <div className="staff-sched-correction-detail">
                      {c.requested_clock_in_at ? `${t('businessHub.staffScheduler.time.in')} ${new Date(c.requested_clock_in_at).toLocaleString(i18n.language)} ` : ''}
                      {c.requested_clock_out_at ? `· ${t('businessHub.staffScheduler.time.out')} ${new Date(c.requested_clock_out_at).toLocaleString(i18n.language)} ` : ''}
                      {c.reason ? `· ${c.reason}` : ''}
                    </div>
                  </div>
                  <div className="staff-sched-correction-actions">
                    <button onClick={() => decideCorrection(c.id, 'approved')} className="staff-sched-correction-approve" data-track="ui.34ed3b0a4c.15">{t('businessHub.staffScheduler.corrections.approve')}</button>
                    <button onClick={() => decideCorrection(c.id, 'rejected')} className="staff-sched-correction-reject" data-track="ui.34ed3b0a4c.16">{t('businessHub.staffScheduler.corrections.reject')}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {timeEntries.length === 0 ? <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--muted-text)' }}><Clock size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} /><p>{t('businessHub.staffScheduler.emptyTime')}</p></div>
        : timeEntries.map(e => (
          <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.5rem', padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{e.user_name}
                {e.system_closed && <span className="staff-sched-system-closed-badge">{t('businessHub.staffScheduler.time.systemClosed')}</span>}
              </div>
              <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                {t('businessHub.staffScheduler.time.in')} {new Date(e.clock_in).toLocaleString(i18n.language)}{' '}
                {e.clock_out ? `· ${t('businessHub.staffScheduler.time.out')} ${new Date(e.clock_out).toLocaleString(i18n.language)}` : `· ${t('businessHub.staffScheduler.time.stillWorking')}`}
              </div>
            </div>
            <div style={{ fontWeight: 600, color: e.clock_out ? '#10b981' : '#f59e0b' }}>{formatDuration(parseFloat(e.hours))}</div>
            {!e.clock_out && <button onClick={() => clockOut(e.id)} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.4rem 0.75rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }} data-track="ui.34ed3b0a4c.7"><LogOut size={12} /> {t('businessHub.staffScheduler.time.clockOut')}</button>}
          </div>
        ))}
        </div>
      ) : (
        <div>
          {/* Phase 4 Track B: manager sets accrual policies and grants
              accrual; balances are listed here so approvals are not blind. */}
          {isManager && (
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem' }}>{t('businessHub.staffScheduler.pto.policyTitle')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label htmlFor="pto-member" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.fields.staff')}</label>
                  <select id="pto-member" value={policyForm.user_id} onChange={(e) => setPolicyForm((f) => ({ ...f, user_id: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                    <option value="">{t('businessHub.staffScheduler.fields.staffPlaceholder')}</option>
                    {staffMembers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{staffName(m)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pto-type" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.timeOff.type')}</label>
                  <select id="pto-type" value={policyForm.request_type} onChange={(e) => setPolicyForm((f) => ({ ...f, request_type: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                    {['vacation', 'sick', 'personal', 'unpaid', 'other'].map((k) => (
                      <option key={k} value={k}>{t(`businessHub.staffScheduler.timeOff.types.${k}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pto-amount" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.pto.accrualAmount')}</label>
                  <input id="pto-amount" type="number" min="0" step="0.5" value={policyForm.accrual_amount} onChange={(e) => setPolicyForm((f) => ({ ...f, accrual_amount: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label htmlFor="pto-unit" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.pto.accrualUnit')}</label>
                  <select id="pto-unit" value={policyForm.accrual_unit} onChange={(e) => setPolicyForm((f) => ({ ...f, accrual_unit: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                    <option value="days">{t('businessHub.staffScheduler.pto.unitDays')}</option>
                    <option value="hours">{t('businessHub.staffScheduler.pto.unitHours')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="pto-period" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.pto.accrualPeriod')}</label>
                  <select id="pto-period" value={policyForm.accrual_period} onChange={(e) => setPolicyForm((f) => ({ ...f, accrual_period: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }}>
                    {['weekly', 'monthly', 'yearly', 'once'].map((k) => (
                      <option key={k} value={k}>{t(`businessHub.staffScheduler.pto.periods.${k}`)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="pto-cap" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.pto.carryoverCap')}</label>
                  <input id="pto-cap" type="number" min="0" step="0.5" value={policyForm.carryover_cap} onChange={(e) => setPolicyForm((f) => ({ ...f, carryover_cap: e.target.value }))} placeholder={t('businessHub.staffScheduler.pto.noCap')} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label htmlFor="pto-initial" style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>{t('businessHub.staffScheduler.pto.initialBalance')}</label>
                  <input id="pto-initial" type="number" min="0" step="0.5" value={policyForm.initial_balance} onChange={(e) => setPolicyForm((f) => ({ ...f, initial_balance: e.target.value }))} style={{ width: '100%', padding: '0.6rem', border: '1px solid var(--border-color)', borderRadius: '0.5rem', background: 'var(--card-bg)', color: 'var(--app-text)', boxSizing: 'border-box' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button onClick={grantAccrual} style={{ padding: '0.5rem 1rem', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.26">{t('businessHub.staffScheduler.pto.grantAccrual')}</button>
                <button onClick={savePolicy} style={{ padding: '0.5rem 1rem', background: '#f97316', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontWeight: 600 }} data-track="ui.34ed3b0a4c.27">{t('businessHub.staffScheduler.pto.savePolicy')}</button>
              </div>
              {balances.length > 0 && (
                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  {balances.map((b) => (
                    <div key={`${b.user_id}-${b.request_type}`} style={{ fontSize: '0.875rem', padding: '0.25rem 0' }}>
                      {b.user_name || b.user_id} · {t(`businessHub.staffScheduler.timeOff.types.${b.request_type}`)} · {formatBalance(b)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
            {/* Phase 4 Track B: the requester's remaining balance for
                the selected type (staff see only their own). */}
            {!isManager && balances.find((b) => b.request_type === timeOffForm.request_type) && (
              <p style={{ margin: '0.75rem 0 0', fontSize: '0.875rem', color: 'var(--muted-text)' }}>
                {formatBalance(balances.find((b) => b.request_type === timeOffForm.request_type))}
              </p>
            )}
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
                {balanceFor(r.user_id, r.request_type) && (
                  <div style={{ fontSize: '0.875rem', color: 'var(--muted-text)' }}>{formatBalance(balanceFor(r.user_id, r.request_type))}</div>
                )}
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
      {tab === 'labor' && isManager && (
        <StaffLaborRulesPanel businessId={businessId} staffMembers={staffMembers} staffName={staffName} />
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
