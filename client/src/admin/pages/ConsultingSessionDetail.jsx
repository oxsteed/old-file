import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

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

  async function updateSessionStatus(sessionId, newStatus) {
    try {
      setUpdateLoading(true);
      await axios.patch(`/api/consulting/admin/sessions/${sessionId}`, {
        status: newStatus,
      });
      toast.success('Status updated successfully');
      onStatusUpdate();
      onClose();
    } catch (err) {
      toast.error('Failed to update status');
    } finally {
      setUpdateLoading(false);
    }
  }

  async function saveNotes() {
    if (!notes.trim()) {
      toast.error('Please enter a note');
      return;
    }

    try {
      setNotesLoading(true);
      await axios.patch(`/api/consulting/admin/sessions/${session.id}`, {
        notes: notes,
      });
      toast.success('Notes saved successfully');
      onStatusUpdate();
    } catch (err) {
      toast.error('Failed to save notes');
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

      {/* Content */}
      <div style={sectionStyle}>
        <div style={sectionTitleStyle}>Contact Information</div>
        <p><strong>Email:</strong> {session.email}</p>
        <p><strong>Phone:</strong> {session.phone || '—'}</p>
        <p><strong>Business Name:</strong> {session.business_name || '—'}</p>
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
