import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileText,
  History,
  MessageSquare,
  ShieldCheck,
} from 'lucide-react';
import api from '../api/axios';
import './FranchiseApplicationDetail.css';
import FranchiseBoundarySummary from './FranchiseBoundarySummary';
import FranchiseLaunchPlan from './FranchiseLaunchPlan';
import FranchiseOpenLocations from './FranchiseOpenLocations';
import FranchiseReadinessReviews from './FranchiseReadinessReviews';
import FranchiseTerritoryInvitations from './FranchiseTerritoryInvitations';
import FranchiseTrainingTasks from './FranchiseTrainingTasks';
import FranchiseAnnouncements from './FranchiseAnnouncements';
import FranchiseStandards from './FranchiseStandards';
import FranchiseBrandAssets from './FranchiseBrandAssets';
import FranchiseComplianceChecklist from './FranchiseComplianceChecklist';
import FranchiseExceptionSummary from './FranchiseExceptionSummary';
import FranchiseLocationHealth from './FranchiseLocationHealth';
import FranchiseTerritoryTickets from './FranchiseTerritoryTickets';
import FranchiseExceptionEscalations from './FranchiseExceptionEscalations';
import FranchiseExceptionResolution from './FranchiseExceptionResolution';
import FranchiseCandidateLocations from './FranchiseCandidateLocations';
import FranchiseTerritoryCapacity from './FranchiseTerritoryCapacity';
import FranchiseTrainingPlanner from './FranchiseTrainingPlanner';
import FranchiseLaunchDependencies from './FranchiseLaunchDependencies';
import FranchiseExpansionNotes from './FranchiseExpansionNotes';
import FranchisePolicyQuestions from './FranchisePolicyQuestions';
import FranchiseOpsAppointments from './FranchiseOpsAppointments';
import FranchiseTrainingEscalations from './FranchiseTrainingEscalations';
import FranchiseTerritoryCases from './FranchiseTerritoryCases';
import FranchiseSupportHistory from './FranchiseSupportHistory';
import { useAuth } from '../hooks/useAuth';

const DOCUMENT_CATEGORIES = ['identity', 'entity', 'financials', 'territory_plan'];
const DOC_CATEGORY_KEYS = {
  identity: 'docIdentity',
  entity: 'docEntity',
  financials: 'docFinancials',
  territory_plan: 'docTerritoryPlan',
};
const DOC_STATUS_KEYS = {
  missing: 'docMissing',
  pending: 'docPending',
  accepted: 'docAccepted',
  rejected: 'docRejected',
};
const INTERVIEW_STATUS_KEYS = {
  proposed: 'interviewProposedLabel',
  booked: 'interviewBookedLabel',
  completed: 'interviewCompleted',
  cancelled: 'interviewCancelled',
};
// Group 12 Slice 3b (608, D-306): the fixed operator responsibility set.
// Labels are localized by code; the stored English label is the fallback
// only when a code has no locale key.
const RESPONSIBILITY_KEYS = {
  operate_territory: 'respOperateTerritory',
  brand_standards: 'respBrandStandards',
  recruit_train_team: 'respRecruitTrainTeam',
  comply_local_law: 'respComplyLocalLaw',
  report_performance: 'respReportPerformance',
  honor_agreement_fees: 'respHonorAgreementFees',
  protect_brand_assets: 'respProtectBrandAssets',
  resolve_customer_issues: 'respResolveCustomerIssues',
};

function formatDateTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Group 12 Slice 3a (604/603/605): the applicant-facing detail sections for
// one franchise application — interview booking, the document checklist
// with uploads, and the decision follow-up thread. Loads the applicant
// detail endpoint, which never carries internal notes.
export default function FranchiseApplicationDetail({ applicationId }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const copy = (key, options) => t(`dashboards.franchise.${key}`, options);
  const [detail, setDetail] = useState(null);
  // G12-A10 (D-655): older assignment-history pages, appended below the
  // bundle's first 50 events.
  const [extraActivity, setExtraActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState(null);
  // Group 12 Slice 3b (606): decline-reason compose state.
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  // Group 12 Slice 3f (629): the territory ticket queue for the
  // operator dashboard — the territory's open support requests.
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketLocationId, setTicketLocationId] = useState('');
  const [territoryTickets, setTerritoryTickets] = useState([]);
  const [ticketTotal, setTicketTotal] = useState(null);
  const [ticketLoadingMore, setTicketLoadingMore] = useState(false);
  const [ticketRefresh, setTicketRefresh] = useState(0);
  useEffect(() => {
    if (!detail || detail.application?.is_operator !== true) {
      setTerritoryTickets([]);
      setTicketTotal(null);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ status: ticketStatus });
    if (ticketLocationId) params.set('location_id', ticketLocationId);
    api.get(`/franchise/my-applications/${applicationId}/support-tickets?${params.toString()}`)
      .then((response) => {
        if (cancelled) return;
        setTerritoryTickets(response.data?.tickets ?? []);
        setTicketTotal(typeof response.data?.total === 'number' ? response.data.total : null);
      })
      .catch(() => { if (!cancelled) { setTerritoryTickets([]); setTicketTotal(null); } });
    return () => { cancelled = true; };
  }, [detail, applicationId, ticketStatus, ticketLocationId, ticketRefresh]);

  // G12-B6 (D-660): append the next ticket page, cursoring from the
  // last shown ticket's id.
  async function loadMoreTickets() {
    const last = territoryTickets[territoryTickets.length - 1];
    if (!last || ticketLoadingMore) return;
    setTicketLoadingMore(true);
    try {
      const params = new URLSearchParams({ status: ticketStatus, before: last.id });
      if (ticketLocationId) params.set('location_id', ticketLocationId);
      const response = await api.get(`/franchise/my-applications/${applicationId}/support-tickets?${params.toString()}`);
      setTerritoryTickets((prev) => [...prev, ...(response.data?.tickets ?? [])]);
      if (typeof response.data?.total === 'number') setTicketTotal(response.data.total);
    } catch {
      setError(copy('ticketsLoadFailed'));
    } finally {
      setTicketLoadingMore(false);
    }
  }

  // Group 12 Slice 3j (649): the territory case tracker for the
  // operator dashboard — the territory's cases in one view.
  const [caseStatus, setCaseStatus] = useState('open');
  const [caseType, setCaseType] = useState('all');
  const [caseLocationId, setCaseLocationId] = useState('');
  const [territoryCases, setTerritoryCases] = useState([]);
  const [caseTotal, setCaseTotal] = useState(null);
  const [caseLoadingMore, setCaseLoadingMore] = useState(false);
  useEffect(() => {
    if (!detail || detail.application?.is_operator !== true) {
      setTerritoryCases([]);
      setCaseTotal(null);
      return undefined;
    }
    let cancelled = false;
    const params = new URLSearchParams({ status: caseStatus, type: caseType });
    if (caseLocationId) params.set('location_id', caseLocationId);
    api.get(`/franchise/my-applications/${applicationId}/cases?${params.toString()}`)
      .then((response) => {
        if (cancelled) return;
        setTerritoryCases(response.data?.cases ?? []);
        setCaseTotal(typeof response.data?.total === 'number' ? response.data.total : null);
      })
      .catch(() => { if (!cancelled) { setTerritoryCases([]); setCaseTotal(null); } });
    return () => { cancelled = true; };
  }, [detail, applicationId, caseStatus, caseType, caseLocationId]);

  // G12-B6 (D-660): append the next case page, cursoring from the last
  // shown case's id.
  async function loadMoreCases() {
    const last = territoryCases[territoryCases.length - 1];
    if (!last || caseLoadingMore) return;
    setCaseLoadingMore(true);
    try {
      const params = new URLSearchParams({ status: caseStatus, type: caseType, before: last.id });
      if (caseLocationId) params.set('location_id', caseLocationId);
      const response = await api.get(`/franchise/my-applications/${applicationId}/cases?${params.toString()}`);
      setTerritoryCases((prev) => [...prev, ...(response.data?.cases ?? [])]);
      if (typeof response.data?.total === 'number') setCaseTotal(response.data.total);
    } catch {
      setError(copy('casesLoadFailed'));
    } finally {
      setCaseLoadingMore(false);
    }
  }

  // G12-B6 (D-660): older support-history pages, appended below the
  // bundle's first 50 events. The cursor is the last shown event's
  // sort key, "<at>|<ref_id>|<kind>".
  const [extraHistory, setExtraHistory] = useState([]);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  async function loadMoreHistory() {
    const shown = [...(detail?.support_history?.history || []), ...extraHistory];
    const last = shown[shown.length - 1];
    if (!last || historyLoadingMore) return;
    setHistoryLoadingMore(true);
    try {
      const before = `${new Date(last.at).toISOString()}|${last.ref_id}|${last.kind}`;
      const response = await api.get(`/franchise/my-applications/${applicationId}/support-history?before=${encodeURIComponent(before)}`);
      setExtraHistory((prev) => [...prev, ...(response.data?.history ?? [])]);
    } catch {
      setError(copy('supportHistoryLoadFailed'));
    } finally {
      setHistoryLoadingMore(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    // G12-A10 (D-655): older history pages append below the bundle's
    // first 50; a new application resets them.
    setExtraActivity([]);
    // G12-B6 (D-660): older support-history pages append below the
    // bundle's first 50; a new application resets them.
    setExtraHistory([]);
    api.get(`/franchise/my-applications/${applicationId}`)
      .then((response) => {
        if (!cancelled) setDetail(response.data);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  async function loadMoreActivity() {
    const shown = [...(detail?.activity || []), ...extraActivity];
    const last = shown[shown.length - 1];
    if (!last || activityLoading) return;
    setActivityLoading(true);
    try {
      const response = await api.get(`/franchise/my-applications/${applicationId}/activity?before=${last.id}`);
      setExtraActivity((prev) => [...prev, ...(response.data?.activity || [])]);
      if (typeof response.data?.total === 'number') {
        setDetail((prev) => (prev ? { ...prev, activity_total: response.data.total } : prev));
      }
    } catch {
      setError(copy('historyLoadFailed'));
    } finally {
      setActivityLoading(false);
    }
  }

  async function downloadDocument(doc) {
    // G12-A11 (D-656): mint the download URL on click — the bundle's
    // read-time URL is 600s and stale by the time the operator clicks.
    // The blank window opens in the click handler so the popup blocker
    // does not swallow the navigation after the fetch.
    const win = window.open('', '_blank', 'noopener');
    try {
      const response = await api.get(`/franchise/my-applications/${applicationId}/documents/${doc.id}/download-url`);
      const url = response.data?.download_url;
      if (!url) throw new Error('no download url');
      if (win) win.location.href = url;
      else window.location.href = url;
    } catch {
      if (win) win.close();
      setError(copy('docDownloadFailed'));
    }
  }

  async function bookSlot(slotId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/interviews/${slotId}/book`);
      setDetail(response.data);
    } catch {
      setError(copy('interviewActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(slotId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/interviews/${slotId}/cancel`);
      setDetail(response.data);
    } catch {
      setError(copy('interviewActionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function uploadDocument(category, file) {
    if (!file) return;
    setUploadingCategory(category);
    setError('');
    const form = new FormData();
    form.append('category', category);
    form.append('file', file);
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/documents`, form);
      setDetail(response.data);
    } catch {
      setError(copy('docUploadFailed'));
    } finally {
      setUploadingCategory(null);
    }
  }

  async function sendReply() {
    if (!reply.trim()) return;
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/followup`, { body: reply.trim() });
      setDetail(response.data);
      setReply('');
    } catch {
      setError(copy('followupSendFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3b (606): answer the territory offer.
  async function answerAcceptance(decision) {
    if (decision === 'declined' && !declineReason.trim()) {
      setError(copy('acceptanceReasonRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/acceptance`, {
        decision,
        reason: decision === 'declined' ? declineReason.trim() : undefined,
      });
      setDetail(response.data);
      setShowDecline(false);
      setDeclineReason('');
    } catch {
      setError(copy('acceptanceFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3b (609): update one launch plan step's status.
  async function updateLaunchPlanStatus(stepId, status) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/launch-plan/${stepId}/status`, { status });
      setDetail(response.data);
    } catch {
      setError(copy('launchPlanStatusFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3c (611): update one location milestone's status.
  async function updateMilestoneStatus(locationId, milestoneId, status) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/locations/${locationId}/milestones/${milestoneId}/status`, { status });
      setDetail(response.data);
    } catch {
      setError(copy('milestoneStatusFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3c (614): update one row of a location's service
  // availability checklist, and launch a location.
  async function saveLocationService(locationId, body) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/locations/${locationId}/services`, body);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('servicesSaveFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function launchLocation(locationId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/locations/${locationId}/launch`);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('servicesLaunchFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3c (615): the operator confirms a launched location
  // opened — the record that completes the launch.
  async function confirmOpening(locationId, body) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/locations/${locationId}/confirm-opening`, body);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('openingConfirmationFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3d (616): invite someone to the territory by email,
  // and cancel an outstanding invite. Only the assigned operator sees
  // the form — gated by canInvite on is_operator, not by payload scoping:
  // the detail payload is applicant-or-operator scoped (G12-A4, D-646).
  async function inviteTerritoryMember(body) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/invitations`, body);
      setDetail(response.data);
      return { token: response.data.new_invite_token, email: body.email };
    } catch (err) {
      setError(err?.response?.data?.error || copy('territoryInvitesFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function cancelTerritoryInvite(inviteId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/invitations/${inviteId}/cancel`);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('territoryInvitesFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3d (617/618): the territory members — the operator,
  // accepted invitees, and the opening-team helpers.
  function territoryMembers() {
    if (!detail) return [];
    const byId = new Map();
    if (user?.id) {
      byId.set(user.id, {
        user_id: user.id,
        name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || user.id,
        email: user.email || '',
      });
    }
    (detail.territory_invitations || [])
      .filter((invite) => invite.status === 'accepted' && invite.invitee_user_id)
      .forEach((invite) => {
        if (!byId.has(invite.invitee_user_id)) {
          byId.set(invite.invitee_user_id, { user_id: invite.invitee_user_id, name: invite.email, email: invite.email });
        }
      });
    const teams = [
      ...(detail.opening_team || []),
      ...((detail.locations || []).flatMap((location) => location.opening_team || [])),
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

  // Group 12 Slice 3d (618): assign training to a territory member,
  // mark it complete, and remove assignments.
  async function assignTraining(body) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/training`, body);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('trainingTasksAssignFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function completeTraining(assignmentId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/training/${assignmentId}/complete`);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('trainingTasksAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function removeTraining(assignmentId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.delete(`/franchise/my-applications/${applicationId}/training/${assignmentId}`);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('trainingTasksAssignFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3d (620): the operator marks an HQ announcement read.
  async function markAnnouncementRead(announcementId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/announcements/${announcementId}/read`);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('announcementsPostFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3b (608): acknowledge one responsibility item.
  async function acknowledgeResponsibility(itemId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/responsibilities/${itemId}/acknowledge`);
      setDetail(response.data);
    } catch {
      setError(copy('responsibilityAcknowledgeFailed'));
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3f (628, D-327): link or unlink a support ticket
  // to the territory. The link response carries the fresh exception
  // summary, which replaces the one on the detail payload.
  async function linkTicket(ticketNumber, locationId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/support-tickets/${ticketNumber}/link`, { location_id: locationId });
      setDetail((prev) => (prev ? { ...prev, exception_summary: response.data.exception_summary } : prev));
      setTicketRefresh((v) => v + 1);
    } catch (err) {
      setError(err?.response?.data?.error || copy('exceptionLinkFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function unlinkTicket(ticketId) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/support-tickets/${ticketId}/unlink`);
      setDetail((prev) => (prev ? { ...prev, exception_summary: response.data.exception_summary } : prev));
      setTicketRefresh((v) => v + 1);
    } catch (err) {
      setError(err?.response?.data?.error || copy('exceptionUnlinkFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3g (631-635): the exception resolution lists — the
  // escalation queue and the corrective-action checklist. The resolution
  // state itself rides the detail payload; these lists are the working
  // surface on top of it.
  const [escalations, setEscalations] = useState([]);
  const [correctiveActions, setCorrectiveActions] = useState([]);
  const [resolutionRefresh, setResolutionRefresh] = useState(0);
  useEffect(() => {
    if (!detail || detail.application?.is_operator !== true) {
      setEscalations([]);
      setCorrectiveActions([]);
      return undefined;
    }
    let cancelled = false;
    api.get(`/franchise/my-applications/${applicationId}/escalations`)
      .then((response) => { if (!cancelled) setEscalations(response.data?.escalations ?? []); })
      .catch(() => { if (!cancelled) setEscalations([]); });
    api.get(`/franchise/my-applications/${applicationId}/corrective-actions`)
      .then((response) => { if (!cancelled) setCorrectiveActions(response.data?.corrective_actions ?? []); })
      .catch(() => { if (!cancelled) setCorrectiveActions([]); });
    return () => { cancelled = true; };
  }, [detail, applicationId, resolutionRefresh]);

  async function reloadDetail() {
    try {
      const response = await api.get(`/franchise/my-applications/${applicationId}`);
      setDetail(response.data);
    } catch {
      // The list refresh still runs; the bundle reload is best-effort.
    }
  }

  // Group 12 Slice 3j (646, D-347): the operator asks a policy question
  // for the territory; HQ answers in-thread on the ticket.
  async function askPolicyQuestion(body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/policy-questions`, body);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('policyAskFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3j (647, D-348): the operator books or cancels a
  // dedicated HQ operations appointment for the territory.
  async function bookOpsSlot(slotId) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/ops-appointments/${slotId}/book`);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('opsBookFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function cancelOpsBooking(slotId) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/ops-appointments/${slotId}/cancel`);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('opsCancelFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3j (648, D-349): the operator escalates a training
  // issue/gap to HQ.
  async function escalateTraining(body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/training-escalations`, body);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('trainingEscFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function escalateTicket(ticketNumber, reason) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/support-tickets/${ticketNumber}/escalate`, { reason });
      setDetail((prev) => (prev ? { ...prev, exception_summary: response.data.exception_summary } : prev));
      setResolutionRefresh((v) => v + 1);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('escalationFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function assignRemediation(ticketId, body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/support-tickets/${ticketId}/remediation`, body);
      setResolutionRefresh((v) => v + 1);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('remediationFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function createCorrectiveAction(ticketId, body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/support-tickets/${ticketId}/corrective-actions`, body);
      setResolutionRefresh((v) => v + 1);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('actionAddFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function updateCorrectiveActionStatus(actionId, status) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/status`, { status });
      setResolutionRefresh((v) => v + 1);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('actionUpdateFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function uploadEvidence(actionId, formData) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/evidence`, formData);
      setResolutionRefresh((v) => v + 1);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('evidenceUploadFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function loadEvidence(actionId) {
    const response = await api.get(`/franchise/my-applications/${applicationId}/corrective-actions/${actionId}/evidence`);
    return response.data?.evidence ?? [];
  }

  // Group 12 Slice 3h (636): the operator proposes a candidate location,
  // moves one through review, and removes a scouting candidate.
  async function proposeCandidate(body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/candidate-locations`, body);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('candidateProposeFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function updateCandidateStatus(candidateId, status) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/franchise/my-applications/${applicationId}/candidate-locations/${candidateId}`, { status });
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('candidateUpdateFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function removeCandidate(candidateId) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/franchise/my-applications/${applicationId}/candidate-locations/${candidateId}`);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('candidateRemoveFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3h (640): the operator records, edits, and removes
  // expansion readiness notes for the territory or one location.
  async function addExpansionNote(body) {
    setBusy(true);
    setError('');
    try {
      await api.post(`/franchise/my-applications/${applicationId}/expansion-notes`, body);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('notesAddFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function updateExpansionNote(noteId, body) {
    setBusy(true);
    setError('');
    try {
      await api.patch(`/franchise/my-applications/${applicationId}/expansion-notes/${noteId}`, body);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('notesUpdateFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function removeExpansionNote(noteId) {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/franchise/my-applications/${applicationId}/expansion-notes/${noteId}`);
      await reloadDetail();
    } catch (err) {
      setError(err?.response?.data?.error || copy('notesRemoveFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  // Group 12 Slice 3e (622): acknowledge a standard's current version
  // with a drawn e-signature (multipart FormData).
  async function acknowledgeStandard(standardId, formData) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/standards/${standardId}/acknowledge`, formData);
      setDetail(response.data);
    } catch (err) {
      setError(err?.response?.data?.error || copy('standardsAcknowledgeFailed'));
      throw err;
    } finally {
      setBusy(false);
    }
  }

  if (!detail) return null;

  const interviews = detail.interviews || [];
  const booked = interviews.find((slot) => slot.status === 'booked');
  // G12-A6 (D-650): a proposed slot whose start has passed is lapsed —
  // it renders as expired with no Book button, and the server refuses
  // the booking with 409. The applicant sees the time HQ proposed and
  // that it is gone, instead of a live button for a past time.
  const isLapsed = (slot) => slot.starts_at && new Date(slot.starts_at).getTime() <= Date.now();
  const proposed = interviews.filter((slot) => slot.status === 'proposed' && !isLapsed(slot));
  const lapsed = interviews.filter((slot) => slot.status === 'proposed' && isLapsed(slot));
  const past = interviews.filter((slot) => ['completed', 'cancelled'].includes(slot.status));
  const documents = detail.documents || [];
  const categoryStatus = new Map((detail.document_categories || []).map((entry) => [entry.category, entry.status]));
  const sharedNotes = detail.shared_notes || [];
  const followup = detail.followup || [];
  const responsibilities = detail.responsibilities || [];
  const acknowledgedCount = responsibilities.filter((item) => item.status === 'acknowledged').length;
  const acceptanceStatus = detail.application?.acceptance_status || 'not_offered';
  const isOperator = detail.application?.is_operator === true;

  return (
    <div className="fr-detail">
      {error && <div className="fr-detail-error" role="alert">{error}</div>}

      {/* Group 12 Slice 3b (606): the territory accept/decline step. The
          assignment is an offer, not an activation — the operator answers
          here, and the operator surface stays locked until they accept. */}
      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <ShieldCheck size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('acceptanceTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('acceptanceSubtitle')}</p>
          </div>
        </div>

        {acceptanceStatus === 'offered' && isOperator && (
          <div>
            <p className="fr-detail-empty">{copy('acceptanceOffered')}</p>
            {!showDecline ? (
              <div className="fr-accept-actions">
                <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => answerAcceptance('accepted')} data-track="ui.38155fa446.5">
                  {copy('acceptanceAccept')}
                </button>
                <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => setShowDecline(true)} data-track="ui.38155fa446.6">
                  {copy('acceptanceDecline')}
                </button>
              </div>
            ) : (
              <div className="fr-followup-compose">
                <label className="fr-detail-list-label" htmlFor="fr-decline-reason">{copy('acceptanceDeclineReasonLabel')}</label>
                <textarea
                  id="fr-decline-reason"
                  className="fr-followup-input"
                  value={declineReason}
                  onChange={(event) => setDeclineReason(event.target.value)}
                  placeholder={copy('acceptanceDeclineReasonPlaceholder')}
                  rows={3}
                />
                <div className="fr-accept-actions">
                  <button type="button" className="fr-btn-primary" disabled={busy || !declineReason.trim()} onClick={() => answerAcceptance('declined')} data-track="ui.38155fa446.7">
                    {copy('acceptanceConfirmDecline')}
                  </button>
                  <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => { setShowDecline(false); setDeclineReason(''); }} data-track="ui.38155fa446.8">
                    {copy('acceptanceCancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {acceptanceStatus === 'offered' && !isOperator && (
          <p className="fr-detail-empty">{copy('acceptanceAwaitingOperator')}</p>
        )}

        {acceptanceStatus === 'accepted' && (
          <div>
            <span className="fr-status-badge fr-status-accepted">{copy('acceptanceAccepted')}</span>
            {detail.application?.acceptance_decided_at && (
              <div className="fr-doc-file-meta">{copy('acceptanceDecidedLabel')}: {formatDate(detail.application.acceptance_decided_at)}</div>
            )}
          </div>
        )}

        {acceptanceStatus === 'declined' && (
          <div>
            <span className="fr-status-badge fr-status-rejected">{copy('acceptanceDeclined')}</span>
            {detail.application?.acceptance_reason && (
              <div className="fr-doc-file-meta">{copy('acceptanceDeclineReasonLabel')}: {detail.application.acceptance_reason}</div>
            )}
            {detail.application?.acceptance_decided_at && (
              <div className="fr-doc-file-meta">{copy('acceptanceDecidedLabel')}: {formatDate(detail.application.acceptance_decided_at)}</div>
            )}
          </div>
        )}

        {acceptanceStatus === 'not_offered' && (
          <p className="fr-detail-empty">{copy('acceptanceNotOffered')}</p>
        )}
      </section>

      {/* Group 12 Slice 3b (607): the structured boundary summary. */}
      <FranchiseBoundarySummary
        areas={detail.territory_areas || []}
        territoryExclusive={detail.application?.territory_exclusive === true}
        territorySummary={detail.application?.territory_summary || null}
      />

      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <CalendarClock size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('interviewTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('interviewSubtitle')}</p>
          </div>
        </div>

        {booked && (
          <div className="fr-interview-booked">
            <div className="fr-interview-booked-label">{copy('interviewBooked')}</div>
            <div className="fr-interview-when">{formatDateTime(booked.starts_at)}</div>
            {booked.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {booked.interviewer_name}</div>}
            {booked.note && <div className="fr-interview-meta">{booked.note}</div>}
            <button type="button" className="fr-btn-ghost" disabled={busy} onClick={() => cancelBooking(booked.id)} data-track="ui.38155fa446.1">
              {copy('interviewCancelBooking')}
            </button>
          </div>
        )}

        {proposed.length > 0 && (
          <div className="fr-interview-list">
            <div className="fr-detail-list-label">{copy('interviewProposed')}</div>
            {proposed.map((slot) => (
              <div key={slot.id} className="fr-interview-row">
                <div>
                  <div className="fr-interview-when">{formatDateTime(slot.starts_at)}</div>
                  {slot.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {slot.interviewer_name}</div>}
                  {slot.note && <div className="fr-interview-meta">{slot.note}</div>}
                </div>
                <button type="button" className="fr-btn-primary" disabled={busy || Boolean(booked)} onClick={() => bookSlot(slot.id)} data-track="ui.38155fa446.2">
                  {copy('interviewBook')}
                </button>
              </div>
            ))}
          </div>
        )}

        {lapsed.length > 0 && (
          <div className="fr-interview-list">
            {lapsed.map((slot) => (
              <div key={slot.id} className="fr-interview-row fr-interview-row-past">
                <div>
                  <div className="fr-interview-when">{formatDateTime(slot.starts_at)}</div>
                  {slot.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {slot.interviewer_name}</div>}
                  {slot.note && <div className="fr-interview-meta">{slot.note}</div>}
                </div>
                <span className="fr-status-badge">{copy('interviewExpired')}</span>
              </div>
            ))}
          </div>
        )}

        {past.length > 0 && (
          <div className="fr-interview-list">
            {past.map((slot) => (
              <div key={slot.id} className="fr-interview-row fr-interview-row-past">
                <div>
                  <div className="fr-interview-when">{formatDateTime(slot.starts_at)}</div>
                  {slot.interviewer_name && <div className="fr-interview-meta">{copy('interviewer')}: {slot.interviewer_name}</div>}
                </div>
                <span className="fr-status-badge">{copy(INTERVIEW_STATUS_KEYS[slot.status])}</span>
              </div>
            ))}
          </div>
        )}

        {!booked && proposed.length === 0 && lapsed.length === 0 && past.length === 0 && (
          <p className="fr-detail-empty">{copy('interviewNone')}</p>
        )}
      </section>

      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <FileText size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('documentsTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('documentsSubtitle')}</p>
          </div>
        </div>

        <div className="fr-doc-list">
          {DOCUMENT_CATEGORIES.map((category) => {
            const status = categoryStatus.get(category) || 'missing';
            const categoryDocs = documents.filter((doc) => doc.category === category);
            const uploading = uploadingCategory === category;
            return (
              <div key={category} className="fr-doc-category">
                <div className="fr-doc-category-head">
                  <div>
                    <div className="fr-doc-category-name">{copy(DOC_CATEGORY_KEYS[category])}</div>
                    <span className={`fr-status-badge fr-status-${status}`}>{copy(DOC_STATUS_KEYS[status])}</span>
                  </div>
                  <label className="fr-doc-upload-label">
                    <input
                      type="file"
                      className="fr-doc-file-input"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp"
                      disabled={uploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) uploadDocument(category, file);
                      }}
                    />
                    {uploading ? copy('docUploading') : copy('docChooseFile')}
                  </label>
                </div>
                {categoryDocs.length > 0 && (
                  <ul className="fr-doc-files">
                    {categoryDocs.map((doc) => (
                      <li key={doc.id} className="fr-doc-file">
                        <div>
                          <div className="fr-doc-file-name">{doc.file_name}</div>
                          <div className="fr-doc-file-meta">
                            {copy(DOC_STATUS_KEYS[doc.status])} · {formatDate(doc.created_at)}
                          </div>
                          {doc.review_reason && (
                            <div className="fr-doc-file-reason">{copy('docReviewReason')}: {doc.review_reason}</div>
                          )}
                        </div>
                        {!doc.download_unavailable && (
                          <button type="button" className="fr-doc-download" onClick={() => downloadDocument(doc)} data-track="ui.38155fa446.3">
                            <Download size={14} /> {copy('docDownload')}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Group 12 Slice 3b (608): the operator responsibility checklist.
          Each responsibility is acknowledged by the operator; HQ sees the
          same list and progress in the admin bundle. */}
      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <ShieldCheck size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('responsibilitiesTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('responsibilitiesSubtitle')}</p>
          </div>
        </div>

        {responsibilities.length > 0 ? (
          <>
            <div className="fr-detail-list-label">
              {copy('responsibilityProgress', { done: acknowledgedCount, total: responsibilities.length })}
            </div>
            <div className="fr-doc-list">
              {responsibilities.map((item) => {
                const acknowledged = item.status === 'acknowledged';
                return (
                  <div key={item.id} className="fr-doc-category">
                    <div className="fr-doc-category-head">
                      <div>
                        <div className="fr-doc-category-name">{RESPONSIBILITY_KEYS[item.code] ? copy(RESPONSIBILITY_KEYS[item.code]) : item.label}</div>
                        <span className={`fr-status-badge ${acknowledged ? 'fr-status-accepted' : 'fr-status-pending'}`}>
                          {acknowledged ? copy('responsibilityAcknowledged') : copy('responsibilityPending')}
                        </span>
                        {acknowledged && item.acknowledged_at && (
                          <div className="fr-doc-file-meta">{formatDate(item.acknowledged_at)}</div>
                        )}
                      </div>
                      {!acknowledged && isOperator && (
                        <button type="button" className="fr-btn-primary" disabled={busy} onClick={() => acknowledgeResponsibility(item.id)} data-track="ui.38155fa446.9">
                          {copy('responsibilityAcknowledge')}
                        </button>
                      )}
                      {acknowledged && <CheckCircle2 size={18} className="fr-detail-heading-icon" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className="fr-detail-empty">{copy('responsibilitiesEmpty')}</p>
        )}
      </section>

      {/* Group 12 Slice 3b (609): the territory launch plan. */}
      {/* G12-A4 (D-646): the status control is operator-only; a null
          handler hides the select instead of showing a dead button. */}
      <FranchiseLaunchPlan
        steps={detail.launch_plan_steps || []}
        readinessStatus={detail.application?.launch_readiness_status || null}
        onStatusChange={isOperator ? updateLaunchPlanStatus : null}
        disabled={busy}
      />

      {/* Group 12 Slice 3c (611): the open locations with their launch
          milestones. */}
      {/* G12-A4 (D-646): milestone/service/launch/confirm controls are
          operator-only; null handlers hide them instead of showing dead
          buttons that 403. */}
      <FranchiseOpenLocations
        locations={detail.locations || []}
        launchPlanSteps={detail.launch_plan_steps || []}
        openingTeam={detail.opening_team || []}
        businessServices={detail.business_services || []}
        onMilestoneStatusChange={isOperator ? updateMilestoneStatus : null}
        onServiceSave={isOperator ? saveLocationService : null}
        onLaunchLocation={isOperator ? launchLocation : null}
        onConfirmOpening={isOperator ? confirmOpening : null}
        disabled={busy}
      />

      {/* Group 12 Slice 3c (613): the formal readiness reviews. */}
      <FranchiseReadinessReviews reviews={detail.readiness_reviews || []} />

      {/* Group 12 Slice 3d (616): territory invitations. */}
      <FranchiseTerritoryInvitations
        invitations={detail.territory_invitations || []}
        canInvite={detail.application?.is_operator === true}
        onInvite={inviteTerritoryMember}
        onCancel={cancelTerritoryInvite}
        disabled={busy}
      />

      {/* Group 12 Slice 3d (618): territory training distribution. */}
      <FranchiseTrainingTasks
        assignments={detail.training_assignments || []}
        members={territoryMembers()}
        locations={detail.locations || []}
        canAssign={detail.application?.is_operator === true}
        canComplete={detail.application?.is_operator === true}
        onAssign={assignTraining}
        onComplete={completeTraining}
        onRemove={removeTraining}
        disabled={busy}
      />

      {/* Group 12 Slice 3d (620): the HQ announcement feed. */}
      <FranchiseAnnouncements
        announcements={detail.announcements || []}
        canRead={detail.application?.is_operator === true}
        onMarkRead={markAnnouncementRead}
        disabled={busy}
      />

      {/* Group 12 Slice 3e (621/622): the franchise standards library;
          the operator acknowledges each version with a drawn signature. */}
      <FranchiseStandards
        standards={detail.standards || []}
        canAcknowledge={detail.application?.is_operator === true}
        onAcknowledge={acknowledgeStandard}
        disabled={busy}
      />

      {/* Group 12 Slice 3e (623): the brand asset store. */}
      <FranchiseBrandAssets
        assets={detail.brand_assets || []}
        onDownload={async (asset) => {
          const response = await api.get(`/franchise/my-applications/${applicationId}/brand-assets/${asset.id}/download-url`);
          return response.data?.download_url;
        }}
      />

      {/* Group 12 Slice 3e (624): the operator compliance checklist. */}
      <FranchiseComplianceChecklist checklist={detail.compliance_checklist || null} />

      {/* Group 12 Slice 3f (628, D-327): the service exception summary —
          the territory's support tickets aggregated; the operator links
          their own tickets by ticket number. */}
      <FranchiseExceptionSummary
        summary={detail.exception_summary || null}
        locations={detail.locations || []}
        canLink={detail.application?.is_operator === true}
        onLink={linkTicket}
        onUnlink={unlinkTicket}
        busy={busy}
      />

      {/* Group 12 Slice 3f (627, D-328): the per-location health view —
          status, KPIs, and compliance for each location. */}
      <FranchiseLocationHealth health={detail.location_health || null} />

      {/* Group 12 Slice 3f (629, D-329): the territory ticket queue. */}
      <FranchiseTerritoryTickets
        tickets={territoryTickets}
        locations={detail.locations || []}
        status={ticketStatus}
        locationId={ticketLocationId}
        onStatusChange={setTicketStatus}
        onLocationChange={setTicketLocationId}
        canUnlink={detail.application?.is_operator === true}
        onUnlink={unlinkTicket}
        busy={busy}
        total={ticketTotal}
        onLoadMore={loadMoreTickets}
        loadingMore={ticketLoadingMore}
      />

      {/* Group 12 Slice 3j (648, D-349): training escalation — a training
          issue/gap raised to HQ with the training context attached. */}
      <FranchiseTrainingEscalations
        escalations={detail.training_escalations || []}
        assignments={detail.training_assignments || []}
        members={detail.territory_members || []}
        locations={detail.locations || []}
        canEscalate={detail.application?.is_operator === true}
        onEscalate={escalateTraining}
        busy={busy}
      />

      {/* Group 12 Slice 3j (647, D-348): dedicated HQ operations
          appointments — the operator books one; HQ confirms it. */}
      <FranchiseOpsAppointments
        slots={detail.ops_appointments || []}
        currentUserId={user?.id}
        canBook={detail.application?.is_operator === true}
        onBook={bookOpsSlot}
        onCancelBooking={cancelOpsBooking}
        busy={busy}
      />

      {/* Group 12 Slice 3j (650, D-351): the franchise support history
          — the territory's support interactions in chronological order. */}
      <FranchiseSupportHistory
        history={detail.support_history ? { ...detail.support_history, history: [...(detail.support_history.history || []), ...extraHistory] } : null}
        onLoadMore={loadMoreHistory}
        loadingMore={historyLoadingMore}
      />

      {/* Group 12 Slice 3j (649, D-350): the territory case tracker —
          tickets, policy questions, training escalations, and handoffs
          in one view. */}
      <FranchiseTerritoryCases
        cases={territoryCases}
        locations={detail.locations || []}
        status={caseStatus}
        type={caseType}
        locationId={caseLocationId}
        onStatusChange={setCaseStatus}
        onTypeChange={setCaseType}
        onLocationChange={setCaseLocationId}
        busy={busy}
        total={caseTotal}
        onLoadMore={loadMoreCases}
        loadingMore={caseLoadingMore}
      />

      {/* Group 12 Slice 3j (646, D-347): franchise-scoped policy
          questions — the operator asks, HQ answers in-thread. */}
      <FranchisePolicyQuestions
        questions={detail.policy_questions || []}
        locations={detail.locations || []}
        standards={detail.standards || []}
        canAsk={detail.application?.is_operator === true}
        onAsk={askPolicyQuestion}
        busy={busy}
      />

      {/* Group 12 Slice 3g (631, D-331): the per-territory escalation queue. */}
      <FranchiseExceptionEscalations
        escalations={escalations}
        canEscalate={detail.application?.is_operator === true}
        onEscalate={escalateTicket}
        busy={busy}
      />

      {/* Group 12 Slice 3g (632-635, D-332/D-333/D-334/D-335): resolve
          exceptions — remediation, corrective actions, evidence, and the
          derived resolution state. HQ review happens from the HQ page. */}
      <FranchiseExceptionResolution
        resolution={detail.exception_resolution || null}
        correctiveActions={correctiveActions}
        members={detail.territory_members || []}
        canAssign={detail.application?.is_operator === true}
        canCreateAction={detail.application?.is_operator === true}
        canUpdateAction={detail.application?.is_operator === true}
        canUploadEvidence={detail.application?.is_operator === true}
        onAssignRemediation={assignRemediation}
        onCreateAction={createCorrectiveAction}
        onUpdateActionStatus={updateCorrectiveActionStatus}
        onUploadEvidence={uploadEvidence}
        onLoadEvidence={loadEvidence}
        busy={busy}
      />

      {/* Group 12 Slice 3h (636, D-336): the candidate location tracker. */}
      <FranchiseCandidateLocations
        candidates={detail.candidate_locations || null}
        canPropose={detail.application?.is_operator === true}
        onPropose={proposeCandidate}
        onStatusChange={updateCandidateStatus}
        onRemove={removeCandidate}
        busy={busy}
      />

      {/* Group 12 Slice 3h (637, D-337): the territory capacity view. */}
      <FranchiseTerritoryCapacity capacity={detail.territory_capacity || null} />

      {/* Group 12 Slice 3h (638, D-338): the training resource planner. */}
      <FranchiseTrainingPlanner planner={detail.training_planner || null} />

      {/* Group 12 Slice 3h (639, D-339): the launch dependency overview. */}
      <FranchiseLaunchDependencies dependencies={detail.launch_dependencies || null} />

      {/* Group 12 Slice 3h (640, D-340): expansion readiness notes — the
          operator's notes next to HQ's own readiness fields. */}
      <FranchiseExpansionNotes
        notes={detail.expansion_notes || null}
        hqNotes={detail.hq_readiness_notes || null}
        locations={detail.locations || []}
        canWrite={detail.application?.is_operator === true}
        onAdd={addExpansionNote}
        onUpdate={updateExpansionNote}
        onRemove={removeExpansionNote}
        busy={busy}
      />

      {/* Group 12 Slice 3b (610, D-310): the operator-facing assignment history. */}
      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <History size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('historyTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('historySubtitle')}</p>
          </div>
        </div>

        {(detail.activity || []).length > 0 ? (
          <>
            <ul className="fr-history-list">
              {[...(detail.activity || []), ...extraActivity].map((event) => (
                <li key={event.id} className="fr-history-item">
                  <div className="fr-history-when">{formatDateTime(event.created_at)}</div>
                  <div className="fr-history-summary">{event.event_summary}</div>
                </li>
              ))}
            </ul>
            {typeof detail.activity_total === 'number'
              && (detail.activity || []).length + extraActivity.length < detail.activity_total && (
              <button type="button" className="fr-btn-ghost" disabled={activityLoading} onClick={loadMoreActivity} data-track="ui.38155fa446.10">
                {copy('historyShowMore', { count: detail.activity_total - ((detail.activity || []).length + extraActivity.length) })}
              </button>
            )}
          </>
        ) : (
          <p className="fr-detail-empty">{copy('historyEmpty')}</p>
        )}
      </section>

      <section className="fr-detail-card">
        <div className="fr-detail-heading">
          <MessageSquare size={16} className="fr-detail-heading-icon" />
          <div>
            <h2 className="fr-detail-title">{copy('followupTitle')}</h2>
            <p className="fr-detail-subtitle">{copy('followupSubtitle')}</p>
          </div>
        </div>

        {sharedNotes.length > 0 && (
          <div className="fr-followup-block">
            <div className="fr-detail-list-label">{copy('sharedNotesTitle')}</div>
            {sharedNotes.map((note) => (
              <div key={note.id} className="fr-followup-message fr-followup-message-hq">
                <div className="fr-followup-author">{copy('followupNoteLabel')} · {formatDate(note.created_at)}</div>
                <div className="fr-followup-body">{note.note_text}</div>
              </div>
            ))}
          </div>
        )}

        <div className="fr-followup-block">
          {followup.length === 0 && sharedNotes.length === 0 ? (
            <p className="fr-detail-empty">{copy('followupEmpty')}</p>
          ) : (
            followup.map((message) => (
              <div
                key={message.id}
                className={`fr-followup-message ${message.author_role === 'applicant' ? 'fr-followup-message-you' : 'fr-followup-message-hq'}`}
              >
                <div className="fr-followup-author">
                  {message.author_role === 'applicant' ? copy('followupFromYou') : copy('followupFromHq')} · {formatDate(message.created_at)}
                </div>
                <div className="fr-followup-body">{message.body}</div>
              </div>
            ))
          )}
        </div>

        <div className="fr-followup-compose">
          <textarea
            className="fr-followup-input"
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder={copy('followupPlaceholder')}
            rows={3}
          />
          <button type="button" className="fr-btn-primary" disabled={busy || !reply.trim()} onClick={sendReply} data-track="ui.38155fa446.4">
            {copy('followupSend')}
          </button>
        </div>
      </section>
    </div>
  );
}
