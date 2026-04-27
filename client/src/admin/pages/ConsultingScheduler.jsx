import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from '../../api/axios';
import toast from 'react-hot-toast';

export default function ConsultingScheduler() {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [showScheduler, setShowScheduler] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const timeSlots = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '13:00', '13:30', '14:00', '14:30', '15:00', '15:30',
    '16:00', '16:30', '17:00'
  ];

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      setLoading(true);
      const res = await axios.get('/consulting/admin/requests');
      setSessions(res.data.requests || []);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  async function scheduleSession() {
    if (!selectedSession || !selectedDate || !selectedTime) {
      toast.error(t('consulting.scheduler.selectAll'));
      return;
    }

    try {
      setSaving(true);
      const scheduledDateTime = new Date(`${selectedDate}T${selectedTime}`);

      await axios.patch(
        `/consulting/admin/requests/${selectedSession.id}/status`,
        {
          status: 'scheduled',
          scheduled_at: scheduledDateTime.toISOString(),
          meeting_url: meetingUrl
        }
      );

      toast.success(t('consulting.scheduler.scheduleSuccess'));
      setShowScheduler(false);
      setSelectedSession(null);
      setSelectedDate(null);
      setSelectedTime(null);
      setMeetingUrl('');
      loadSessions();
    } catch (err) {
      toast.error(t('consulting.scheduler.scheduleError') || 'Failed to schedule session');
    } finally {
      setSaving(false);
    }
  }

  const containerStyle = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem',
  };

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '2rem',
    marginBottom: '2rem',
  };

  const cardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '2rem',
    cursor: 'pointer',
    transition: 'border-color 0.3s',
  };

  const selectedCardStyle = {
    ...cardStyle,
    borderColor: 'var(--color-primary)',
    background: 'rgba(var(--color-primary-rgb), 0.05)',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '2rem',
  };

  const thStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    textAlign: 'left',
    borderBottom: '2px solid var(--color-border)',
    fontWeight: '600',
  };

  const tdStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
  };

  const buttonStyle = {
    background: 'var(--color-primary)',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    padding: '0.75rem 1.5rem',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '600',
    marginRight: '0.5rem',
  };

  const modalStyle = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const modalContentStyle = {
    background: 'var(--color-surface)',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '600px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
  };

  const sectionStyle = {
    marginBottom: '2rem',
  };

  const labelStyle = {
    display: 'block',
    fontWeight: '600',
    marginBottom: '0.5rem',
    marginTop: '1rem',
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    fontSize: '0.95rem',
    boxSizing: 'border-box',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
  };

  const timeGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '0.5rem',
    marginTop: '0.5rem',
  };

  const timeButtonStyle = (isSelected) => ({
    padding: '0.5rem',
    border: isSelected ? 'none' : '1px solid var(--color-border)',
    borderRadius: '4px',
    background: isSelected ? 'var(--color-primary)' : 'var(--color-bg)',
    color: isSelected ? 'white' : 'var(--color-text)',
    cursor: 'pointer',
    fontSize: '0.85rem',
  });

  const pendingSessions = sessions.filter(s => s.status === 'pending');
  const scheduledSessions = sessions.filter(s => s.status === 'scheduled');

  if (loading) {
    return (
      <div style={containerStyle}>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: '700' }}>
        {t('consulting.scheduler.title')}
      </h1>

      {/* Pending Sessions Section */}
      <div>
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
          {t('consulting.scheduler.pendingSessions')} ({pendingSessions.length})
        </h2>

        {pendingSessions.length > 0 ? (
          <div style={gridStyle}>
            {pendingSessions.map(session => (
              <div
                key={session.id}
                style={selectedSession?.id === session.id ? selectedCardStyle : cardStyle}
                onClick={() => {
                  setSelectedSession(session);
                  setShowScheduler(true);
                }}
              >
                <h3 style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>
                  {session.first_name} {session.last_name}
                </h3>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                  {session.email}
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>{t('consulting.serviceTier')}:</strong> {session.service_tier}
                </p>
                <p style={{ marginBottom: '0.5rem' }}>
                  <strong>{t('consulting.phone')}:</strong> {session.phone || t('common.na')}
                </p>
                <button style={buttonStyle} onClick={(e) => {
                  e.stopPropagation();
                  setSelectedSession(session);
                  setShowScheduler(true);
                }}>
                  {t('consulting.scheduler.schedule')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>
            {t('consulting.scheduler.noPending')}
          </p>
        )}
      </div>

      {/* Scheduled Sessions Section */}
      <div style={{ marginTop: '3rem' }}>
        <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
          {t('consulting.scheduler.scheduledSessions')} ({scheduledSessions.length})
        </h2>

        {scheduledSessions.length > 0 ? (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>{t('consulting.scheduler.client')}</th>
                <th style={thStyle}>{t('consulting.scheduler.email')}</th>
                <th style={thStyle}>{t('consulting.scheduler.scheduledDate')}</th>
                <th style={thStyle}>{t('consulting.scheduler.meetingUrl')}</th>
              </tr>
            </thead>
            <tbody>
              {scheduledSessions.map(session => (
                <tr key={session.id}>
                  <td style={tdStyle}>
                    {session.first_name} {session.last_name}
                  </td>
                  <td style={tdStyle}>{session.email}</td>
                  <td style={tdStyle}>
                    {session.scheduled_at
                      ? new Date(session.scheduled_at).toLocaleString()
                      : t('common.na')}
                  </td>
                  <td style={tdStyle}>
                    {session.meeting_url ? (
                      <a href={session.meeting_url} target="_blank" rel="noopener noreferrer">
                        {t('consulting.scheduler.joinMeeting')}
                      </a>
                    ) : (
                      t('common.na')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>
            {t('consulting.scheduler.noScheduled')}
          </p>
        )}
      </div>

      {/* Schedule Modal */}
      {showScheduler && selectedSession && (
        <div style={modalStyle}>
          <div style={modalContentStyle}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
              {t('consulting.scheduler.scheduleFor')} {selectedSession.first_name}{' '}
              {selectedSession.last_name}
            </h2>

            <div style={sectionStyle}>
              <label style={labelStyle}>{t('consulting.scheduler.selectDate')}</label>
              <input
                type="date"
                value={selectedDate || ''}
                onChange={(e) => setSelectedDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>{t('consulting.scheduler.selectTime')}</label>
              <div style={timeGridStyle}>
                {timeSlots.map(time => (
                  <button
                    key={time}
                    style={timeButtonStyle(selectedTime === time)}
                    onClick={() => setSelectedTime(time)}
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>

            <div style={sectionStyle}>
              <label style={labelStyle}>{t('consulting.scheduler.meetingUrl')}</label>
              <input
                type="text"
                placeholder="https://zoom.us/j/..."
                value={meetingUrl}
                onChange={(e) => setMeetingUrl(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
              <button
                style={buttonStyle}
                onClick={scheduleSession}
                disabled={saving}
              >
                {saving ? t('common.sending') : t('consulting.scheduler.confirm')}
              </button>
              <button
                style={{
                  ...buttonStyle,
                  background: 'var(--color-border)',
                  color: 'var(--color-text)',
                }}
                onClick={() => {
                  setShowScheduler(false);
                  setSelectedDate(null);
                  setSelectedTime(null);
                  setMeetingUrl('');
                }}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
