import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import axios from '../api/axios';

export default function ConsultingFullPortal() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({
    sessions: [],
    purchases: [],
    phases: {},
    deliverables: [],
    actionItems: [],
    packages: [],
    feedback: null,
    analytics: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPortalData();
  }, []);

  async function loadPortalData() {
    try {
      setLoading(true);
      const [dashResponse, packagesResponse] = await Promise.all([
        axios.get('/consulting/portal/dashboard'),
        axios.get('/consulting/packages'),
      ]);

      setData(prev => ({
        ...prev,
        sessions: dashResponse.data.sessions || [],
        purchases: dashResponse.data.purchases || [],
        packages: packagesResponse.data || [],
      }));
    } catch (err) {
      // Error loading data - will show in empty state
    } finally {
      setLoading(false);
    }
  }

  const containerStyle = {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '2rem',
  };

  const tabStyle = {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    borderBottom: '1px solid var(--color-border)',
  };

  const tabButtonStyle = (isActive) => ({
    padding: '0.75rem 1.5rem',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : 'none',
    fontWeight: isActive ? 600 : 400,
    fontSize: '1rem',
  });

  const cardStyle = {
    background: 'var(--color-bg)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1rem',
  };

  if (loading) {
    return <div style={containerStyle}>{t('common.loading')}</div>;
  }

  return (
    <div style={containerStyle}>
      <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 700 }}>
        {t('consulting.portalTitle')} 🚀
      </h1>

      {/* Tab Navigation */}
      <div style={tabStyle}>
        {['dashboard', 'phases', 'deliverables', 'packages', 'feedback', 'analytics'].map(tab => (
          <button
            key={tab}
            style={tabButtonStyle(activeTab === tab)}
            onClick={() => setActiveTab(tab)}
          >
            {t(`consulting.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            {t('consulting.activeSessions')}
          </h2>
          {data.sessions.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.noSessions')}</p>
          ) : (
            data.sessions.map(session => (
              <div key={session.id} style={cardStyle}>
                <h3 style={{ margin: '0 0 0.5rem' }}>{session.business_name || session.email}</h3>
                <p style={{ margin: '0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  Tier: <strong>{session.service_tier}</strong> | Status: <strong>{session.status}</strong>
                </p>
                {session.scheduled_date && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                    📅 {session.scheduled_date} at {session.scheduled_time}
                  </p>
                )}
                {session.current_phase && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <p style={{ margin: 0, fontSize: '0.9rem' }}>Phase: {session.current_phase}/30</p>
                    <div style={{ background: 'var(--color-border)', height: '4px', borderRadius: '2px', marginTop: '0.5rem' }}>
                      <div
                        style={{
                          background: 'var(--color-primary)',
                          height: '100%',
                          width: `${(session.progress_pct || 0)}%`,
                          borderRadius: '2px',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <h2 style={{ fontSize: '1.5rem', margin: '2rem 0 1rem', fontWeight: 600 }}>
            {t('consulting.activePackages')}
          </h2>
          {data.purchases.length === 0 ? (
            <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.noPackages')}</p>
          ) : (
            data.purchases.map(purchase => (
              <div key={purchase.id} style={cardStyle}>
                <h3 style={{ margin: '0 0 0.5rem' }}>{purchase.name}</h3>
                <p style={{ margin: '0', fontSize: '0.9rem' }}>
                  Sessions: {purchase.sessions_used}/{purchase.sessions_remaining + purchase.sessions_used}
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* Phases Tab */}
      {activeTab === 'phases' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            Business Ascension Phases
          </h2>
          <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
            {t('consulting.phaseDescription')}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '1rem' }}>
            {Array.from({ length: 30 }, (_, i) => i + 1).map(phase => {
              const currentPhase = data.sessions[0]?.current_phase || 0;
              const isCompleted = phase < currentPhase;
              const isCurrent = phase === currentPhase;
              return (
                <div
                  key={phase}
                  style={{
                    padding: '1rem',
                    borderRadius: '8px',
                    background: isCompleted ? 'var(--color-primary)' : isCurrent ? 'var(--color-secondary)' : 'var(--color-bg)',
                    border: '1px solid var(--color-border)',
                    textAlign: 'center',
                    cursor: 'pointer',
                    color: isCompleted || isCurrent ? 'white' : 'var(--color-text)',
                    fontWeight: isCurrent ? 600 : 400,
                  }}
                >
                  Phase {phase}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Deliverables Tab */}
      {activeTab === 'deliverables' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            {t('consulting.deliverables')}
          </h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.deliverableDescription')}</p>
          <div style={{ marginTop: '1.5rem' }}>
            <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.noDeliverables')}</p>
          </div>
        </div>
      )}

      {/* Packages Tab */}
      {activeTab === 'packages' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            {t('consulting.availablePackages')}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2rem' }}>
            {data.packages.map(pkg => (
              <div key={pkg.id} style={{ ...cardStyle, border: '2px solid var(--color-primary)' }}>
                <h3 style={{ margin: '0 0 0.5rem', color: 'var(--color-primary)' }}>{pkg.name}</h3>
                <p style={{ margin: '0.5rem 0', fontSize: '2rem', fontWeight: 700 }}>
                  ${(pkg.price_cents / 100).toFixed(2)}
                </p>
                <p style={{ margin: '0.5rem 0', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  {pkg.session_count} sessions | {pkg.duration_hours || 'N/A'} hours
                </p>
                <p style={{ margin: '1rem 0 0', fontSize: '0.85rem' }}>{pkg.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feedback Tab */}
      {activeTab === 'feedback' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            {t('consulting.sessionFeedback')}
          </h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.feedbackDescription')}</p>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', fontWeight: 600 }}>
            {t('consulting.analytics')}
          </h2>
          <p style={{ color: 'var(--color-text-muted)' }}>{t('consulting.analyticsDescription')}</p>
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--color-bg)', borderRadius: '8px' }}>
            <p style={{ margin: 0 }}>📊 {t('consulting.trackingProgress')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
