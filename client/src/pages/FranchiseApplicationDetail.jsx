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
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState(null);
  // Group 12 Slice 3b (606): decline-reason compose state.
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState('');

  useEffect(() => {
    let cancelled = false;
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
  // the form — the detail payload is operator-scoped already.
  async function inviteTerritoryMember(body) {
    setBusy(true);
    setError('');
    try {
      const response = await api.post(`/franchise/my-applications/${applicationId}/invitations`, body);
      setDetail(response.data);
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
  const proposed = interviews.filter((slot) => slot.status === 'proposed');
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

        {!booked && proposed.length === 0 && past.length === 0 && (
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
                        {doc.download_url && (
                          <a className="fr-doc-download" href={doc.download_url} target="_blank" rel="noreferrer" data-track="ui.38155fa446.3">
                            <Download size={14} /> {copy('docDownload')}
                          </a>
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
                      {!acknowledged && (
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
      <FranchiseLaunchPlan
        steps={detail.launch_plan_steps || []}
        readinessStatus={detail.application?.launch_readiness_status || null}
        onStatusChange={updateLaunchPlanStatus}
        disabled={busy}
      />

      {/* Group 12 Slice 3c (611): the open locations with their launch
          milestones. */}
      <FranchiseOpenLocations
        locations={detail.locations || []}
        launchPlanSteps={detail.launch_plan_steps || []}
        openingTeam={detail.opening_team || []}
        businessServices={detail.business_services || []}
        onMilestoneStatusChange={updateMilestoneStatus}
        onServiceSave={saveLocationService}
        onLaunchLocation={launchLocation}
        onConfirmOpening={confirmOpening}
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
      <FranchiseBrandAssets assets={detail.brand_assets || []} />

      {/* Group 12 Slice 3e (624): the operator compliance checklist. */}
      <FranchiseComplianceChecklist checklist={detail.compliance_checklist || null} />

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
          <ul className="fr-history-list">
            {(detail.activity || []).map((event) => (
              <li key={event.id} className="fr-history-item">
                <div className="fr-history-when">{formatDateTime(event.created_at)}</div>
                <div className="fr-history-summary">{event.event_summary}</div>
              </li>
            ))}
          </ul>
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
