import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import axios from '../api/axios';

export default function ConsultingPortalPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [phases, setPhases] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      setLoading(true);
      const [sessionsRes, phasesRes, deliverablesRes] = await Promise.all([
        axios.get('/api/consulting/my-sessions'),
        axios.get('/api/consulting/phases'),
        axios.get('/api/consulting/deliverables'),
      ]).catch(() => [{ data: [] }, { data: [] }, { data: [] }]);

      const sessionsList = sessionsRes.data || [];
      setSessions(sessionsList);
      if (sessionsList.length > 0) {
        setSelectedSession(sessionsList[0]);
      }

      setPhases(phasesRes.data || []);
      setDeliverables(deliverablesRes.data || []);
    } catch (err) {
      console.error('Error loading consulting portal data', err);
    } finally {
      setLoading(false);
    }
  }

  const containerStyle = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem',
  };

  const headerStyle = {
    marginBottom: '2rem',
  };

  const tabsStyle = {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    borderBottom: '2px solid var(--color-border)',
    paddingBottom: '1rem',
  };

  const tabStyle = (isActive) => ({
    padding: '0.75rem 1.5rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : '400',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : 'none',
    fontSize: '1rem',
  });

  const cardStyle = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1rem',
  };

  const progressBarStyle = {
    width: '100%',
    height: '8px',
    background: 'var(--color-border)',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '0.5rem',
  };

  const progressFillStyle = (percentage) => ({
    height: '100%',
    width: `${percentage}%`,
    background: 'var(--color-primary)',
    transition: 'width 0.3s ease',
  });

  const phaseGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem',
  };

  const phaseBoxStyle = (isComplete) => ({
    padding: '1rem',
    border: isComplete ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
    borderRadius: '8px',
    textAlign: 'center',
    background: isComplete ? 'rgba(var(--color-primary-rgb), 0.1)' : 'var(--color-bg)',
    cursor: 'pointer',
  });

  const phaseNumberStyle = {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--color-primary)',
    marginBottom: '0.5rem',
  };

  const phaseNameStyle = {
    fontSize: '0.85rem',
    color: 'var(--color-text-muted)',
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={containerStyle}>
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={{ marginBottom: '0.5rem', fontSize: '2rem', fontWeight: '700' }}>
          {t('consulting.portal.title')}
        </h1>
        <p style={{ color: 'var(--color-text-muted)' }}>
          {t('consulting.portal.subtitle')}
        </p>
      </div>

      {/* Tabs */}
      <div style={tabsStyle}>
        <button
          style={tabStyle(activeTab === 'dashboard')}
          onClick={() => setActiveTab('dashboard')}
        >
          {t('consulting.portal.overview')}
        </button>
        <button
          style={tabStyle(activeTab === 'phases')}
          onClick={() => setActiveTab('phases')}
        >
          {t('consulting.portal.phases')}
        </button>
        <button
          style={tabStyle(activeTab === 'deliverables')}
          onClick={() => setActiveTab('deliverables')}
        >
          {t('consulting.portal.deliverables')}
        </button>
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div>
          {sessions.length > 0 ? (
            <>
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
                {t('consulting.portal.activeSessions')}
              </h2>
              <div>
                {sessions.map(session => (
                  <div key={session.id} style={cardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                      <div>
                        <h3 style={{ marginBottom: '0.5rem', fontSize: '1.25rem' }}>
                          {t('consulting.portal.sessionWith')} {session.consultant_name}
                        </h3>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                          {t('consulting.portal.tier')}: {session.service_tier}
                        </p>
                      </div>
                      <div style={{
                        padding: '0.5rem 1rem',
                        background: 'var(--color-bg)',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        fontWeight: '600',
                      }}>
                        {session.status}
                      </div>
                    </div>

                    <div style={{ marginBottom: '1rem' }}>
                      <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                        {t('consulting.portal.progress')}
                      </p>
                      <div style={progressBarStyle}>
                        <div style={progressFillStyle(session.current_phase * 3.33)} />
                      </div>
                      <p style={{ fontSize: '0.85rem', marginTop: '0.5rem', color: 'var(--color-text-muted)' }}>
                        {t('consulting.portal.phase')} {session.current_phase}/30
                      </p>
                    </div>

                    {session.scheduled_at && (
                      <div>
                        <p style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                          <strong>{t('consulting.portal.nextSession')}:</strong>{' '}
                          {new Date(session.scheduled_at).toLocaleString()}
                        </p>
                        {session.meeting_url && (
                          <a
                            href={session.meeting_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              display: 'inline-block',
                              padding: '0.5rem 1rem',
                              background: 'var(--color-primary)',
                              color: 'white',
                              borderRadius: '4px',
                              textDecoration: 'none',
                              fontSize: '0.9rem',
                              fontWeight: '600',
                              marginTop: '0.5rem',
                            }}
                          >
                            {t('consulting.portal.joinMeeting')}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>
              {t('consulting.portal.noSessions')}
            </p>
          )}
        </div>
      )}

      {/* Phases Tab */}
      {activeTab === 'phases' && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
            {t('consulting.portal.businessPhases')}
          </h2>
          <p style={{ marginBottom: '2rem', color: 'var(--color-text-muted)' }}>
            {t('consulting.portal.phasesDescription')}
          </p>

          <div style={phaseGridStyle}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map(num => (
              <div key={num} style={phaseBoxStyle(selectedSession?.current_phase >= num)}>
                <div style={phaseNumberStyle}>{num}</div>
                <div style={phaseNameStyle}>
                  {t('consulting.portal.phase')}
                </div>
              </div>
            ))}
          </div>

          {selectedSession && (
            <div style={cardStyle}>
              <h3 style={{ marginBottom: '1rem' }}>
                {t('consulting.portal.currentPhase')} {selectedSession.current_phase}
              </h3>
              <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                {t('consulting.portal.phaseDetails')}
              </p>
              <div style={{
                padding: '1rem',
                background: 'var(--color-bg)',
                borderRadius: '4px',
              }}>
                <p>{t('consulting.portal.phase')} {selectedSession.current_phase} {t('consulting.portal.progressUpdate')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deliverables Tab */}
      {activeTab === 'deliverables' && (
        <div>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: '600' }}>
            {t('consulting.portal.deliverables')}
          </h2>

          {deliverables.length > 0 ? (
            <div>
              {deliverables.map(deliverable => (
                <div key={deliverable.id} style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div>
                      <h3 style={{ marginBottom: '0.5rem', fontSize: '1.1rem' }}>
                        {deliverable.title}
                      </h3>
                      <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
                        {deliverable.description}
                      </p>
                    </div>
                    <div style={{
                      padding: '0.25rem 0.75rem',
                      background: 'var(--color-bg)',
                      borderRadius: '4px',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      whiteSpace: 'nowrap',
                    }}>
                      {deliverable.status}
                    </div>
                  </div>

                  {deliverable.file_url && (
                    <a
                      href={deliverable.file_url}
                      download
                      style={{
                        display: 'inline-block',
                        padding: '0.5rem 1rem',
                        background: 'var(--color-primary)',
                        color: 'white',
                        borderRadius: '4px',
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        fontWeight: '600',
                      }}
                    >
                      {t('consulting.portal.download')}
                    </a>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: 'var(--color-text-muted)' }}>
              {t('consulting.portal.noDeliverables')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
