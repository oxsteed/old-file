import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import {
  Wrench,
  Home,
  Heart,
  CalendarDays,
  ClipboardList,
  Pause,
  Play,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  Sparkles,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { formatMoney } from '../lib/format';
import { getDefaultCurrency } from '../lib/countries';
import QuickAddTemplates from '../components/QuickAddTemplates';
import PlannedNeedHoldStatus from '../components/PlannedNeedHoldStatus';
import PulseScoreSettings from '../components/PulseScoreSettings';
import '../styles/PlannedNeedsPage.css';

const WINDOWS = ['1w', '2w', '1m', '3m', '6m', '1y', '5y', '10y'];
const DEFAULT_WINDOW = '3m';
const ACTIVE_STATUSES = ['planned', 'funding', 'activating_soon'];
const INACTIVE_STATUSES = ['published', 'completed', 'cancelled', 'regenerated'];

const DEFAULT_FORM = {
  title: '',
  description: '',
  category: 'other',
  due_date: '',
  estimated_cost: '',
  lead_time_days: 7,
  recurrence_type: 'none',
  recurrence_interval_days: '',
  preferred_helper_id: '',
  notes: '',
  vehicle_id: '',
  home_id: '',
};

function fmt$(n, currency = 'USD') {
  return formatMoney(n, { currency });
}
function fmtDate(d) {
  if (!d) return '-';
  return new Date(d + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function daysLabel(days, t) {
  if (days === null || days === undefined) return '';
  const d = parseInt(days, 10);
  if (d < 0) return t('plannedNeeds.daysOverdue');
  if (d === 0) return t('plannedNeeds.daysToday');
  if (d === 1) return t('plannedNeeds.daysTomorrow');
  if (d < 7) return t('plannedNeeds.daysCount', { count: d });
  if (d < 30) return t('plannedNeeds.daysWeeks', { count: Math.round(d / 7) });
  if (d < 365) return t('plannedNeeds.daysMonths', { count: Math.round(d / 30) });
  return t('plannedNeeds.daysYears', { count: (d / 365).toFixed(1) });
}
function helperDisplayName(need) {
  if (!need.preferred_helper_first_name) return null;
  return `${need.preferred_helper_first_name} ${(need.preferred_helper_last_name || '').charAt(0)}.`.trim();
}

function useCountUp(target, durationMs = 800) {
  const [v, setV] = useState(0);
  const raf = useRef(null);
  const start = useRef(null);
  const num = typeof target === 'number' && !Number.isNaN(target) ? target : 0;

  useEffect(() => {
    start.current = null;
    const tick = (ts) => {
      if (start.current == null) start.current = ts;
      const p = Math.min(1, (ts - start.current) / durationMs);
      setV(num * (0.5 - Math.cos(p * Math.PI) / 2));
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else setV(num);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [num, durationMs]);

  return v;
}

function trendArrow(pct) {
  if (pct == null || Number.isNaN(pct)) return '→';
  if (pct > 5) return '↑';
  if (pct > 0.5) return '↗';
  if (pct < -5) return '↓';
  if (pct < -0.5) return '↘';
  return '→';
}

function CategoryIcon({ category, className }) {
  const cn = className || 'pn-cat-icon';
  if (category === 'car_care') return <Wrench className={cn} aria-hidden />;
  if (category === 'personal_care') return <Heart className={cn} aria-hidden />;
  return <Home className={cn} aria-hidden />;
}

const EXAMPLE_CARDS = [
  {
    key: 'ex1',
    titleKey: 'plannedNeeds.example1Title',
    metaKey: 'plannedNeeds.example1Meta',
  },
  {
    key: 'ex2',
    titleKey: 'plannedNeeds.example2Title',
    metaKey: 'plannedNeeds.example2Meta',
  },
  {
    key: 'ex3',
    titleKey: 'plannedNeeds.example3Title',
    metaKey: 'plannedNeeds.example3Meta',
  },
];

export default function PlannedNeedsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const currency =
    user?.preferred_currency || (user?.country ? getDefaultCurrency(user.country) : null) || 'USD';

  const [needs, setNeeds] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [projection, setProjection] = useState(null);
  const [savedHelpers, setSavedHelpers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [homes, setHomes] = useState([]);
  const [window_, setWindow] = useState(DEFAULT_WINDOW);
  const [loading, setLoading] = useState(true);
  const [projLoading, setProjLoading] = useState(false);
  const [suggestions, setSuggestions] = useState({ suggestions: [], defaults: [] });

  const [modal, setModal] = useState(null);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showSrcs, setShowSrcs] = useState(false);

  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [viewMode, setViewMode] = useState('list');
  const [calMonth, setCalMonth] = useState(() => new Date());
  const [sinkingOpen, setSinkingOpen] = useState(true);
  const [fundNeed, setFundNeed] = useState(null);
  const [fundAmount, setFundAmount] = useState('');

  const loadNeeds = useCallback(async () => {
    try {
      const [needsRes, bookingsRes] = await Promise.all([
        api.get('/planned-needs'),
        api.get('/bookings'),
      ]);

      setNeeds(needsRes.data.planned_needs || []);

      // Filter bookings for scheduled ones with pricing
      const scheduledBookings = Array.isArray(bookingsRes.data?.data)
        ? bookingsRes.data.data.filter(b =>
            (b.scheduled_date || b.start_time) &&
            b.status !== 'declined' &&
            b.status !== 'expired' &&
            b.price
          )
        : [];
      setBookings(scheduledBookings);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjection = useCallback(async (win) => {
    setProjLoading(true);
    try {
      const { data } = await api.get(`/life/pulse?window=${win}`);
      setProjection(data);
    } catch (e) {
      console.error(e);
    } finally {
      setProjLoading(false);
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    try {
      const { data } = await api.get('/planned-needs/suggestions');
      setSuggestions({
        suggestions: data.suggestions || [],
        defaults: data.defaults || [],
      });
    } catch {
      setSuggestions({ suggestions: [], defaults: [] });
    }
  }, []);

  const loadSavedHelpers = useCallback(async () => {
    try {
      const { data } = await api.get('/life/saved-helpers');
      setSavedHelpers(data.saved_helpers || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadVehiclesAndHomes = useCallback(async () => {
    try {
      const [vRes, hRes] = await Promise.all([api.get('/vehicles/my'), api.get('/house/my')]);
      setVehicles(vRes.data.vehicles || []);
      setHomes(hRes.data.homes || []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadNeeds();
    loadSavedHelpers();
    loadVehiclesAndHomes();
    loadSuggestions();
  }, [loadNeeds, loadSavedHelpers, loadVehiclesAndHomes, loadSuggestions]);
  useEffect(() => {
    loadProjection(window_);
  }, [window_, loadProjection]);

  // Combine needs with bookings (bookings are always "active")
  const combinedNeeds = useMemo(() => {
    const converted = bookings.map((b) => ({
      id: `booking-${b.id}`,
      type: 'booking',
      title: b.service_name || 'Service Request',
      due_date: b.scheduled_date || b.start_time,
      estimated_cost: b.price || 0,
      reserved_amount: b.price || 0, // For bookings, if scheduled and priced, it's already committed
      status: b.status === 'accepted' ? 'funding' : 'planned',
      helper_name: b.helper_name,
      days_until_due: b.scheduled_date
        ? Math.ceil((new Date(b.scheduled_date) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    }));
    return [...needs, ...converted];
  }, [needs, bookings]);

  const activeNeeds = useMemo(() => combinedNeeds.filter((n) => ACTIVE_STATUSES.includes(n.status)), [combinedNeeds]);
  const inactiveNeeds = useMemo(() => combinedNeeds.filter((n) => INACTIVE_STATUSES.includes(n.status)), [combinedNeeds]);

  const activatingSoon = useMemo(
    () => activeNeeds.filter((n) => n.status === 'activating_soon'),
    [activeNeeds],
  );

  const pulseLabel = useMemo(() => {
    if (!projection || projection.no_data) return { key: 'none', color: 'var(--muted-text)' };
    const s = projection.pulse_score;
    if (s == null) return { key: 'none', color: 'var(--muted-text)' };
    if (s >= 75) return { key: 'healthy', color: '#34d399' };
    if (s >= 45) return { key: 'watch', color: '#fbbf24' };
    return { key: 'risk', color: '#f87171' };
  }, [projection]);

  const chartData = useMemo(() => {
    const tl = projection?.timeline;
    if (tl?.length) {
      return tl.map((row) => ({
        day: row.day,
        label: row.day === 0 ? t('plannedNeeds.chartStart') : `+${row.day}d`,
        income: row.projected_income,
        expenses: row.projected_fixed_expenses,
        sinking: row.sinking_funds_cumulative,
      }));
    }
    const w = projection?.window_days || 90;
    const inc = projection?.projected_income ?? 0;
    const exp = projection?.projected_fixed_expenses ?? 0;
    const sink = projection?.sinking_fund_for_window ?? 0;
    return [
      { day: 0, label: t('plannedNeeds.chartStart'), income: 0, expenses: 0, sinking: 0 },
      { day: w, label: t('plannedNeeds.chartEnd'), income: inc, expenses: exp, sinking: sink },
    ];
  }, [projection, t]);

  const incomeAnim = useCountUp(projection?.projected_income ?? 0, 700);
  const expAnim = useCountUp(projection?.projected_fixed_expenses ?? 0, 700);
  const sinkAnim = useCountUp(projection?.sinking_fund_for_window ?? 0, 700);
  const netAnim = useCountUp(projection?.net_available ?? 0, 700);

  const trend = projection?.trend || {};

  const totalReserved = useMemo(
    () => activeNeeds.reduce((s, n) => s + parseFloat(n.reserved_amount || 0), 0),
    [activeNeeds],
  );

  const upcomingCost = useMemo(() => {
    return activeNeeds.reduce((s, n) => s + parseFloat(n.estimated_cost || 0), 0);
  }, [activeNeeds]);

  const nextDue = useMemo(() => {
    const sorted = [...activeNeeds].sort(
      (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime(),
    );
    return sorted[0] || null;
  }, [activeNeeds]);

  const stats = useMemo(
    () => ({
      active: activeNeeds.length,
      upcoming: activeNeeds.filter((n) => (parseInt(n.days_until_due, 10) || 0) >= 0).length,
      completed: inactiveNeeds.filter((n) => n.status === 'completed').length,
    }),
    [activeNeeds, inactiveNeeds],
  );

  const filteredActive = useMemo(() => {
    let list = [...activeNeeds];
    if (filter === 'upcoming') {
      list = list.filter((n) => (parseInt(n.days_until_due, 10) || 0) >= 0);
    } else if (filter === 'saving') {
      list = list.filter((n) => {
        const cost = parseFloat(n.estimated_cost || 0);
        const r = parseFloat(n.reserved_amount || 0);
        return n.status === 'funding' || (cost > 0 && r < cost);
      });
    } else if (filter === 'ready') {
      list = list.filter((n) => n.status === 'activating_soon');
    } else if (filter === 'overdue') {
      list = list.filter((n) => (parseInt(n.days_until_due, 10) || 0) < 0);
    }
    if (sortBy === 'date') {
      list.sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
    } else if (sortBy === 'cost') {
      list.sort((a, b) => parseFloat(b.estimated_cost || 0) - parseFloat(a.estimated_cost || 0));
    } else if (sortBy === 'progress') {
      list.sort((a, b) => {
        const pa =
          parseFloat(a.estimated_cost || 0) > 0
            ? parseFloat(a.reserved_amount || 0) / parseFloat(a.estimated_cost || 1)
            : 0;
        const pb =
          parseFloat(b.estimated_cost || 0) > 0
            ? parseFloat(b.reserved_amount || 0) / parseFloat(b.estimated_cost || 1)
            : 0;
        return pb - pa;
      });
    }
    return list;
  }, [activeNeeds, filter, sortBy]);

  const completedFiltered = useMemo(() => {
    if (filter !== 'completed') return [];
    return inactiveNeeds.filter((n) => n.status === 'completed');
  }, [filter, inactiveNeeds]);

  function openAdd() {
    setForm(DEFAULT_FORM);
    setError('');
    setModal('add');
  }
  function openEdit(need) {
    setSelected(need);
    setForm({
      title: need.title || '',
      description: need.description || '',
      category: need.category || 'other',
      due_date: need.due_date ? String(need.due_date).split('T')[0] : '',
      estimated_cost: need.estimated_cost || '',
      lead_time_days: need.lead_time_days ?? 7,
      recurrence_type: need.recurrence_type || 'none',
      recurrence_interval_days: need.recurrence_interval_days || '',
      preferred_helper_id: need.preferred_helper_id || '',
      notes: need.notes || '',
      vehicle_id: need.vehicle_id || '',
      home_id: need.home_id || '',
    });
    setError('');
    setModal('edit');
  }
  function openCancel(need) {
    setSelected(need);
    setModal('cancel');
  }
  function openComplete(need) {
    setSelected(need);
    setForm({ actual_cost: need.estimated_cost || '' });
    setModal('complete');
  }
  function closeModal() {
    setModal(null);
    setSelected(null);
    setError('');
  }
  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handleSave() {
    setError('');
    if (!form.title.trim()) {
      setError(t('plannedNeeds.errTitleRequired'));
      return;
    }
    if (!form.due_date) {
      setError(t('plannedNeeds.errDueDateRequired'));
      return;
    }
    if (form.recurrence_type !== 'none' && !form.recurrence_interval_days) {
      setError(t('plannedNeeds.errRepeatRequired'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : undefined,
        lead_time_days: parseInt(form.lead_time_days, 10) || 7,
        recurrence_interval_days: form.recurrence_interval_days
          ? parseInt(form.recurrence_interval_days, 10)
          : undefined,
        preferred_helper_id: form.preferred_helper_id || undefined,
        vehicle_id: form.vehicle_id ? parseInt(form.vehicle_id, 10) : undefined,
        home_id: form.home_id ? parseInt(form.home_id, 10) : undefined,
      };
      if (modal === 'add') await api.post('/planned-needs', payload);
      else await api.put(`/planned-needs/${selected.id}`, payload);
      closeModal();
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      setError(e?.response?.data?.error || t('plannedNeeds.errGeneric'));
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/cancel`);
      closeModal();
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      setError(e?.response?.data?.error || t('plannedNeeds.failedCancel'));
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    setSaving(true);
    try {
      await api.post(`/planned-needs/${selected.id}/complete`, {
        actual_cost: form.actual_cost ? parseFloat(form.actual_cost) : undefined,
      });
      closeModal();
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      setError(e?.response?.data?.error || t('plannedNeeds.failedComplete'));
    } finally {
      setSaving(false);
    }
  }

  async function togglePause(needId, nextPaused) {
    try {
      await api.put(`/planned-needs/${needId}`, { is_paused: nextPaused });
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleDelete(need) {
    if (!window.confirm(t('plannedNeeds.confirmDelete', { title: need.title }))) return;
    try {
      await api.delete(`/planned-needs/${need.id}`);
      await loadNeeds();
      await loadProjection(window_);
    } catch (e) {
      alert(e?.response?.data?.error || t('plannedNeeds.deleteFailed'));
    }
  }

  async function submitTopUp(e) {
    e.preventDefault();
    if (!fundNeed || !fundAmount || parseFloat(fundAmount) <= 0) return;
    try {
      await api.post(`/planned-needs/${fundNeed.id}/fund`, { amount: parseFloat(fundAmount) });
      setFundNeed(null);
      setFundAmount('');
      await loadNeeds();
      await loadProjection(window_);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed');
    }
  }

  function applyQuickChip(item) {
    const due = new Date();
    due.setDate(due.getDate() + (item.recurrence_days || 90));
    setForm((f) => ({
      ...f,
      title: item.title,
      category: item.category || 'other',
      due_date: due.toISOString().split('T')[0],
      recurrence_type: item.recurrence_days ? 'fixed' : 'none',
      recurrence_interval_days: item.recurrence_days || '',
    }));
    setError('');
    setModal('add');
  }

  const coveragePct = useMemo(() => {
    const r = projection?.coverage_ratio;
    if (r == null) return null;
    return Math.min(100, Math.round((r / 2) * 100));
  }, [projection]);

  const autoList = projection?.auto_publishing_needs || [];

  return (
    <PageShell>
      <PageMeta title={`${t('plannedNeeds.title')} - OxSteed`} description={t('plannedNeeds.subtitle')} />
      <div className="pn-page pn-page-v2">
        <div className="pn-header">
          <div>
            <h1>{t('plannedNeeds.title')}</h1>
            <p>{t('plannedNeeds.subtitle')}</p>
          </div>
          <button type="button" className="pn-add-btn pn-add-btn-desktop" onClick={openAdd}>
            {t('plannedNeeds.addBtn')}
          </button>
        </div>

        <div className="pn-quick-stats" role="region" aria-label={t('plannedNeeds.quickStatsAria')}>
          <div className="pn-quick-stats-inner">
            <div className="pn-stat-pill">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statActive')}</span>
              <span className="pn-stat-pill-val">{stats.active}</span>
            </div>
            <div className="pn-stat-pill">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statUpcoming')}</span>
              <span className="pn-stat-pill-val">{stats.upcoming}</span>
            </div>
            <div className="pn-stat-pill">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statCompleted')}</span>
              <span className="pn-stat-pill-val">{stats.completed}</span>
            </div>
            <div className="pn-stat-pill">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statEstUpcoming')}</span>
              <span className="pn-stat-pill-val">{fmt$(upcomingCost, currency)}</span>
            </div>
            <div className="pn-stat-pill">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statSaved')}</span>
              <span className="pn-stat-pill-val">{fmt$(totalReserved, currency)}</span>
            </div>
            <div className="pn-stat-pill pn-stat-pill-wide">
              <span className="pn-stat-pill-label">{t('plannedNeeds.statNext')}</span>
              <span className="pn-stat-pill-val">
                {nextDue ? (
                  <>
                    {nextDue.title} · {fmtDate(nextDue.due_date)}
                  </>
                ) : (
                  t('plannedNeeds.statNextNone')
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="pn-projection pn-projection-v2">
          <div className="pn-projection-header">
            <h2>{t('plannedNeeds.projectionTitle')}</h2>
            <div className="pn-window-tabs pn-window-tabs-scroll">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`pn-window-tab${window_ === w ? ' active' : ''}`}
                  onClick={() => setWindow(w)}
                >
                  {t(`plannedNeeds.window${w}`)}
                </button>
              ))}
            </div>
          </div>

          {projLoading ? (
            <p className="pn-proj-loading">{t('plannedNeeds.projLoading')}</p>
          ) : projection ? (
            <>
              {(projection.pulse_score !== undefined || projection.no_data) && (
                <>
                  {showSettings && (
                    <PulseScoreSettings
                      onClose={() => setShowSettings(false)}
                      onSaved={() => loadProjection(window_)}
                    />
                  )}
                  {projection.no_data ? (
                    <div className="pn-pulse-score-row pn-pulse-no-data">
                      <div className="pn-pulse-ring">
                        <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
                          <circle
                            cx="28"
                            cy="28"
                            r="23"
                            fill="none"
                            stroke="var(--border-color)"
                            strokeWidth="4"
                            strokeDasharray="4 4"
                          />
                        </svg>
                        <span className="pn-pulse-ring-score" style={{ color: 'var(--muted-text)' }}>
                          -
                        </span>
                      </div>
                      <div style={{ flex: 1 }}>
                        <p className="pn-no-data-title">{t('plannedNeeds.noDataYet')}</p>
                        <p className="pn-no-data-hint">{t('plannedNeeds.noDataHint')}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        className="pn-pulse-settings-btn"
                        title={t('plannedNeeds.configSources')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="pn-pulse-score-row">
                      <div className="pn-pulse-ring">
                        <svg width="56" height="56" viewBox="0 0 56 56" style={{ transform: 'rotate(-90deg)' }}>
                          <circle cx="28" cy="28" r="23" fill="none" stroke="var(--border-color)" strokeWidth="4" />
                          <circle
                            cx="28"
                            cy="28"
                            r="23"
                            fill="none"
                            stroke={pulseLabel.color}
                            strokeWidth="4"
                            strokeDasharray={`${((projection.pulse_score || 0) / 100) * 144.5} 144.5`}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dasharray 0.8s ease' }}
                          />
                        </svg>
                        <span className="pn-pulse-ring-score" style={{ color: pulseLabel.color }}>
                          {projection.pulse_score}
                        </span>
                      </div>
                      <div className="pn-pulse-label-block">
                        <span className="pn-pulse-status" style={{ color: pulseLabel.color }}>
                          {t(`plannedNeeds.pulseStatus.${pulseLabel.key}`)}
                        </span>
                        <span className="pn-pulse-sub">{t('plannedNeeds.pulseScoreLabel')}</span>
                      </div>
                      <div className="pn-pulse-bd">
                        {[
                          { l: t('plannedNeeds.scoreCoverage'), v: projection.score_breakdown?.coverage },
                          { l: t('plannedNeeds.scoreBuffer'), v: projection.score_breakdown?.buffer },
                          { l: t('plannedNeeds.scoreReliability'), v: projection.score_breakdown?.reliability },
                          { l: t('plannedNeeds.scoreObligations'), v: projection.score_breakdown?.obligations },
                        ].map((d, i) => (
                          <div key={i} className="pn-pulse-bd-item">
                            <span className="pn-pulse-bd-val">{d.v ?? '-'}</span>
                            <span className="pn-pulse-bd-label">{d.l}</span>
                          </div>
                        ))}
                        {projection.runway_months != null && (
                          <div className="pn-pulse-bd-item">
                            <span className="pn-pulse-bd-val">{projection.runway_months}mo</span>
                            <span className="pn-pulse-bd-label">{t('plannedNeeds.scoreRunway')}</span>
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowSettings(true)}
                        className="pn-pulse-settings-btn"
                        title={t('plannedNeeds.configScoreSourcesTitle')}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                        </svg>
                      </button>
                    </div>
                  )}

                  <button type="button" className="pn-sources-toggle" onClick={() => setShowSrcs((v) => !v)}>
                    {showSrcs ? t('plannedNeeds.hideSources') : t('plannedNeeds.showSources')}
                  </button>
                  {showSrcs && projection.sources && (() => {
                    const SRC_LIST = [
                      { key: 'manual_income_90d', label: t('plannedNeeds.srcManualIncome'), dir: '+' },
                      { key: 'recurring_income_monthly', label: t('plannedNeeds.srcRecurringIncome'), dir: '+' },
                      { key: 'oxsteed_income_90d', label: t('plannedNeeds.srcOxsteedIncome'), dir: '+' },
                      { key: 'tool_rental_income_90d', label: t('plannedNeeds.srcToolRentalIncome'), dir: '+' },
                      { key: 'invoice_income_90d', label: t('plannedNeeds.srcInvoiceIncome'), dir: '+' },
                      { key: 'predicted_jobs', label: t('plannedNeeds.srcPredictedJobs'), dir: '+' },
                      { key: 'predicted_invoices', label: t('plannedNeeds.srcPredictedInvoices'), dir: '+' },
                      { key: 'manual_expense_90d', label: t('plannedNeeds.srcManualExpense'), dir: '−' },
                      { key: 'recurring_expense_monthly', label: t('plannedNeeds.srcRecurringExpense'), dir: '−' },
                      { key: 'debt_monthly', label: t('plannedNeeds.srcDebt'), dir: '−' },
                      { key: 'home_maintenance_monthly', label: t('plannedNeeds.srcHomeMaint'), dir: '−' },
                      { key: 'car_care_monthly', label: t('plannedNeeds.srcCarCare'), dir: '−' },
                      { key: 'personal_care_monthly', label: t('plannedNeeds.srcPersonalCare'), dir: '−' },
                      { key: 'tax_obligations_window', label: t('plannedNeeds.srcTax'), dir: '−' },
                      { key: 'sinking_fund_window', label: t('plannedNeeds.srcSinkingFund'), dir: '−' },
                    ].filter((s) => (projection.sources[s.key] ?? 0) !== 0);
                    if (!SRC_LIST.length) return null;
                    return (
                      <div className="pn-sources-grid">
                        {SRC_LIST.map((s) => (
                          <div key={s.key} className="pn-source-row">
                            <span className="pn-source-label">{s.label}</span>
                            <span className={`pn-source-val ${s.dir === '+' ? 'positive' : 'negative'}`}>
                              {s.dir}
                              {(projection.sources[s.key] || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}

              <div className="pn-chart-wrap">
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="pnGradIncome" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#34d399" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="pnGradExp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="pnGradSink" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F4A261" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#F4A261" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" opacity={0.5} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-text)' }} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--muted-text)' }} width={44} />
                    <Tooltip
                      formatter={(val) => fmt$(val, currency)}
                      contentStyle={{
                        background: 'var(--card-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: 8,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="income"
                      name={t('plannedNeeds.projectedIncome')}
                      stroke="#34d399"
                      fill="url(#pnGradIncome)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="expenses"
                      name={t('plannedNeeds.fixedExpenses')}
                      stroke="#f87171"
                      fill="url(#pnGradExp)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="sinking"
                      name={t('plannedNeeds.sinkingFunds')}
                      stroke="#F4A261"
                      fill="url(#pnGradSink)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="pn-projection-grid pn-proj-grid-v2">
                <div className="pn-proj-stat pn-proj-stat-glow">
                  <div className="label">{t('plannedNeeds.projectedIncome')}</div>
                  <div className="value positive">{fmt$(incomeAnim, currency)}</div>
                  {!projection.no_data && (
                    <span className="pn-trend" title={t('plannedNeeds.trendVsPrior')}>
                      {trendArrow(trend.projected_income_pct)} {trend.projected_income_pct != null ? `${trend.projected_income_pct > 0 ? '+' : ''}${trend.projected_income_pct}%` : ''}
                    </span>
                  )}
                  {projection.no_data && (
                    <p className="pn-inline-cta">
                      <Link to="/dashboard">{t('plannedNeeds.ctaIncome')}</Link>
                    </p>
                  )}
                </div>
                <div className="pn-proj-stat pn-proj-stat-glow">
                  <div className="label">{t('plannedNeeds.fixedExpenses')}</div>
                  <div className="value negative">{fmt$(expAnim, currency)}</div>
                  {!projection.no_data && (
                    <span className="pn-trend" title={t('plannedNeeds.trendVsPrior')}>
                      {trendArrow(trend.projected_expenses_pct)} {trend.projected_expenses_pct != null ? `${trend.projected_expenses_pct > 0 ? '+' : ''}${trend.projected_expenses_pct}%` : ''}
                    </span>
                  )}
                  {projection.no_data && <p className="pn-inline-cta">{t('plannedNeeds.ctaExpense')}</p>}
                </div>
                <div className="pn-proj-stat pn-proj-stat-glow">
                  <div className="label">{t('plannedNeeds.sinkingFunds')}</div>
                  <div className="value warn">{fmt$(sinkAnim, currency)}</div>
                  {!projection.no_data && activeNeeds.length === 0 && (
                    <p className="pn-inline-cta">
                      <button type="button" className="pn-linkish" onClick={openAdd}>
                        {t('plannedNeeds.ctaSinking')}
                      </button>
                    </p>
                  )}
                </div>
                <div className="pn-proj-stat pn-proj-stat-glow">
                  <div className="label">{t('plannedNeeds.netAvailable')}</div>
                  <div className={`value ${(projection?.net_available ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                    {fmt$(netAnim, currency)}
                  </div>
                  {!projection.no_data && (
                    <span className="pn-trend" title={t('plannedNeeds.trendVsPrior')}>
                      {trendArrow(trend.net_available_pct)} {trend.net_available_pct != null ? `${trend.net_available_pct > 0 ? '+' : ''}${trend.net_available_pct}%` : ''}
                    </span>
                  )}
                </div>
                <div className="pn-proj-stat pn-proj-stat-glow pn-coverage-card">
                  <div className="label pn-coverage-head">
                    {t('plannedNeeds.coverageRatio')}
                    <span className="pn-info-tip" title={t('plannedNeeds.coverageTooltip')}>
                      ?
                    </span>
                  </div>
                  <div
                    className={`value ${
                      projection?.coverage_ratio == null
                        ? 'neutral'
                        : projection.coverage_ratio >= 1.2
                          ? 'positive'
                          : projection.coverage_ratio >= 0.9
                            ? 'warn'
                            : 'negative'
                    }`}
                  >
                    {projection?.coverage_ratio != null ? `${projection.coverage_ratio}x` : '-'}
                  </div>
                  {coveragePct != null && (
                    <div className="pn-coverage-ring-wrap">
                      <svg width="48" height="48" viewBox="0 0 48 48" className="pn-coverage-ring-svg">
                        <circle cx="24" cy="24" r="20" fill="none" stroke="var(--border-color)" strokeWidth="4" />
                        <circle
                          cx="24"
                          cy="24"
                          r="20"
                          fill="none"
                          stroke="#F4A261"
                          strokeWidth="4"
                          strokeDasharray={`${(coveragePct / 100) * 125.6} 125.6`}
                          transform="rotate(-90 24 24)"
                          strokeLinecap="round"
                        />
                      </svg>
                    </div>
                  )}
                  {!projection.no_data && (
                    <span className="pn-trend" title={t('plannedNeeds.trendVsPrior')}>
                      {trendArrow(trend.coverage_ratio_pct)} {trend.coverage_ratio_pct != null ? `${trend.coverage_ratio_pct > 0 ? '+' : ''}${trend.coverage_ratio_pct}%` : ''}
                    </span>
                  )}
                </div>
                <div className="pn-proj-stat pn-proj-stat-glow">
                  <div className="label">{t('plannedNeeds.autoPublishing')}</div>
                  <div className={`value ${(projection?.auto_publishing_in_window ?? 0) > 0 ? 'warn' : 'neutral'}`}>
                    {t('plannedNeeds.autoPublishCount', { count: projection?.auto_publishing_in_window ?? 0 })}
                  </div>
                  {autoList.length > 0 ? (
                    <ul className="pn-auto-list">
                      {autoList.slice(0, 4).map((a) => (
                        <li key={a.id}>
                          <span>{a.title}</span>
                          <span className="pn-auto-due">{fmtDate(a.due_date)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="pn-inline-cta">
                      <button type="button" className="pn-linkish" onClick={openAdd}>
                        {t('plannedNeeds.autoPublishSetup')}
                      </button>
                    </p>
                  )}
                </div>
              </div>

              {projection.alerts?.length > 0 && (
                <div className="pn-alerts">
                  {projection.alerts.map((alert, i) => (
                    <div key={i} className="pn-alert-item">
                      <span className="pn-alert-icon">⚠</span>
                      <span>{alert}</span>
                    </div>
                  ))}
                </div>
              )}

              <p className="pn-proj-note">
                {t('plannedNeeds.projectionNote', { window: t(`plannedNeeds.window${window_}`) })}
              </p>
            </>
          ) : (
            <p className="pn-proj-loading">{t('plannedNeeds.noProjection')}</p>
          )}
        </div>

        {activatingSoon.length > 0 && (
          <div className="pn-queue-banner">
            <span aria-hidden>⚡</span>
            <span>{t('plannedNeeds.queueBanner', { count: activatingSoon.length })}</span>
          </div>
        )}

        <div className="pn-toolbar">
          <div className="pn-filters">
            {['all', 'upcoming', 'saving', 'ready', 'overdue', 'completed'].map((f) => (
              <button
                key={f}
                type="button"
                className={`pn-filter-chip${filter === f ? ' active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {t(`plannedNeeds.filter.${f}`)}
              </button>
            ))}
          </div>
          <div className="pn-toolbar-right">
            <label className="pn-sort-label">
              <span>{t('plannedNeeds.sortLabel')}</span>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="date">{t('plannedNeeds.sortDate')}</option>
                <option value="cost">{t('plannedNeeds.sortCost')}</option>
                <option value="progress">{t('plannedNeeds.sortProgress')}</option>
              </select>
            </label>
            <div className="pn-view-toggle">
              <button
                type="button"
                className={viewMode === 'list' ? 'active' : ''}
                onClick={() => setViewMode('list')}
                title={t('plannedNeeds.viewList')}
              >
                <List size={18} />
              </button>
              <button
                type="button"
                className={viewMode === 'calendar' ? 'active' : ''}
                onClick={() => setViewMode('calendar')}
                title={t('plannedNeeds.viewCalendar')}
              >
                <LayoutGrid size={18} />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="pn-muted-center">{t('plannedNeeds.loading')}</p>
        ) : filter === 'completed' ? (
          <>
            <p className="pn-section-title">{t('plannedNeeds.historySection', { count: completedFiltered.length })}</p>
            <div className="pn-cards">
              {completedFiltered.map((need) => (
                <NeedCard
                  key={need.id}
                  need={need}
                  currency={currency}
                  onEdit={null}
                  onCancel={null}
                  onComplete={null}
                  onPause={null}
                  onDelete={null}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="pn-section-title">{t('plannedNeeds.activeSection', { count: filteredActive.length })}</p>
            {filteredActive.length === 0 && activeNeeds.length === 0 ? (
              <div className="pn-empty-v2">
                <div className="pn-empty-illustration" aria-hidden>
                  <CalendarDays size={48} strokeWidth={1.25} />
                  <ClipboardList size={28} className="pn-empty-ico2" />
                </div>
                <p className="pn-empty-title">{t('plannedNeeds.emptyTitle')}</p>
                <p className="pn-empty-sub">{t('plannedNeeds.emptySubtitle')}</p>
                <div className="pn-example-cards">
                  {EXAMPLE_CARDS.map((ex) => (
                    <div key={ex.key} className="pn-card pn-card-example">
                      <span className="pn-example-badge">{t('plannedNeeds.exampleBadge')}</span>
                      <h3 className="pn-card-title">{t(ex.titleKey)}</h3>
                      <p className="pn-example-meta">{t(ex.metaKey)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : filteredActive.length === 0 ? (
              <p className="pn-muted-center">{t('plannedNeeds.filterEmpty')}</p>
            ) : viewMode === 'calendar' ? (
              <PlannedNeedsCalendar month={calMonth} setMonth={setCalMonth} needs={filteredActive} currency={currency} t={t} />
            ) : (
              <div className="pn-cards pn-cards-animate">
                {filteredActive.map((need) => (
                  <NeedCard
                    key={need.id}
                    need={need}
                    currency={currency}
                    onEdit={() => openEdit(need)}
                    onCancel={() => openCancel(need)}
                    onComplete={() => openComplete(need)}
                    onPause={(id, next) => togglePause(id, next)}
                    onDelete={() => handleDelete(need)}
                    onUpdate={loadNeeds}
                    onFund={() => setFundNeed(need)}
                  />
                ))}
              </div>
            )}

            {activeNeeds.length > 0 && (
              <div className="pn-sinking-section">
                <button type="button" className="pn-sinking-toggle" onClick={() => setSinkingOpen((o) => !o)}>
                  {sinkingOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  {t('plannedNeeds.sinkingBreakdownTitle')}
                </button>
                {sinkingOpen && (
                  <>
                    <div className="pn-sinking-health">
                      <span>{t('plannedNeeds.sinkingHealth')}</span>
                      <div className="pn-sinking-health-bar">
                        <div
                          className="pn-sinking-health-fill"
                          style={{
                            width: `${Math.min(100, upcomingCost > 0 ? Math.round((totalReserved / upcomingCost) * 100) : 0)}%`,
                          }}
                        />
                      </div>
                      <span className="pn-sinking-health-pct">
                        {upcomingCost > 0 ? Math.min(100, Math.round((totalReserved / upcomingCost) * 100)) : 0}%
                      </span>
                    </div>
                    <ul className="pn-sinking-list">
                      {activeNeeds.map((n) => (
                        <SinkingRow key={n.id} need={n} currency={currency} onTopUp={() => setFundNeed(n)} t={t} />
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            <div className="pn-suggestions">
              <h3 className="pn-suggestions-title">
                <Sparkles size={18} className="pn-sug-icon" aria-hidden />
                {t('plannedNeeds.suggestionsTitle')}
              </h3>
              <div className="pn-suggestion-chips">
                {suggestions.suggestions.map((s, i) => (
                  <button key={i} type="button" className="pn-chip" onClick={() => applyQuickChip(s)}>
                    {t('plannedNeeds.suggestionRepeat', { title: s.title, days: s.days_since_completed })}
                  </button>
                ))}
                {suggestions.defaults.map((d, i) => (
                  <button key={`d-${i}`} type="button" className="pn-chip pn-chip-muted" onClick={() => applyQuickChip(d)}>
                    {d.title}
                  </button>
                ))}
              </div>
            </div>

            {inactiveNeeds.length > 0 && filter !== 'completed' && (
              <>
                <p className="pn-section-title" style={{ marginTop: '1rem' }}>
                  {t('plannedNeeds.historySection', { count: inactiveNeeds.length })}
                </p>
                <div className="pn-cards">
                  {inactiveNeeds.map((need) => (
                    <NeedCard
                      key={need.id}
                      need={need}
                      currency={currency}
                      onEdit={null}
                      onCancel={null}
                      onComplete={null}
                      onPause={null}
                      onDelete={null}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        <button type="button" className="pn-add-fab" onClick={openAdd} aria-label={t('plannedNeeds.addBtn')}>
          +
        </button>

        {(modal === 'add' || modal === 'edit') && (
          <div className="pn-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{modal === 'add' ? t('plannedNeeds.addTitle') : t('plannedNeeds.editTitle')}</h2>
              {modal === 'add' && <QuickAddTemplates onSelect={(tpl) => setForm((f) => ({ ...f, ...tpl }))} />}

              <div className="pn-form-group">
                <label>{t('plannedNeeds.titleRequired')}</label>
                <input
                  name="title"
                  value={form.title}
                  onChange={handleFormChange}
                  placeholder={t('plannedNeeds.titlePlaceholder')}
                  maxLength={200}
                />
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.categoryLabel')}</label>
                  <select name="category" value={form.category} onChange={handleFormChange}>
                    <option value="car_care">{t('plannedNeeds.catCarCare')}</option>
                    <option value="personal_care">{t('plannedNeeds.catPersonalCare')}</option>
                    <option value="other">{t('plannedNeeds.catOther')}</option>
                  </select>
                </div>
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.dueDateRequired')}</label>
                  <input type="date" name="due_date" value={form.due_date} onChange={handleFormChange} />
                </div>
              </div>

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.estimatedCost')}</label>
                  <input
                    type="number"
                    name="estimated_cost"
                    value={form.estimated_cost}
                    onChange={handleFormChange}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.leadTime')}</label>
                  <input
                    type="number"
                    name="lead_time_days"
                    value={form.lead_time_days}
                    onChange={handleFormChange}
                    min="1"
                    max="90"
                  />
                  <div className="pn-form-hint">{t('plannedNeeds.leadTimeHint')}</div>
                </div>
              </div>

              {form.category === 'car_care' && vehicles.length > 0 && (
                <div className="pn-form-group">
                  <label>
                    {t('plannedNeeds.vehicleOpt')}{' '}
                    <span style={{ fontWeight: 400, color: 'var(--muted-text)' }}>({t('common.optional')})</span>
                  </label>
                  <select name="vehicle_id" value={form.vehicle_id} onChange={handleFormChange}>
                    <option value="">{t('plannedNeeds.noVehicle')}</option>
                    {vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.nickname || `${v.year || ''} ${v.make_name || ''} ${v.model_name || ''}`.trim()}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {homes.length > 0 && (
                <div className="pn-form-group">
                  <label>
                    {t('plannedNeeds.propertyOpt')}{' '}
                    <span style={{ fontWeight: 400, color: 'var(--muted-text)' }}>({t('common.optional')})</span>
                  </label>
                  <select name="home_id" value={form.home_id} onChange={handleFormChange}>
                    <option value="">{t('plannedNeeds.noProperty')}</option>
                    {homes.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.nickname || h.address}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="pn-form-row">
                <div className="pn-form-group">
                  <label>{t('plannedNeeds.recurrenceLabel')}</label>
                  <select name="recurrence_type" value={form.recurrence_type} onChange={handleFormChange}>
                    <option value="none">{t('plannedNeeds.recurrenceNone')}</option>
                    <option value="fixed">{t('plannedNeeds.recurrenceFixed')}</option>
                    <option value="floating">{t('plannedNeeds.recurrenceFloating')}</option>
                  </select>
                </div>
                {form.recurrence_type !== 'none' && (
                  <div className="pn-form-group">
                    <label>{t('plannedNeeds.repeatEvery')}</label>
                    <input
                      type="number"
                      name="recurrence_interval_days"
                      value={form.recurrence_interval_days}
                      onChange={handleFormChange}
                      placeholder={t('plannedNeeds.repeatPlaceholder')}
                      min="1"
                    />
                  </div>
                )}
              </div>

              <div className="pn-form-group">
                <label>
                  {t('plannedNeeds.prefHelperOpt')}{' '}
                  <span style={{ fontWeight: 400, color: 'var(--muted-text)' }}>({t('common.optional')})</span>
                </label>
                {savedHelpers.length === 0 ? (
                  <div className="pn-form-hint" style={{ padding: '0.5rem 0' }}>
                    {t('plannedNeeds.noSavedHelpers')} <Link to="/helpers">{t('plannedNeeds.browseHelpers')}</Link>{' '}
                    {t('plannedNeeds.noSavedHelpersSuffix')}
                  </div>
                ) : (
                  <>
                    <select name="preferred_helper_id" value={form.preferred_helper_id} onChange={handleFormChange}>
                      <option value="">{t('plannedNeeds.noPreference')}</option>
                      {savedHelpers.map((h) => (
                        <option key={h.helper_id} value={h.helper_id}>
                          {h.first_name} {h.last_name}
                          {h.avg_rating ? ` · ★ ${parseFloat(h.avg_rating).toFixed(1)}` : ''}
                          {h.completed_jobs ? ` · ${h.completed_jobs} jobs` : ''}
                        </option>
                      ))}
                    </select>
                    {form.preferred_helper_id && <div className="pn-form-hint">{t('plannedNeeds.prefHelperHint')}</div>}
                  </>
                )}
              </div>

              <div className="pn-form-group">
                <label>{t('plannedNeeds.descriptionLabel')}</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleFormChange}
                  rows={2}
                  placeholder={t('plannedNeeds.descriptionPlaceholder')}
                />
              </div>

              <div className="pn-form-group">
                <label>{t('plannedNeeds.notesLabel')}</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleFormChange}
                  rows={2}
                  placeholder={t('plannedNeeds.notesPlaceholder')}
                />
              </div>

              {error && <p style={{ color: '#f87171', fontSize: '0.85rem', margin: '0 0 0.5rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button type="button" className="btn-ghost" onClick={closeModal}>
                  {t('plannedNeeds.cancelBtn')}
                </button>
                <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? t('plannedNeeds.saving') : modal === 'add' ? t('plannedNeeds.addNeedBtn') : t('plannedNeeds.saveChangesBtn')}
                </button>
              </div>
            </div>
          </div>
        )}

        {modal === 'cancel' && selected && (
          <div className="pn-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{t('plannedNeeds.cancelNeedTitle')}</h2>
              <p dangerouslySetInnerHTML={{ __html: t('plannedNeeds.cancelNeedConfirm', { name: `<strong>${selected.title}</strong>` }) }} />
              {error && <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button type="button" className="btn-ghost" onClick={closeModal}>
                  {t('plannedNeeds.keepIt')}
                </button>
                <button type="button" className="btn-danger" onClick={handleCancel} disabled={saving}>
                  {saving ? t('plannedNeeds.cancelling') : t('plannedNeeds.yesCancel')}
                </button>
              </div>
            </div>
          </div>
        )}

        {modal === 'complete' && selected && (
          <div className="pn-modal-overlay" onClick={(e) => e.target === e.currentTarget && closeModal()}>
            <div className="pn-modal">
              <h2>{t('plannedNeeds.completeTitle')}</h2>
              <p>{t('plannedNeeds.completeSub')}</p>
              <div className="pn-form-group">
                <label>{t('plannedNeeds.actualCost')}</label>
                <input
                  type="number"
                  name="actual_cost"
                  value={form.actual_cost}
                  onChange={handleFormChange}
                  placeholder={t('plannedNeeds.actualCostPlaceholder')}
                  min="0"
                  step="0.01"
                />
              </div>
              {selected.recurrence_type !== 'none' && (
                <p style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>{t('plannedNeeds.recurringNote')}</p>
              )}
              {error && <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{error}</p>}
              <div className="pn-modal-actions">
                <button type="button" className="btn-ghost" onClick={closeModal}>
                  {t('plannedNeeds.goBack')}
                </button>
                <button type="button" className="btn-primary" onClick={handleComplete} disabled={saving}>
                  {saving ? t('plannedNeeds.saving') : t('plannedNeeds.markComplete')}
                </button>
              </div>
            </div>
          </div>
        )}

        {fundNeed && (
          <div className="pn-modal-overlay" onClick={(e) => e.target === e.currentTarget && setFundNeed(null)}>
            <div className="pn-modal">
              <h2>{t('plannedNeeds.topUpTitle')}</h2>
              <p>{fundNeed.title}</p>
              <form onSubmit={submitTopUp} className="pn-form-group">
                <label>{t('plannedNeeds.topUpAmount')}</label>
                <input
                  type="number"
                  value={fundAmount}
                  onChange={(e) => setFundAmount(e.target.value)}
                  min="0.01"
                  step="0.01"
                  required
                />
                <div className="pn-modal-actions">
                  <button type="button" className="btn-ghost" onClick={() => setFundNeed(null)}>
                    {t('plannedNeeds.cancelBtn')}
                  </button>
                  <button type="submit" className="btn-primary">
                    {t('plannedNeeds.topUpSubmit')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function SinkingRow({ need, currency, onTopUp, t }) {
  const cost = parseFloat(need.estimated_cost || 0);
  const reserved = parseFloat(need.reserved_amount || 0);
  const daysLeft = parseInt(need.days_until_due, 10) || 0;
  const pct = cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0;
  return (
    <li className="pn-sinking-row">
      <div>
        <strong>{need.title}</strong>
        <div className="pn-sinking-meta">
          {t('plannedNeeds.sinkingTarget', { amount: fmt$(cost, currency) })} ·{' '}
          {t('plannedNeeds.sinkingSaved', { amount: fmt$(reserved, currency) })} ·{' '}
          {t('plannedNeeds.sinkingRateDay', { amount: fmt$(parseFloat(need.sinking_fund_per_day || 0), currency) })} ·{' '}
          {daysLeft >= 0 ? t('plannedNeeds.sinkingDays', { count: daysLeft }) : t('plannedNeeds.daysOverdue')}
        </div>
        <div className="pn-meter-track pn-meter-animate">
          <div className="pn-meter-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button type="button" className="pn-topup-btn" onClick={onTopUp}>
        {t('plannedNeeds.topUp')}
      </button>
    </li>
  );
}

function PlannedNeedsCalendar({ month, setMonth, needs, currency, t }) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const byDay = useMemo(() => {
    const map = {};
    for (const n of needs) {
      const ds = String(n.due_date).split('T')[0];
      const dt = new Date(ds + 'T12:00:00');
      if (dt.getFullYear() === y && dt.getMonth() === m) {
        const day = dt.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(n);
      }
    }
    return map;
  }, [needs, y, m]);

  return (
    <div className="pn-cal">
      <div className="pn-cal-nav">
        <button type="button" onClick={() => setMonth(new Date(y, m - 1, 1))}>
          ‹
        </button>
        <span>
          {month.toLocaleString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <button type="button" onClick={() => setMonth(new Date(y, m + 1, 1))}>
          ›
        </button>
      </div>
      <div className="pn-cal-grid">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <div key={d} className="pn-cal-dow">
            {d}
          </div>
        ))}
        {cells.map((day, idx) => (
          <div key={idx} className={`pn-cal-cell${day ? '' : ' empty'}`}>
            {day && (
              <>
                <span className="pn-cal-daynum">{day}</span>
                <div className="pn-cal-dots">
                  {(byDay[day] || []).map((n) => (
                    <div key={n.id} className={`pn-cal-dot cat-${n.category}`} title={n.title} />
                  ))}
                </div>
                {(byDay[day] || []).map((n) => (
                  <div key={n.id} className="pn-cal-mini">
                    <div className="pn-cal-cardteaser">
                      <span className="pn-cal-teaser-title">{n.title}</span>
                      {parseFloat(n.estimated_cost || 0) > 0 && (
                        <span className="pn-cal-teaser-cost">{fmt$(parseFloat(n.estimated_cost), currency)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function NeedCard({ need, currency = 'USD', onEdit, onCancel, onComplete, onUpdate, onPause, onDelete, onFund }) {
  const { t } = useTranslation();
  const cost = parseFloat(need?.estimated_cost ?? 0);
  const reserved = parseFloat(need?.reserved_amount ?? 0);
  const fundPct = cost > 0 ? Math.min(100, Math.round((reserved / cost) * 100)) : 0;
  const monthly = parseFloat(need?.sinking_fund_per_month ?? 0);
  const daysLeft = parseInt(need?.days_until_due ?? 0, 10) || 0;
  const isActive = ['planned', 'funding', 'activating_soon'].includes(need?.status);
  const helperName = helperDisplayName(need);
  const paused = Boolean(need.is_paused);

  const CATEGORY_LABELS = {
    car_care: t('plannedNeeds.catCarCare'),
    personal_care: t('plannedNeeds.catPersonalCare'),
    other: t('plannedNeeds.catOther'),
  };

  const uiStatus = (() => {
    if (need.status === 'completed') return { key: 'completed', className: 'st-completed' };
    if (need.status === 'cancelled') return { key: 'cancelled', className: 'st-cancelled' };
    if (need.status === 'published') return { key: 'published', className: 'st-published' };
    if (need.status === 'regenerated') return { key: 'regenerated', className: 'st-regenerated' };
    if (daysLeft < 0 && isActive) return { key: 'overdue', className: 'st-overdue' };
    if (need.status === 'activating_soon') return { key: 'ready', className: 'st-activating_soon' };
    if (need.status === 'funding' || (cost > 0 && fundPct < 100)) return { key: 'saving', className: 'st-funding' };
    return { key: 'planned', className: 'st-planned' };
  })();

  const PREF_HELPER_LABELS = {
    pending: t('plannedNeeds.prefStatusPending'),
    accepted: t('plannedNeeds.prefStatusAccepted'),
    declined: t('plannedNeeds.prefStatusDeclined'),
    expired: t('plannedNeeds.prefStatusExpired'),
  };

  return (
    <div
      className={`pn-card pn-card-v2 status-${need.status} pn-enter${uiStatus.key === 'overdue' ? ' pn-card-overdue' : ''}${paused ? ' pn-card-paused' : ''}`}
    >
      <div className="pn-card-main">
        <div className="pn-card-title-row">
          <CategoryIcon category={need.category} />
          <h3 className="pn-card-title">{need.title}</h3>
          <span className={`pn-badge cat-${need.category}`}>{CATEGORY_LABELS[need.category] || need.category}</span>
          <span className={`pn-badge ${uiStatus.className} pn-badge-pulse`}>{t(`plannedNeeds.uiStatus.${uiStatus.key}`)}</span>
        </div>

        <div className="pn-card-meta">
          <span>{t('plannedNeeds.due', { date: fmtDate(need.due_date) })}</span>
          {isActive && <span>{daysLabel(daysLeft, t)} {t('plannedNeeds.away')}</span>}
          {cost > 0 && <span>{t('plannedNeeds.est', { amount: fmt$(cost, currency) })}</span>}
          {need.actual_cost && <span>{t('plannedNeeds.actual', { amount: fmt$(need.actual_cost, currency) })}</span>}
          {need.recurrence_type !== 'none' && (
            <span>{t('plannedNeeds.recurrenceEvery', { days: need.recurrence_interval_days, type: need.recurrence_type })}</span>
          )}
          {need.lead_time_days && isActive && (
            <span>{t('plannedNeeds.autoPostsIn', { label: daysLabel(daysLeft - need.lead_time_days, t) })}</span>
          )}
        </div>

        {helperName ? (
          <div className="pn-preferred-helper">
            <span className="pn-ph-label">{t('plannedNeeds.preferredHelper')}</span>
            <span className="pn-ph-name">{helperName}</span>
            {need.preferred_helper_status && (
              <span
                className={`pn-badge pn-ph-status st-${
                  need.preferred_helper_status === 'pending'
                    ? 'activating_soon'
                    : need.preferred_helper_status === 'accepted'
                      ? 'published'
                      : need.preferred_helper_status === 'expired'
                        ? 'cancelled'
                        : 'planned'
                }`}
              >
                {PREF_HELPER_LABELS[need.preferred_helper_status] || need.preferred_helper_status}
              </span>
            )}
          </div>
        ) : (
          isActive && (
            <Link to="/helpers" className="pn-find-helper">
              {t('plannedNeeds.findHelper')}
            </Link>
          )
        )}

        {isActive && need.preferred_helper_id && need.status === 'published' && <PlannedNeedHoldStatus need={need} onUpdate={onUpdate} />}

        {cost > 0 && isActive && (
          <div className="pn-meter-wrap">
            <div className="pn-meter-labels">
              <span>{t('plannedNeeds.reserved', { amount: fmt$(reserved, currency) })}</span>
              <span>{t('plannedNeeds.funded', { pct: fundPct })}</span>
            </div>
            <div className="pn-meter-track pn-meter-animate">
              <div className="pn-meter-fill" style={{ width: `${fundPct}%` }} />
            </div>
          </div>
        )}

        {monthly > 0 && isActive && (
          <div className="pn-sinking-fund">{t('plannedNeeds.sinkingFundHint', { amount: fmt$(monthly, currency) })}</div>
        )}

        {need.description && (
          <p className="pn-card-desc">{need.description}</p>
        )}

        {isActive && onPause && (
          <label
            className="pn-pause-row"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span>{t('plannedNeeds.pauseAuto')}</span>
            <input
              type="checkbox"
              checked={paused}
              onChange={() => onPause(need.id, !paused)}
            />
          </label>
        )}
      </div>

      {isActive && (onEdit || onComplete || onCancel || onDelete || onFund || onPause) && (
        <div className="pn-card-actions pn-card-actions-v2">
          {onEdit && (
            <button type="button" className="pn-card-action-btn" onClick={onEdit} title={t('plannedNeeds.editBtn')}>
              <Pencil size={16} />
            </button>
          )}
          {onFund && (
            <button type="button" className="pn-card-action-btn" onClick={onFund} title={t('plannedNeeds.topUp')}>
              +
            </button>
          )}
          {onComplete && (
            <button type="button" className="pn-card-action-btn primary" onClick={onComplete}>
              {t('plannedNeeds.completeBtn')}
            </button>
          )}
          {onCancel && (
            <button type="button" className="pn-card-action-btn danger" onClick={onCancel}>
              {t('plannedNeeds.cancelBtn')}
            </button>
          )}
          {onDelete && (
            <button type="button" className="pn-card-action-btn danger" onClick={onDelete} title={t('plannedNeeds.deleteBtn')}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
