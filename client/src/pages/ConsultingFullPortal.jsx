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
import { schedulingApi } from '../api/scheduling';
import { deliverablesApi } from '../api/consultantDeliverables';
import { confidentialityApi, downloadEngagementRecord } from '../api/consultantConfidentiality';
import { useAuth } from '../context/AuthContext';
import ConsultantScheduleSelector from '../components/ConsultantScheduleSelector';
import ConsultantRescheduleDialog from '../components/ConsultantRescheduleDialog';
import ConsultantCancelSessionDialog from '../components/ConsultantCancelSessionDialog';
import ConsultingPaymentModal from '../components/ConsultingPaymentModal';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageMeta from '../components/PageMeta';
import {
  CalendarClock, CheckCircle2, Circle, AlertTriangle, FileText, User, ArrowRight,
  Sparkles, Clock, Video, Award, MessageSquare, Package, Loader2, Plus,
  ChevronRight, Target, Compass, ClipboardCheck, ShieldCheck, TrendingUp,
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

function ActiveSessionHero({ session, t, onBookReschedule, onScheduleSession, schedulingBusy }) {
  const pct = Number(session.progress_pct) || 0;
  const phase = Number(session.current_phase) || 1;
  // A pending_confirmation scheduled row carries only the 1970-01-01 sentinel
  // date (its date/time columns are NOT NULL), so it must never render as a
  // real appointment. Only confirmed/completed rows show a next session;
  // sessions with no scheduled row fall back to the legacy scheduled_at.
  const hasScheduledRow = session.scheduled_id != null;
  const isConfirmedSchedule = ['confirmed', 'completed'].includes(session.scheduled_status);
  const nextSession = isConfirmedSchedule && session.scheduled_date
    ? `${session.scheduled_date}T${session.scheduled_time || '09:00'}`
    : (!hasScheduledRow ? session.scheduled_at : null);

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
              {session.meeting_link ? (
                <a
                  href={session.meeting_link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300" data-track="ui.719d896ad2.1"
                >
                  <Video size={11} /> {t('consultingPortal.joinMeeting', { defaultValue: 'Join meeting' })}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => toast(t('consultingPortal.meetingLinkSoon', { defaultValue: 'Meeting link will be available 15 min before.' }))}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-400 hover:text-orange-300" data-track="ui.719d896ad2.1"
                >
                  <Video size={11} /> {t('consultingPortal.joinMeeting', { defaultValue: 'Join meeting' })}
                </button>
              )}
            </div>
          )}
          {session.scheduled_id && session.consultant_assigned_id && (
            <button
              type="button"
              onClick={onBookReschedule}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white" data-track="ui.719d896ad2.2"
            >
              <CalendarClock size={12} /> {t('consultingPortal.bookReschedule')}
            </button>
          )}
          {!session.scheduled_id && (
            <button
              type="button"
              onClick={onScheduleSession}
              disabled={schedulingBusy}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-60" data-track="ui.719d896ad2.3"
            >
              <CalendarClock size={12} /> {t('consultingPortal.scheduleSession')}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── session schedule panel (Group 10 Slice C, 518-520) ────────────────────
// Pending reschedule proposals for one appointment, the client's own
// attendance confirmation once the start has passed, and cancellation.
// Rendered under the hero for the active session; returns null when there
// is nothing to act on.
function SchedulePanel({ session, detail, t, onChanged, onReschedule, onCancel }) {
  const [busy, setBusy] = useState('');
  if (!session?.scheduled_id || !detail) return null;
  const scheduled = detail.scheduled || {};
  const proposals = (detail.proposals || []).filter((p) => p.status === 'proposed');
  const attendance = detail.attendance || [];
  const clientConfirmed = attendance.some((a) => a.role === 'client');
  const consultantConfirmed = attendance.some((a) => a.role === 'consultant');
  const startPassed = scheduled.scheduled_date
    ? new Date(`${scheduled.scheduled_date}T${scheduled.scheduled_time || '00:00'}`).getTime() <= Date.now()
    : false;
  const cancellable = ['confirmed', 'pending_confirmation'].includes(scheduled.status);
  const canConfirmAttendance = startPassed && !clientConfirmed && ['confirmed', 'completed'].includes(scheduled.status);
  if (proposals.length === 0 && !canConfirmAttendance && !cancellable && !clientConfirmed && !consultantConfirmed) return null;

  const runAction = async (key, fn, successKey) => {
    setBusy(key);
    try {
      await fn();
      if (successKey) toast.success(t(successKey));
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || t('common.errorUpdating'));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
        <CalendarClock size={16} className="text-orange-500" />
        {t('consultingPortal.schedulePanelTitle')}
      </h3>

      {proposals.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider mb-2 text-amber-300">
            {t('consultingPortal.pendingProposals')}
          </div>
          <ul className="flex flex-col gap-2">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-xs">
                  <span className="font-semibold">
                    {fmtDate(`${p.proposed_date}T${p.proposed_time}`)}
                  </span>
                  {' · '}
                  {p.proposed_by_role === 'client'
                    ? t('consultingPortal.proposedByYou')
                    : p.proposed_by_role === 'consultant'
                      ? t('consultingPortal.proposedByConsultant')
                      : t('consultingPortal.proposedByOxsteed')}
                  {p.reason ? ` · ${p.reason}` : ''}
                </div>
                <div className="flex gap-1.5">
                  {p.proposed_by_role === 'client' ? (
                    <button
                      type="button"
                      disabled={busy === `withdraw-${p.id}`}
                      onClick={() => runAction(`withdraw-${p.id}`, () => schedulingApi.withdrawReschedule(session.scheduled_id, p.id), 'scheduling.rescheduleWithdrawn')}
                      className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-700 disabled:opacity-60" data-track="ui.719d896ad2.5"
                    >
                      {t('scheduling.withdraw')}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy === `accept-${p.id}`}
                        onClick={() => runAction(`accept-${p.id}`, () => schedulingApi.acceptReschedule(session.scheduled_id, p.id), 'scheduling.rescheduleAccepted')}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60" data-track="ui.719d896ad2.6"
                      >
                        {t('scheduling.accept')}
                      </button>
                      <button
                        type="button"
                        disabled={busy === `decline-${p.id}`}
                        onClick={() => runAction(`decline-${p.id}`, () => schedulingApi.declineReschedule(session.scheduled_id, p.id), 'scheduling.rescheduleDeclined')}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-gray-700 disabled:opacity-60" data-track="ui.719d896ad2.7"
                      >
                        {t('scheduling.decline')}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {canConfirmAttendance && (
          <button
            type="button"
            disabled={busy === 'attend'}
            onClick={() => runAction('attend', () => schedulingApi.confirmAttendance(session.scheduled_id), 'scheduling.attendanceConfirmed')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60" data-track="ui.719d896ad2.8"
          >
            <CheckCircle2 size={12} /> {t('scheduling.confirmAttendance')}
          </button>
        )}
        {clientConfirmed && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
            <CheckCircle2 size={12} /> {t('scheduling.attendanceConfirmedByYou')}
          </span>
        )}
        {consultantConfirmed && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <CheckCircle2 size={12} /> {t('scheduling.attendanceConfirmedByConsultant')}
          </span>
        )}
        {cancellable && (
          <>
            <button
              type="button"
              onClick={onReschedule}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md bg-orange-500 hover:bg-orange-600 text-white" data-track="ui.719d896ad2.9"
            >
              <CalendarClock size={12} /> {t('scheduling.proposeNewTime')}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md border border-red-700 text-red-300 hover:bg-red-600/10" data-track="ui.719d896ad2.10"
            >
              {t('scheduling.cancelSession')}
            </button>
          </>
        )}
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
          <p className="text-xs mt-1 text-[var(--color-text-muted)]">{p.description}</p>
          <div className="text-2xl font-bold mt-3">
            {p.base_price != null
              ? `$${Number(p.base_price).toLocaleString()}`
              : fmtMoney(p.price_cents)}
          </div>
          <Link
            to="/consulting-intake"
            className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-orange-400 hover:text-orange-300"
          >
            {t('consultingPortal.startWith', { defaultValue: 'Start with this' })} <ArrowRight size={12} />
          </Link>
        </Card>
      ))}
    </div>
  );
}

