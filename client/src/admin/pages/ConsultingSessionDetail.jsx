import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';
import ActionItemsPanel from '../../components/ActionItemsPanel';

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
  const [consultants, setConsultants] = useState([]);
  const [consultantsLoading, setConsultantsLoading] = useState(false);
  const [selectedConsultant, setSelectedConsultant] = useState(session.consultant_assigned_id || '');
  const [assigningConsultant, setAssigningConsultant] = useState(false);

  useEffect(() => {
    fetchConsultants();
  }, []);

  async function fetchConsultants() {
    try {
      setConsultantsLoading(true);
      const response = await axios.get('/consulting/admin/consultants');
      setConsultants(response.data);
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.loadConsultantsFailed'));
    } finally {
      setConsultantsLoading(false);
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

  async function markSessionComplete() {
    if (!window.confirm(t('adminConsultingSessionDetail.confirm.complete'))) {
      return;
    }

    try {
      setUpdateLoading(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}/complete`);
      toast.success(t('adminConsultingSessionDetail.toast.markedComplete'));
      onStatusUpdate();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.markCompleteFailed'));
    } finally {
      setUpdateLoading(false);
    }
  }

  async function markSessionNoShow() {
    if (!window.confirm(t('adminConsultingSessionDetail.confirm.noShow'))) {
      return;
    }

    try {
      setUpdateLoading(true);
      await axios.patch(`/consulting/admin/sessions/${session.id}/no-show`);
      toast.success(t('adminConsultingSessionDetail.toast.markedNoShow'));
      onStatusUpdate();
    } catch (err) {
      toast.error(t('adminConsultingSessionDetail.toast.markNoShowFailed'));
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
              defaultValue={session.status}
              onChange={e => {
                if (e.target.value !== session.status) {
                  updateSessionStatus(session.id, e.target.value);
                }
              }}
              disabled={updateLoading}
            >
              <option value="pending">Pending</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
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
                  onClick={markSessionComplete}
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
                  onClick={markSessionNoShow}
                  disabled={updateLoading}
                >
                  {updateLoading ? 'Processing...' : '✗ Mark No-Show'}
                </button>
              </div>
              <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                Mark completed if session happened. Mark no-show if customer didn't attend.
              </p>
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
        Close
      </button>
    </div>
  );
}
