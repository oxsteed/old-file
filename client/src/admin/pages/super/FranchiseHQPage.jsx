import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CheckCircle2,
  ClipboardList,
  DollarSign,
  Globe,
  MapPin,
  Plus,
  RefreshCcw,
  Users,
} from 'lucide-react';
import { SuggestDropdown } from '../../../components/SuggestDropdown';
import FranchiseLocationServices from '../../../pages/FranchiseLocationServices';
import FranchiseOpeningConfirmation from '../../../pages/FranchiseOpeningConfirmation';
import FranchiseTerritoryInvitations from '../../../pages/FranchiseTerritoryInvitations';
import FranchiseTrainingTasks from '../../../pages/FranchiseTrainingTasks';
import FranchiseCoveragePlan from '../../../pages/FranchiseCoveragePlan';
import FranchiseAnnouncements from '../../../pages/FranchiseAnnouncements';
import FranchiseStandards from '../../../pages/FranchiseStandards';
import FranchiseBrandAssets from '../../../pages/FranchiseBrandAssets';
import FranchiseComplianceChecklist from '../../../pages/FranchiseComplianceChecklist';
import FranchiseExceptionSummary from '../../../pages/FranchiseExceptionSummary';
import FranchiseLocationHealth from '../../../pages/FranchiseLocationHealth';
import FranchiseTerritoryTickets from '../../../pages/FranchiseTerritoryTickets';
import FranchiseCoverageTrend from '../../../pages/FranchiseCoverageTrend';
import FranchiseExceptionEscalations from '../../../pages/FranchiseExceptionEscalations';
import FranchiseExceptionResolution from '../../../pages/FranchiseExceptionResolution';
import FranchiseCandidateLocations from '../../../pages/FranchiseCandidateLocations';
import FranchiseTerritoryCapacity from '../../../pages/FranchiseTerritoryCapacity';
import FranchiseTrainingPlanner from '../../../pages/FranchiseTrainingPlanner';
import FranchiseLaunchDependencies from '../../../pages/FranchiseLaunchDependencies';
import FranchiseExpansionNotes from '../../../pages/FranchiseExpansionNotes';
import FranchiseHandoff from '../../../pages/FranchiseHandoff';
import FranchiseContactDirectory from '../../../pages/FranchiseContactDirectory';
import FranchiseAccessRemoval from '../../../pages/FranchiseAccessRemoval';
import FranchisePolicyQuestions from '../../../pages/FranchisePolicyQuestions';
import FranchiseOpsAppointments from '../../../pages/FranchiseOpsAppointments';
import FranchiseTrainingEscalations from '../../../pages/FranchiseTrainingEscalations';
import '../../lib/suggestDropdownAdmin.css';
import './FranchiseHQSections.css';
import toast from 'react-hot-toast';
import axios from '../../../api/axios';

const STATUS_OPTIONS = ['inquiry', 'screening', 'application_review', 'diligence', 'agreement_pending', 'approved', 'rejected', 'archived', 'launched'];
const AGREEMENT_OPTIONS = ['draft', 'sent', 'signed', 'waived'];
const TRAINING_OPTIONS = ['not_started', 'scheduled', 'in_progress', 'completed'];
const READINESS_OPTIONS = ['not_ready', 'planning', 'launched'];
const CHECKLIST_OPTIONS = ['pending', 'in_progress', 'completed', 'blocked', 'waived'];

// Group 12 Slice 3b (608, D-306): operator responsibility labels, localized
// by code under dashboards.franchise (same keys as the operator dashboard).
const RESPONSIBILITY_LABEL_KEYS = {
  operate_territory: 'respOperateTerritory',
  brand_standards: 'respBrandStandards',
  recruit_train_team: 'respRecruitTrainTeam',
  comply_local_law: 'respComplyLocalLaw',
  report_performance: 'respReportPerformance',
  honor_agreement_fees: 'respHonorAgreementFees',
  protect_brand_assets: 'respProtectBrandAssets',
  resolve_customer_issues: 'respResolveCustomerIssues',
};

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const pageShell = {
  minHeight: '100%',
  background: 'linear-gradient(180deg, #030712 0%, #0f172a 42%, #111827 100%)',
  color: '#e5e7eb',
  padding: '24px',
};

const panel = {
  background: 'rgba(15, 23, 42, 0.88)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
  borderRadius: '24px',
  boxShadow: '0 24px 70px rgba(2, 6, 23, 0.42)',
  backdropFilter: 'blur(16px)',
};

const fieldStyle = {
  width: '100%',
  padding: '11px 13px',
  borderRadius: '14px',
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'rgba(15, 23, 42, 0.75)',
  color: '#f8fafc',
  fontSize: '0.92rem',
};

const OPTION_LABEL_KEYS = {
  inquiry: 'adminFranchiseStatusInquiry',
  screening: 'adminFranchiseStatusScreening',
  application_review: 'adminFranchiseStatusApplicationReview',
  diligence: 'adminFranchiseStatusDiligence',
  agreement_pending: 'adminFranchiseStatusAgreementPending',
  approved: 'adminFranchiseStatusApproved',
  rejected: 'adminFranchiseStatusRejected',
  archived: 'adminFranchiseStatusArchived',
  launched: 'adminFranchiseStatusLaunched',
  draft: 'adminFranchiseOptionDraft',
  sent: 'adminFranchiseOptionSent',
  signed: 'adminFranchiseOptionSigned',
  waived: 'adminFranchiseOptionWaived',
  not_started: 'adminFranchiseOptionNotStarted',
  scheduled: 'adminFranchiseOptionScheduled',
  in_progress: 'adminFranchiseOptionInProgress',
  completed: 'adminFranchiseOptionCompleted',
  not_ready: 'adminFranchiseOptionNotReady',
  planning: 'adminFranchiseOptionPlanning',
  ready: 'adminFranchiseOptionReady',
  pending: 'adminFranchiseOptionPending',
  blocked: 'adminFranchiseOptionBlocked',
};

function formatLabel(value, t) {
  const raw = String(value || '');
  if (!raw) return '';
  const key = OPTION_LABEL_KEYS[raw.toLowerCase()];
  if (key && t) return t(key);
  return raw
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ');
}

