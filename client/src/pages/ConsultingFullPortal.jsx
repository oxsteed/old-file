// client/src/pages/ConsultingFullPortal.jsx
//
// Customer-facing consulting portal — mounted at /consulting/portal.
// Single cohesive view (no tabs) that reads the user's active engagement(s)
// and surfaces what they actually need to act on:
//
//   - Hero: current phase progress + next scheduled session
//   - Active engagement card with consultant info + meeting CTA
//   - Action items (across all sessions, grouped by urgency)
//   - Upcoming sessions list
//   - Past sessions / history
//   - Consultant card with contact
//   - "Need more help?" recommendations
//
// Empty state (no engagement): hero with "Start your consulting journey" +
// package picker pulled from /consulting/packages.
//
// Data sources (all existing):
//   GET /consulting/portal/dashboard            → { sessions, purchases }
//   GET /consulting/sessions/:id/action-items   → per-session items (lazy)
//   GET /consulting/packages                    → for the empty-state CTA

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import {
  CalendarClock, CheckCircle2, Circle, AlertTriangle, FileText, User, ArrowRight,
  Sparkles, Clock, Video, Award, MessageSquare, Package, Loader2, Plus,
  ChevronRight, Target,
} from 'lucide-react';

// ── small primitives ────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--color-bg, #06080d)' }}>
      <Loader2 size={24} className="animate-spin text-orange-500" />
    </div>
  );
}

function Card({ children, padding = 5, className = '', style = {} }) {
  const padMap = { 3: 'p-3', 4: 'p-4', 5: 'p-5', 6: 'p-6' };
  return (
    <section
      className={`rounded-xl border ${padMap[padding] || 'p-5'} ${className}`}
      style={{ borderColor: 'var(--color-border, #1f2937)', background: 'var(--color-surface, rgba(17,24,39,0.6))', ...style }}
    >
      {children}
    </section>
  );
}

function fmtDate(value, opts = {}) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      ...(opts.includeTime !== false ? { hour: 'numeric', minute: '2-digit' } : {}),
    });
  } catch { return '—'; }
}

