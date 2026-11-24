/**
 * FranchiseTerritoryOpsPage.jsx
 *
 * Territory command center for launched / approved franchise operators.
 * Shows territory KPIs, helper roster, compliance status, and quick actions.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Users, Hammer, DollarSign, ShieldCheck, Star,
  MapPin, RefreshCw, CheckCircle2, Clock, AlertTriangle,
  ArrowRight, TrendingUp, Building2,
} from 'lucide-react';
import api from '../api/axios';
import PageShell from '../components/PageShell';
import FranchiseBoundarySummary from './FranchiseBoundarySummary';
import FranchiseLaunchPlan from './FranchiseLaunchPlan';
import FranchiseOpenLocations from './FranchiseOpenLocations';
import FranchiseTerritoryInvitations from './FranchiseTerritoryInvitations';
import FranchiseTrainingTasks from './FranchiseTrainingTasks';
import FranchiseCoveragePlan from './FranchiseCoveragePlan';
import FranchiseAnnouncements from './FranchiseAnnouncements';
import FranchiseStandards from './FranchiseStandards';
import FranchiseBrandAssets from './FranchiseBrandAssets';
import FranchiseComplianceChecklist from './FranchiseComplianceChecklist';
import FranchiseExceptionSummary from './FranchiseExceptionSummary';
import FranchiseLocationHealth from './FranchiseLocationHealth';
import FranchiseTerritoryTickets from './FranchiseTerritoryTickets';
import FranchiseCoverageTrend from './FranchiseCoverageTrend';
import FranchiseExceptionEscalations from './FranchiseExceptionEscalations';
import FranchiseExceptionResolution from './FranchiseExceptionResolution';
import FranchiseCandidateLocations from './FranchiseCandidateLocations';
import FranchiseTerritoryCapacity from './FranchiseTerritoryCapacity';
import FranchiseTrainingPlanner from './FranchiseTrainingPlanner';
import FranchiseLaunchDependencies from './FranchiseLaunchDependencies';
import FranchiseExpansionNotes from './FranchiseExpansionNotes';
import { useAuth } from '../hooks/useAuth';
import useAccessProjection from '../hooks/useAccessProjection';

// ── Helpers ──────────────────────────────────────────────────────────────────
// Zero-decimal currencies (mirrors server revenueDivisor): their minor unit
// is the major unit, so cents must not be divided by 100.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);
const fmtCents = (c, currencyCode = 'USD') => {
  const raw = String(currencyCode || '');
  const code = /^[A-Za-z]{3}$/.test(raw) ? raw.toUpperCase() : 'USD';
  const divisor = ZERO_DECIMAL_CURRENCIES.has(code.toLowerCase()) ? 1 : 100;
  const major = (c ?? 0) / divisor;
  try {
    if (Math.abs(major) >= 1_000) {
      return new Intl.NumberFormat(undefined, {
        style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1,
      }).format(major);
    }
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: code, maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `$${major.toFixed(0)}`;
  }
};
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (n) => n != null ? `${n}%` : '—';

// ── Sub-components ────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-xl bg-gray-800 ${className}`} />;
}

function KpiTile({ icon: Icon, label, value, sub, accent = 'emerald', loading }) {
  const colors = {
    emerald: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/8',
    orange:  'text-orange-400  border-orange-500/20  bg-orange-500/8',
    blue:    'text-blue-400    border-blue-500/20    bg-blue-500/8',
    purple:  'text-purple-400  border-purple-500/20  bg-purple-500/8',
    rose:    'text-rose-400    border-rose-500/20    bg-rose-500/8',
  };
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-1.5 ${colors[accent]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
        <Icon size={14} />
      </div>
      {loading ? <Skeleton className="h-7 w-20" /> : <p className="text-xl font-bold text-white">{value}</p>}
      {!loading && sub && <p className="text-xs opacity-60">{sub}</p>}
    </div>
  );
}

const STATUS_COLOR = {
  pending:   'bg-yellow-500/15 text-yellow-400',
  approved:  'bg-emerald-500/15 text-emerald-400',
  launched:  'bg-purple-500/15 text-purple-400',
  inquiry:   'bg-gray-500/15 text-gray-400',
  diligence: 'bg-blue-500/15 text-blue-400',
  rejected:  'bg-red-500/15 text-red-400',
};

const TRAINING_LABEL_KEYS = {
  not_started: 'trainingLabels.notStarted',
  scheduled:   'trainingLabels.scheduled',
  in_progress: 'trainingLabels.inProgress',
  completed:   'trainingLabels.completed',
};

// ── Main ──────────────────────────────────────────────────────────────────────
export default function FranchiseTerritoryOpsPage() {
  const { user } = useAuth();
  const accessProjection = useAccessProjection(user);
  const { t } = useTranslation();
  const [stats, setStats]     = useState(null);
  const [helpers, setHelpers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  // Group 12 Slice 3b (607): the boundary summary rides the applicant
  // detail endpoint, loaded for whichever territory the stats resolved.
  const [boundaryDetail, setBoundaryDetail] = useState(null);
  // G-26: one franchisee, two territories. The operator picks which
  // territory to view; the choice travels as ?application_id=.
  const [applications, setApplications] = useState([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState('');
  // Group 12 Slice 3c (612): the opening-team designation scope — which
  // location launch (or the whole territory) a roster toggle applies to —
  // and the role new members get.
  const [openingTeamScope, setOpeningTeamScope] = useState('');
  const [openingTeamRole, setOpeningTeamRole] = useState('member');
  const [teamBusy, setTeamBusy] = useState(false);
  const operableApplications = applications.filter((a) => ['approved', 'launched'].includes(a.status));
  const projectedAccess = accessProjection?.access || accessProjection;
  const projectionControlsTerritory = Boolean(accessProjection?.flags?.accessProjection);
  const hasFranchiseAccess = projectedAccess?.personal?.includes('franchise.operate');
  const territoryBlocked = projectionControlsTerritory && !hasFranchiseAccess;

  useEffect(() => {
    if (territoryBlocked) {
      setApplications([]);
      setSelectedApplicationId('');
      return undefined;
    }
    let cancelled = false;
    api.get('/franchise/my-applications')
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data?.applications) ? res.data.applications : [];
        setApplications(rows);
        const operable = rows.filter((a) => ['approved', 'launched'].includes(a.status));
        if (operable.length === 1) setSelectedApplicationId(operable[0].id);
      })
      .catch(() => { if (!cancelled) setApplications([]); });
    return () => { cancelled = true; };
  }, [territoryBlocked]);
  // Revenue currency, default USD to match the server default. The selector
  // is sent as ?currency= so operators outside the US stop seeing every
  // revenue tile silently converted to dollars by the USD default.
  const [currency, setCurrency] = useState('USD');
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const appParam = selectedApplicationId ? `&application_id=${selectedApplicationId}` : '';
      const helpersQuery = selectedApplicationId ? `?application_id=${selectedApplicationId}` : '';
      const [sRes, hRes] = await Promise.all([
        api.get(`/franchise/territory-stats?currency=${currency.toLowerCase()}${appParam}`),
        api.get(`/franchise/territory-helpers${helpersQuery}`),
      ]);
      setStats(sRes.data);
      setHelpers(hRes.data?.helpers ?? []);
    } catch (e) {
      setError(t('franchiseTerritoryPage.errors.loadFailure'));
    } finally {
      setLoading(false);
    }
  }, [t, currency, selectedApplicationId]);

  useEffect(() => {
    if (territoryBlocked) {
      setLoading(false);
      setStats(null);
      setHelpers([]);
      return;
    }
    load();
  }, [load, territoryBlocked]);

  // Group 12 Slice 3b (607): boundary summary for the resolved territory.
  const resolvedApplicationId = stats?.application?.id || null;
  useEffect(() => {
    if (!resolvedApplicationId || territoryBlocked) {
      setBoundaryDetail(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/franchise/my-applications/${resolvedApplicationId}`)
      .then((res) => { if (!cancelled) setBoundaryDetail(res.data); })
      .catch(() => { if (!cancelled) setBoundaryDetail(null); });
    return () => { cancelled = true; };
  }, [resolvedApplicationId, territoryBlocked]);

  // Group 12 Slice 3d (619): the territory coverage rollup for the
  // resolved territory — read-only, rolled up from the linked business.
  const [coverage, setCoverage] = useState(null);
  useEffect(() => {
    if (!resolvedApplicationId || territoryBlocked) {
      setCoverage(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/franchise/my-applications/${resolvedApplicationId}/coverage`)
      .then((res) => { if (!cancelled) setCoverage(res.data); })
      .catch(() => { if (!cancelled) setCoverage(null); });
    return () => { cancelled = true; };
  }, [resolvedApplicationId, territoryBlocked]);

  // Group 12 Slice 3f (629): the territory ticket queue — the
  // territory's open support requests, filterable by status and location.
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketLocationId, setTicketLocationId] = useState('');
  const [territoryTickets, setTerritoryTickets] = useState([]);
  const [ticketRefresh, setTicketRefresh] = useState(0);
  useEffect(() => {
    if (!resolvedApplicationId || territoryBlocked) {
      setTerritoryTickets([]);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ status: ticketStatus });
    if (ticketLocationId) params.set('location_id', ticketLocationId);
    api.get(`/franchise/my-applications/${resolvedApplicationId}/support-tickets?${params.toString()}`)
      .then((res) => { if (!cancelled) setTerritoryTickets(res.data?.tickets ?? []); })
      .catch(() => { if (!cancelled) setTerritoryTickets([]); });
    return () => { cancelled = true; };
  }, [resolvedApplicationId, territoryBlocked, ticketStatus, ticketLocationId, ticketRefresh]);

  // Group 12 Slice 3f (630): the territory coverage trend for the
  // resolved territory — coverage % by day and by week over time.
  const [coverageTrend, setCoverageTrend] = useState(null);
  useEffect(() => {
    if (!resolvedApplicationId || territoryBlocked) {
      setCoverageTrend(null);
      return undefined;
    }
    let cancelled = false;
    api.get(`/franchise/my-applications/${resolvedApplicationId}/coverage-trend`)
      .then((res) => { if (!cancelled) setCoverageTrend(res.data); })
      .catch(() => { if (!cancelled) setCoverageTrend(null); });
    return () => { cancelled = true; };
  }, [resolvedApplicationId, territoryBlocked]);

  // Group 12 Slice 3g (631-635): the exception resolution lists — the
  // escalation queue and the corrective-action checklist for the
  // resolved territory. The resolution state itself rides the boundary
  // detail; these lists are the working surface on top of it.
  const [escalations, setEscalations] = useState([]);
  const [correctiveActions, setCorrectiveActions] = useState([]);
  const [resolutionRefresh, setResolutionRefresh] = useState(0);
  useEffect(() => {
    if (!resolvedApplicationId || territoryBlocked) {
      setEscalations([]);
      setCorrectiveActions([]);
      return undefined;
    }
    let cancelled = false;
    api.get(`/franchise/my-applications/${resolvedApplicationId}/escalations`)
      .then((res) => { if (!cancelled) setEscalations(res.data?.escalations ?? []); })
      .catch(() => { if (!cancelled) setEscalations([]); });
    api.get(`/franchise/my-applications/${resolvedApplicationId}/corrective-actions`)
      .then((res) => { if (!cancelled) setCorrectiveActions(res.data?.corrective_actions ?? []); })
      .catch(() => { if (!cancelled) setCorrectiveActions([]); });
    return () => { cancelled = true; };
  }, [resolvedApplicationId, territoryBlocked, resolutionRefresh]);

  const refreshResolution = useCallback(async () => {
    if (!resolvedApplicationId) return;
    setResolutionRefresh((v) => v + 1);
    try {
      const res = await api.get(`/franchise/my-applications/${resolvedApplicationId}`);
      setBoundaryDetail(res.data);
    } catch {
      // The list refresh above still runs; the bundle reload is best-effort.
    }
  }, [resolvedApplicationId]);

  // Group 12 Slice 3h (636-640): plan development — reload the territory
  // detail bundle after a planning mutation (candidates, notes).
  const reloadBoundaryDetail = useCallback(async () => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.get(`/franchise/my-applications/${resolvedApplicationId}`);
      setBoundaryDetail(res.data);
    } catch {
      setError(t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3h (636): the operator proposes a candidate location,
  // moves one through review, and removes a scouting candidate.
  const proposeCandidate = useCallback(async (body) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/candidate-locations`, body);
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  const updateCandidateStatus = useCallback(async (candidateId, status) => {
    if (!resolvedApplicationId) return;
    try {
      await api.patch(`/franchise/my-applications/${resolvedApplicationId}/candidate-locations/${candidateId}`, { status });
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  const removeCandidate = useCallback(async (candidateId) => {
    if (!resolvedApplicationId) return;
    try {
      await api.delete(`/franchise/my-applications/${resolvedApplicationId}/candidate-locations/${candidateId}`);
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  // Group 12 Slice 3h (640): the operator records, edits, and removes
  // expansion readiness notes for the territory or one location.
  const addExpansionNote = useCallback(async (body) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/expansion-notes`, body);
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  const updateExpansionNote = useCallback(async (noteId, body) => {
    if (!resolvedApplicationId) return;
    try {
      await api.patch(`/franchise/my-applications/${resolvedApplicationId}/expansion-notes/${noteId}`, body);
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  const removeExpansionNote = useCallback(async (noteId) => {
    if (!resolvedApplicationId) return;
    try {
      await api.delete(`/franchise/my-applications/${resolvedApplicationId}/expansion-notes/${noteId}`);
      await reloadBoundaryDetail();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, reloadBoundaryDetail, t]);

  // Group 12 Slice 3g (631): the operator escalates a linked exception
  // with a reason; the fresh summary replaces the one on the detail.
  const escalateTicket = useCallback(async (ticketNumber, reason) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/support-tickets/${ticketNumber}/escalate`, { reason });
      setBoundaryDetail((prev) => (prev ? { ...prev, exception_summary: res.data.exception_summary } : prev));
      await refreshResolution();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, refreshResolution, t]);

  // Group 12 Slice 3g (632): the operator assigns a remediation owner
  // for a linked exception.
  const assignRemediation = useCallback(async (ticketId, body) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/support-tickets/${ticketId}/remediation`, body);
      await refreshResolution();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, refreshResolution, t]);

  // Group 12 Slice 3g (633): the operator adds a corrective action and
  // moves one through its status workflow.
  const createCorrectiveAction = useCallback(async (ticketId, body) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/support-tickets/${ticketId}/corrective-actions`, body);
      await refreshResolution();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, refreshResolution, t]);

  const updateCorrectiveActionStatus = useCallback(async (actionId, status) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/corrective-actions/${actionId}/status`, { status });
      await refreshResolution();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, refreshResolution, t]);

  // Group 12 Slice 3g (634): evidence upload (multipart) and read for
  // one corrective action.
  const uploadEvidence = useCallback(async (actionId, formData) => {
    if (!resolvedApplicationId) return;
    try {
      await api.post(`/franchise/my-applications/${resolvedApplicationId}/corrective-actions/${actionId}/evidence`, formData);
      await refreshResolution();
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, refreshResolution, t]);

  const loadEvidence = useCallback(async (actionId) => {
    if (!resolvedApplicationId) return [];
    const res = await api.get(`/franchise/my-applications/${resolvedApplicationId}/corrective-actions/${actionId}/evidence`);
    return res.data?.evidence ?? [];
  }, [resolvedApplicationId]);

  // Group 12 Slice 3b (609): the operator updates a launch plan step's
  // status from the ops page; the detail is reloaded to reflect it.
  const updateLaunchPlanStatus = useCallback(async (stepId, status) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/launch-plan/${stepId}/status`, { status });
      setBoundaryDetail(res.data);
    } catch {
      setError(t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3c (611): the operator updates a location milestone's
  // status from the ops page; the detail is reloaded to reflect it.
  const updateMilestoneStatus = useCallback(async (locationId, milestoneId, status) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/locations/${locationId}/milestones/${milestoneId}/status`, { status });
      setBoundaryDetail(res.data);
    } catch {
      setError(t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3c (614): the operator updates a location's service
  // availability checklist and launches a location from the ops page.
  const saveLocationService = useCallback(async (locationId, body) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/locations/${locationId}/services`, body);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  const launchLocation = useCallback(async (locationId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/locations/${locationId}/launch`);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3c (615): the operator confirms a launched location
  // opened from the ops page — the record that completes the launch.
  const confirmOpening = useCallback(async (locationId, body) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/locations/${locationId}/confirm-opening`, body);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3d (616): the operator invites someone to the
  // territory by email, and cancels an outstanding invite.
  const inviteTerritoryMember = useCallback(async (body) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/invitations`, body);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  const cancelTerritoryInvite = useCallback(async (inviteId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/invitations/${inviteId}/cancel`);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3d (617/618): the territory members — the operator,
  // accepted invitees, and the opening-team helpers. Used to pick
  // training assignees (and, in HQ, location managers).
  const territoryMembers = useCallback(() => {
    if (!boundaryDetail) return [];
    const byId = new Map();
    if (user?.id) {
      byId.set(user.id, {
        user_id: user.id,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || user.id,
        email: user.email || '',
      });
    }
    (boundaryDetail.territory_invitations || [])
      .filter((invite) => invite.status === 'accepted' && invite.invitee_user_id)
      .forEach((invite) => {
        if (!byId.has(invite.invitee_user_id)) {
          byId.set(invite.invitee_user_id, { user_id: invite.invitee_user_id, name: invite.email, email: invite.email });
        }
      });
    const teams = [
      ...(boundaryDetail.opening_team || []),
      ...((boundaryDetail.locations || []).flatMap((location) => location.opening_team || [])),
    ];
    teams.forEach((member) => {
      if (member.helper_user_id && !byId.has(member.helper_user_id)) {
        byId.set(member.helper_user_id, {
          user_id: member.helper_user_id,
          name: [member.helper_first_name, member.helper_last_name].filter(Boolean).join(' ') || member.helper_email,
          email: member.helper_email || '',
        });
      }
    });
    return [...byId.values()];
  }, [boundaryDetail, user]);

  // Group 12 Slice 3d (618): the operator assigns training to a
  // territory member, marks it complete, and removes assignments.
  const assignTraining = useCallback(async (body) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/training`, body);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  const completeTraining = useCallback(async (assignmentId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/training/${assignmentId}/complete`);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  const removeTraining = useCallback(async (assignmentId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.delete(`/franchise/my-applications/${resolvedApplicationId}/training/${assignmentId}`);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3f (628, D-327): link or unlink a support ticket
  // to the territory; the fresh exception summary replaces the one on
  // the boundary detail.
  const linkTicket = useCallback(async (ticketNumber, locationId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/support-tickets/${ticketNumber}/link`, { location_id: locationId });
      setBoundaryDetail((prev) => (prev ? { ...prev, exception_summary: res.data.exception_summary } : prev));
      setTicketRefresh((v) => v + 1);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  const unlinkTicket = useCallback(async (ticketId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/support-tickets/${ticketId}/unlink`);
      setBoundaryDetail((prev) => (prev ? { ...prev, exception_summary: res.data.exception_summary } : prev));
      setTicketRefresh((v) => v + 1);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3d (620): the operator marks an HQ announcement read.
  const markAnnouncementRead = useCallback(async (announcementId) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/announcements/${announcementId}/read`);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3e (622): the operator acknowledges a standard's
  // current version with a drawn e-signature (multipart FormData).
  const acknowledgeStandard = useCallback(async (standardId, formData) => {
    if (!resolvedApplicationId) return;
    try {
      const res = await api.post(`/franchise/my-applications/${resolvedApplicationId}/standards/${standardId}/acknowledge`, formData);
      setBoundaryDetail(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || t('franchiseTerritoryPage.errors.loadFailure'));
      throw err;
    }
  }, [resolvedApplicationId, t]);

  // Group 12 Slice 3c (612): the operator designates a roster helper as
  // an opening-team member (or removes them) for the selected scope. The
  // roster reloads so the opening-team flags reflect the change.
  const toggleOpeningTeam = useCallback(async (helper) => {
    if (!resolvedApplicationId || teamBusy) return;
    setTeamBusy(true);
    try {
      if (helper.opening_team && helper.opening_team_member_id) {
        await api.delete(`/franchise/my-applications/${resolvedApplicationId}/opening-team/${helper.opening_team_member_id}`);
      } else {
        await api.post(`/franchise/my-applications/${resolvedApplicationId}/opening-team`, {
          helper_user_id: helper.user_id,
          location_id: openingTeamScope || undefined,
          role: openingTeamRole,
        });
      }
      await load();
    } catch {
      setError(t('franchiseTerritoryPage.errors.loadFailure'));
    } finally {
      setTeamBusy(false);
    }
  }, [resolvedApplicationId, teamBusy, openingTeamScope, openingTeamRole, load, t]);

  const app      = stats?.application ?? {};
  const kpis     = stats?.territory_kpis ?? {};
  // The currency the server actually scoped the revenue to; falls back to
  // the selected currency while loading or if an older response omits it.
  const revenueCurrencyCode = kpis.revenue_currency_code || currency;
  const currencyOptions = [...new Set([
    'USD',
    ...(kpis.available_revenue_currencies ?? []),
    revenueCurrencyCode,
  ])].filter((code) => /^[A-Z]{3}$/.test(code));
  const territory = [app.city, app.region, app.country].filter(Boolean).join(', ');
  const trainingLabel = app.training_status && TRAINING_LABEL_KEYS[app.training_status]
    ? t(TRAINING_LABEL_KEYS[app.training_status])
    : app.training_status || '—';

  if (territoryBlocked) {
    return (
      <PageShell>
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="max-w-lg text-center space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <Building2 size={13} />
              {t('franchiseTerritoryPage.noTerritory.badge')}
            </div>
            <h1 className="text-2xl font-bold">{t('franchiseTerritoryPage.noTerritory.title')}</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              {t('franchiseTerritoryPage.noTerritory.description')}
            </p>
            <Link to="/franchise/status" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
              {t('franchiseTerritoryPage.noTerritory.viewApplication')} <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  // ── Not launched yet ─────────────────────────────────────────
  if (!loading && stats && !stats.has_territory) {
    return (
      <PageShell>
        <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
          <div className="max-w-lg text-center space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
              <Building2 size={13} />
              {t('franchiseTerritoryPage.noTerritory.badge')}
            </div>
            <h1 className="text-2xl font-bold">{t('franchiseTerritoryPage.noTerritory.title')}</h1>
            <p className="text-gray-400 text-sm leading-relaxed">
              {t('franchiseTerritoryPage.noTerritory.description')}
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Link to="/franchise/status" className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition">
                {t('franchiseTerritoryPage.noTerritory.viewApplication')} <ArrowRight size={14} />
              </Link>
              <Link to="/franchise/apply" className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-gray-700 text-sm font-semibold hover:bg-gray-800 transition">
                {t('franchiseTerritoryPage.noTerritory.applyNow')}
              </Link>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="min-h-screen bg-gray-950 text-white px-4 py-8 md:px-8">
        <div className="max-w-6xl mx-auto space-y-6">

          {/* ── Header ─────────────────────────────────────────────── */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={14} className="text-orange-400" />
                <p className="text-xs text-orange-400 font-semibold uppercase tracking-wide">
                  {loading ? '…' : territory || t('franchiseTerritoryPage.header.territoryFallback')}
                </p>
              </div>
              <h1 className="text-2xl font-bold">{t('franchiseTerritoryPage.header.title')}</h1>
            </div>
            <button
              onClick={load}
              className="self-start flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-800 bg-gray-900 text-gray-400 hover:text-white text-sm transition" data-track="ui.35001a967e.1"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              {t('franchiseTerritoryPage.actions.refresh')}
            </button>
          </div>

          {error && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 flex items-center gap-2">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {/* ── Status strip ───────────────────────────────────────── */}
          {!loading && app.status && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 flex flex-wrap items-center gap-3">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLOR[app.status] ?? 'bg-gray-700 text-gray-300'}`}>
                {app.status}
              </span>
              {app.brand_name && (
                <span className="text-sm font-semibold text-white">{app.brand_name}</span>
              )}
              <span className="text-xs text-gray-500 ml-auto">
                {t('franchiseTerritoryPage.status.agreementLabel')}: <span className="text-gray-300 capitalize">{app.agreement_status ?? '—'}</span>
                {'  ·  '}
                {t('franchiseTerritoryPage.status.trainingLabel')}: <span className="text-gray-300">{trainingLabel}</span>
              </span>
            </div>
          )}

          {/* ── KPI grid ───────────────────────────────────────────── */}
          <div className="flex items-center gap-4 flex-wrap">
            {operableApplications.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor="territory-application" className="text-xs text-gray-400">
                  {t('franchiseTerritoryPage.territory.label')}
                </label>
                <select
                  id="territory-application"
                  value={selectedApplicationId}
                  onChange={(e) => setSelectedApplicationId(e.target.value)}
                  className="rounded-xl border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm text-white"
                >
                  <option value="">{t('franchiseTerritoryPage.territory.newest')}</option>
                  {operableApplications.map((application) => (
                    <option key={application.id} value={application.id}>
                      {[application.desired_city, application.desired_region, application.desired_country].filter(Boolean).join(', ')}
                      {application.desired_brand_name ? ` (${application.desired_brand_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
            <label htmlFor="territory-revenue-currency" className="text-xs text-gray-400">
              {t('franchiseTerritoryPage.currency.label')}
            </label>
            <select
              id="territory-revenue-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="rounded-xl border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm text-white"
            >
              {currencyOptions.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiTile icon={Users}      label={t('franchiseTerritoryPage.kpis.helpers')} loading={loading}
              value={fmt(kpis.helpers_total)}   sub={t('franchiseTerritoryPage.kpis.helpersVerified', { count: fmt(kpis.helpers_verified) })} accent="blue" />
            <KpiTile icon={Star}       label={t('franchiseTerritoryPage.kpis.avgRating')}    loading={loading}
              value={kpis.avg_rating ? kpis.avg_rating.toFixed(2) : '—'} accent="orange" />
            <KpiTile icon={Hammer}     label={t('franchiseTerritoryPage.kpis.jobsPosted')}    loading={loading}
              value={fmt(kpis.jobs_posted_30d)} sub={t('franchiseTerritoryPage.kpis.jobsActive', { count: fmt(kpis.jobs_active) })} accent="emerald" />
            <KpiTile icon={CheckCircle2} label={t('franchiseTerritoryPage.kpis.completionRate')}    loading={loading}
              value={pct(kpis.completion_rate)} sub={t('franchiseTerritoryPage.kpis.completedJobs', { count: fmt(kpis.jobs_completed) })} accent="emerald" />
            <KpiTile icon={DollarSign} label={t('franchiseTerritoryPage.kpis.revenue')}        loading={loading}
              value={fmtCents(kpis.revenue_30d_cents, revenueCurrencyCode)} sub={`${t('franchiseTerritoryPage.kpis.revenueTotal', { amount: fmtCents(kpis.revenue_total_cents, revenueCurrencyCode) })} (${revenueCurrencyCode})`} accent="purple" />
            <KpiTile icon={ShieldCheck} label={t('franchiseTerritoryPage.kpis.compliance')}          loading={loading}
              value={pct(app.compliance_pct)} sub={t('franchiseTerritoryPage.compliance.stepsComplete', {
                done: app.checklist_done ?? 0,
                total: app.checklist_all ?? 0,
              })} accent="emerald" />
          </div>

          {/* ── Compliance + quick actions ──────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Compliance card */}
            <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <ShieldCheck size={14} className="text-emerald-400" /> {t('franchiseTerritoryPage.compliance.title')}
              </h2>
              {loading
                ? <Skeleton className="h-3 w-full" />
                : (
                  <>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                      <span>{t('franchiseTerritoryPage.compliance.stepsComplete', {
                        done: app.checklist_done ?? 0,
                        total: app.checklist_all ?? 0,
                      })}</span>
                      <span className="font-bold text-white">{pct(app.compliance_pct)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all"
                        style={{ width: `${app.compliance_pct ?? 0}%` }}
                      />
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-gray-400">
                      {[
                        [t('franchiseTerritoryPage.compliance.labels.agreement'),      app.agreement_status === 'signed',   app.agreement_status],
                        [t('franchiseTerritoryPage.compliance.labels.training'),       app.training_status === 'completed',  trainingLabel],
                        [t('franchiseTerritoryPage.compliance.labels.launchReadiness'), app.launch_readiness_status === 'launched' || app.launch_readiness_status === 'ready', app.launch_readiness_status],
                      ].map(([label, done, val]) => (
                        <div key={label} className="flex items-center gap-2">
                          {done
                            ? <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                            : <Clock size={12} className="text-yellow-400 shrink-0" />
                          }
                          <span className="flex-1">{label}</span>
                          <span className={done ? 'text-emerald-400' : 'text-yellow-300'}>{val ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )
              }
            </div>

            {/* Quick actions */}
            <div className="lg:col-span-2 rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <h2 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <TrendingUp size={14} className="text-orange-400" /> {t('franchiseTerritoryPage.actionsCard.title')}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { to: '/franchise/status', icon: Building2, label: t('franchiseTerritoryPage.actionsCard.viewApplication.title'), sub: t('franchiseTerritoryPage.actionsCard.viewApplication.sub'), color: 'text-orange-400' },
                  { to: '/growth',           icon: TrendingUp, label: t('franchiseTerritoryPage.actionsCard.growth.title'),       sub: t('franchiseTerritoryPage.actionsCard.growth.sub'),       color: 'text-emerald-400' },
                  { to: '/learn',            icon: Star,       label: t('franchiseTerritoryPage.actionsCard.training.title'),     sub: t('franchiseTerritoryPage.actionsCard.training.sub'),     color: 'text-blue-400' },
                  { to: '/jobs',             icon: Hammer,     label: t('franchiseTerritoryPage.actionsCard.jobs.title'),        sub: t('franchiseTerritoryPage.actionsCard.jobs.sub'),        color: 'text-purple-400' },
                ].map(({ to, icon: Icon, label, sub, color }) => (
                  <Link key={to} to={to} className="flex items-center gap-3 p-3 rounded-xl bg-gray-800/50 hover:bg-gray-800 border border-gray-700/50 hover:border-gray-600 transition group">
                    <Icon size={16} className={`${color} shrink-0`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-gray-500">{sub}</p>
                    </div>
                    <ArrowRight size={12} className="text-gray-600 group-hover:text-gray-400 transition" />
                  </Link>
                ))}
              </div>
            </div>
          </div>

          {/* ── Helper roster ───────────────────────────────────────── */}
          {/* Group 12 Slice 3b (607): the structured boundary summary for
              the resolved territory (operator read-only). */}
          {boundaryDetail && (
            <FranchiseBoundarySummary
              areas={boundaryDetail.territory_areas || []}
              territoryExclusive={boundaryDetail.application?.territory_exclusive === true}
              territorySummary={boundaryDetail.application?.territory_summary || null}
            />
          )}

          {/* Group 12 Slice 3b (609): the territory launch plan. */}
          {boundaryDetail && (
            <FranchiseLaunchPlan
              steps={boundaryDetail.launch_plan_steps || []}
              readinessStatus={boundaryDetail.application?.launch_readiness_status || null}
              onStatusChange={updateLaunchPlanStatus}
            />
          )}

          {/* Group 12 Slice 3c (611): the open locations with their launch
              milestones. */}
          {boundaryDetail && (
            <FranchiseOpenLocations
              locations={boundaryDetail.locations || []}
              launchPlanSteps={boundaryDetail.launch_plan_steps || []}
              openingTeam={boundaryDetail.opening_team || []}
              businessServices={boundaryDetail.business_services || []}
              onMilestoneStatusChange={updateMilestoneStatus}
              onServiceSave={saveLocationService}
              onLaunchLocation={launchLocation}
              onConfirmOpening={confirmOpening}
            />
          )}

          {/* Group 12 Slice 3d (616): territory invitations. */}
          {boundaryDetail && (
            <FranchiseTerritoryInvitations
              invitations={boundaryDetail.territory_invitations || []}
              canInvite
              onInvite={inviteTerritoryMember}
              onCancel={cancelTerritoryInvite}
            />
          )}

          {/* Group 12 Slice 3d (618): territory training distribution. */}
          {boundaryDetail && (
            <FranchiseTrainingTasks
              assignments={boundaryDetail.training_assignments || []}
              members={territoryMembers()}
              locations={boundaryDetail.locations || []}
              canAssign
              canComplete
              onAssign={assignTraining}
              onComplete={completeTraining}
              onRemove={removeTraining}
            />
          )}

          {/* Group 12 Slice 3d (619): territory coverage planning. */}
          {boundaryDetail && <FranchiseCoveragePlan coverage={coverage} />}

          {/* Group 12 Slice 3f (630, D-330): the territory coverage trend —
              coverage % by day and by week over time. */}
          {boundaryDetail && <FranchiseCoverageTrend trend={coverageTrend} />}

          {/* Group 12 Slice 3d (620): the HQ announcement feed. */}
          {boundaryDetail && (
            <FranchiseAnnouncements
              announcements={boundaryDetail.announcements || []}
              canRead
              onMarkRead={markAnnouncementRead}
            />
          )}

          {/* Group 12 Slice 3e (621/622): the franchise standards library —
              franchise-wide standards plus this territory's own, browsed
              from the territory ops page; the operator acknowledges each
              version with a drawn signature. */}
          {boundaryDetail && (
            <FranchiseStandards
              standards={boundaryDetail.standards || []}
              canAcknowledge
              onAcknowledge={acknowledgeStandard}
            />
          )}

          {/* Group 12 Slice 3e (623): the brand asset store — HQ uploads,
              operators browse and download from the territory ops page. */}
          {boundaryDetail && (
            <FranchiseBrandAssets assets={boundaryDetail.brand_assets || []} />
          )}

          {/* Group 12 Slice 3e (624): the operator compliance checklist —
              standards compliance derived from the library, the
              acknowledgment state, and readiness. */}
          {boundaryDetail && (
            <FranchiseComplianceChecklist checklist={boundaryDetail.compliance_checklist || null} />
          )}

          {/* Group 12 Slice 3f (628, D-327): the service exception summary —
              the territory's support tickets aggregated; the operator links
              their own tickets by ticket number. */}
          {boundaryDetail && (
            <FranchiseExceptionSummary
              summary={boundaryDetail.exception_summary || null}
              locations={boundaryDetail.locations || []}
              canLink
              onLink={linkTicket}
              onUnlink={unlinkTicket}
            />
          )}

          {/* Group 12 Slice 3f (627, D-328): the per-location health view —
              status, KPIs, and compliance for each location. */}
          {boundaryDetail && (
            <FranchiseLocationHealth health={boundaryDetail.location_health || null} />
          )}

          {/* Group 12 Slice 3f (629, D-329): the territory ticket queue —
              the territory's open support requests, filterable by status
              and location. */}
          {boundaryDetail && (
            <FranchiseTerritoryTickets
              tickets={territoryTickets}
              locations={boundaryDetail.locations || []}
              status={ticketStatus}
              locationId={ticketLocationId}
              onStatusChange={setTicketStatus}
              onLocationChange={setTicketLocationId}
              canUnlink
              onUnlink={unlinkTicket}
            />
          )}

          {/* Group 12 Slice 3h (636, D-336): the candidate location
              tracker — locations inside the territory the operator is
              scouting; the operator proposes and submits for review. */}
          {boundaryDetail && (
            <FranchiseCandidateLocations
              candidates={boundaryDetail.candidate_locations || null}
              canPropose
              onPropose={proposeCandidate}
              onStatusChange={updateCandidateStatus}
              onRemove={removeCandidate}
            />
          )}

          {/* Group 12 Slice 3h (637, D-337): the territory capacity view —
              a structured per-area capacity view, no map. Read-only here;
              HQ sets the targets. */}
          {boundaryDetail && (
            <FranchiseTerritoryCapacity capacity={boundaryDetail.territory_capacity || null} />
          )}

          {/* Group 12 Slice 3h (638, D-338): the training resource planner —
              who needs what training by when, and how much is covered. */}
          {boundaryDetail && (
            <FranchiseTrainingPlanner planner={boundaryDetail.training_planner || null} />
          )}

          {/* Group 12 Slice 3h (639, D-339): the launch dependency overview —
              per-location dependencies with blocked/blocking status. */}
          {boundaryDetail && (
            <FranchiseLaunchDependencies dependencies={boundaryDetail.launch_dependencies || null} />
          )}

          {/* Group 12 Slice 3h (640, D-340): expansion readiness notes —
              the operator's notes per territory or location, shown next
              to HQ's own readiness fields (read-only here). */}
          {boundaryDetail && (
            <FranchiseExpansionNotes
              notes={boundaryDetail.expansion_notes || null}
              hqNotes={boundaryDetail.hq_readiness_notes || null}
              locations={boundaryDetail.locations || []}
              canWrite
              onAdd={addExpansionNote}
              onUpdate={updateExpansionNote}
              onRemove={removeExpansionNote}
            />
          )}

          {/* Group 12 Slice 3g (631, D-331): the per-territory escalation
              queue — the operator escalates a linked exception with a
              reason; HQ sees the same queue. */}
          {boundaryDetail && (
            <FranchiseExceptionEscalations
              escalations={escalations}
              canEscalate
              onEscalate={escalateTicket}
            />
          )}

          {/* Group 12 Slice 3g (632-635, D-332/D-333/D-334/D-335): resolve
              exceptions — remediation assignment, the corrective-action
              checklist, evidence, and the derived resolution state.
              HQ review happens from the HQ page, not here. */}
          {boundaryDetail && (
            <FranchiseExceptionResolution
              resolution={boundaryDetail.exception_resolution || null}
              correctiveActions={correctiveActions}
              members={boundaryDetail.territory_members || []}
              canAssign
              canCreateAction
              canUpdateAction
              canUploadEvidence
              onAssignRemediation={assignRemediation}
              onCreateAction={createCorrectiveAction}
              onUpdateActionStatus={updateCorrectiveActionStatus}
              onUploadEvidence={uploadEvidence}
              onLoadEvidence={loadEvidence}
            />
          )}

          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <Users size={14} className="text-blue-400" /> {t('franchiseTerritoryPage.helpersSection.title')}
              </h2>
              <span className="text-xs text-gray-500">{t('franchiseTerritoryPage.helpersSection.found', { count: helpers.length })}</span>
            </div>
            {/* Group 12 Slice 3c (612): the opening-team designation
                scope — a roster toggle applies to this location launch,
                or to the whole territory when no location is picked. */}
            <div className="flex items-center gap-4 flex-wrap mb-4">
              <div className="flex items-center gap-2">
                <label htmlFor="opening-team-scope" className="text-xs text-gray-400">
                  {t('dashboards.franchise.openingTeamScopeLabel')}
                </label>
                <select
                  id="opening-team-scope"
                  value={openingTeamScope}
                  onChange={(e) => setOpeningTeamScope(e.target.value)}
                  className="rounded-xl border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm text-white"
                >
                  <option value="">{t('dashboards.franchise.openingTeamScopeTerritory')}</option>
                  {(boundaryDetail?.locations || []).map((location) => (
                    <option key={location.id} value={location.id}>{location.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="opening-team-role" className="text-xs text-gray-400">
                  {t('dashboards.franchise.openingTeamRoleLabel')}
                </label>
                <select
                  id="opening-team-role"
                  value={openingTeamRole}
                  onChange={(e) => setOpeningTeamRole(e.target.value)}
                  className="rounded-xl border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-sm text-white"
                >
                  <option value="member">{t('dashboards.franchise.openingTeamMember')}</option>
                  <option value="lead">{t('dashboards.franchise.openingTeamLead')}</option>
                </select>
              </div>
            </div>
            {loading
              ? <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
              : helpers.length === 0
                ? (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500">{t('franchiseTerritoryPage.helpersSection.emptyTitle')}</p>
                    <p className="text-xs text-gray-600 mt-1">{t('franchiseTerritoryPage.helpersSection.emptyDescription')}</p>
                  </div>
                )
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b border-gray-800">
                          <th className="text-left pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.helper')}</th>
                          <th className="text-left pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.location')}</th>
                          <th className="text-right pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.rating')}</th>
                          <th className="text-right pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.reviews')}</th>
                          <th className="text-right pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.verified')}</th>
                          <th className="text-right pb-2 font-normal">{t('franchiseTerritoryPage.helpersSection.table.available')}</th>
                          <th className="text-right pb-2 font-normal">{t('dashboards.franchise.openingTeamTitle')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {helpers.slice(0, 20).map((h) => (
                          <tr key={h.user_id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition">
                            <td className="py-2 font-medium text-gray-200">
                              {h.first_name} {h.last_name}
                              <span className="block text-xs text-gray-500">{h.email}</span>
                            </td>
                            <td className="py-2 text-gray-400 text-xs">{[h.city, h.state].filter(Boolean).join(', ') || '—'}</td>
                            <td className="py-2 text-right text-orange-400">{h.avg_rating ? Number(h.avg_rating).toFixed(2) : '—'}</td>
                            <td className="py-2 text-right text-gray-400">{h.total_reviews ?? 0}</td>
                            <td className="py-2 text-right">
                              {h.is_identity_verified || h.is_background_checked
                                ? <CheckCircle2 size={13} className="text-emerald-400 ml-auto" />
                                : <Clock size={13} className="text-gray-600 ml-auto" />
                              }
                            </td>
                            <td className="py-2 text-right">
                              <span className={`inline-block w-2 h-2 rounded-full ${h.is_available_now ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                            </td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                disabled={teamBusy}
                                onClick={() => toggleOpeningTeam(h)}
                                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${h.opening_team ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`} data-track="ui.35001a967e.2"
                              >
                                {h.opening_team
                                  ? `${t('dashboards.franchise.openingTeamRemove')}${h.opening_team_role === 'lead' ? ` · ${t('dashboards.franchise.openingTeamLead')}` : ''}`
                                  : t('dashboards.franchise.openingTeamAdd')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {helpers.length > 20 && (
                      <p className="text-xs text-gray-500 text-center mt-3">{t('franchiseTerritoryPage.helpersSection.showingTop', { count: helpers.length })}</p>
                    )}
                  </div>
                )
            }
          </div>

        </div>
      </div>
    </PageShell>
  );
}