// Group 10 Slice G (536-540): engagements the signed-in user
// participates in as a site contact or observer. The participant reads
// the milestone board and the documents shared with them, acknowledges
// confidentiality for themselves, and exports the engagement record.
// Participants never mutate: no file, decide, accept, upload, or pause.
function ParticipatingEngagements({ user }) {
  const { t } = useTranslation();
  const [engagements, setEngagements] = useState([]);
  const [details, setDetails] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      const { data } = await confidentialityApi.listParticipatingSessions();
      const list = Array.isArray(data?.engagements) ? data.engagements : [];
      setEngagements(list);
      const entries = await Promise.all(list.map(async (item) => {
        const [confRes, boardRes] = await Promise.all([
          confidentialityApi.getClientConfidentiality(item.id).catch(() => null),
          deliverablesApi.listClientDeliverables(item.id).catch(() => null),
        ]);
        return [item.id, {
          confidentiality: confRes?.data || null,
          deliverables: Array.isArray(boardRes?.data?.deliverables) ? boardRes.data.deliverables : [],
        }];
      }));
      const map = {};
      for (const [id, detail] of entries) map[id] = detail;
      setDetails(map);
    } catch {
      toast.error(t('consultantConfidentiality.loadError', { defaultValue: 'Could not load confidentiality details.' }));
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => { load(); }, []);

  if (!loaded) return null;
  if (engagements.length === 0) return null;

  const acknowledge = async (sessionId) => {
    setBusy(`ack-${sessionId}`);
    try {
      await confidentialityApi.acknowledgeClientConfidentiality(sessionId);
      toast.success(t('consultantConfidentiality.acknowledged', { defaultValue: 'Confidentiality acknowledged.' }));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setBusy('');
    }
  };

  const exportRecord = async (sessionId) => {
    setBusy(`export-${sessionId}`);
    try {
      const { data } = await confidentialityApi.exportClientRecord(sessionId);
      downloadEngagementRecord(data, sessionId);
      toast.success(t('consultantConfidentiality.exported', { defaultValue: 'Engagement record downloaded.' }));
    } catch {
      toast.error(t('consultantConfidentiality.exportError', { defaultValue: 'Could not export the engagement record.' }));
    } finally {
      setBusy('');
    }
  };

  const downloadDocument = async (doc) => {
    try {
      const { data } = await deliverablesApi.downloadClientDocument(doc.id);
      if (data?.url) window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error(t('consultantDeliverable.downloadError', { defaultValue: 'Could not prepare the download.' }));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold flex items-center gap-2">
        <ShieldCheck size={18} className="text-orange-500" />
        {t('consultantConfidentiality.participatingTitle', { defaultValue: 'Engagements you participate in' })}
      </h2>
      {engagements.map((item) => {
        const detail = details[item.id] || {};
        const parties = detail.confidentiality?.parties || [];
        const myAck = parties.find((party) => String(party.userId) === String(user?.id)) || null;
        const pending = parties.filter((party) => !party.acknowledgedAt);
        return (
          <Card key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold">{item.businessName || item.business_name || 'Engagement'}</h3>
                <p className="text-xs mt-1 text-[var(--color-text-muted)]">
                  {t(`consultantConfidentiality.roles.${item.participantRole}`, { defaultValue: (item.participantRole || 'observer').replace(/_/g, ' ') })}
                  {' • '}
                  {item.status}
                </p>
              </div>
              <button
                type="button"
                onClick={() => exportRecord(item.id)}
                disabled={busy === `export-${item.id}`}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold transition hover:border-orange-400 hover:text-orange-300 disabled:opacity-60 border-[rgba(148,163,184,0.22)] text-[var(--color-text)]" data-track="ui.719d896ad2.12"
              >
                {t('consultantConfidentiality.export', { defaultValue: 'Export engagement record' })}
              </button>
            </div>
            {pending.length === 0 ? (
              <p className="text-xs mt-3 text-[#6ee7b7]">
                {t('consultantConfidentiality.ackDone', { defaultValue: 'Everyone on this engagement has acknowledged confidentiality.' })}
              </p>
            ) : (
              <p className="text-xs mt-3 text-[var(--color-text-muted)]">
                {pending.map((party) => t('consultantConfidentiality.ackPending', { defaultValue: 'Still waiting on {{name}}.', name: [party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId })).join(' ')}
              </p>
            )}
            {(!myAck || !myAck.acknowledgedAt) && (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-xs text-[var(--color-text-muted)]">
                  {t('consultantConfidentiality.ackStatement', { defaultValue: 'I will keep this engagement\u2019s information confidential and share it only with the people on this engagement.' })}
                </p>
                <div>
                  <button
                    type="button"
                    onClick={() => acknowledge(item.id)}
                    disabled={busy === `ack-${item.id}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition disabled:opacity-60" data-track="ui.719d896ad2.13"
                  >
                    {t('consultantConfidentiality.acknowledge', { defaultValue: 'Acknowledge confidentiality' })}
                  </button>
                </div>
              </div>
            )}
            {myAck?.acknowledgedAt && (
              <p className="text-xs mt-3 text-[#6ee7b7]">
                {t('consultantConfidentiality.ackYou', { defaultValue: 'You have acknowledged confidentiality.' })}
              </p>
            )}
            {(detail.deliverables || []).length > 0 && (
              <div className="mt-4 grid gap-2">
                {detail.deliverables.map((deliverable) => (
                  <div key={deliverable.id} className="rounded-xl border p-3 border-[rgba(148,163,184,0.16)] bg-[rgba(255,255,255,0.03)]">
                    <div className="text-sm font-semibold">{deliverable.name}</div>
                    <div className="text-xs mt-1 text-[var(--color-text-muted)]">
                      {t(`consultantDeliverable.status.${deliverable.status}`, { defaultValue: (deliverable.status || '').replace(/_/g, ' ') })}
                    </div>
                    {(deliverable.documents || []).length > 0 && (
                      <ul className="mt-2 grid gap-1">
                        {deliverable.documents.map((doc) => (
                          <li key={doc.id} className="flex items-center gap-2 text-xs">
                            <span className="flex-1 min-w-0 truncate">{doc.originalName}</span>
                            {doc.expired ? (
                              <span className="text-[#fca5a5]">{t('consultantConfidentiality.docExpired', { defaultValue: 'Access expired' })}</span>
                            ) : doc.expiresAt ? (
                              <span className="text-[var(--color-text-muted)]">{t('consultantConfidentiality.docExpiry', { defaultValue: 'Access until {{date}}', date: String(doc.expiresAt).slice(0, 10) })}</span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => downloadDocument(doc)}
                              className="font-semibold text-indigo-300 hover:text-indigo-200" data-track="ui.719d896ad2.14"
                            >
                              {t('consultantDeliverable.download', { defaultValue: 'Download' })}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        );
      })}
    </section>
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
  const [schedulingSession, setSchedulingSession] = useState(null); // session open in the booking widget
  const [paymentSession, setPaymentSession] = useState(null); // session open in the payment modal
  const [paymentReturnsToWidget, setPaymentReturnsToWidget] = useState(false);
  const [creatingSchedule, setCreatingSchedule] = useState(false);
  // Group 10 Slice C (518-520): per-appointment detail (proposals +
  // attendance) keyed by scheduled_id, plus the open dialogs.
  const [sessionDetails, setSessionDetails] = useState({});
  const [rescheduleSession, setRescheduleSession] = useState(null);
  const [cancelTarget, setCancelTarget] = useState(null);
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

  // Re-read the dashboard (sessions + purchases) and return the sessions.
  const fetchDashboardSessions = async () => {
    try {
      const d = await api.get('/consulting/portal/dashboard').then(r => r.data);
      if (Array.isArray(d?.sessions)) setSessions(d.sessions);
      if (Array.isArray(d?.purchases)) setPurchases(d.purchases);
      return Array.isArray(d?.sessions) ? d.sessions : sessions;
    } catch {
      return sessions;
    }
  };

  // Slice B wiring: a session with no scheduled row gets one created, then
  // proceeds to payment (the new row is unpaid by construction) and, once
  // paid, to the booking widget when a consultant is assigned.
  const handleScheduleSession = async (session) => {
    if (!session || creatingSchedule) return;
    setCreatingSchedule(true);
    try {
      const { data } = await schedulingApi.createScheduledSession(
        session.id,
        session.consultant_assigned_id || null,
      );
      const updated = {
        ...session,
        scheduled_id: data.id,
        scheduled_status: data.status || 'pending_confirmation',
        scheduled_date: data.scheduled_date,
        scheduled_time: data.scheduled_time,
        is_paid: false,
      };
      setSessions((prev) => prev.map((s) => (s.id === session.id ? updated : s)));
      setPaymentReturnsToWidget(true);
      setPaymentSession(updated);
    } catch (err) {
      toast.error(t('common.errorUpdating'));
    } finally {
      setCreatingSchedule(false);
    }
  };

  // Payment success: close the modal, refresh, then reopen the booking
  // widget for the same session when a consultant is assigned so the user
  // can book immediately instead of hunting for the button again.
  const handlePaymentSuccess = async () => {
    const paidSession = paymentSession;
    const returnToWidget = paymentReturnsToWidget;
    setPaymentSession(null);
    setPaymentReturnsToWidget(false);
    if (!paidSession || !returnToWidget) return;
    const fresh = await fetchDashboardSessions();
    const current = fresh.find((s) => s.id === paidSession.id) || paidSession;
    if (current.consultant_assigned_id) setSchedulingSession(current);
    else toast(t('consultingPortal.consultantPending'));
  };

  // Slice C wiring: load each appointment's proposals and attendance once
  // the dashboard sessions are known, and refresh them after any schedule
  // action (proposal answer, attendance, cancellation).
  const loadSessionDetails = async (list) => {
    const withRows = (list || []).filter((s) => s.scheduled_id);
    if (!withRows.length) return;
    const entries = await Promise.all(
      withRows.map((s) =>
        schedulingApi.getSessionDetail(s.scheduled_id)
          .then((r) => [s.scheduled_id, r.data])
          .catch(() => null),
      ),
    );
    setSessionDetails((prev) => {
      const next = { ...prev };
      for (const entry of entries) if (entry) next[entry[0]] = entry[1];
      return next;
    });
  };

  useEffect(() => {
    if (sessions.length) loadSessionDetails(sessions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions]);

  const refreshSchedule = async () => {
    const fresh = await fetchDashboardSessions();
    await loadSessionDetails(fresh);
  };

  // Open booking for any session row: create the row first when missing,
  // open the widget when a consultant is assigned, otherwise explain why
  // booking cannot start yet. A confirmed appointment opens the
  // reschedule dialog instead: the booking widget 409s on confirmed rows.
  const openBookingFor = (session) => {
    if (!session) return;
    if (!session.scheduled_id) { handleScheduleSession(session); return; }
    if (!session.consultant_assigned_id) { toast(t('consultingPortal.consultantPending')); return; }
    if (session.scheduled_status === 'confirmed') { setRescheduleSession(session); return; }
    setSchedulingSession(session);
  };

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
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-10 flex flex-col gap-8">
          <section
            className="rounded-3xl border p-6 md:p-8 overflow-hidden"
            style={{
              borderColor: 'rgba(249,115,22,0.18)',
              background:
                'radial-gradient(circle at top left, rgba(249,115,22,0.18), transparent 28%), radial-gradient(circle at top right, rgba(56,189,248,0.12), transparent 24%), linear-gradient(180deg, rgba(17,24,39,0.88), rgba(9,12,18,0.96))',
            }}
          >
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_340px] gap-6 items-start">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider" style={{ background: 'rgba(249,115,22,0.15)', color: '#fdba74' }}>
                  <Sparkles size={12} />
                  {t('consultingPortal.emptyEyebrow', { defaultValue: 'Business launch consulting' })}
                </div>
                <h1 className="text-3xl md:text-5xl font-bold tracking-tight mt-4 max-w-3xl">
                  {t('consultingPortal.emptyTitle', { defaultValue: 'Start your consulting journey' })}
                </h1>
                <p className="text-base md:text-lg mt-4 max-w-2xl" style={{ color: 'var(--color-text-muted)' }}>
                  {t('consultingPortal.emptySubtitle', { defaultValue: 'Pick a package, share what you need help with, and an OxSteed consultant will guide you from idea to launch.' })}
                </p>

                <div className="flex flex-wrap gap-3 mt-6">
                  <Link
                    to="/consulting-intake"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition"
                  >
                    {t('consultingPortal.bookIntake', { defaultValue: 'Book your intake call' })} <ArrowRight size={16} />
                  </Link>
                  <Link
                    to="/business-launch-status"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl border text-sm font-semibold transition hover:border-orange-400 hover:text-orange-300"
                    style={{ borderColor: 'rgba(148,163,184,0.22)', color: 'var(--color-text)' }}
                  >
                    {t('consultingPortal.viewLaunchStatus', { defaultValue: 'View launch status' })}
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8">
                  <Card padding={4} style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                      <Compass size={11} /> {t('consultingPortal.emptyStat1Label', { defaultValue: 'Starts with clarity' })}
                    </div>
                    <div className="text-sm font-semibold mt-2">{t('consultingPortal.emptyStat1Value', { defaultValue: 'Discovery, direction, and package fit' })}</div>
                  </Card>
                  <Card padding={4} style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                      <ClipboardCheck size={11} /> {t('consultingPortal.emptyStat2Label', { defaultValue: 'Built for execution' })}
                    </div>
                    <div className="text-sm font-semibold mt-2">{t('consultingPortal.emptyStat2Value', { defaultValue: 'Phases, deliverables, and action items' })}</div>
                  </Card>
                  <Card padding={4} style={{ background: 'rgba(255,255,255,0.04)' }}>
                    <div className="text-[10px] uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                      <ShieldCheck size={11} /> {t('consultingPortal.emptyStat3Label', { defaultValue: 'One portal after purchase' })}
                    </div>
                    <div className="text-sm font-semibold mt-2">{t('consultingPortal.emptyStat3Value', { defaultValue: 'Sessions, progress, files, and consultant communication' })}</div>
                  </Card>
                </div>
              </div>

              <Card
                padding={5}
                style={{
                  background: 'rgba(6,8,13,0.56)',
                  borderColor: 'rgba(148,163,184,0.18)',
                }}
              >
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <TrendingUp size={16} className="text-orange-500" />
                  {t('consultingPortal.emptyPreviewTitle', { defaultValue: 'What this portal becomes after purchase' })}
                </h2>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(255,255,255,0.03)' }}>
                    <div className="text-xs font-semibold">Active phase progress</div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      Know exactly where your business is in the consulting roadmap.
                    </div>
                  </div>
                  <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(255,255,255,0.03)' }}>
                    <div className="text-xs font-semibold">Action items and due dates</div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      Keep momentum between calls instead of losing track in scattered notes.
                    </div>
                  </div>
                  <div className="rounded-xl border p-3" style={{ borderColor: 'rgba(148,163,184,0.16)', background: 'rgba(255,255,255,0.03)' }}>
                    <div className="text-xs font-semibold">Deliverables and consultant contact</div>
                    <div className="text-[11px] mt-1" style={{ color: 'var(--color-text-muted)' }}>
                      Download files, review next steps, and know who owns the next move.
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </section>

          <ParticipatingEngagements user={user} />

          {packages.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Package size={18} className="text-orange-500" />
                {t('consultingPortal.packagesTitle', { defaultValue: 'Choose a starting package' })}
              </h2>
              <PackageGrid packages={packages} t={t} />
            </section>
          )}

          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card padding={5}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
                1. Intake
              </div>
              <h3 className="text-base font-semibold mb-2">Tell us what you are building</h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Share the skill, market, setup needs, urgency, and package level so the right consultant can pick it up with context.
              </p>
            </Card>
            <Card padding={5}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
                2. Strategy
              </div>
              <h3 className="text-base font-semibold mb-2">Receive a real roadmap</h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Your consultant organizes the work into phases, deliverables, and action items so progress feels concrete from week one.
              </p>
            </Card>
            <Card padding={5}>
              <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--color-text-muted)' }}>
                3. Execution
              </div>
              <h3 className="text-base font-semibold mb-2">Track everything here</h3>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Sessions, files, responsibilities, and next steps stay inside one consulting workspace instead of disappearing into email threads.
              </p>
            </Card>
          </section>
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
        {activeSession && (
          <ActiveSessionHero
            session={activeSession}
            t={t}
            onBookReschedule={() => openBookingFor(activeSession)}
            onScheduleSession={() => handleScheduleSession(activeSession)}
            schedulingBusy={creatingSchedule}
          />
        )}

        {/* Group 10 Slice C (518-520): proposals, attendance, cancellation
            for the active appointment. */}
        {activeSession?.scheduled_id && (
          <SchedulePanel
            session={activeSession}
            detail={sessionDetails[activeSession.scheduled_id]}
            t={t}
            onChanged={refreshSchedule}
            onReschedule={() => setRescheduleSession(activeSession)}
            onCancel={() => setCancelTarget(activeSession)}
          />
        )}

        {/* Group 10 Slice G (536-540): engagements the user participates
            in as a site contact or observer. */}
        <ParticipatingEngagements user={user} />

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
                          {s.scheduled_status === 'pending_confirmation'
                            ? t('consultingPortal.tba', { defaultValue: 'TBA' })
                            : (s.scheduled_date
                              ? fmtDate(`${s.scheduled_date}T${s.scheduled_time || '09:00'}`)
                              : (s.scheduled_at ? fmtDate(s.scheduled_at) : t('consultingPortal.tba', { defaultValue: 'TBA' })))}
                        </div>
                      </div>
                      {/* Was a dead link to /consulting/:id (no such route):
                          it now opens booking for that session in place. A
                          confirmed appointment opens the reschedule dialog;
                          cancellation has its own dialog (Slice C). */}
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {['confirmed', 'pending_confirmation'].includes(s.scheduled_status) && (
                          <button
                            type="button"
                            onClick={() => setCancelTarget(s)}
                            className="text-xs text-red-400 hover:text-red-300 inline-flex items-center gap-1" data-track="ui.719d896ad2.11"
                          >
                            {t('scheduling.cancelSession')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openBookingFor(s)}
                          className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 flex-shrink-0" data-track="ui.719d896ad2.4"
                        >
                          {t('consultingPortal.reschedule')} <ArrowRight size={11} />
                        </button>
                      </div>
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
                      {/* Dead link to /consulting/:id/feedback removed: the only
                          feedback route is /consulting/feedback/:sessionId/:token,
                          reached from the token link emailed after a session. */}
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
              <p className="text-xs mt-1 text-[var(--color-text-muted)]">
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

      {/* Booking widget modal: no new route, mounted inside the portal. */}
      {schedulingSession && schedulingSession.scheduled_id && schedulingSession.consultant_assigned_id && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '1rem',
          }}
          onClick={() => setSchedulingSession(null)}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '540px' }}>
            <ConsultantScheduleSelector
              consultantId={schedulingSession.consultant_assigned_id}
              sessionId={schedulingSession.scheduled_id}
              onScheduleConfirmed={() => { setSchedulingSession(null); fetchDashboardSessions(); }}
              onCancel={() => setSchedulingSession(null)}
              onPaymentRequired={() => {
                setSchedulingSession(null);
                setPaymentReturnsToWidget(true);
                setPaymentSession(schedulingSession);
              }}
            />
          </div>
        </div>
      )}

      {/* Group 10 Slice C (518-519): reschedule and cancel dialogs. */}
      {rescheduleSession && (
        <ConsultantRescheduleDialog
          consultantId={rescheduleSession.consultant_assigned_id}
          scheduledSession={rescheduleSession}
          onClose={() => setRescheduleSession(null)}
          onDone={() => { setRescheduleSession(null); refreshSchedule(); }}
        />
      )}
      {cancelTarget && (
        <ConsultantCancelSessionDialog
          scheduledSession={cancelTarget}
          canRequestRefund
          onClose={() => setCancelTarget(null)}
          onDone={() => { setCancelTarget(null); refreshSchedule(); }}
        />
      )}

      {/* Existing payment modal: on 402 from the widget, and after a
          Schedule-session row creation, payment happens here; on success
          the widget reopens so booking can be retried immediately. */}
      <ConsultingPaymentModal
        sessionId={paymentSession?.id}
        isOpen={!!paymentSession}
        onClose={() => { setPaymentSession(null); setPaymentReturnsToWidget(false); }}
        onSuccess={handlePaymentSuccess}
      />

      <Footer />
    </div>
  );
}