function MetricCard({ icon: Icon, label, value, sublabel, accent }) {
  return (
    <div style={{ ...panel, padding: '18px 18px 16px', display: 'grid', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: accent }}>
          <Icon size={18} />
        </span>
        <span style={{ color: '#94a3b8', fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</span>
      </div>
      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f8fafc' }}>{value}</div>
      <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{sublabel}</div>
    </div>
  );
}

function FranchiseRow({ item, isActive, onClick }) {
  const { t } = useTranslation();
  const readinessPct = item.checklist_total ? Math.round((item.checklist_completed / item.checklist_total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        textAlign: 'left',
        borderRadius: '20px',
        padding: '16px',
        border: isActive ? '1px solid rgba(249, 115, 22, 0.7)' : '1px solid rgba(148, 163, 184, 0.12)',
        background: isActive ? 'linear-gradient(135deg, rgba(249, 115, 22, 0.18), rgba(15, 23, 42, 0.96))' : 'rgba(2, 6, 23, 0.62)',
        color: '#e5e7eb',
        display: 'grid',
        gap: '10px',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc' }}>
            {item.desired_brand_name || item.current_company_name || `${item.first_name} ${item.last_name}`}
          </div>
          <div style={{ color: '#94a3b8', fontSize: '0.86rem' }}>{item.first_name} {item.last_name} · {item.email}</div>
        </div>
        <div style={{ color: '#fb923c', fontSize: '0.8rem', fontWeight: 700 }}>{formatLabel(item.status, t)}</div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd', fontSize: '0.78rem' }}>
          {item.desired_country}{item.desired_region ? ` · ${item.desired_region}` : ''}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.15)', color: '#86efac', fontSize: '0.78rem' }}>
          {t('adminFranchiseAgreementLabel', { status: formatLabel(item.agreement_status, t) })}
        </span>
        <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(250, 204, 21, 0.12)', color: '#fde68a', fontSize: '0.78rem' }}>
          {t('adminFranchiseStores', { count: item.preferred_store_count })}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', fontSize: '0.78rem' }}>
          <span>{t('adminFranchiseLaunchReadiness')}</span>
          <span>{readinessPct}%</span>
        </div>
        <div style={{ height: 8, borderRadius: 999, background: 'rgba(148, 163, 184, 0.14)', overflow: 'hidden' }}>
          <div style={{ width: `${readinessPct}%`, height: '100%', background: 'linear-gradient(90deg, #f97316, #22c55e)' }} />
        </div>
      </div>
    </button>
  );
}

export default function FranchiseHQPage() {
  const { t } = useTranslation();
  const [applications, setApplications] = useState([]);

  // Typeahead suggestions from the latest loaded franchise-application rows.
  const franchiseSuggestItems = useMemo(() => {
    const seen = new Set();
    const items = [];
    for (const item of applications) {
      if (item.id == null || seen.has(item.id)) continue;
      seen.add(item.id);
      const title = item.desired_brand_name || item.current_company_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || String(item.id);
      items.push({ id: item.id, title, meta: item.email || undefined });
    }
    return items;
  }, [applications]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedBundle, setSelectedBundle] = useState(null);
  // Group 12 Slice 3d (619): the territory coverage rollup for the
  // selected application, loaded with the bundle.
  const [coverage, setCoverage] = useState(null);
  // Group 12 Slice 3f (630): the territory coverage trend for the
  // selected application — coverage % over time, loaded with the bundle.
  const [coverageTrend, setCoverageTrend] = useState(null);
  // Group 12 Slice 3f (629): the per-territory ticket queue for the
  // selected application — HQ sees each territory's open requests.
  const [territoryTickets, setTerritoryTickets] = useState([]);
  const [hqTicketStatus, setHqTicketStatus] = useState('open');
  const [hqTicketLocationId, setHqTicketLocationId] = useState('');
  const [hqTicketRefresh, setHqTicketRefresh] = useState(0);
  // Group 12 Slice 3i (645): the explicit HQ removals of a territory
  // member's access for the selected application — the audit list.
  const [accessRemovals, setAccessRemovals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [filters, setFilters] = useState({ status: '', country: '', agreement_status: '' });
  const [search, setSearch] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteVisibility, setNoteVisibility] = useState('internal');
  // Group 12 Slice 3a (604/603/605): interview proposal form, per-document
  // review reasons, and the decision follow-up reply box.
  const [interviewForm, setInterviewForm] = useState({ starts_at: '', ends_at: '', interviewer_name: '', note: '' });
  const [docReasons, setDocReasons] = useState({});
  const [followupText, setFollowupText] = useState('');
  // Group 12 Slice 3b (607): boundary area form state.
  const [areaForm, setAreaForm] = useState({ country: '', region: '', city: '', area_type: 'included' });
  // Group 12 Slice 3b (609): launch plan step form state.
  const [planForm, setPlanForm] = useState({ title: '', description: '', due_date: '', owner_role: 'operator' });
  // Group 12 Slice 3c (611): HQ adds locations and their launch milestones.
  const [locationForm, setLocationForm] = useState({ name: '', city: '', region: '', country: '' });
  const [milestoneForm, setMilestoneForm] = useState({ location_id: '', title: '', due_date: '', owner_role: 'operator', launch_plan_step_id: '' });
  // Group 12 Slice 3c (613): HQ records a formal readiness review.
  const [reviewForm, setReviewForm] = useState({ outcome: 'passed', notes: '' });
  const [createForm, setCreateForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    lead_source: 'admin_referral',
    current_company_name: '',
    desired_brand_name: '',
    desired_country: '',
    desired_region: '',
    desired_city: '',
    territory_summary: '',
    business_background: '',
    available_capital: '',
    liquid_capital: '',
    preferred_store_count: 1,
    timeline_window: '',
  });
  const [editForm, setEditForm] = useState(null);
  const [agreementForm, setAgreementForm] = useState(null);
  const [activationForm, setActivationForm] = useState({ business_name: '', business_type: 'corp', website: '', description: '' });

  const selectedApplication = selectedBundle?.application || null;

  const metrics = useMemo(() => {
    const total = applications.length;
    const active = applications.filter((item) => !['rejected', 'archived'].includes(item.status)).length;
    const approved = applications.filter((item) => ['approved', 'launched'].includes(item.status)).length;
    const launched = applications.filter((item) => item.status === 'launched' || item.linked_business_id).length;
    return { total, active, approved, launched };
  }, [applications]);

  async function loadApplications(preferredId) {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.country) params.set('country', filters.country.trim().toUpperCase());
      if (filters.agreement_status) params.set('agreement_status', filters.agreement_status);
      if (search.trim()) params.set('search', search.trim());
      const res = await axios.get(`/franchise/applications?${params.toString()}`);
      const list = res.data?.data || [];
      setApplications(list);
      const nextId = preferredId || selectedId || list[0]?.id || null;
      setSelectedId(nextId);
      if (nextId) {
        await loadDetail(nextId);
      } else {
        setSelectedBundle(null);
      }
    } catch (err) {
      toast.error(t('adminFranchiseLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function loadDetail(id) {
    if (!id) return;
    try {
      setDetailLoading(true);
      const res = await axios.get(`/franchise/applications/${id}`);
      const bundle = res.data;
      setSelectedBundle(bundle);
      // Group 12 Slice 3d (619): the territory coverage rollup for the
      // selected application — read-only in HQ.
      try {
        const coverageRes = await axios.get(`/franchise/applications/${id}/coverage`);
        setCoverage(coverageRes.data);
      } catch {
        setCoverage(null);
      }
      // Group 12 Slice 3f (630): the territory coverage trend for the
      // selected application — read-only in HQ.
      try {
        const trendRes = await axios.get(`/franchise/applications/${id}/coverage-trend`);
        setCoverageTrend(trendRes.data);
      } catch {
        setCoverageTrend(null);
      }
      // Group 12 Slice 3i (645): the explicit access-removal audit list
      // for the selected application — read-only in HQ.
      try {
        const removalsRes = await axios.get(`/franchise/applications/${id}/access-removals`);
        setAccessRemovals(removalsRes.data);
      } catch {
        setAccessRemovals(null);
      }
      setEditForm({
        status: bundle.application.status || 'inquiry',
        agreement_status: bundle.application.agreement_status || 'draft',
        training_status: bundle.application.training_status || 'not_started',
        launch_readiness_status: bundle.application.launch_readiness_status || 'not_ready',
        owner_user_id: bundle.application.owner_user_id || '',
        desired_country: bundle.application.desired_country || '',
        desired_region: bundle.application.desired_region || '',
        desired_city: bundle.application.desired_city || '',
        desired_brand_name: bundle.application.desired_brand_name || '',
        current_company_name: bundle.application.current_company_name || '',
        territory_summary: bundle.application.territory_summary || '',
        timeline_window: bundle.application.timeline_window || '',
        preferred_store_count: bundle.application.preferred_store_count || 1,
        hq_recommendation: bundle.application.hq_recommendation || '',
        risk_notes: bundle.application.risk_notes || '',
        market_assessment: bundle.application.market_assessment || '',
      });
      setAgreementForm({
        agreement_version: bundle.agreement?.agreement_version || 'v1',
        document_url: bundle.agreement?.document_url || '',
        initial_fee: bundle.agreement?.initial_fee_cents ? (bundle.agreement.initial_fee_cents / 100).toFixed(0) : '',
        royalty_bps: bundle.agreement?.royalty_bps ?? '',
        marketing_fee_bps: bundle.agreement?.marketing_fee_bps ?? '',
        term_years: bundle.agreement?.term_years ?? '',
        territory_exclusive: bundle.agreement?.territory_exclusive || false,
        signed_by_name: bundle.agreement?.signed_by_name || '',
        signed_by_email: bundle.agreement?.signed_by_email || '',
        notes: bundle.agreement?.notes || '',
        application_agreement_status: bundle.application.agreement_status || 'draft',
      });
      setActivationForm({
        business_name: bundle.application.desired_brand_name || bundle.application.current_company_name || '',
        business_type: 'corp',
        website: '',
        description: bundle.application.local_market_overview || '',
      });
    } catch (err) {
      toast.error(t('adminFranchiseDetailFailed'));
    } finally {
      setDetailLoading(false);
    }
  }

  // Group 12 Slice 3f (629): reload the per-territory ticket queue
  // whenever the selected application or the queue filters change.
  useEffect(() => {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) {
      setTerritoryTickets([]);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ status: hqTicketStatus });
    if (hqTicketLocationId) params.set('location_id', hqTicketLocationId);
    axios.get(`/franchise/applications/${applicationId}/support-tickets?${params.toString()}`)
      .then((res) => { if (!cancelled) setTerritoryTickets(res.data?.tickets ?? []); })
      .catch(() => { if (!cancelled) setTerritoryTickets([]); });
    return () => { cancelled = true; };
  }, [selectedBundle, hqTicketStatus, hqTicketLocationId, hqTicketRefresh]);

  // Group 12 Slice 3g (631-635): the exception resolution lists for the
  // selected application — the escalation queue and the corrective-action
  // checklist. The resolution state itself rides the bundle.
  const [hqEscalations, setHqEscalations] = useState([]);
  const [hqCorrectiveActions, setHqCorrectiveActions] = useState([]);
  const [hqResolutionRefresh, setHqResolutionRefresh] = useState(0);
  useEffect(() => {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) {
      setHqEscalations([]);
      setHqCorrectiveActions([]);
      return undefined;
    }
    let cancelled = false;
    axios.get(`/franchise/applications/${applicationId}/escalations`)
      .then((res) => { if (!cancelled) setHqEscalations(res.data?.escalations ?? []); })
      .catch(() => { if (!cancelled) setHqEscalations([]); });
    axios.get(`/franchise/applications/${applicationId}/corrective-actions`)
      .then((res) => { if (!cancelled) setHqCorrectiveActions(res.data?.corrective_actions ?? []); })
      .catch(() => { if (!cancelled) setHqCorrectiveActions([]); });
    return () => { cancelled = true; };
  }, [selectedBundle, hqResolutionRefresh]);

  // Group 12 Slice 3j (648): HQ resolves a training escalation — a
  // resolution note is required, and a resolved escalation is terminal.
  async function resolveTrainingEscalation(escalationId, body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/training-escalations/${escalationId}/resolve`, body);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.trainingEscResolveFailed'));
      throw new Error(t('dashboards.franchise.trainingEscResolveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3j (647): HQ publishes dedicated operations slots
  // and moves them through confirm/complete/cancel.
  async function publishOpsSlot(body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/ops-appointments`, body);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.opsPublishFailed'));
      throw new Error(t('dashboards.franchise.opsPublishFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateOpsSlot(slotId, transition) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/ops-appointments/${slotId}/${transition}`);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.opsUpdateFailed'));
      throw new Error(t('dashboards.franchise.opsUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmOpsSlot(slotId) {
    await updateOpsSlot(slotId, 'confirm');
  }

  async function completeOpsSlot(slotId) {
    await updateOpsSlot(slotId, 'complete');
  }

  async function cancelOpsSlot(slotId) {
    await updateOpsSlot(slotId, 'cancel');
  }

  // Group 12 Slice 3g (631): HQ escalates a linked exception for the
  // territory.
  async function escalateTerritoryTicket(ticketNumber, reason) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/support-tickets/${ticketNumber}/escalate`, { reason });
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.escalationFailed'));
      throw new Error(t('dashboards.franchise.escalationFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3g (632): HQ assigns a remediation owner for a
  // linked exception.
  async function assignTerritoryRemediation(ticketId, body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/support-tickets/${ticketId}/remediation`, body);
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.remediationFailed'));
      throw new Error(t('dashboards.franchise.remediationFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3g (633): HQ adds a corrective action and moves one
  // through its status workflow (including verify / send back).
  async function createTerritoryCorrectiveAction(ticketId, body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/support-tickets/${ticketId}/corrective-actions`, body);
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.actionAddFailed'));
      throw new Error(t('dashboards.franchise.actionAddFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateTerritoryCorrectiveActionStatus(actionId, status) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/corrective-actions/${actionId}/status`, { status });
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.actionUpdateFailed'));
      throw new Error(t('dashboards.franchise.actionUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3g (634): HQ uploads evidence (multipart) and reads
  // it back for one corrective action.
  async function uploadTerritoryEvidence(actionId, formData) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/corrective-actions/${actionId}/evidence`, formData);
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.evidenceUploadFailed'));
      throw new Error(t('dashboards.franchise.evidenceUploadFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function loadTerritoryEvidence(actionId) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return [];
    const res = await axios.get(`/franchise/applications/${applicationId}/corrective-actions/${actionId}/evidence`);
    return res.data?.evidence ?? [];
  }

  // Group 12 Slice 3g (635): HQ reviews a resolved corrective action —
  // accept verifies it, reject sends it back with a reason.
  async function reviewTerritoryCorrectiveAction(actionId, { decision, reason }) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/corrective-actions/${actionId}/review`, { decision, reason });
      setHqResolutionRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.actionReviewFailed'));
      throw new Error(t('dashboards.franchise.actionReviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3h (636): HQ proposes a candidate location, reviews
  // one (shortlist / approve / reject / reopen), and removes one.
  async function proposeTerritoryCandidate(body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/candidate-locations`, body);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.candidateProposeFailed'));
      throw new Error(t('dashboards.franchise.candidateProposeFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateTerritoryCandidateStatus(candidateId, status) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.patch(`/franchise/applications/${applicationId}/candidate-locations/${candidateId}`, { status });
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.candidateUpdateFailed'));
      throw new Error(t('dashboards.franchise.candidateUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeTerritoryCandidate(candidateId) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.delete(`/franchise/applications/${applicationId}/candidate-locations/${candidateId}`);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.candidateRemoveFailed'));
      throw new Error(t('dashboards.franchise.candidateRemoveFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3i (641/642/644): HQ reviews a pending handoff
  // (approve executes the transfer; reject needs a reason) and cancels
  // one. The transfer log loads on demand from the handoff card.
  async function reviewTerritoryHandoff(handoffId, { decision, reason }) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/handoffs/${handoffId}/review`, { decision, reason });
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.handoffReviewFailed'));
      throw new Error(t('dashboards.franchise.handoffReviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function cancelTerritoryHandoff(handoffId) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/handoffs/${handoffId}/cancel`);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.handoffCancelFailed'));
      throw new Error(t('dashboards.franchise.handoffCancelFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function loadTerritoryHandoffTransfers(handoffId) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return [];
    const res = await axios.get(`/franchise/applications/${applicationId}/handoffs/${handoffId}/transfers`);
    return res.data.transfers || [];
  }

  // Group 12 Slice 3i (645): HQ explicitly removes a territory member's
  // access, with a reason; the audit list reloads with the bundle.
  async function removeTerritoryAccess(body) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/access-removals`, body);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.accessRemovalFailed'));
      throw new Error(t('dashboards.franchise.accessRemovalFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3h (637): HQ sets the target location count for one
  // structured boundary area.
  async function setTerritoryCapacityTarget(areaId, targetLocations) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/capacity-targets`, { area_id: areaId, target_locations: targetLocations });
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.capacityTargetFailed'));
      throw new Error(t('dashboards.franchise.capacityTargetFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3f (629): HQ unlinks a ticket from the territory;
  // the bundle reload refreshes the exception summary and the queue.
  async function unlinkTerritoryTicket(ticketId) {
    const applicationId = selectedBundle?.application?.id;
    if (!applicationId) return;
    setSaving(true);
    try {
      await axios.post(`/franchise/applications/${applicationId}/support-tickets/${ticketId}/unlink`);
      setHqTicketRefresh((v) => v + 1);
      await loadDetail(applicationId);
    } catch {
      toast.error(t('dashboards.franchise.exceptionUnlinkFailed'));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    loadApplications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveApplication() {
    if (!selectedApplication || !editForm) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}`, editForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseUpdateFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function saveAgreement() {
    if (!selectedApplication || !agreementForm) return;
    try {
      setSaving(true);
      const res = await axios.put(`/franchise/applications/${selectedApplication.id}/agreement`, agreementForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseAgreementUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAgreementFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function createApplication(e) {
    e.preventDefault();
    try {
      setSaving(true);
      const res = await axios.post('/franchise/applications', createForm);
      toast.success(t('adminFranchiseLeadCreated'));
      setShowCreate(false);
      setCreateForm({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        lead_source: 'admin_referral',
        current_company_name: '',
        desired_brand_name: '',
        desired_country: '',
        desired_region: '',
        desired_city: '',
        territory_summary: '',
        business_background: '',
        available_capital: '',
        liquid_capital: '',
        preferred_store_count: 1,
        timeline_window: '',
      });
      await loadApplications(res.data?.application?.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLeadFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function addNote() {
    if (!selectedApplication || !noteText.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/notes`, { note_text: noteText, visibility: noteVisibility });
      setSelectedBundle(res.data);
      setNoteText('');
      toast.success(t('adminFranchiseNoteAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseNoteFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function proposeInterview() {
    if (!selectedApplication || !interviewForm.starts_at) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/interviews`, {
        starts_at: new Date(interviewForm.starts_at).toISOString(),
        ends_at: interviewForm.ends_at ? new Date(interviewForm.ends_at).toISOString() : undefined,
        interviewer_name: interviewForm.interviewer_name,
        note: interviewForm.note,
      });
      setSelectedBundle(res.data);
      setInterviewForm({ starts_at: '', ends_at: '', interviewer_name: '', note: '' });
      toast.success(t('adminFranchiseInterviewProposed'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseInterviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateInterview(slotId, status) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/interviews/${slotId}`, { status });
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseInterviewUpdated'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseInterviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function reviewDocument(docId, status) {
    if (!selectedApplication) return;
    const reason = (docReasons[docId] || '').trim();
    if (status === 'rejected' && !reason) {
      toast.error(t('adminFranchiseReviewReasonPlaceholder'));
      return;
    }
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/documents/${docId}`, { status, reason });
      setSelectedBundle(res.data);
      setDocReasons((value) => ({ ...value, [docId]: '' }));
      toast.success(t('adminFranchiseDocumentReviewed'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseDocumentReviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function sendFollowup() {
    if (!selectedApplication || !followupText.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/followup`, { body: followupText.trim() });
      setSelectedBundle(res.data);
      setFollowupText('');
      toast.success(t('adminFranchiseFollowupSent'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseNoteFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3b (607): HQ adds/removes boundary areas. The
  // exclusivity flag stays on the agreement form; areas are the list.
  async function addArea() {
    if (!selectedApplication || !areaForm.country.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/areas`, {
        country: areaForm.country.trim().toUpperCase(),
        region: areaForm.region.trim(),
        city: areaForm.city.trim(),
        area_type: areaForm.area_type,
      });
      setSelectedBundle(res.data);
      setAreaForm({ country: '', region: '', city: '', area_type: 'included' });
      toast.success(t('adminFranchiseAreaAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAreaFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeArea(areaId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/areas/${areaId}`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseAreaRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAreaFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3b (609): HQ manages the launch plan steps.
  async function addPlanStep() {
    if (!selectedApplication || !planForm.title.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/launch-plan`, {
        title: planForm.title.trim(),
        description: planForm.description.trim(),
        due_date: planForm.due_date || undefined,
        owner_role: planForm.owner_role,
      });
      setSelectedBundle(res.data);
      setPlanForm({ title: '', description: '', due_date: '', owner_role: 'operator' });
      toast.success(t('adminFranchiseLaunchPlanAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLaunchPlanFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updatePlanStep(stepId, payload) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/launch-plan/${stepId}`, payload);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseLaunchPlanUpdated'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLaunchPlanFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removePlanStep(stepId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/launch-plan/${stepId}`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseLaunchPlanRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLaunchPlanFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3c (611): HQ adds locations and their launch milestones.
  async function addLocation() {
    if (!selectedApplication || !locationForm.name.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/locations`, {
        name: locationForm.name.trim(),
        city: locationForm.city.trim(),
        region: locationForm.region.trim(),
        country: locationForm.country.trim().toUpperCase() || undefined,
      });
      setSelectedBundle(res.data);
      setLocationForm({ name: '', city: '', region: '', country: '' });
      toast.success(t('adminFranchiseLocationAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLocationFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function addMilestone() {
    if (!selectedApplication || !milestoneForm.location_id || !milestoneForm.title.trim()) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/locations/${milestoneForm.location_id}/milestones`, {
        title: milestoneForm.title.trim(),
        due_date: milestoneForm.due_date || undefined,
        owner_role: milestoneForm.owner_role,
        launch_plan_step_id: milestoneForm.launch_plan_step_id || undefined,
      });
      setSelectedBundle(res.data);
      setMilestoneForm({ location_id: '', title: '', due_date: '', owner_role: 'operator', launch_plan_step_id: '' });
      toast.success(t('adminFranchiseMilestoneAdded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseMilestoneFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateMilestone(locationId, milestoneId, payload) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/milestones/${milestoneId}`, payload);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseMilestoneUpdated'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseMilestoneFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeMilestone(locationId, milestoneId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/milestones/${milestoneId}`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseMilestoneRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseMilestoneFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3c (613): HQ records a readiness review — the only
  // path that moves readiness to `ready`.
  async function submitReadinessReview() {
    if (!selectedApplication) return;
    if (reviewForm.outcome === 'changes_requested' && !reviewForm.notes.trim()) {
      toast.error(t('adminFranchiseReadinessReviewNotesRequired'));
      return;
    }
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/readiness-review`, {
        outcome: reviewForm.outcome,
        notes: reviewForm.notes.trim() || undefined,
      });
      setSelectedBundle(res.data);
      setReviewForm({ outcome: 'passed', notes: '' });
      toast.success(t('adminFranchiseReadinessReviewRecorded'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseReadinessReviewFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3c (614): HQ updates a location's service
  // availability checklist and launches a location.
  async function saveLocationService(locationId, body) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/services`, body);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseServiceSaved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseServiceFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function launchLocation(locationId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/launch`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseLocationLaunched'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLocationLaunchFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3d (616): HQ invites someone to the territory by
  // email, and cancels an outstanding invite.
  async function inviteTerritoryMember(body) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/invitations`, body);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseTerritoryInviteSent'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseTerritoryInviteFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function cancelTerritoryInvite(inviteId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/invitations/${inviteId}/cancel`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseTerritoryInviteCancelled'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseTerritoryInviteFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3d (617): the territory members HQ can pick a
  // location manager from — the operator, accepted invitees, and the
  // opening-team helpers. Deduped by user id.
  const [managerPick, setManagerPick] = useState({});
  function territoryMembers() {
    if (!selectedBundle) return [];
    const byId = new Map();
    const app = selectedBundle.application || {};
    if (app.owner_user_id) {
      byId.set(app.owner_user_id, {
        user_id: app.owner_user_id,
        name: [app.owner_first_name, app.owner_last_name].filter(Boolean).join(' ') || app.owner_email || app.owner_user_id,
        email: app.owner_email || '',
      });
    }
    (selectedBundle.territory_invitations || [])
      .filter((invite) => invite.status === 'accepted' && invite.invitee_user_id)
      .forEach((invite) => {
        if (!byId.has(invite.invitee_user_id)) {
          byId.set(invite.invitee_user_id, { user_id: invite.invitee_user_id, name: invite.email, email: invite.email });
        }
      });
    const teams = [
      ...(selectedBundle.opening_team || []),
      ...((selectedBundle.locations || []).flatMap((location) => location.opening_team || [])),
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
  }

  async function assignLocationManager(locationId) {
    if (!selectedApplication) return;
    const managerUserId = managerPick[locationId];
    if (!managerUserId) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/manager`, { manager_user_id: managerUserId });
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseLocationManagerAssigned'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLocationManagerFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeLocationManager(locationId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/locations/${locationId}/manager`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseLocationManagerRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLocationManagerFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3d (618): HQ assigns training to a territory member,
  // marks it complete, and removes assignments.
  async function assignTraining(body) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/training`, body);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseTrainingAssigned'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseTrainingFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function completeTraining(assignmentId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/training/${assignmentId}/complete`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseTrainingCompleted'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseTrainingFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function removeTraining(assignmentId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/training/${assignmentId}`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseTrainingRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseTrainingFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3d (620): HQ posts and removes territory announcements.
  async function postAnnouncement(body) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/announcements`, body);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseAnnouncementPosted'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAnnouncementFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function deleteAnnouncement(announcementId) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/announcements/${announcementId}`);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseAnnouncementRemoved'));
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseAnnouncementFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3e (621): HQ curates the franchise standards library —
  // a Learn guide becomes a standard for this territory, or franchise-wide
  // (every territory). A franchise-wide curate returns the wide list, so
  // the bundle is reloaded to show it.
  async function curateStandard(body) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (body.scope === 'franchise') {
        await axios.post('/franchise/standards', { guide_id: body.guide_id });
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.post(`/franchise/applications/${selectedApplication.id}/standards`, { guide_id: body.guide_id });
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function removeStandard(standard) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (standard.scope === 'franchise') {
        await axios.delete(`/franchise/standards/${standard.id}`);
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/standards/${standard.id}`);
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3e (622): HQ publishes a new version of a standard —
  // the policy-change event members must acknowledge (and 625 reminds
  // about). A franchise-wide publish returns the wide list, so the
  // bundle is reloaded to show it.
  async function publishStandardVersion(standard) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (standard.scope === 'franchise') {
        await axios.post(`/franchise/standards/${standard.id}/version`);
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.post(`/franchise/applications/${selectedApplication.id}/standards/${standard.id}/version`);
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3e (625): HQ re-sends the policy change reminder for
  // a standard, now — an explicit HQ action that bypasses the daily 24h
  // dedupe. A franchise-wide remind returns the wide list, so the
  // bundle is reloaded to show it.
  async function remindStandard(standard) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (standard.scope === 'franchise') {
        await axios.post(`/franchise/standards/${standard.id}/remind`);
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.post(`/franchise/applications/${selectedApplication.id}/standards/${standard.id}/remind`);
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
    } finally {
      setSaving(false);
    }
  }

  // Group 12 Slice 3e (623): HQ uploads a brand asset for this territory
  // or franchise-wide (multipart FormData), and removes assets. A
  // franchise-wide upload returns the wide list, so the bundle is
  // reloaded to show it.
  async function uploadBrandAsset({ formData, scope }) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (scope === 'franchise') {
        await axios.post('/franchise/brand-assets', formData);
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.post(`/franchise/applications/${selectedApplication.id}/brand-assets`, formData);
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
      throw err;
    } finally {
      setSaving(false);
    }
  }

  async function deleteBrandAsset(asset) {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      if (asset.scope === 'franchise') {
        await axios.delete(`/franchise/brand-assets/${asset.id}`);
        await loadDetail(selectedApplication.id);
      } else {
        const res = await axios.delete(`/franchise/applications/${selectedApplication.id}/brand-assets/${asset.id}`);
        setSelectedBundle(res.data);
      }
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseLoadFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function updateChecklist(itemId, payload) {
    if (!selectedApplication) return;
    try {
      const res = await axios.patch(`/franchise/applications/${selectedApplication.id}/checklist/${itemId}`, payload);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseChecklistUpdated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseChecklistFailed'));
    }
  }

  async function activateStore() {
    if (!selectedApplication) return;
    try {
      setSaving(true);
      const res = await axios.post(`/franchise/applications/${selectedApplication.id}/activate-store`, activationForm);
      setSelectedBundle(res.data);
      toast.success(t('adminFranchiseStoreActivated'));
      await loadApplications(selectedApplication.id);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('adminFranchiseActivateFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={pageShell}>
      <div style={{ maxWidth: 1500, margin: '0 auto', display: 'grid', gap: 22 }}>
        <section style={{ ...panel, padding: '28px 28px 24px', display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 760 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderRadius: 999, background: 'rgba(249, 115, 22, 0.13)', color: '#fdba74', fontSize: '0.82rem', fontWeight: 700 }}>
                <Globe size={14} />
                {t('adminFranchiseEyebrow')}
              </div>
              <h1 style={{ margin: '14px 0 10px', fontSize: '2.6rem', lineHeight: 1.05, color: '#f8fafc' }}>
                {t('adminFranchiseTitle')}
              </h1>
              <p style={{ margin: 0, color: '#94a3b8', fontSize: '1rem', lineHeight: 1.6 }}>
                {t('adminFranchiseSubtitle')}
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setShowCreate((value) => !value)}
                style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #f97316, #fb7185)', color: 'white', padding: '12px 18px', fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
              >
                <Plus size={16} />
                {t('adminFranchiseNewLead')}
              </button>
              <button
                type="button"
                onClick={() => loadApplications(selectedId)}
                style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'rgba(15, 23, 42, 0.72)', color: '#e5e7eb', padding: '12px 16px', fontWeight: 700, display: 'inline-flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}
              >
                <RefreshCcw size={16} />
                {t('common.refresh')}
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14 }}>
            <MetricCard icon={Users} label={t('adminFranchiseLivePipeline')} value={metrics.active} sublabel={t('adminFranchiseLivePipelineHint')} accent="rgba(59, 130, 246, 0.22)" />
            <MetricCard icon={Briefcase} label={t('adminFranchiseApproved')} value={metrics.approved} sublabel={t('adminFranchiseApprovedHint')} accent="rgba(34, 197, 94, 0.2)" />
            <MetricCard icon={Building2} label={t('adminFranchiseLaunchedStores')} value={metrics.launched} sublabel={t('adminFranchiseLaunchedStoresHint')} accent="rgba(16, 185, 129, 0.22)" />
            <MetricCard icon={ClipboardList} label={t('adminFranchiseTotalLeads')} value={metrics.total} sublabel={t('adminFranchiseTotalLeadsHint')} accent="rgba(249, 115, 22, 0.2)" />
          </div>

          {showCreate && (
            <form onSubmit={createApplication} style={{ ...panel, padding: 20, display: 'grid', gap: 14, borderRadius: 20 }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseCreateLead')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <input style={fieldStyle} placeholder={t('adminFranchiseFirstName')} value={createForm.first_name} onChange={(e) => setCreateForm((v) => ({ ...v, first_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLastName')} value={createForm.last_name} onChange={(e) => setCreateForm((v) => ({ ...v, last_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseEmail')} value={createForm.email} onChange={(e) => setCreateForm((v) => ({ ...v, email: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchisePhone')} value={createForm.phone} onChange={(e) => setCreateForm((v) => ({ ...v, phone: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCountryCode')} value={createForm.desired_country} onChange={(e) => setCreateForm((v) => ({ ...v, desired_country: e.target.value.toUpperCase() }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseRegion')} value={createForm.desired_region} onChange={(e) => setCreateForm((v) => ({ ...v, desired_region: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCity')} value={createForm.desired_city} onChange={(e) => setCreateForm((v) => ({ ...v, desired_city: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLeadSource')} value={createForm.lead_source} onChange={(e) => setCreateForm((v) => ({ ...v, lead_source: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseCurrentCompany')} value={createForm.current_company_name} onChange={(e) => setCreateForm((v) => ({ ...v, current_company_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseDesiredBrand')} value={createForm.desired_brand_name} onChange={(e) => setCreateForm((v) => ({ ...v, desired_brand_name: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseAvailableCapital')} value={createForm.available_capital} onChange={(e) => setCreateForm((v) => ({ ...v, available_capital: e.target.value }))} />
                <input style={fieldStyle} placeholder={t('adminFranchiseLiquidCapital')} value={createForm.liquid_capital} onChange={(e) => setCreateForm((v) => ({ ...v, liquid_capital: e.target.value }))} />
              </div>
              <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseTerritorySummary')} value={createForm.territory_summary} onChange={(e) => setCreateForm((v) => ({ ...v, territory_summary: e.target.value }))} />
              <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseBusinessBackground')} value={createForm.business_background} onChange={(e) => setCreateForm((v) => ({ ...v, business_background: e.target.value }))} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" onClick={() => setShowCreate(false)} style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'transparent', color: '#cbd5e1', padding: '11px 16px', cursor: 'pointer' }}>{t('common.close')}</button>
                <button type="submit" style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #f97316, #fb7185)', color: 'white', padding: '11px 18px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseCreateLeadButton')}</button>
              </div>
            </form>
          )}
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '420px minmax(0, 1fr)', gap: 18, alignItems: 'start' }}>
          <div style={{ ...panel, padding: 18, display: 'grid', gap: 14, position: 'sticky', top: 24 }}>
            <div style={{ display: 'grid', gap: 12 }}>
              <SuggestDropdown
                id="franchise-hq-search"
                items={franchiseSuggestItems}
                value={search}
                onQueryChange={setSearch}
                onSelect={(item) => setSearch(item.title || '')}
                recentsKey="oxsteed_admin_franchise_hq_search_recents"
                placeholder={t('adminFranchiseSearchPlaceholder')}
                ariaLabel={t('adminFranchiseSearchPlaceholder')}
                className="sd-admin-adaptive"
              />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <select style={fieldStyle} value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value }))}>
                  <option value="">{t('adminFranchiseAllStatuses')}</option>
                  {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                </select>
                <input style={fieldStyle} placeholder={t('adminFranchiseCountry')} value={filters.country} onChange={(e) => setFilters((v) => ({ ...v, country: e.target.value.toUpperCase() }))} />
                <select style={fieldStyle} value={filters.agreement_status} onChange={(e) => setFilters((v) => ({ ...v, agreement_status: e.target.value }))}>
                  <option value="">{t('adminFranchiseAllAgreements')}</option>
                  {AGREEMENT_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                </select>
              </div>
              <button type="button" onClick={() => loadApplications()} style={{ border: 'none', borderRadius: 14, background: 'rgba(59, 130, 246, 0.16)', color: '#bfdbfe', padding: '11px 14px', fontWeight: 700, cursor: 'pointer' }}>
                {t('adminFranchiseApplyFilters')}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 12, maxHeight: '68vh', overflowY: 'auto', paddingRight: 4 }}>
              {loading ? (
                <div style={{ color: '#94a3b8' }}>{t('adminFranchiseLoadingPipeline')}</div>
              ) : applications.length ? (
                applications.map((item) => (
                  <FranchiseRow key={item.id} item={item} isActive={item.id === selectedId} onClick={() => { setSelectedId(item.id); loadDetail(item.id); }} />
                ))
              ) : (
                <div style={{ ...panel, padding: 20, textAlign: 'center', color: '#94a3b8' }}>
                  {t('adminFranchiseNoMatches')}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 18 }}>
            {!selectedApplication ? (
              <div style={{ ...panel, padding: 36, textAlign: 'center', color: '#94a3b8' }}>
                {t('adminFranchiseSelectPrompt')}
              </div>
            ) : detailLoading || !editForm || !agreementForm ? (
              <div style={{ ...panel, padding: 36, color: '#94a3b8' }}>{t('adminFranchiseLoadingWorkspace')}</div>
            ) : (
              <>
                <section style={{ ...panel, padding: 24, display: 'grid', gap: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(249, 115, 22, 0.14)', color: '#fdba74', fontSize: '0.78rem', fontWeight: 700 }}>{formatLabel(selectedApplication.status, t)}</span>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(16, 185, 129, 0.14)', color: '#86efac', fontSize: '0.78rem', fontWeight: 700 }}>{t('adminFranchiseAgreementBadge', { status: formatLabel(selectedApplication.agreement_status, t) })}</span>
                        <span style={{ padding: '6px 11px', borderRadius: 999, background: 'rgba(59, 130, 246, 0.16)', color: '#bfdbfe', fontSize: '0.78rem', fontWeight: 700 }}>{selectedApplication.desired_country}{selectedApplication.desired_region ? ` · ${selectedApplication.desired_region}` : ''}</span>
                      </div>
                      <h2 style={{ margin: 0, fontSize: '2rem', color: '#f8fafc' }}>
                        {selectedApplication.desired_brand_name || selectedApplication.current_company_name || `${selectedApplication.first_name} ${selectedApplication.last_name}`}
                      </h2>
                      <div style={{ color: '#94a3b8', fontSize: '0.95rem' }}>
                        {selectedApplication.first_name} {selectedApplication.last_name} · {selectedApplication.email}{selectedApplication.phone ? ` · ${selectedApplication.phone}` : ''}
                      </div>
                    </div>

                    <div style={{ ...panel, padding: 16, borderRadius: 18, minWidth: 240 }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('adminFranchiseLaunchProgress')}</div>
                      <div style={{ marginTop: 6, fontSize: '1.9rem', fontWeight: 700 }}>{selectedApplication.checklist_total ? Math.round((selectedApplication.checklist_completed / selectedApplication.checklist_total) * 100) : 0}%</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.88rem', marginTop: 4 }}>
                        {t('adminFranchiseStepsComplete', { completed: selectedApplication.checklist_completed, total: selectedApplication.checklist_total })}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
                    <MetricCard icon={MapPin} label={t('adminFranchiseTerritory')} value={selectedApplication.desired_city || selectedApplication.desired_region || selectedApplication.desired_country} sublabel={selectedApplication.territory_summary || t('adminFranchiseTerritoryFallback')} accent="rgba(59, 130, 246, 0.18)" />
                    <MetricCard icon={DollarSign} label={t('adminFranchiseCapital')} value={selectedApplication.available_capital_cents ? money.format(selectedApplication.available_capital_cents / 100) : t('adminFranchiseTbd')} sublabel={selectedApplication.liquid_capital_cents ? t('adminFranchiseLiquidAmount', { amount: money.format(selectedApplication.liquid_capital_cents / 100) }) : t('adminFranchiseLiquidityMissing')} accent="rgba(16, 185, 129, 0.18)" />
                    <MetricCard icon={Users} label={t('adminFranchiseOwner')} value={selectedApplication.owner_email || t('adminFranchiseUnassigned')} sublabel={selectedApplication.owner_user_id ? t('adminFranchiseOwnerLinked') : t('adminFranchiseAssignOwner')} accent="rgba(168, 85, 247, 0.18)" />
                    <MetricCard icon={Building2} label={t('adminFranchiseStoreLink')} value={selectedApplication.linked_business_name || t('adminFranchiseNotLaunched')} sublabel={selectedApplication.linked_business_id ? t('adminFranchiseBusinessRef', { id: selectedApplication.linked_business_id }) : t('adminFranchiseNoStore')} accent="rgba(249, 115, 22, 0.18)" />
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1.08fr 0.92fr', gap: 18 }}>
                  <div style={{ ...panel, padding: 22, display: 'grid', gap: 14 }}>
                    <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseHqReview')}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                      <select style={fieldStyle} value={editForm.status} onChange={(e) => setEditForm((v) => ({ ...v, status: e.target.value }))}>
                        {STATUS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <input style={fieldStyle} placeholder={t('adminFranchiseOwnerUuid')} value={editForm.owner_user_id} onChange={(e) => setEditForm((v) => ({ ...v, owner_user_id: e.target.value }))} />
                      <select style={fieldStyle} value={editForm.training_status} onChange={(e) => setEditForm((v) => ({ ...v, training_status: e.target.value }))}>
                        {TRAINING_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <select style={fieldStyle} value={editForm.launch_readiness_status} onChange={(e) => setEditForm((v) => ({ ...v, launch_readiness_status: e.target.value }))}>
                        {editForm.launch_readiness_status === 'ready' && (
                          <option value="ready">{formatLabel('ready', t)}</option>
                        )}
                        {READINESS_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                      </select>
                      <input style={fieldStyle} placeholder={t('adminFranchiseCountry')} value={editForm.desired_country} onChange={(e) => setEditForm((v) => ({ ...v, desired_country: e.target.value.toUpperCase() }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseRegion')} value={editForm.desired_region} onChange={(e) => setEditForm((v) => ({ ...v, desired_region: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseCity')} value={editForm.desired_city} onChange={(e) => setEditForm((v) => ({ ...v, desired_city: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchisePreferredStoreCount')} value={editForm.preferred_store_count} onChange={(e) => setEditForm((v) => ({ ...v, preferred_store_count: e.target.value }))} />
                      <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseDesiredBrandName')} value={editForm.desired_brand_name} onChange={(e) => setEditForm((v) => ({ ...v, desired_brand_name: e.target.value }))} />
                      <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseCurrentCompanyName')} value={editForm.current_company_name} onChange={(e) => setEditForm((v) => ({ ...v, current_company_name: e.target.value }))} />
                    </div>
                    {/* Group 12 Slice 3c (613): `ready` is set by a passed
                        readiness review, not from this form. */}
                    <div className="frhq-row-meta">{t('adminFranchiseReadinessViaReview')}</div>
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseTerritorySummary')} value={editForm.territory_summary} onChange={(e) => setEditForm((v) => ({ ...v, territory_summary: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseMarketAssessment')} value={editForm.market_assessment} onChange={(e) => setEditForm((v) => ({ ...v, market_assessment: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseHqRecommendation')} value={editForm.hq_recommendation} onChange={(e) => setEditForm((v) => ({ ...v, hq_recommendation: e.target.value }))} />
                    <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseRiskNotes')} value={editForm.risk_notes} onChange={(e) => setEditForm((v) => ({ ...v, risk_notes: e.target.value }))} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ color: '#94a3b8', fontSize: '0.86rem' }}>
                        {t('adminFranchiseLastContact', { value: selectedApplication.last_contacted_at ? new Date(selectedApplication.last_contacted_at).toLocaleString() : t('adminFranchiseNotRecorded') })}
                      </div>
                      <div style={{ display: 'flex', gap: 10 }}>
                        <button type="button" onClick={() => setEditForm((v) => ({ ...v, touch_contacted_at: true }))} style={{ border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: 14, background: 'transparent', color: '#cbd5e1', padding: '10px 14px', cursor: 'pointer' }}>{t('adminFranchiseMarkContacted')}</button>
                        <button type="button" disabled={saving} onClick={saveApplication} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #2563eb, #14b8a6)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseSaveReview')}</button>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseAgreementPackage')}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                        <select style={fieldStyle} value={agreementForm.application_agreement_status} onChange={(e) => setAgreementForm((v) => ({ ...v, application_agreement_status: e.target.value }))}>
                          {AGREEMENT_OPTIONS.map((value) => <option key={value} value={value}>{formatLabel(value, t)}</option>)}
                        </select>
                        <input style={fieldStyle} placeholder={t('adminFranchiseAgreementVersion')} value={agreementForm.agreement_version} onChange={(e) => setAgreementForm((v) => ({ ...v, agreement_version: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseInitialFee')} value={agreementForm.initial_fee} onChange={(e) => setAgreementForm((v) => ({ ...v, initial_fee: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseRoyalty')} value={agreementForm.royalty_bps} onChange={(e) => setAgreementForm((v) => ({ ...v, royalty_bps: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseMarketingFee')} value={agreementForm.marketing_fee_bps} onChange={(e) => setAgreementForm((v) => ({ ...v, marketing_fee_bps: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseTermYears')} value={agreementForm.term_years} onChange={(e) => setAgreementForm((v) => ({ ...v, term_years: e.target.value }))} />
                        <input style={{ ...fieldStyle, gridColumn: '1 / -1' }} placeholder={t('adminFranchiseAgreementUrl')} value={agreementForm.document_url} onChange={(e) => setAgreementForm((v) => ({ ...v, document_url: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseSignedByName')} value={agreementForm.signed_by_name} onChange={(e) => setAgreementForm((v) => ({ ...v, signed_by_name: e.target.value }))} />
                        <input style={fieldStyle} placeholder={t('adminFranchiseSignedByEmail')} value={agreementForm.signed_by_email} onChange={(e) => setAgreementForm((v) => ({ ...v, signed_by_email: e.target.value }))} />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: '0.9rem' }}>
                        <input type="checkbox" checked={agreementForm.territory_exclusive} onChange={(e) => setAgreementForm((v) => ({ ...v, territory_exclusive: e.target.checked }))} />
                        {t('adminFranchiseExclusiveTerritory')}
                      </label>
                      <textarea style={{ ...fieldStyle, minHeight: 90 }} placeholder={t('adminFranchiseAgreementNotes')} value={agreementForm.notes} onChange={(e) => setAgreementForm((v) => ({ ...v, notes: e.target.value }))} />
                      <button type="button" disabled={saving} onClick={saveAgreement} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>
                        {t('adminFranchiseSaveAgreement')}
                      </button>
                    </div>

                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseActivateStore')}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6 }}>
                        {t('adminFranchiseActivateText')}
                      </div>
                      <input style={fieldStyle} placeholder={t('adminFranchiseBusinessName')} value={activationForm.business_name} onChange={(e) => setActivationForm((v) => ({ ...v, business_name: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseBusinessType')} value={activationForm.business_type} onChange={(e) => setActivationForm((v) => ({ ...v, business_type: e.target.value }))} />
                      <input style={fieldStyle} placeholder={t('adminFranchiseWebsite')} value={activationForm.website} onChange={(e) => setActivationForm((v) => ({ ...v, website: e.target.value }))} />
                      <textarea style={{ ...fieldStyle, minHeight: 84 }} placeholder={t('adminFranchiseOpeningDescription')} value={activationForm.description} onChange={(e) => setActivationForm((v) => ({ ...v, description: e.target.value }))} />
                      <button
                        type="button"
                        disabled={saving || !selectedApplication.owner_user_id || !!selectedApplication.linked_business_id}
                        onClick={activateStore}
                        style={{ border: 'none', borderRadius: 14, background: selectedApplication.linked_business_id ? 'rgba(34, 197, 94, 0.25)' : 'linear-gradient(135deg, #10b981, #22c55e)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: selectedApplication.linked_business_id ? 'default' : 'pointer' }}
                      >
                        {selectedApplication.linked_business_id ? t('adminFranchiseAlreadyActivated') : t('adminFranchiseActivateButton')}
                      </button>
                      {!selectedApplication.owner_user_id && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#fca5a5', fontSize: '0.86rem' }}>
                          <AlertTriangle size={15} />
                          {t('adminFranchiseAssignOwnerNote')}
                        </div>
                      )}
                    </div>
                  </div>
                </section>

                <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div style={{ ...panel, padding: 22, display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseLaunchChecklist')}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.84rem' }}>{t('adminFranchiseItems', { count: selectedBundle.checklist.length })}</div>
                    </div>
                    <div style={{ display: 'grid', gap: 10 }}>
                      {selectedBundle.checklist.map((item) => (
                        <div key={item.id} style={{ border: '1px solid rgba(148, 163, 184, 0.14)', borderRadius: 18, padding: 14, display: 'grid', gap: 10, background: 'rgba(2, 6, 23, 0.48)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                            <div>
                              <div style={{ fontWeight: 700, color: '#f8fafc' }}>{item.label}</div>
                              <div style={{ color: '#94a3b8', fontSize: '0.84rem' }}>{item.owner_role || t('adminFranchiseUnassignedOwner')}</div>
                            </div>
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: item.status === 'completed' ? '#86efac' : '#fcd34d', fontSize: '0.84rem', fontWeight: 700 }}>
                              {item.status === 'completed' ? <CheckCircle2 size={15} /> : <ClipboardList size={15} />}
                              {formatLabel(item.status, t)}
                            </div>
                          </div>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {CHECKLIST_OPTIONS.map((status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() => updateChecklist(item.id, { status })}
                                style={{
                                  border: item.status === status ? '1px solid rgba(249, 115, 22, 0.65)' : '1px solid rgba(148, 163, 184, 0.12)',
                                  borderRadius: 999,
                                  padding: '6px 10px',
                                  background: item.status === status ? 'rgba(249, 115, 22, 0.16)' : 'transparent',
                                  color: '#e5e7eb',
                                  fontSize: '0.75rem',
                                  cursor: 'pointer',
                                }}
                              >
                                {formatLabel(status, t)}
                              </button>
                            ))}
                          </div>
                          {item.notes ? <div style={{ color: '#cbd5e1', fontSize: '0.84rem' }}>{item.notes}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 18 }}>
                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseInternalNotes')}</div>
                      <textarea style={{ ...fieldStyle, minHeight: 92 }} placeholder={t('adminFranchiseNotesPlaceholder')} value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                      <div className="frhq-note-visibility">
                        <span>{t('adminFranchiseNoteVisibility')}</span>
                        <select className="frhq-field" value={noteVisibility} onChange={(e) => setNoteVisibility(e.target.value)}>
                          <option value="internal">{t('adminFranchiseNoteInternal')}</option>
                          <option value="shared">{t('adminFranchiseNoteShared')}</option>
                        </select>
                      </div>
                      <button type="button" disabled={saving || !noteText.trim()} onClick={addNote} style={{ border: 'none', borderRadius: 14, background: 'linear-gradient(135deg, #0ea5e9, #2563eb)', color: 'white', padding: '10px 16px', fontWeight: 700, cursor: 'pointer' }}>{t('adminFranchiseAddNote')}</button>
                      <div style={{ display: 'grid', gap: 10, maxHeight: 260, overflowY: 'auto' }}>
                        {selectedBundle.notes.length ? selectedBundle.notes.map((note) => (
                          <div key={note.id} style={{ borderRadius: 16, padding: 14, background: 'rgba(2, 6, 23, 0.56)', border: '1px solid rgba(148, 163, 184, 0.12)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, color: '#94a3b8', fontSize: '0.78rem' }}>
                              <span>{note.admin_email || t('adminFranchiseSystem')} · {note.visibility === 'shared' ? t('adminFranchiseNoteShared') : t('adminFranchiseNoteInternal')}</span>
                              <span>{new Date(note.created_at).toLocaleString()}</span>
                            </div>
                            <div style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.55 }}>{note.note_text}</div>
                          </div>
                        )) : (
                          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{t('adminFranchiseNoNotes')}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ ...panel, padding: 22, display: 'grid', gap: 12 }}>
                      <div style={{ fontSize: '1.08rem', fontWeight: 700, color: '#f8fafc' }}>{t('adminFranchiseRecentActivity')}</div>
                      <div style={{ display: 'grid', gap: 10, maxHeight: 240, overflowY: 'auto' }}>
                        {selectedBundle.activity.length ? selectedBundle.activity.map((event) => (
                          <div key={event.id} style={{ borderRadius: 16, padding: 14, background: 'rgba(2, 6, 23, 0.56)', border: '1px solid rgba(148, 163, 184, 0.12)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8, color: '#94a3b8', fontSize: '0.78rem' }}>
                              <span>{formatLabel(event.event_type, t)}</span>
                              <span>{new Date(event.created_at).toLocaleString()}</span>
                            </div>
                            <div style={{ color: '#e5e7eb', fontSize: '0.9rem', lineHeight: 1.55 }}>{event.event_summary}</div>
                          </div>
                        )) : (
                          <div style={{ color: '#94a3b8', fontSize: '0.88rem' }}>{t('adminFranchiseNoActivity')}</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="frhq-sections">
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseInterviewTitle')}</div>
                    <div className="frhq-form-grid">
                      <label className="frhq-label">
                        {t('adminFranchiseStartsAt')}
                        <input type="datetime-local" className="frhq-field" value={interviewForm.starts_at} onChange={(e) => setInterviewForm((v) => ({ ...v, starts_at: e.target.value }))} />
                      </label>
                      <label className="frhq-label">
                        {t('adminFranchiseEndsAt')}
                        <input type="datetime-local" className="frhq-field" value={interviewForm.ends_at} onChange={(e) => setInterviewForm((v) => ({ ...v, ends_at: e.target.value }))} />
                      </label>
                      <input className="frhq-field frhq-field-full" placeholder={t('adminFranchiseInterviewerName')} value={interviewForm.interviewer_name} onChange={(e) => setInterviewForm((v) => ({ ...v, interviewer_name: e.target.value }))} />
                      <textarea className="frhq-field frhq-field-full" placeholder={t('adminFranchiseInterviewNote')} value={interviewForm.note} onChange={(e) => setInterviewForm((v) => ({ ...v, note: e.target.value }))} />
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving || !interviewForm.starts_at} onClick={proposeInterview}>
                      {t('adminFranchiseProposeButton')}
                    </button>
                    <div className="frhq-list">
                      {(selectedBundle.interviews || []).length ? selectedBundle.interviews.map((slot) => (
                        <div key={slot.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">
                              {new Date(slot.starts_at).toLocaleString()}
                              {slot.ends_at ? ` – ${new Date(slot.ends_at).toLocaleTimeString()}` : ''}
                            </div>
                            <div className="frhq-row-meta">
                              {slot.interviewer_name ? `${slot.interviewer_name} · ` : ''}{formatLabel(slot.status, t)}
                            </div>
                            {slot.note && <div className="frhq-row-meta">{slot.note}</div>}
                          </div>
                          <div className="frhq-row-actions">
                            {slot.status === 'booked' && (
                              <button type="button" className="frhq-btn-accept" disabled={saving} onClick={() => updateInterview(slot.id, 'completed')}>
                                {t('adminFranchiseCompleteInterview')}
                              </button>
                            )}
                            {['proposed', 'booked'].includes(slot.status) && (
                              <button type="button" className="frhq-btn-reject" disabled={saving} onClick={() => updateInterview(slot.id, 'cancelled')}>
                                {t('adminFranchiseCancelInterview')}
                              </button>
                            )}
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseNoInterviews')}</div>
                      )}
                    </div>
                  </div>

                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseDocumentsTitle')}</div>
                    <div className="frhq-list">
                      {(selectedBundle.documents || []).length ? selectedBundle.documents.map((doc) => (
                        <div key={doc.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">{doc.file_name}</div>
                            <div className="frhq-row-meta">
                              {t(`dashboards.franchise.${{ identity: 'docIdentity', entity: 'docEntity', financials: 'docFinancials', territory_plan: 'docTerritoryPlan' }[doc.category] || 'docIdentity'}`)} · {formatLabel(doc.status, t)} · {new Date(doc.created_at).toLocaleString()}
                            </div>
                            {doc.review_reason && <div className="frhq-row-meta">{doc.review_reason}</div>}
                            {doc.download_url && (
                              <a className="frhq-link" href={doc.download_url} target="_blank" rel="noreferrer">
                                {t('adminFranchiseDownloadDocument')}
                              </a>
                            )}
                          </div>
                          <div className="frhq-doc-review">
                            <input
                              className="frhq-field"
                              placeholder={t('adminFranchiseReviewReasonPlaceholder')}
                              value={docReasons[doc.id] || ''}
                              onChange={(e) => setDocReasons((v) => ({ ...v, [doc.id]: e.target.value }))}
                            />
                            <div className="frhq-row-actions">
                              <button type="button" className="frhq-btn-accept" disabled={saving || doc.status === 'accepted'} onClick={() => reviewDocument(doc.id, 'accepted')}>
                                {t('adminFranchiseAcceptDocument')}
                              </button>
                              <button type="button" className="frhq-btn-reject" disabled={saving || doc.status === 'rejected'} onClick={() => reviewDocument(doc.id, 'rejected')}>
                                {t('adminFranchiseRejectDocument')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseNoDocuments')}</div>
                      )}
                    </div>
                  </div>

                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseFollowupTitle')}</div>
                    <div className="frhq-list">
                      {(selectedBundle.followup || []).length ? selectedBundle.followup.map((message) => (
                        <div key={message.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-meta">
                              {message.author_role === 'admin' ? t('adminFranchiseFollowupFromHq') : t('adminFranchiseFollowupFromApplicant')} · {new Date(message.created_at).toLocaleString()}
                            </div>
                            <div className="frhq-row-body">{message.body}</div>
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseFollowupEmpty')}</div>
                      )}
                    </div>
                    <textarea
                      className="frhq-field"
                      placeholder={t('adminFranchiseFollowupPlaceholder')}
                      value={followupText}
                      onChange={(e) => setFollowupText(e.target.value)}
                    />
                    <button type="button" className="frhq-btn-primary" disabled={saving || !followupText.trim()} onClick={sendFollowup}>
                      {t('adminFranchiseFollowupSend')}
                    </button>
                  </div>

                  {/* Group 12 Slice 3b (607): assignment boundary — the
                      structured area list HQ edits; exclusivity lives on
                      the agreement form above. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseBoundaryTitle')}</div>
                    <div className="frhq-row-meta">
                      {selectedBundle.agreement?.territory_exclusive
                        ? t('adminFranchiseBoundaryExclusive')
                        : t('adminFranchiseBoundaryNonExclusive')}
                    </div>
                    <div className="frhq-list">
                      {(selectedBundle.territory_areas || []).length ? selectedBundle.territory_areas.map((area) => (
                        <div key={area.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">
                              {[area.city, area.region, area.country].filter(Boolean).join(', ')}
                            </div>
                            <div className="frhq-row-meta">
                              {area.area_type === 'excluded' ? t('adminFranchiseAreaExcluded') : t('adminFranchiseAreaIncluded')}
                            </div>
                          </div>
                          <div className="frhq-row-actions">
                            <button type="button" className="frhq-btn-reject" disabled={saving} onClick={() => removeArea(area.id)}>
                              {t('adminFranchiseRemoveArea')}
                            </button>
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseBoundaryEmpty')}</div>
                      )}
                    </div>
                    <div className="frhq-form-grid">
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseAreaCountry')}
                        value={areaForm.country}
                        onChange={(e) => setAreaForm((v) => ({ ...v, country: e.target.value.toUpperCase() }))}
                      />
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseAreaRegion')}
                        value={areaForm.region}
                        onChange={(e) => setAreaForm((v) => ({ ...v, region: e.target.value }))}
                      />
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseAreaCity')}
                        value={areaForm.city}
                        onChange={(e) => setAreaForm((v) => ({ ...v, city: e.target.value }))}
                      />
                      <select
                        className="frhq-field"
                        value={areaForm.area_type}
                        onChange={(e) => setAreaForm((v) => ({ ...v, area_type: e.target.value }))}
                      >
                        <option value="included">{t('adminFranchiseAreaIncluded')}</option>
                        <option value="excluded">{t('adminFranchiseAreaExcluded')}</option>
                      </select>
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving || !areaForm.country.trim()} onClick={addArea}>
                      {t('adminFranchiseAddArea')}
                    </button>
                  </div>

                  {/* Group 12 Slice 3b (609): territory launch plan — HQ
                      manages steps; the operator updates step status. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseLaunchPlanTitle')}</div>
                    <div className="frhq-row-meta">
                      {t('adminFranchiseLaunchPlanReadiness')}: {formatLabel(selectedApplication.launch_readiness_status, t)}
                    </div>
                    <div className="frhq-list">
                      {(selectedBundle.launch_plan_steps || []).length ? selectedBundle.launch_plan_steps.map((step) => (
                        <div key={step.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">{step.title}</div>
                            {step.description && <div className="frhq-row-meta">{step.description}</div>}
                            <div className="frhq-row-meta">
                              {formatLabel(step.owner_role, t)}
                              {step.due_date ? ` · ${new Date(step.due_date).toLocaleDateString()}` : ''}
                              {' · '}
                              {formatLabel(step.status, t)}
                            </div>
                          </div>
                          <div className="frhq-row-actions">
                            <select
                              className="frhq-field"
                              value={step.status}
                              disabled={saving}
                              onChange={(e) => updatePlanStep(step.id, { status: e.target.value })}
                            >
                              {['pending', 'in_progress', 'completed', 'blocked'].map((status) => (
                                <option key={status} value={status}>{formatLabel(status, t)}</option>
                              ))}
                            </select>
                            <button type="button" className="frhq-btn-reject" disabled={saving} onClick={() => removePlanStep(step.id)}>
                              {t('adminFranchiseLaunchPlanDelete')}
                            </button>
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseLaunchPlanEmpty')}</div>
                      )}
                    </div>
                    <div className="frhq-form-grid">
                      <input
                        className="frhq-field frhq-field-full"
                        placeholder={t('adminFranchiseLaunchPlanAddTitle')}
                        value={planForm.title}
                        onChange={(e) => setPlanForm((v) => ({ ...v, title: e.target.value }))}
                      />
                      <textarea
                        className="frhq-field frhq-field-full"
                        placeholder={t('adminFranchiseLaunchPlanDescription')}
                        value={planForm.description}
                        onChange={(e) => setPlanForm((v) => ({ ...v, description: e.target.value }))}
                      />
                      <label className="frhq-label">
                        {t('adminFranchiseLaunchPlanDueDate')}
                        <input
                          type="date"
                          className="frhq-field"
                          value={planForm.due_date}
                          onChange={(e) => setPlanForm((v) => ({ ...v, due_date: e.target.value }))}
                        />
                      </label>
                      <label className="frhq-label">
                        {t('adminFranchiseLaunchPlanOwner')}
                        <select
                          className="frhq-field"
                          value={planForm.owner_role}
                          onChange={(e) => setPlanForm((v) => ({ ...v, owner_role: e.target.value }))}
                        >
                          <option value="operator">{t('dashboards.franchise.launchPlanOwnerOperator')}</option>
                          <option value="hq">{t('dashboards.franchise.launchPlanOwnerHq')}</option>
                          <option value="shared">{t('dashboards.franchise.launchPlanOwnerShared')}</option>
                        </select>
                      </label>
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving || !planForm.title.trim()} onClick={addPlanStep}>
                      {t('adminFranchiseLaunchPlanAdd')}
                    </button>
                  </div>

                  {/* Group 12 Slice 3c (611): open locations — HQ adds
                      locations and their launch milestones; the operator
                      updates milestone status from their own pages. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('dashboards.franchise.openLocationsTitle')}</div>
                    <div className="frhq-list">
                      {(selectedBundle.locations || []).length ? selectedBundle.locations.map((location) => (
                        <div key={location.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">{location.name}</div>
                            <div className="frhq-row-meta">
                              {[location.city, location.region, location.country].filter(Boolean).join(', ')}
                              {' · '}
                              {formatLabel(location.status, t)}
                            </div>
                            {/* Group 12 Slice 3c (612): the opening team
                                for this launch, read-only in HQ — the
                                operator designates members from the
                                territory roster. */}
                            {(location.opening_team || []).length > 0 && (
                              <div className="frhq-row-meta">
                                {t('dashboards.franchise.openingTeamTitle')}: {location.opening_team.map((member) => (
                                  `${[member.helper_first_name, member.helper_last_name].filter(Boolean).join(' ') || member.helper_email} (${member.role === 'lead' ? t('dashboards.franchise.openingTeamLead') : t('dashboards.franchise.openingTeamMember')})`
                                )).join(', ')}
                              </div>
                            )}
                            {/* Group 12 Slice 3d (617): the location
                                manager — HQ-only assignment from the
                                territory members; the operator sees the
                                manager read-only on the location card. */}
                            <div className="frhq-row-meta">
                              {t('dashboards.franchise.locationManagerTitle')}: {location.manager
                                ? `${[location.manager.manager_first_name, location.manager.manager_last_name].filter(Boolean).join(' ') || location.manager.manager_email} (${location.manager.manager_email})`
                                : t('dashboards.franchise.locationManagerNone')}
                            </div>
                            <div className="frhq-form-grid">
                              <label className="frhq-label">
                                {t('dashboards.franchise.locationManagerTitle')}
                                <select
                                  className="frhq-field"
                                  value={managerPick[location.id] || ''}
                                  disabled={saving}
                                  onChange={(e) => setManagerPick((v) => ({ ...v, [location.id]: e.target.value }))}
                                >
                                  <option value="">{t('dashboards.franchise.locationManagerChoose')}</option>
                                  {territoryMembers().map((member) => (
                                    <option key={member.user_id} value={member.user_id}>
                                      {member.name}{member.email && member.name !== member.email ? ` (${member.email})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <div className="frhq-row-actions">
                              <button type="button" className="frhq-btn-primary" disabled={saving || !managerPick[location.id]} onClick={() => assignLocationManager(location.id)}>
                                {t('dashboards.franchise.locationManagerAssign')}
                              </button>
                              {location.manager && (
                                <button type="button" className="frhq-btn-reject" disabled={saving} onClick={() => removeLocationManager(location.id)}>
                                  {t('dashboards.franchise.locationManagerRemove')}
                                </button>
                              )}
                            </div>
                            {(location.milestones || []).length ? location.milestones.map((milestone) => (
                              <div key={milestone.id} className="frhq-row">
                                <div>
                                  <div className="frhq-row-title">{milestone.title}</div>
                                  <div className="frhq-row-meta">
                                    {formatLabel(milestone.owner_role, t)}
                                    {milestone.due_date ? ` · ${new Date(milestone.due_date).toLocaleDateString()}` : ''}
                                    {' · '}
                                    {formatLabel(milestone.status, t)}
                                  </div>
                                </div>
                                <div className="frhq-row-actions">
                                  <select
                                    className="frhq-field"
                                    value={milestone.status}
                                    disabled={saving}
                                    onChange={(e) => updateMilestone(location.id, milestone.id, { status: e.target.value })}
                                  >
                                    {['pending', 'in_progress', 'completed', 'blocked'].map((status) => (
                                      <option key={status} value={status}>{formatLabel(status, t)}</option>
                                    ))}
                                  </select>
                                  <button type="button" className="frhq-btn-reject" disabled={saving} onClick={() => removeMilestone(location.id, milestone.id)}>
                                    {t('adminFranchiseMilestoneDelete')}
                                  </button>
                                </div>
                              </div>
                            )) : (
                              <div className="frhq-empty">{t('adminFranchiseMilestoneEmpty')}</div>
                            )}
                            {/* Group 12 Slice 3c (614): this location's
                                service availability checklist and launch. */}
                            <FranchiseLocationServices
                              location={location}
                              catalogue={selectedBundle.business_services || []}
                              canEdit
                              onServiceSave={saveLocationService}
                              onLaunch={launchLocation}
                              disabled={saving}
                            />
                            {/* Group 12 Slice 3c (615): the opening
                                confirmation, read-only in HQ — only the
                                operator confirms a location opened. */}
                            <FranchiseOpeningConfirmation location={location} />
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('dashboards.franchise.openLocationsEmpty')}</div>
                      )}
                    </div>
                    <div className="frhq-form-grid">
                      <input
                        className="frhq-field frhq-field-full"
                        placeholder={t('adminFranchiseLocationName')}
                        value={locationForm.name}
                        onChange={(e) => setLocationForm((v) => ({ ...v, name: e.target.value }))}
                      />
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseLocationCity')}
                        value={locationForm.city}
                        onChange={(e) => setLocationForm((v) => ({ ...v, city: e.target.value }))}
                      />
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseLocationRegion')}
                        value={locationForm.region}
                        onChange={(e) => setLocationForm((v) => ({ ...v, region: e.target.value }))}
                      />
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseLocationCountry')}
                        value={locationForm.country}
                        onChange={(e) => setLocationForm((v) => ({ ...v, country: e.target.value.toUpperCase() }))}
                      />
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving || !locationForm.name.trim()} onClick={addLocation}>
                      {t('adminFranchiseLocationAdd')}
                    </button>
                    <div className="frhq-form-grid">
                      <label className="frhq-label">
                        {t('adminFranchiseLocationName')}
                        <select
                          className="frhq-field"
                          value={milestoneForm.location_id}
                          onChange={(e) => setMilestoneForm((v) => ({ ...v, location_id: e.target.value }))}
                        >
                          <option value="">{t('adminFranchiseMilestonePlanStepNone')}</option>
                          {(selectedBundle.locations || []).map((location) => (
                            <option key={location.id} value={location.id}>{location.name}</option>
                          ))}
                        </select>
                      </label>
                      <input
                        className="frhq-field"
                        placeholder={t('adminFranchiseMilestoneTitle')}
                        value={milestoneForm.title}
                        onChange={(e) => setMilestoneForm((v) => ({ ...v, title: e.target.value }))}
                      />
                      <label className="frhq-label">
                        {t('adminFranchiseLaunchPlanDueDate')}
                        <input
                          type="date"
                          className="frhq-field"
                          value={milestoneForm.due_date}
                          onChange={(e) => setMilestoneForm((v) => ({ ...v, due_date: e.target.value }))}
                        />
                      </label>
                      <label className="frhq-label">
                        {t('adminFranchiseLaunchPlanOwner')}
                        <select
                          className="frhq-field"
                          value={milestoneForm.owner_role}
                          onChange={(e) => setMilestoneForm((v) => ({ ...v, owner_role: e.target.value }))}
                        >
                          <option value="operator">{t('dashboards.franchise.launchPlanOwnerOperator')}</option>
                          <option value="hq">{t('dashboards.franchise.launchPlanOwnerHq')}</option>
                          <option value="shared">{t('dashboards.franchise.launchPlanOwnerShared')}</option>
                        </select>
                      </label>
                      <label className="frhq-label">
                        {t('dashboards.franchise.milestoneLinkedStep')}
                        <select
                          className="frhq-field"
                          value={milestoneForm.launch_plan_step_id}
                          onChange={(e) => setMilestoneForm((v) => ({ ...v, launch_plan_step_id: e.target.value }))}
                        >
                          <option value="">{t('adminFranchiseMilestonePlanStepNone')}</option>
                          {(selectedBundle.launch_plan_steps || []).filter((step) => !step.milestone_id).map((step) => (
                            <option key={step.id} value={step.id}>{step.title}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving || !milestoneForm.location_id || !milestoneForm.title.trim()} onClick={addMilestone}>
                      {t('adminFranchiseMilestoneAdd')}
                    </button>
                  </div>

                  {/* Group 12 Slice 3d (616): territory invitations — HQ
                      invites by email and cancels outstanding invites. */}
                  <FranchiseTerritoryInvitations
                    invitations={selectedBundle.territory_invitations || []}
                    canInvite
                    onInvite={inviteTerritoryMember}
                    onCancel={cancelTerritoryInvite}
                    disabled={saving}
                  />

                  {/* Group 12 Slice 3d (618): territory training
                      distribution — HQ assigns, completes, and removes. */}
                  <FranchiseTrainingTasks
                    assignments={selectedBundle.training_assignments || []}
                    members={territoryMembers()}
                    locations={selectedBundle.locations || []}
                    canAssign
                    canComplete
                    onAssign={assignTraining}
                    onComplete={completeTraining}
                    onRemove={removeTraining}
                    disabled={saving}
                  />

                  {/* Group 12 Slice 3d (619): territory coverage planning
                      — read-only rollup in HQ. */}
                  <FranchiseCoveragePlan coverage={coverage} />

                  {/* Group 12 Slice 3f (630, D-330): the territory coverage
                      trend — coverage % by day and by week over time,
                      read-only in HQ. */}
                  <FranchiseCoverageTrend trend={coverageTrend} />

                  {/* Group 12 Slice 3f (628, D-327): the service exception
                      summary — the territory's support tickets aggregated,
                      read-only in HQ. */}
                  <FranchiseExceptionSummary
                    summary={selectedBundle.exception_summary || null}
                    locations={selectedBundle.locations || []}
                  />

                  {/* Group 12 Slice 3f (627, D-328): the per-location health
                      view — read-only in HQ. */}
                  <FranchiseLocationHealth health={selectedBundle.location_health || null} />

                  {/* Group 12 Slice 3f (629, D-329): the per-territory ticket
                      queue — HQ sees this territory's open requests. */}
                  <FranchiseTerritoryTickets
                    tickets={territoryTickets}
                    locations={selectedBundle.locations || []}
                    status={hqTicketStatus}
                    locationId={hqTicketLocationId}
                    onStatusChange={setHqTicketStatus}
                    onLocationChange={setHqTicketLocationId}
                    canUnlink
                    onUnlink={unlinkTerritoryTicket}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3j (648, D-349): the per-territory
                      training-escalation queue — HQ resolves each one
                      with a resolution note. */}
                  <FranchiseTrainingEscalations
                    escalations={selectedBundle.training_escalations || []}
                    assignments={selectedBundle.training_assignments || []}
                    members={selectedBundle.territory_members || []}
                    locations={selectedBundle.locations || []}
                    canResolve
                    onResolve={resolveTrainingEscalation}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3j (647, D-348): dedicated HQ
                      operations appointments — HQ publishes slots and
                      confirms, completes, or cancels them. */}
                  <FranchiseOpsAppointments
                    slots={selectedBundle.ops_appointments || []}
                    canPublish
                    canManage
                    onPublish={publishOpsSlot}
                    onConfirm={confirmOpsSlot}
                    onComplete={completeOpsSlot}
                    onCancelSlot={cancelOpsSlot}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3j (646, D-347): the per-territory
                      policy-question queue — HQ answers in-thread on the
                      ticket, never here. */}
                  <FranchisePolicyQuestions
                    questions={selectedBundle.policy_questions || []}
                    locations={selectedBundle.locations || []}
                    standards={selectedBundle.standards || []}
                  />

                  {/* Group 12 Slice 3g (631, D-331): the per-territory
                      escalation queue — HQ escalates a linked exception
                      and reads the queue. */}
                  <FranchiseExceptionEscalations
                    escalations={hqEscalations}
                    canEscalate
                    onEscalate={escalateTerritoryTicket}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3g (632-635, D-332/D-333/D-334/D-335):
                      resolve exceptions — HQ assigns remediation, adds
                      and moves corrective actions, uploads evidence, and
                      reviews resolved actions. */}
                  <FranchiseExceptionResolution
                    resolution={selectedBundle.exception_resolution || null}
                    correctiveActions={hqCorrectiveActions}
                    members={selectedBundle.territory_members || []}
                    canAssign
                    canCreateAction
                    canUpdateAction
                    canUploadEvidence
                    canReview
                    onAssignRemediation={assignTerritoryRemediation}
                    onCreateAction={createTerritoryCorrectiveAction}
                    onUpdateActionStatus={updateTerritoryCorrectiveActionStatus}
                    onUploadEvidence={uploadTerritoryEvidence}
                    onLoadEvidence={loadTerritoryEvidence}
                    onReview={reviewTerritoryCorrectiveAction}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3h (636, D-336): the candidate location
                      tracker — HQ proposes and reviews locations inside
                      the territory. */}
                  <FranchiseCandidateLocations
                    candidates={selectedBundle.candidate_locations || null}
                    canPropose
                    canReview
                    onPropose={proposeTerritoryCandidate}
                    onStatusChange={updateTerritoryCandidateStatus}
                    onRemove={removeTerritoryCandidate}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3h (637, D-337): the territory capacity
                      view — HQ sets the target per boundary area. */}
                  <FranchiseTerritoryCapacity
                    capacity={selectedBundle.territory_capacity || null}
                    canSetTarget
                    onSetTarget={setTerritoryCapacityTarget}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3h (638, D-338): the training resource
                      planner — read-only in HQ. */}
                  <FranchiseTrainingPlanner planner={selectedBundle.training_planner || null} />

                  {/* Group 12 Slice 3h (639, D-339): the launch dependency
                      overview — read-only in HQ. */}
                  <FranchiseLaunchDependencies dependencies={selectedBundle.launch_dependencies || null} />

                  {/* Group 12 Slice 3h (640, D-340): expansion readiness
                      notes — the operator's notes next to HQ's own
                      readiness fields, in one view. HQ never writes
                      operator notes. */}
                  <FranchiseExpansionNotes
                    notes={selectedBundle.expansion_notes || null}
                    hqNotes={{
                      market_assessment: selectedBundle.application?.market_assessment || null,
                      hq_recommendation: selectedBundle.application?.hq_recommendation || null,
                      risk_notes: selectedBundle.application?.risk_notes || null,
                    }}
                    locations={selectedBundle.locations || []}
                  />

                  {/* Group 12 Slice 3i (641/642/644, D-341/D-342/D-344):
                      operator handoff — HQ approves or rejects a pending
                      handoff here; approval executes the transfer. */}
                  <FranchiseHandoff
                    handoffs={selectedBundle.handoffs || null}
                    members={selectedBundle.territory_members || []}
                    canReview
                    onCancel={cancelTerritoryHandoff}
                    onReview={reviewTerritoryHandoff}
                    onLoadTransfers={loadTerritoryHandoffTransfers}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3i (643, D-343): the contact
                      directory — the operator maintains it; HQ reads the
                      same list, never writes it. */}
                  <FranchiseContactDirectory
                    directory={selectedBundle.contact_directory || null}
                  />

                  {/* Group 12 Slice 3i (645, D-345): explicit HQ removal
                      of a territory member's access, with the audit list.
                      The operator is never listed: operator access ends
                      only through a completed handoff. */}
                  <FranchiseAccessRemoval
                    members={selectedBundle.territory_members || []}
                    ownerUserId={selectedBundle.application?.owner_user_id || null}
                    removals={accessRemovals}
                    onRemove={removeTerritoryAccess}
                    busy={saving}
                  />

                  {/* Group 12 Slice 3d (620): the HQ announcement feed —
                      HQ posts and removes, operators read. */}
                  <FranchiseAnnouncements
                    announcements={selectedBundle.announcements || []}
                    canPost
                    canManage
                    onPost={postAnnouncement}
                    onDelete={deleteAnnouncement}
                    disabled={saving}
                  />

                  {/* Group 12 Slice 3e (621/622/625): the franchise standards
                      library — HQ curates Learn guides as franchise-wide
                      or per-territory standards, publishes new versions,
                      re-sends policy change reminders, and removes them;
                      the acknowledgment list rides the bundle. */}
                  <FranchiseStandards
                    standards={selectedBundle.standards || []}
                    canCurate
                    canRemove
                    canPublishVersion
                    canRemind
                    onCurate={curateStandard}
                    onRemove={removeStandard}
                    onPublishVersion={publishStandardVersion}
                    onRemind={remindStandard}
                    disabled={saving}
                  />

                  {/* Group 12 Slice 3e (623): the brand asset store — HQ
                      uploads and removes brand assets, per territory or
                      franchise-wide. */}
                  <FranchiseBrandAssets
                    assets={selectedBundle.brand_assets || []}
                    canUpload
                    canDelete
                    onUpload={uploadBrandAsset}
                    onDelete={deleteBrandAsset}
                    disabled={saving}
                  />

                  {/* Group 12 Slice 3e (624): the operator compliance
                      checklist — team perspective for HQ. */}
                  <FranchiseComplianceChecklist checklist={selectedBundle.compliance_checklist || null} />

                  {/* Group 12 Slice 3c (613): HQ records a formal readiness
                      review — the only path that moves readiness to `ready`. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseReadinessReviewTitle')}</div>
                    <div className="frhq-row-meta">
                      {t('adminFranchiseLaunchPlanReadiness')}: {formatLabel(selectedApplication.launch_readiness_status, t)}
                    </div>
                    {(selectedBundle.readiness_reviews || []).length > 0 && (
                      <div className="frhq-list">
                        {selectedBundle.readiness_reviews.map((review) => (
                          <div key={review.id} className="frhq-row">
                            <div>
                              <div className="frhq-row-title">
                                {review.outcome === 'passed' ? t('adminFranchiseReadinessReviewPassed') : t('adminFranchiseReadinessReviewChanges')}
                              </div>
                              {review.notes && <div className="frhq-row-meta">{review.notes}</div>}
                              <div className="frhq-row-meta">{new Date(review.created_at).toLocaleString()}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="frhq-form-grid">
                      <label className="frhq-field">
                        <span className="frhq-label">{t('adminFranchiseReadinessReviewOutcome')}</span>
                        <select className="frhq-input" value={reviewForm.outcome} onChange={(e) => setReviewForm((v) => ({ ...v, outcome: e.target.value }))}>
                          <option value="passed">{t('adminFranchiseReadinessReviewPassed')}</option>
                          <option value="changes_requested">{t('adminFranchiseReadinessReviewChanges')}</option>
                        </select>
                      </label>
                      <label className="frhq-field">
                        <span className="frhq-label">{t('adminFranchiseReadinessReviewNotes')}</span>
                        <textarea className="frhq-input" rows={2} value={reviewForm.notes} onChange={(e) => setReviewForm((v) => ({ ...v, notes: e.target.value }))} />
                      </label>
                    </div>
                    <button type="button" className="frhq-btn-primary" disabled={saving} onClick={submitReadinessReview}>
                      {t('adminFranchiseReadinessReviewSubmit')}
                    </button>
                  </div>

                  {/* Group 12 Slice 3b (606): territory acceptance, read-only
                      in HQ — only the assigned operator can answer the offer. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseAcceptanceTitle')}</div>
                    <div className="frhq-row">
                      <div>
                        <div className="frhq-row-title">
                          {selectedApplication.acceptance_status === 'offered' && t('adminFranchiseAcceptanceOffered')}
                          {selectedApplication.acceptance_status === 'accepted' && t('adminFranchiseAcceptanceAccepted')}
                          {selectedApplication.acceptance_status === 'declined' && t('adminFranchiseAcceptanceDeclined')}
                          {(!selectedApplication.acceptance_status || selectedApplication.acceptance_status === 'not_offered') && t('adminFranchiseAcceptanceNotOffered')}
                        </div>
                        {selectedApplication.acceptance_reason && (
                          <div className="frhq-row-meta">
                            {t('adminFranchiseAcceptanceReason')}: {selectedApplication.acceptance_reason}
                          </div>
                        )}
                        {selectedApplication.acceptance_decided_at && (
                          <div className="frhq-row-meta">
                            {new Date(selectedApplication.acceptance_decided_at).toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Group 12 Slice 3b (608): operator responsibility checklist,
                      read-only in HQ — the operator acknowledges each item. */}
                  <div className="frhq-panel">
                    <div className="frhq-panel-title">{t('adminFranchiseResponsibilitiesTitle')}</div>
                    <div className="frhq-row-meta">
                      {t('adminFranchiseResponsibilitiesProgress', {
                        done: (selectedBundle.responsibilities || []).filter((item) => item.status === 'acknowledged').length,
                        total: (selectedBundle.responsibilities || []).length,
                      })}
                    </div>
                    <div className="frhq-list">
                      {(selectedBundle.responsibilities || []).length ? selectedBundle.responsibilities.map((item) => (
                        <div key={item.id} className="frhq-row">
                          <div>
                            <div className="frhq-row-title">
                              {RESPONSIBILITY_LABEL_KEYS[item.code]
                                ? t(`dashboards.franchise.${RESPONSIBILITY_LABEL_KEYS[item.code]}`)
                                : item.label}
                            </div>
                            <div className="frhq-row-meta">
                              {item.status === 'acknowledged'
                                ? t('adminFranchiseResponsibilityAcknowledged')
                                : t('adminFranchiseResponsibilityPending')}
                              {item.status === 'acknowledged' && item.acknowledged_at
                                ? ` · ${new Date(item.acknowledged_at).toLocaleString()}`
                                : ''}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <div className="frhq-empty">{t('adminFranchiseNoResponsibilities')}</div>
                      )}
                    </div>
                  </div>
                </section>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