function fmtMoney(cents, currency = 'USD') {
  if (cents == null) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

function classifyDue(dueDate) {
  if (!dueDate) return 'none';
  const ms = new Date(dueDate).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  const days = ms / (24 * 60 * 60 * 1000);
  if (days < 3) return 'soon';
  if (days < 14) return 'upcoming';
  return 'later';
}

// ── visual: phase progress ring ─────────────────────────────────────────────

function PhaseRing({ pct = 0 }) {
  const radius = 36;
  const stroke = 6;
  const c = 2 * Math.PI * radius;
  const offset = c - (Math.max(0, Math.min(100, pct)) / 100) * c;
  return (
    <div className="relative" style={{ width: 96, height: 96 }}>
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} stroke="rgba(148,163,184,0.2)" strokeWidth={stroke} fill="none" />
        <circle
          cx="48" cy="48" r={radius}
          stroke="#F97316" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 48 48)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold" style={{ color: 'var(--color-text, #f3f4f6)' }}>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

// ── phase timeline (4 generic phases) ───────────────────────────────────────

const PHASE_DEFS = [
  { key: 1, labelKey: 'consultingPortal.phases.discover',  label: 'Discover' },
  { key: 2, labelKey: 'consultingPortal.phases.plan',      label: 'Plan' },
  { key: 3, labelKey: 'consultingPortal.phases.execute',   label: 'Execute' },
  { key: 4, labelKey: 'consultingPortal.phases.handoff',   label: 'Handoff' },
];

function PhaseTimeline({ currentPhase = 1, t }) {
  return (
    <ol className="flex items-stretch gap-2 overflow-x-auto pb-1">
      {PHASE_DEFS.map((p, i) => {
        const isPast = currentPhase > p.key;
        const isActive = currentPhase === p.key;
        const color = isPast ? '#10B981' : isActive ? '#F97316' : '#4B5563';
        return (
          <li key={p.key} className="flex items-center gap-2 flex-shrink-0">
            <div
              className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
              style={{ background: `${color}1A`, color, border: `1px solid ${color}55` }}
            >
              {isPast ? <CheckCircle2 size={14} /> : p.key}
            </div>
            <span className="text-xs whitespace-nowrap" style={{ color: isActive ? 'var(--color-text)' : 'var(--color-text-muted, #94a3b8)', fontWeight: isActive ? 600 : 400 }}>
              {t(p.labelKey, { defaultValue: p.label })}
            </span>
            {i < PHASE_DEFS.length - 1 && (
              <ChevronRight size={14} className="opacity-30" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── action items ────────────────────────────────────────────────────────────

function ActionItemRow({ item, t }) {
  const due = classifyDue(item.due_date);
  const dueColor = due === 'overdue' ? '#EF4444' : due === 'soon' ? '#F97316' : 'var(--color-text-muted)';
  const isDone = item.status === 'completed';
  return (
    <li className="py-2.5 flex items-start gap-3">
      {isDone
        ? <CheckCircle2 size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
        : <Circle size={16} className="text-gray-500 mt-0.5 flex-shrink-0" />}
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${isDone ? 'line-through opacity-60' : ''}`} style={{ color: 'var(--color-text)' }}>
          {item.title}
        </div>
        {item.description && (
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
            {item.description}
          </div>
        )}
        {item.due_date && (
          <div className="text-[11px] mt-0.5 flex items-center gap-1" style={{ color: dueColor }}>
            <Clock size={10} />
            {due === 'overdue'
              ? t('consultingPortal.dueOverdue', { defaultValue: 'Overdue · ' }) + fmtDate(item.due_date, { includeTime: false })
              : t('consultingPortal.due', { defaultValue: 'Due ' }) + fmtDate(item.due_date, { includeTime: false })}
          </div>
        )}
      </div>
      {item.priority && item.priority >= 3 && !isDone && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-bold uppercase tracking-wider" style={{ background: 'rgba(239,68,68,0.12)', color: '#fca5a5' }}>
          {t('consultingPortal.priorityHigh', { defaultValue: 'High' })}
        </span>
      )}
    </li>
  );
}

// ── session card (active engagement) ────────────────────────────────────────

function ActiveSessionHero({ session, t }) {
  const pct = Number(session.progress_pct) || 0;
  const phase = Number(session.current_phase) || 1;
  const nextSession = session.scheduled_date
    ? `${session.scheduled_date}T${session.scheduled_time || '09:00'}`
    : session.scheduled_at;

  return (
    <Card padding={6} className="overflow-hidden" style={{ background: 'radial-gradient(circle at top left, rgba(249,115,22,0.18), transparent 35%), radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 30%), var(--color-surface)' }}>
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3" style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74' }}>
            <Sparkles size={11} />
            {session.service_tier ? session.service_tier.toUpperCase() : t('consultingPortal.heroEyebrow', { defaultValue: 'Active engagement' })}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--color-text, #f3f4f6)' }}>
            {session.business_name || t('consultingPortal.yourJourney', { defaultValue: 'Your consulting journey' })}
          </h1>
          {Array.isArray(session.areas_of_help) && session.areas_of_help.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {session.areas_of_help.slice(0, 6).map((a) => (
                <span key={a} className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'rgba(148,163,184,0.1)', color: 'var(--color-text-muted)' }}>
                  {a}
                </span>
              ))}
            </div>
          )}
          <div className="mt-5">
            <PhaseTimeline currentPhase={phase} t={t} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-3 flex-shrink-0">
          <PhaseRing pct={pct} />
          {nextSession && (
            <div className="rounded-lg border px-3 py-2 text-right" style={{ borderColor: 'rgba(148,163,184,0.2)' }}>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                {t('consultingPortal.nextSession', { defaultValue: 'Next session' })}
              </div>
              <div className="text-sm font-semibold mt-0.5">{fmtDate(nextSession)}</div>
              <button
                type="button"
                onClick={() => toast(t('consultingPortal.meetingLinkSoon', { defaultValue: 'Meeting link will be available 15 min before.' }))}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300"
              >
                <Video size={11} /> {t('consultingPortal.joinMeeting', { defaultValue: 'Join meeting' })}
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── consultant card ─────────────────────────────────────────────────────────

function ConsultantCard({ session, t }) {
  if (!session.consultant_assigned_id) {
    return (
      <Card>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-2">
          <User size={16} className="text-orange-500" />
          {t('consultingPortal.yourConsultant', { defaultValue: 'Your consultant' })}
        </h3>
        <div className="text-xs flex items-start gap-2" style={{ color: 'var(--color-text-muted)' }}>
          <Clock size={14} className="text-orange-400 mt-0.5 flex-shrink-0" />
          <span>{t('consultingPortal.consultantPending', { defaultValue: 'A consultant will be assigned to you shortly. You\'ll get an email when they reach out.' })}</span>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <User size={16} className="text-orange-500" />
        {t('consultingPortal.yourConsultant', { defaultValue: 'Your consultant' })}
      </h3>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold" style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74' }}>
          {(session.consultant_name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{session.consultant_name || t('consultingPortal.consultantAssigned', { defaultValue: 'Assigned consultant' })}</div>
          {session.consultant_email && (
            <div className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>{session.consultant_email}</div>
          )}
        </div>
      </div>
      <Link
        to="/messages"
        className="inline-flex items-center gap-1.5 text-xs mt-3 text-orange-400 hover:text-orange-300 font-semibold"
      >
        <MessageSquare size={12} /> {t('consultingPortal.openConversation', { defaultValue: 'Open conversation' })}
      </Link>
    </Card>
  );
}

// ── packages (empty-state CTA) ──────────────────────────────────────────────

function PackageGrid({ packages, t }) {
  if (!packages.length) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {packages.slice(0, 3).map((p) => (
        <Card key={p.id}>
          <div className="text-[10px] font-bold uppercase tracking-wider text-orange-400">{p.service_tier || p.tier}</div>
          <h3 className="text-lg font-semibold mt-1">{p.package_name || p.name}</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{p.description}</p>
          <div className="text-2xl font-bold mt-3">
            {p.base_price != null
              ? `$${Number(p.base_price).toLocaleString()}`
              : fmtMoney(p.price_cents)}
          </div>
          <Link
            to="/consulting"
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-orange-400 hover:text-orange-300"
          >
            {t('consultingPortal.startWith', { defaultValue: 'Start with this' })} <ArrowRight size={12} />
          </Link>
        </Card>
      ))}
    </div>
  );
}

// ── main page ───────────────────────────────────────────────────────────────

export default function ConsultingFullPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [sessions, setSessions] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [packages, setPackages] = useState([]);
  const [actionItems, setActionItems] = useState({});  // sessionId -> []
  const [loaded, setLoaded] = useState(false);

  // 1. Load dashboard + packages in parallel.
  useEffect(() => {
    let cancelled = false;
    const safe = (url) => api.get(url).then(r => r.data).catch(() => null);
    Promise.all([
      safe('/consulting/portal/dashboard'),
      safe('/consulting/packages'),
    ]).then(([d, p]) => {
      if (cancelled) return;
      setSessions(Array.isArray(d?.sessions) ? d.sessions : []);
      setPurchases(Array.isArray(d?.purchases) ? d.purchases : []);
      setPackages(Array.isArray(p) ? p : []);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  // 2. Lazy-load action items for the active sessions.
  useEffect(() => {
    const targets = sessions.filter(s => ['pending', 'scheduled'].includes(s.status));
    if (!targets.length) return;
    let cancelled = false;
    Promise.all(
      targets.map(s =>
        api.get(`/consulting/sessions/${s.id}/action-items`)
          .then(r => ({ id: s.id, items: r.data || [] }))
          .catch(() => ({ id: s.id, items: [] })),
      ),
    ).then((all) => {
      if (cancelled) return;
      const map = {};
      for (const { id, items } of all) map[id] = items;
      setActionItems(map);
    });
    return () => { cancelled = true; };
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find(s => ['pending', 'scheduled'].includes(s.status)) || sessions[0] || null,
    [sessions],
  );
  const upcomingSessions = useMemo(
    () => sessions.filter(s => s.status === 'scheduled' && s !== activeSession).slice(0, 5),
    [sessions, activeSession],
  );
  const pastSessions = useMemo(
    () => sessions.filter(s => s.status === 'completed').slice(0, 5),
    [sessions],
  );

  // Flatten + sort action items across all sessions.
  const flatActionItems = useMemo(() => {
    const all = [];
    for (const list of Object.values(actionItems)) {
      for (const it of list || []) {
        if (it.client_visible === false) continue;
        all.push(it);
      }
    }
    return all.sort((a, b) => {
      const dA = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const dB = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return dA - dB;
    });
  }, [actionItems]);

  const openItems   = flatActionItems.filter(i => i.status !== 'completed');
  const overdueOpen = openItems.filter(i => classifyDue(i.due_date) === 'overdue');
  const dueSoon     = openItems.filter(i => classifyDue(i.due_date) === 'soon');
  const otherOpen   = openItems.filter(i => !overdueOpen.includes(i) && !dueSoon.includes(i));
  const recentDone  = flatActionItems.filter(i => i.status === 'completed').slice(0, 4);

  if (!loaded) return <Spinner />;

  // ── EMPTY STATE ─────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #06080d)', color: 'var(--color-text, #f3f4f6)' }}>
        <PageMeta title={t('consultingPortal.title', { defaultValue: 'Consulting portal' })} />
        <Navbar />
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-12 flex flex-col gap-8">
          <section className="text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mx-auto" style={{ background: 'rgba(249,115,22,0.12)' }}>
              <Sparkles size={32} className="text-orange-500" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight mt-4">
              {t('consultingPortal.emptyTitle', { defaultValue: 'Start your consulting journey' })}
            </h1>
            <p className="text-base mt-3 max-w-xl mx-auto" style={{ color: 'var(--color-text-muted)' }}>
              {t('consultingPortal.emptySubtitle', { defaultValue: 'Pick a package, share what you need help with, and an OxSteed consultant will guide you from idea to launch.' })}
            </p>
            <Link
              to="/consulting"
              className="inline-flex items-center gap-2 mt-6 px-5 py-3 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
            >
              {t('consultingPortal.bookIntake', { defaultValue: 'Book your intake call' })} <ArrowRight size={16} />
            </Link>
          </section>

          {packages.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Package size={18} className="text-orange-500" />
                {t('consultingPortal.packagesTitle', { defaultValue: 'Choose a starting package' })}
              </h2>
              <PackageGrid packages={packages} t={t} />
            </section>
          )}
        </main>
        <Footer />
      </div>
    );
  }

  // ── ACTIVE PORTAL ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--color-bg, #06080d)', color: 'var(--color-text, #f3f4f6)' }}>
      <PageMeta title={t('consultingPortal.title', { defaultValue: 'Consulting portal' })} />
      <Navbar />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 flex flex-col gap-6">
        {activeSession && <ActiveSessionHero session={activeSession} t={t} />}

        {/* Stats strip */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card padding={4}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Target size={11} /> {t('consultingPortal.openItems', { defaultValue: 'Open action items' })}
            </div>
            <div className="text-2xl font-bold mt-1">{openItems.length}</div>
          </Card>
          <Card padding={4} style={overdueOpen.length > 0 ? { borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' } : {}}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: overdueOpen.length > 0 ? '#fca5a5' : 'var(--color-text-muted)' }}>
              <AlertTriangle size={11} /> {t('consultingPortal.overdue', { defaultValue: 'Overdue' })}
            </div>
            <div className="text-2xl font-bold mt-1">{overdueOpen.length}</div>
          </Card>
          <Card padding={4}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <CalendarClock size={11} /> {t('consultingPortal.upcoming', { defaultValue: 'Upcoming sessions' })}
            </div>
            <div className="text-2xl font-bold mt-1">{upcomingSessions.length + (activeSession?.status === 'scheduled' ? 1 : 0)}</div>
          </Card>
          <Card padding={4}>
            <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
              <Award size={11} /> {t('consultingPortal.completed', { defaultValue: 'Completed' })}
            </div>
            <div className="text-2xl font-bold mt-1">{pastSessions.length}</div>
          </Card>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* LEFT: action items + sessions */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            <Card>
              <header className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Target size={16} className="text-orange-500" />
                  {t('consultingPortal.actionItems', { defaultValue: 'Action items' })}
                </h3>
                {openItems.length > 0 && (
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('consultingPortal.openItemsCount', { count: openItems.length, defaultValue: `${openItems.length} open` })}
                  </span>
                )}
              </header>

              {openItems.length === 0 && recentDone.length === 0 ? (
                <div className="text-xs py-2" style={{ color: 'var(--color-text-muted)' }}>
                  {t('consultingPortal.noActionItems', { defaultValue: 'No action items yet. Your consultant will add some after your next session.' })}
                </div>
              ) : (
                <>
                  {overdueOpen.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-wider mb-1 font-semibold" style={{ color: '#fca5a5' }}>
                        {t('consultingPortal.sectionOverdue', { defaultValue: 'Overdue' })}
                      </div>
                      <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                        {overdueOpen.map(i => <ActionItemRow key={i.id} item={i} t={t} />)}
                      </ul>
                    </div>
                  )}
                  {dueSoon.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-wider mb-1 font-semibold" style={{ color: '#fdba74' }}>
                        {t('consultingPortal.sectionDueSoon', { defaultValue: 'Due soon' })}
                      </div>
                      <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                        {dueSoon.map(i => <ActionItemRow key={i.id} item={i} t={t} />)}
                      </ul>
                    </div>
                  )}
                  {otherOpen.length > 0 && (
                    <div className="mb-4">
                      <div className="text-[10px] uppercase tracking-wider mb-1 font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                        {t('consultingPortal.sectionLater', { defaultValue: 'Later' })}
                      </div>
                      <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                        {otherOpen.map(i => <ActionItemRow key={i.id} item={i} t={t} />)}
                      </ul>
                    </div>
                  )}
                  {recentDone.length > 0 && (
                    <details className="mt-2">
                      <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--color-text-muted)' }}>
                        {t('consultingPortal.recentlyDone', { count: recentDone.length, defaultValue: `Recently completed (${recentDone.length})` })}
                      </summary>
                      <ul className="divide-y mt-2" style={{ borderColor: 'var(--color-border)' }}>
                        {recentDone.map(i => <ActionItemRow key={i.id} item={i} t={t} />)}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </Card>

            {upcomingSessions.length > 0 && (
              <Card>
                <header className="flex items-center gap-2 mb-3">
                  <CalendarClock size={16} className="text-orange-500" />
                  <h3 className="text-sm font-semibold">{t('consultingPortal.upcomingSessionsTitle', { defaultValue: 'Upcoming sessions' })}</h3>
                </header>
                <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {upcomingSessions.map(s => (
                    <li key={s.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {s.service_tier ? `${s.service_tier} · ` : ''}{s.business_name || `Session #${s.id}`}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {s.scheduled_date
                            ? fmtDate(`${s.scheduled_date}T${s.scheduled_time || '09:00'}`)
                            : (s.scheduled_at ? fmtDate(s.scheduled_at) : t('consultingPortal.tba', { defaultValue: 'TBA' }))}
                        </div>
                      </div>
                      <Link
                        to={`/consulting/${s.id}`}
                        className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 flex-shrink-0"
                      >
                        {t('common.view', { defaultValue: 'View' })} <ArrowRight size={11} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            {pastSessions.length > 0 && (
              <Card>
                <header className="flex items-center gap-2 mb-3">
                  <Award size={16} className="text-orange-500" />
                  <h3 className="text-sm font-semibold">{t('consultingPortal.pastSessionsTitle', { defaultValue: 'Past sessions' })}</h3>
                </header>
                <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {pastSessions.map(s => (
                    <li key={s.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {s.service_tier ? `${s.service_tier} · ` : ''}{s.business_name || `Session #${s.id}`}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t('consultingPortal.completedOn', { defaultValue: 'Completed' })} {fmtDate(s.completed_at || s.updated_at, { includeTime: false })}
                        </div>
                      </div>
                      <Link
                        to={`/consulting/${s.id}/feedback`}
                        className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 flex-shrink-0"
                      >
                        {t('consultingPortal.giveFeedback', { defaultValue: 'Give feedback' })} <ArrowRight size={11} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>

          {/* RIGHT: consultant card + purchases + CTAs */}
          <div className="flex flex-col gap-4">
            {activeSession && <ConsultantCard session={activeSession} t={t} />}

            {purchases.length > 0 && (
              <Card>
                <header className="flex items-center gap-2 mb-3">
                  <FileText size={16} className="text-orange-500" />
                  <h3 className="text-sm font-semibold">{t('consultingPortal.activePackages', { defaultValue: 'Your packages' })}</h3>
                </header>
                <ul className="flex flex-col gap-2">
                  {purchases.map(p => (
                    <li key={p.id} className="text-sm">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                        {p.tier && <span className="uppercase tracking-wider mr-1">{p.tier}</span>}
                        {p.completed_at ? `· ${t('consultingPortal.completedOn', { defaultValue: 'Completed' })} ${fmtDate(p.completed_at, { includeTime: false })}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card style={{ background: 'rgba(249,115,22,0.06)', borderColor: 'rgba(249,115,22,0.25)' }}>
              <h3 className="text-sm font-semibold">{t('consultingPortal.bookMoreTitle', { defaultValue: 'Need more help?' })}</h3>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                {t('consultingPortal.bookMoreHint', { defaultValue: 'Add another package or schedule a follow-up session with your consultant.' })}
              </p>
              <div className="flex flex-col gap-2 mt-3">
                <Link
                  to="/consulting"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white"
                >
                  <Plus size={12} /> {t('consultingPortal.addPackage', { defaultValue: 'Add a package' })}
                </Link>
                <Link
                  to="/messages"
                  className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md border hover:bg-white/5"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <MessageSquare size={12} /> {t('consultingPortal.messageConsultant', { defaultValue: 'Message your consultant' })}
                </Link>
              </div>
            </Card>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
