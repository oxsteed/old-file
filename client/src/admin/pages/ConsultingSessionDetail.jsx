import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import ActionItemsPanel from '../../components/ActionItemsPanel';
import { useAbortableFetch } from '../lib/useAbortableFetch';
import ConfirmDialog from '../lib/ConfirmDialog';
import { confidentialityApi, downloadEngagementRecord } from '../../api/consultantConfidentiality';
import { closeoutApi } from '../../api/consultantCloseout';
import './ConsultingSessionDetail.css';

const STATUS_COLORS = {
  pending: '#FFA500',
  scheduled: '#0EA5E9',
  completed: '#10B981',
  cancelled: '#EF4444',
};

export default function ConsultingSessionDetail({ session, onClose, onStatusUpdate }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [updateLoading, setUpdateLoading] = useState(false);
  const [notes, setNotes] = useState(session.notes || '');
  const [notesLoading, setNotesLoading] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState(session.consultant_assigned_id || '');
  const [assigningConsultant, setAssigningConsultant] = useState(false);
  const [confirmCompleteOpen, setConfirmCompleteOpen] = useState(false);
  const [confirmNoShowOpen, setConfirmNoShowOpen] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  // Group 10 Slice C (519): the scheduled row for this session, resolved
  // so the Cancel button can hit the unified cancel endpoint. Null when
  // the session has no appointment yet.
  const [scheduledDetail, setScheduledDetail] = useState(null);
  // Group 10 Slice E (526-530): the milestone board, read-only for admin.
  const [deliverables, setDeliverables] = useState([]);
  const [deliverablesLoading, setDeliverablesLoading] = useState(true);
  // Group 10 Slice F (531-535): change requests and history, read-only
  // for admin, plus admin pause/resume.
  const [changeRequests, setChangeRequests] = useState([]);
  const [changeEvents, setChangeEvents] = useState([]);
  const [changesLoading, setChangesLoading] = useState(true);
  const [pauseReason, setPauseReason] = useState('');
  const [pauseBusy, setPauseBusy] = useState(false);
  // Group 10 Slice G (536-540): participants, confidentiality
  // acknowledgment, and document sharing, read-only for admin except
  // document sharing and the record export.
  const [participants, setParticipants] = useState(null);
  const [confidentiality, setConfidentiality] = useState(null);
  const [confidentialityLoading, setConfidentialityLoading] = useState(true);
  const [confidentialityBusy, setConfidentialityBusy] = useState('');
  const [expiryDrafts, setExpiryDrafts] = useState({});
  const [clearedExpiry, setClearedExpiry] = useState({});
  const [visibilityDrafts, setVisibilityDrafts] = useState({});
  const [shareDrafts, setShareDrafts] = useState({});
  // Group 10 Slice H (541-545): the closeout checklist, confirmations,
  // follow-ups, feedback request, and archive. The admin reads the
  // checklist, confirms on the client's behalf only (never for the
  // consultant), and archives or unarchives the engagement.
  const [closeout, setCloseout] = useState(null);
  const [closeoutLoading, setCloseoutLoading] = useState(true);
  const [closeoutBusy, setCloseoutBusy] = useState('');

  // Refetch and reset per-session state whenever the viewed session changes,
  // so consultants and notes never bleed across sessions.
  const { data: consultantsData, loading: consultantsLoading } = useAbortableFetch(async (signal) => {
    const response = await axios.get('/consulting/admin/consultants', { signal });
    return response.data || [];
  }, [session.id]);

  const consultants = consultantsData || [];

  useEffect(() => {
    setNotes(session.notes || '');
    setSelectedConsultant(session.consultant_assigned_id || '');
    setActiveTab('overview');
  }, [session.id, session.notes, session.consultant_assigned_id]);

  // Resolve the scheduled appointment row (if any) for the Slice C actions.
  useEffect(() => {
    let cancelled = false;
    setScheduledDetail(null);
    axios.get(`/scheduling/sessions/by-consulting/${session.id}`)
      .then((r) => { if (!cancelled) setScheduledDetail(r.data); })
      .catch(() => { if (!cancelled) setScheduledDetail(null); });
    return () => { cancelled = true; };
  }, [session.id]);

  // Load the milestone board (Slice E) for this session.
  const loadDeliverables = () => {
    setDeliverables([]);
    setDeliverablesLoading(true);
    return axios.get(`/consulting/admin/sessions/${session.id}/deliverables`)
      .then((r) => { setDeliverables(Array.isArray(r.data?.deliverables) ? r.data.deliverables : []); })
      .catch(() => { setDeliverables([]); })
      .finally(() => { setDeliverablesLoading(false); });
  };
  useEffect(() => { loadDeliverables(); }, [session.id]);

  // Load change requests and history (Slice F) for this session.
  const loadChanges = () => {
    setChangesLoading(true);
    return Promise.all([
      axios.get(`/consulting/admin/sessions/${session.id}/change-requests`),
      axios.get(`/consulting/admin/sessions/${session.id}/history`),
    ])
      .then(([reqRes, histRes]) => {
        setChangeRequests(Array.isArray(reqRes.data?.changeRequests) ? reqRes.data.changeRequests : []);
        setChangeEvents(Array.isArray(histRes.data?.events) ? histRes.data.events : []);
      })
      .catch(() => { setChangeRequests([]); setChangeEvents([]); })
      .finally(() => setChangesLoading(false));
  };
  useEffect(() => { loadChanges(); }, [session.id]);

  // Load participants and confidentiality status (Slice G) for this session.
  const loadConfidentiality = () => {
    setConfidentialityLoading(true);
    return Promise.all([
      confidentialityApi.listAdminParticipants(session.id),
      confidentialityApi.getAdminConfidentiality(session.id),
    ])
      .then(([partRes, confRes]) => {
        setParticipants(partRes.data);
        setConfidentiality(confRes.data);
      })
      .catch(() => { setParticipants(null); setConfidentiality(null); })
      .finally(() => setConfidentialityLoading(false));
  };
  useEffect(() => { loadConfidentiality(); }, [session.id]);

  // Load the closeout checklist and follow-ups (Slice H) for this session.
  const loadCloseout = () => {
    setCloseoutLoading(true);
    return closeoutApi.getAdminCloseout(session.id)
      .then((r) => { setCloseout(r.data); })
      .catch(() => { setCloseout(null); })
      .finally(() => { setCloseoutLoading(false); });
  };
  useEffect(() => { loadCloseout(); }, [session.id]);

  async function confirmCloseoutForClient() {
    try {
      setCloseoutBusy('confirm-client');
      await closeoutApi.confirmAdminCloseout(session.id, { on_behalf_of: 'client' });
      toast.success(t('consultantCloseout.confirmedToast'));
      await loadCloseout();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setCloseoutBusy('');
    }
  }

  async function archiveEngagement() {
    try {
      setCloseoutBusy('archive');
      await closeoutApi.archiveAdminEngagement(session.id);
      toast.success(t('consultantCloseout.archivedToast'));
      await loadCloseout();
      onStatusUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setCloseoutBusy('');
    }
  }

  async function unarchiveEngagement() {
    try {
      setCloseoutBusy('unarchive');
      await closeoutApi.unarchiveAdminEngagement(session.id);
      toast.success(t('consultantCloseout.unarchivedToast'));
      await loadCloseout();
      onStatusUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setCloseoutBusy('');
    }
  }

  async function exportRecord() {
    try {
      setConfidentialityBusy('export');
      const { data } = await confidentialityApi.exportAdminRecord(session.id);
      downloadEngagementRecord(data, session.id);
      toast.success(t('consultantConfidentiality.exported', { defaultValue: 'Engagement record downloaded.' }));
    } catch {
      toast.error(t('consultantConfidentiality.exportError', { defaultValue: 'Could not export the engagement record.' }));
    } finally {
      setConfidentialityBusy('');
    }
  }

  async function saveSharing(doc, deliverableId) {
    const visibility = visibilityDrafts[doc.id] || doc.visibility;
    const payload = { visibility };
    if (clearedExpiry[doc.id]) {
      payload.expires_at = null;
    } else if (expiryDrafts[doc.id]) {
      payload.expires_at = new Date(`${expiryDrafts[doc.id]}T23:59:59.999Z`).toISOString();
    }
    if (visibility === 'limited') {
      payload.shared_with = shareDrafts[doc.id] ?? doc.sharedWith ?? [];
    }
    try {
      setConfidentialityBusy(`sharing-${doc.id}`);
      await confidentialityApi.updateAdminDocumentSharing(session.id, deliverableId, doc.id, payload);
      toast.success(t('consultantConfidentiality.sharingUpdated', { defaultValue: 'Document sharing updated.' }));
      await Promise.all([loadConfidentiality(), loadDeliverables()]);
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setConfidentialityBusy('');
    }
  }

  function toggleShare(doc, userId) {
    setShareDrafts((prev) => {
      const current = new Set(prev[doc.id] ?? doc.sharedWith ?? []);
      if (current.has(userId)) current.delete(userId);
      else current.add(userId);
      return { ...prev, [doc.id]: [...current] };
    });
  }

  async function pauseEngagement() {
    if (pauseReason.trim().length < 10) {
      toast.error(t('consultantChange.reasonRequired', { defaultValue: 'A reason of at least 10 characters is required.' }));
      return;
    }
    try {
      setPauseBusy(true);
      await axios.post(`/consulting/admin/sessions/${session.id}/pause`, { reason: pauseReason.trim() });
      toast.success(t('consultantChange.paused', { defaultValue: 'Engagement paused.' }));
      setPauseReason('');
      await loadChanges();
      onStatusUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setPauseBusy(false);
    }
  }

  async function resumeEngagement() {
    try {
      setPauseBusy(true);
      await axios.post(`/consulting/admin/sessions/${session.id}/resume`);
      toast.success(t('consultantChange.resumed', { defaultValue: 'Engagement resumed.' }));
      await loadChanges();
      onStatusUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || t('common.errorUpdating', { defaultValue: 'Could not save that change.' }));
    } finally {
      setPauseBusy(false);
    }
  }

  async function assignConsultant() {
    if (!selectedConsultant) {
      toast.error(t('adminConsultingSessionDetail.toast.selectConsultant'));
      return;
    }

    try {
      setAssigningConsultant(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}`, {
        consultant_assigned_id: selectedConsultant,
      });
      toast.success(t('adminConsultingSessionDetail.toast.consultantAssigned'));
      onStatusUpdate();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.assignConsultantFailed'));
    } finally {
      setAssigningConsultant(false);
    }
  }

  // Completion is confirmation-gated: the generic status select and the
  // "Mark Completed" button both open the same ConfirmDialog.
  function requestComplete() {
    setConfirmCompleteOpen(true);
  }

  async function confirmMarkSessionComplete() {
    try {
      setUpdateLoading(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}/complete`);
      toast.success(t('adminConsultingSessionDetail.toast.markedComplete'));
      onStatusUpdate();
    } catch (err) {
      // Rethrow so the ConfirmDialog stays open and shows the failure instead
      // of closing as if the session was completed. A future-dated session
      // (Slice C, item 520) is refused by the server: say so plainly.
      if (err.response?.data?.error === 'session_not_started') {
        toast.error(t('adminConsultingSessionDetail.toast.sessionNotStarted'));
      } else {
        toast.error(t('adminConsultingSessionDetail.toast.markCompleteFailed'));
      }
      throw err;
    } finally {
      setUpdateLoading(false);
    }
  }

  // Cancellation (Slice C, item 519) is confirmation-gated with a required
  // reason and goes through the unified cancel endpoint, which moves both
  // the scheduled row and the session in one transaction. Refunds stay on
  // the admin refund endpoint: this only records the cancellation.
  function requestCancel() {
    setConfirmCancelOpen(true);
  }

  async function confirmCancelSession(reason) {
    const scheduledId = scheduledDetail?.scheduled?.id;
    if (!scheduledId) {
      toast.error(t('adminConsultingSessionDetail.toast.cancelFailed'));
      throw new Error('no scheduled appointment');
    }
    try {
      setUpdateLoading(true);
      await axios.post(`/scheduling/sessions/${scheduledId}/cancel`, {
        reason: reason || null,
        refund_requested: false,
      });
      toast.success(t('adminConsultingSessionDetail.toast.cancelled'));
      onStatusUpdate();
      onClose();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.cancelFailed'));
      throw err;
    } finally {
      setUpdateLoading(false);
    }
  }

  // No-show is confirmation-gated via the shared ConfirmDialog.
  function requestNoShow() {
    setConfirmNoShowOpen(true);
  }

  async function confirmMarkSessionNoShow() {
    try {
      setUpdateLoading(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}/no-show`);
      toast.success(t('adminConsultingSessionDetail.toast.markedNoShow'));
      onStatusUpdate();
    } catch (err) {
      // Rethrow so the ConfirmDialog stays open and shows the failure instead
      // of closing as if the session was marked no-show.
      toast.error(t('adminConsultingSessionDetail.toast.markNoShowFailed'));
      throw err;
    } finally {
      setUpdateLoading(false);
    }
  }

  async function updateSessionStatus(sessionId, newStatus) {
    try {
      setUpdateLoading(true);
      await axios.patch(`/consulting/admin/sessions/${sessionId}`, {
        status: newStatus,
      });
      toast.success(t('adminConsultingSessionDetail.toast.statusUpdated'));
      onStatusUpdate();
      onClose();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.statusUpdateFailed'));
    } finally {
      setUpdateLoading(false);
    }
  }

  async function saveNotes() {
    if (!notes.trim()) {
      toast.error(t('adminConsultingSessionDetail.toast.noteRequired'));
      return;
    }

    try {
      setNotesLoading(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}`, {
        notes: notes,
      });
      toast.success(t('adminConsultingSessionDetail.toast.notesSaved'));
      onStatusUpdate();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.saveNotesFailed'));
    } finally {
      setNotesLoading(false);
    }
  }

  const containerStyle = {
    background: 'var(--color-surface)',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '700px',
    width: '100%',
    maxHeight: '90vh',
    overflowY: 'auto',
  };

  const sectionStyle = {
    marginBottom: '1.5rem',
  };

  const sectionTitleStyle = {
    fontSize: '1.1rem',
    fontWeight: 600,
    marginBottom: '1rem',
  };

  const labelStyle = {
    fontWeight: 600,
    marginTop: '0.5rem',
    marginBottom: '0.25rem',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    borderRadius: '6px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.95rem',
    marginBottom: '0.5rem',
  };

  const buttonStyle = {
    padding: '0.75rem 1.5rem',
    borderRadius: '6px',
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
  };

  const badgeStyle = (color) => ({
    display: 'inline-block',
    background: color || 'var(--color-bg)',
    color: 'white',
    padding: '0.35rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.85rem',
    fontWeight: 500,
  });

  const tabsStyle = {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
    borderBottom: '1px solid var(--color-border)',
  };

  const tabStyle = (isActive) => ({
    padding: '0.75rem 1rem',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : '500',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '2px solid var(--color-primary)' : 'none',
    marginBottom: '-1px',
    transition: 'all 0.2s',
  });

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.5rem', fontWeight: 600 }}>
          {session.first_name} {session.last_name}
        </h2>
        <div style={{
          display: 'flex',
          gap: '1rem',
          alignItems: 'center',
          flexWrap: 'wrap',
        }}>
          <span style={{
            background: STATUS_COLORS[session.status],
            color: 'white',
            padding: '0.4rem 0.8rem',
            borderRadius: '12px',
            fontSize: '0.85rem',
            fontWeight: 600,
          }}>
            {session.status}
          </span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
            {session.service_tier} • ${session.service_tier === 'initial' ? '100' : 'Custom'}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabsStyle} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'overview'}
          aria-controls="overview-panel"
          style={tabStyle(activeTab === 'overview')}
          onClick={() => setActiveTab('overview')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActiveTab('action-items');
            if (e.key === 'ArrowLeft') setActiveTab('overview');
          }}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'action-items'}
          aria-controls="action-items-panel"
          style={tabStyle(activeTab === 'action-items')}
          onClick={() => setActiveTab('action-items')}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setActiveTab('overview');
            if (e.key === 'ArrowLeft') setActiveTab('overview');
          }}
        >
          Action Items
        </button>
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div id="overview-panel">
          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Contact Information</div>
            <p><strong>Email:</strong> {session.email}</p>
            <p><strong>Phone:</strong> {session.phone || '-'}</p>
            <p><strong>Business Name:</strong> {session.business_name || '-'}</p>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Consultation Details</div>
            <p><strong>Service Tier:</strong> {session.service_tier}</p>
            <p><strong>Current Phase:</strong> {session.current_phase || 'Not specified'} / 25</p>
            <p><strong>Description:</strong></p>
            <p style={{ fontStyle: 'italic', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
              {session.description || 'No description provided'}
            </p>
          </div>

          <div className="csd-deliverables-section">
            <div className="csd-deliverables-title">{t('consultantDeliverable.title', { defaultValue: 'Milestone board' })}</div>
            {deliverablesLoading ? (
              <p className="csd-deliverables-note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
            ) : deliverables.length === 0 ? (
              <p className="csd-deliverables-note">{t('consultantDeliverable.adminEmpty', { defaultValue: 'No milestones on this engagement yet.' })}</p>
            ) : (
              deliverables.map((item) => (
                <div key={item.id} className="csd-deliverable-card">
                  <p className="csd-deliverable-name">
                    <strong>{item.name}</strong>
                  </p>
                  <p className="csd-deliverable-meta">
                    {t(`consultantDeliverable.status.${item.status}`, { defaultValue: item.status.replace(/_/g, ' ') })}
                    {item.due_date ? ` • ${t('consultantDeliverable.dueLabel', { defaultValue: 'due {{date}}', date: String(item.due_date).slice(0, 10) })}` : ''}
                    {item.accepted_at ? ` • ${t('consultantDeliverable.acceptedOn', { defaultValue: 'accepted {{date}}', date: new Date(item.accepted_at).toLocaleDateString() })}` : ''}
                  </p>
                  {item.description && <p className="csd-deliverable-text">{item.description}</p>}
                  {item.draft_note && (
                    <p className="csd-deliverable-text">
                      {t('consultantDeliverable.draftNote', { defaultValue: 'Draft note: {{note}}', note: item.draft_note })}
                    </p>
                  )}
                  {(item.documents || []).length > 0 && (
                    <ul className="csd-deliverable-docs">
                      {item.documents.map((doc) => (
                        <li key={doc.id}>
                          {doc.originalName} • {doc.visibility}
                          {doc.expired ? (
                            <span>{` • ${t('consultantConfidentiality.docExpired', { defaultValue: 'Access expired' })}`}</span>
                          ) : doc.expiresAt ? (
                            <span>{` • ${t('consultantConfidentiality.docExpiry', { defaultValue: 'Access until {{date}}', date: String(doc.expiresAt).slice(0, 10) })}`}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {item.feedback_count > 0 && (
                    <p className="csd-deliverable-meta">
                      {t('consultantDeliverable.feedbackCount', { defaultValue: '{{count}} feedback notes', count: item.feedback_count })}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="csd-deliverables-section">
            <div className="csd-deliverables-title">{t('consultantChange.title', { defaultValue: 'Changes' })}</div>
            {session.status === 'paused' ? (
              <button type="button" onClick={resumeEngagement} disabled={pauseBusy} className="csd-changes-button">
                {t('consultantChange.resume', { defaultValue: 'Resume engagement' })}
              </button>
            ) : (
              <div className="csd-changes-pause-row">
                <input
                  type="text"
                  value={pauseReason}
                  onChange={(event) => setPauseReason(event.target.value)}
                  placeholder={t('consultantChange.pauseReasonPlaceholder', { defaultValue: 'Why pause? (at least 10 characters)' })}
                  className="csd-changes-input"
                />
                <button type="button" onClick={pauseEngagement} disabled={pauseBusy || pauseReason.trim().length < 10} className="csd-changes-button">
                  {t('consultantChange.pause', { defaultValue: 'Pause engagement' })}
                </button>
              </div>
            )}
            {changesLoading ? (
              <p className="csd-deliverables-note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
            ) : changeRequests.length === 0 && changeEvents.length === 0 ? (
              <p className="csd-deliverables-note">{t('consultantChange.empty', { defaultValue: 'No changes yet.' })}</p>
            ) : (
              <>
                {changeRequests.map((request) => (
                  <div key={request.id} className="csd-deliverable-card">
                    <p className="csd-deliverable-name">
                      <strong>
                        {t(`consultantChange.types.${request.requestType}`, { defaultValue: request.requestType.replace(/_/g, ' ') })}
                        {request.deliverableName ? ` • ${request.deliverableName}` : ''}
                      </strong>
                    </p>
                    <p className="csd-deliverable-meta">
                      {t(`consultantChange.status.${request.status}`, { defaultValue: request.status })}
                      {' • '}
                      {t('consultantChange.requestedBy', { defaultValue: 'Requested by {{role}}', role: t(`consultantChange.roles.${request.requestedByRole}`, { defaultValue: request.requestedByRole }) })}
                      {request.amountCents != null ? ` • $${(request.amountCents / 100).toFixed(2)}` : ''}
                      {request.newDueDate ? ` • ${t('consultantDeliverable.dueLabel', { defaultValue: 'due {{date}}', date: request.newDueDate })}` : ''}
                    </p>
                    {request.reason && <p className="csd-deliverable-text">{request.reason}</p>}
                    {request.decisionReason && (
                      <p className="csd-deliverable-text">
                        {t('consultantChange.decisionReason', { defaultValue: 'Decision: {{reason}}', reason: request.decisionReason })}
                      </p>
                    )}
                  </div>
                ))}
                {changeEvents.length > 0 && (
                  <>
                    <div className="csd-deliverables-title">{t('consultantChange.history', { defaultValue: 'Change history' })}</div>
                    <ul className="csd-deliverable-docs">
                      {changeEvents.map((event) => (
                        <li key={event.id}>
                          {event.summary}
                          {' • '}
                          {event.createdAt ? String(event.createdAt).slice(0, 10) : ''}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>

          {/* Group 10 Slice G (536-540): participants, confidentiality
              acknowledgment, document sharing, and the record export. */}
          <div className="csd-deliverables-section">
            <div className="csd-deliverables-title">{t('consultantConfidentiality.title', { defaultValue: 'Confidentiality' })}</div>
            <button type="button" onClick={exportRecord} disabled={confidentialityBusy === 'export'} className="csd-changes-button">
              {t('consultantConfidentiality.export', { defaultValue: 'Export engagement record' })}
            </button>
            {confidentialityLoading ? (
              <p className="csd-deliverables-note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
            ) : (
              <>
                <ul className="csd-deliverable-docs">
                  {[...(participants?.core || []), ...((participants?.participants || []).filter((party) => party.active))].map((party) => (
                    <li key={party.userId}>
                      {[party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId}
                      {' • '}
                      {t(`consultantConfidentiality.roles.${party.role}`, { defaultValue: party.role.replace(/_/g, ' ') })}
                    </li>
                  ))}
                </ul>
                {(confidentiality?.parties || []).filter((party) => !party.acknowledgedAt).length === 0 ? (
                  <p className="csd-deliverable-meta">
                    {t('consultantConfidentiality.ackDone', { defaultValue: 'Everyone on this engagement has acknowledged confidentiality.' })}
                  </p>
                ) : (
                  <p className="csd-deliverable-meta">
                    {(confidentiality?.parties || []).filter((party) => !party.acknowledgedAt).map((party) => t('consultantConfidentiality.ackPending', { defaultValue: 'Still waiting on {{name}}.', name: [party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId })).join(' ')}
                  </p>
                )}
                {deliverables.flatMap((item) => (item.documents || []).map((doc) => ({ ...doc, deliverableId: item.id }))).map((doc) => {
                  const visibility = visibilityDrafts[doc.id] || doc.visibility;
                  const expiry = expiryDrafts[doc.id] ?? (doc.expired ? '' : (doc.expiresAt ? String(doc.expiresAt).slice(0, 10) : ''));
                  const parties = [...(participants?.core || []), ...((participants?.participants || []).filter((party) => party.active))];
                  return (
                    <div key={doc.id} className="csd-deliverable-card">
                      <p className="csd-deliverable-name"><strong>{doc.originalName}</strong></p>
                      <p className="csd-deliverable-meta">
                        {t(`consultantConfidentiality.visibility${visibility === 'shared' ? 'Shared' : visibility === 'client_only' ? 'ClientOnly' : visibility === 'consultant_only' ? 'ConsultantOnly' : visibility === 'limited' ? 'Limited' : 'Internal'}`, { defaultValue: visibility.replace(/_/g, ' ') })}
                        {doc.expired ? (
                          <span>{` • ${t('consultantConfidentiality.docExpired', { defaultValue: 'Access expired' })}`}</span>
                        ) : doc.expiresAt ? (
                          <span>{` • ${t('consultantConfidentiality.docExpiry', { defaultValue: 'Access until {{date}}', date: String(doc.expiresAt).slice(0, 10) })}`}</span>
                        ) : (
                          <span>{` • ${t('consultantConfidentiality.docNoExpiry', { defaultValue: 'No expiry' })}`}</span>
                        )}
                      </p>
                      <div className="csd-changes-pause-row">
                        <select
                          value={visibility}
                          onChange={(event) => setVisibilityDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }))}
                          className="csd-changes-input"
                          aria-label={t('consultantConfidentiality.visibility', { defaultValue: 'Who can see this' })}
                        >
                          <option value="shared">{t('consultantConfidentiality.visibilityShared', { defaultValue: 'Shared with client' })}</option>
                          <option value="client_only">{t('consultantConfidentiality.visibilityClientOnly', { defaultValue: 'Client only' })}</option>
                          <option value="consultant_only">{t('consultantConfidentiality.visibilityConsultantOnly', { defaultValue: 'Consultant only' })}</option>
                          <option value="limited">{t('consultantConfidentiality.visibilityLimited', { defaultValue: 'Named people only' })}</option>
                          <option value="internal">{t('consultantConfidentiality.visibilityInternal', { defaultValue: 'Internal' })}</option>
                        </select>
                        <input
                          type="date"
                          value={expiry}
                          onChange={(event) => {
                            setExpiryDrafts((prev) => ({ ...prev, [doc.id]: event.target.value }));
                            setClearedExpiry((prev) => ({ ...prev, [doc.id]: false }));
                          }}
                          className="csd-changes-input"
                          aria-label={t('consultantConfidentiality.setExpiry', { defaultValue: 'Set expiry' })}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setExpiryDrafts((prev) => ({ ...prev, [doc.id]: '' }));
                            setClearedExpiry((prev) => ({ ...prev, [doc.id]: true }));
                          }}
                          className="csd-changes-button"
                        >
                          {t('consultantConfidentiality.clearExpiry', { defaultValue: 'Clear expiry' })}
                        </button>
                        <button
                          type="button"
                          onClick={() => saveSharing(doc, doc.deliverableId)}
                          disabled={confidentialityBusy === `sharing-${doc.id}`}
                          className="csd-changes-button"
                        >
                          {t('consultantConfidentiality.saveSharing', { defaultValue: 'Save sharing' })}
                        </button>
                      </div>
                      {visibility === 'limited' && (
                        <div className="csd-changes-pause-row">
                          {parties.map((party) => {
                            const selected = (shareDrafts[doc.id] ?? doc.sharedWith ?? []).includes(party.userId);
                            return (
                              <label key={party.userId} className="csd-deliverable-meta">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleShare(doc, party.userId)}
                                />
                                {' '}
                                {[party.firstName, party.lastName].filter(Boolean).join(' ') || party.email || party.userId}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* Group 10 Slice H (541-545): the closeout checklist,
              confirmations, follow-ups, feedback request, and archive.
              The admin confirms on the client's behalf only. */}
          <div className="csd-deliverables-section">
            <div className="csd-deliverables-title">{t('consultantCloseout.title')}</div>
            {closeoutLoading ? (
              <p className="csd-deliverables-note">{t('common.loading', { defaultValue: 'Loading…' })}</p>
            ) : !closeout ? (
              <p className="csd-deliverables-note">{t('consultantCloseout.loadError')}</p>
            ) : (
              <>
                {closeout.closeout?.closedAt && (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.closedNote')}</p>
                )}
                <ul className="csd-deliverable-docs">
                  {(closeout.checklist?.items || []).map((item) => (
                    <li key={item.key}>
                      {item.met ? '✓ ' : '• '}
                      {t(`consultantCloseout.item_${item.key}`)}
                      {' — '}
                      {item.required ? t('consultantCloseout.required') : t('consultantCloseout.recommended')}
                      {' — '}
                      {item.met ? t('consultantCloseout.met') : t('consultantCloseout.unmet')}
                    </li>
                  ))}
                </ul>
                {closeout.checklist?.archiveEligible ? (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.archiveEligible')}</p>
                ) : (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.archiveNotEligible')}</p>
                )}
                {session.status === 'completed' && !closeout.closeout?.clientConfirmedAt && (
                  <button type="button" onClick={confirmCloseoutForClient} disabled={closeoutBusy === 'confirm-client'} className="csd-changes-button">
                    {t('consultantCloseout.confirmForClient')}
                  </button>
                )}
                {closeout.closeout?.clientConfirmedAt && (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.confirmed')}</p>
                )}
                <div className="csd-deliverables-title">{t('consultantCloseout.feedbackTitle')}</div>
                {closeout.checklist?.items?.find((item) => item.key === 'feedback_received')?.met ? (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.feedbackReceived')}</p>
                ) : closeout.feedbackRequest ? (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.feedbackPending')}</p>
                ) : (
                  <p className="csd-deliverable-meta">{t('consultantCloseout.feedbackPending')}</p>
                )}
                {(closeout.followUps || []).filter((item) => item.status === 'scheduled').length > 0 && (
                  <>
                    <div className="csd-deliverables-title">{t('consultantCloseout.followUpTitle')}</div>
                    <ul className="csd-deliverable-docs">
                      {(closeout.followUps || []).filter((item) => item.status === 'scheduled').map((item) => (
                        <li key={item.id}>
                          {t(`consultantCloseout.followUpKind${item.kind === 'check_in' ? 'CheckIn' : item.kind === 'review' ? 'Review' : item.kind === 'renewal' ? 'Renewal' : 'Other'}`)}
                          {' • '}
                          {t('consultantCloseout.dueLabel', { date: String(item.dueAt).slice(0, 10) })}
                          {item.note ? ` • ${item.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {session.status === 'archived' ? (
                  <button type="button" onClick={unarchiveEngagement} disabled={closeoutBusy === 'unarchive'} className="csd-changes-button">
                    {t('consultantCloseout.unarchive')}
                  </button>
                ) : (
                  <button type="button" onClick={archiveEngagement} disabled={!closeout.checklist?.archiveEligible || closeoutBusy === 'archive'} className="csd-changes-button">
                    {t('consultantCloseout.archive')}
                  </button>
                )}
                <p className="csd-deliverable-meta">{t('consultantCloseout.archiveHint')}</p>
              </>
            )}
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Areas of Help</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {session.areas_of_help && session.areas_of_help.length > 0 ? (
                session.areas_of_help.map((area, idx) => (
                  <span key={idx} style={badgeStyle('var(--color-primary)')}>
                    {area.split('_').join(' ')}
                  </span>
                ))
              ) : (
                <p style={{ color: 'var(--color-text-muted)' }}>No areas selected</p>
              )}
            </div>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Scheduling Preference</div>
            <p><strong>Preferred Date:</strong> {session.preferred_date ? new Date(session.preferred_date).toLocaleDateString() : 'Not specified'}</p>
            <p><strong>Preferred Time:</strong> {session.preferred_time_slot || 'Not specified'}</p>
            <p><strong>Booking Confirmed:</strong> {session.booking_confirmed ? 'Yes' : 'No'}</p>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Update Status</div>
            <select
              style={inputStyle}
              value={session.status}
              onChange={e => {
                if (e.target.value === session.status) return;
                // Completion always goes through the confirmation dialog,
                // even when reached from this generic status select.
                if (e.target.value === 'completed') {
                  requestComplete();
                  return;
                }
                updateSessionStatus(session.id, e.target.value);
              }}
              disabled={updateLoading}
            >
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="archived">Archived</option>
            </select>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Internal Notes</div>
            <textarea
              style={{
                ...inputStyle,
                minHeight: '120px',
                fontFamily: 'monospace',
                fontSize: '0.9rem',
              }}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add internal notes about this consultation request..."
              disabled={notesLoading}
            />
            <button
              style={{
                ...buttonStyle,
                opacity: notesLoading ? 0.6 : 1,
                cursor: notesLoading ? 'not-allowed' : 'pointer',
              }}
              onClick={saveNotes}
              disabled={notesLoading}
            >
              {notesLoading ? 'Saving...' : 'Save Notes'}
            </button>
          </div>

          <div style={sectionStyle}>
            <div style={sectionTitleStyle}>Assign Consultant</div>
            {consultantsLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>Loading consultants...</p>
            ) : (
              <>
                <select
                  style={inputStyle}
                  value={selectedConsultant}
                  onChange={e => setSelectedConsultant(e.target.value)}
                  disabled={assigningConsultant}
                >
                  <option value="">Select a consultant...</option>
                  {consultants.map(consultant => (
                    <option key={consultant.id} value={consultant.id}>
                      {consultant.first_name} {consultant.last_name} ({consultant.role}) - {consultant.active_sessions} active
                    </option>
                  ))}
                </select>
                <button
                  style={{
                    ...buttonStyle,
                    marginTop: '0.5rem',
                    opacity: assigningConsultant || !selectedConsultant ? 0.6 : 1,
                    cursor: assigningConsultant || !selectedConsultant ? 'not-allowed' : 'pointer',
                  }}
                  onClick={assignConsultant}
                  disabled={assigningConsultant || !selectedConsultant}
                >
                  {assigningConsultant ? 'Assigning...' : 'Assign Consultant'}
                </button>
                {session.consultant_assigned_id && consultants.length > 0 && (
                  <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                    Currently assigned to: {consultants.find(c => c.id === session.consultant_assigned_id)?.first_name || 'Unknown'}
                  </p>
                )}
              </>
            )}
          </div>

          {session.status === 'scheduled' && (
            <div style={sectionStyle}>
              <div style={sectionTitleStyle}>Session Actions</div>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <button
                  style={{
                    ...buttonStyle,
                    backgroundColor: '#10B981',
                    opacity: updateLoading ? 0.6 : 1,
                    cursor: updateLoading ? 'not-allowed' : 'pointer',
                    flex: 1,
                    minWidth: '200px',
                  }}
                  onClick={requestComplete}
                  disabled={updateLoading}
                >
                  {updateLoading ? 'Processing...' : '✓ Mark Completed'}
                </button>
                <button
                  style={{
                    ...buttonStyle,
                    backgroundColor: '#EF4444',
                    opacity: updateLoading ? 0.6 : 1,
                    cursor: updateLoading ? 'not-allowed' : 'pointer',
                    flex: 1,
                    minWidth: '200px',
                  }}
                  onClick={requestNoShow}
                  disabled={updateLoading}
                >
                  {updateLoading ? 'Processing...' : '✗ Mark No-Show'}
                </button>
              </div>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                Mark completed if session happened. Mark no-show if customer didn't attend.
              </p>
              {scheduledDetail?.scheduled && ['confirmed', 'pending_confirmation'].includes(scheduledDetail.scheduled.status) && (
                <div className="csd-admin-cancel-wrap">
                  <button
                    className="csd-admin-cancel-btn"
                    onClick={requestCancel}
                    disabled={updateLoading}
                  >
                    {t('adminConsultingSessionDetail.cancelSession')}
                  </button>
                  <p className="csd-admin-cancel-hint">
                    {t('adminConsultingSessionDetail.cancelHint')}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--color-text-muted)',
            marginBottom: '1.5rem',
            paddingTop: '1rem',
            borderTop: '1px solid var(--color-border)',
          }}>
            <p>Submitted: {new Date(session.created_at).toLocaleString()}</p>
            {session.updated_at && (
              <p>Last Updated: {new Date(session.updated_at).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}

      {/* Action Items Tab */}
      {activeTab === 'action-items' && (
        <div id="action-items-panel">
          {session?.id && <ActionItemsPanel sessionId={session.id} isEditable={true} />}
        </div>
      )}

      {/* Close Button */}
      <button
        style={{
          ...buttonStyle,
          width: '100%',
        }}
        onClick={onClose}
      >
        {t('common.close')}
      </button>

      <ConfirmDialog
        open={confirmCompleteOpen}
        title={t('adminConsultingSessionDetail.confirm.complete')}
        onConfirm={confirmMarkSessionComplete}
        onClose={() => setConfirmCompleteOpen(false)}
      />

      <ConfirmDialog
        open={confirmNoShowOpen}
        title={t('adminConsultingSessionDetail.confirm.noShow')}
        onConfirm={confirmMarkSessionNoShow}
        onClose={() => setConfirmNoShowOpen(false)}
      />

      <ConfirmDialog
        open={confirmCancelOpen}
        title={t('adminConsultingSessionDetail.confirm.cancel')}
        danger
        requireReason
        onConfirm={confirmCancelSession}
        onClose={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}
