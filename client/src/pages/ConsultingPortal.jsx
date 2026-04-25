import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import axios from '../api/axios';
import ConsultingPaymentModal from '../components/ConsultingPaymentModal';

export default function ConsultingPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('sessions');
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  useEffect(() => {
    loadUserSessions();
  }, []);

  const loadUserSessions = async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/consulting/my-sessions');
      setSessions(response.data);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const pageStyle = {
    padding: '2rem',
    background: 'var(--color-bg)',
    minHeight: '100vh',
  };

  const titleStyle = {
    fontSize: '2rem',
    fontWeight: 'bold',
    marginBottom: '2rem',
    color: 'var(--color-text)',
  };

  const tabsStyle = {
    display: 'flex',
    gap: '1rem',
    marginBottom: '2rem',
    borderBottom: '2px solid var(--color-border)',
  };

  const tabStyle = (isActive) => ({
    padding: '1rem 1.5rem',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : '500',
    color: isActive ? 'var(--color-primary)' : 'var(--color-text)',
    borderBottom: isActive ? '3px solid var(--color-primary)' : 'none',
    marginBottom: '-2px',
    transition: 'all 0.2s',
  });

  const sessionCardStyle = {
    background: 'var(--color-surface)',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '1.5rem',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
    borderLeft: '4px solid var(--color-primary)',
  };

  const sessionTitleStyle = {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: 'var(--color-text)',
  };

  const sessionMetaStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    marginBottom: '1rem',
  };

  const metaItemStyle = {
    background: 'var(--color-bg)',
    padding: '0.75rem',
    borderRadius: '6px',
  };

  const metaLabelStyle = {
    fontSize: '0.75rem',
    color: 'var(--color-text-muted)',
    marginBottom: '0.25rem',
  };

  const metaValueStyle = {
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--color-text)',
  };

  const statusBadgeStyle = (status) => {
    const colors = {
      pending: '#f59e0b',
      scheduled: '#3b82f6',
      completed: '#10b981',
      cancelled: '#6b7280',
    };

    return {
      display: 'inline-block',
      padding: '0.5rem 1rem',
      borderRadius: '6px',
      background: colors[status] || colors.pending,
      color: 'white',
      fontWeight: '600',
      fontSize: '0.875rem',
    };
  };

  const sectionTitleStyle = {
    fontSize: '1.1rem',
    fontWeight: '600',
    marginTop: '1.5rem',
    marginBottom: '1rem',
    color: 'var(--color-text)',
  };

  const itemListStyle = {
    background: 'var(--color-bg)',
    borderRadius: '8px',
    overflow: 'hidden',
  };

  const itemStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'start',
  };

  const itemLastStyle = {
    ...itemStyle,
    borderBottom: 'none',
  };

  const emptyStateStyle = {
    textAlign: 'center',
    padding: '3rem 1rem',
    color: 'var(--color-text-muted)',
  };

  const progressBarStyle = {
    height: '8px',
    background: 'var(--color-border)',
    borderRadius: '4px',
    overflow: 'hidden',
    marginTop: '0.5rem',
  };

  const progressFillStyle = (percentage) => ({
    height: '100%',
    background: 'var(--color-primary)',
    width: `${Math.min(percentage, 100)}%`,
    transition: 'width 0.3s',
  });

  if (loading) {
    return <div style={pageStyle}>{t('common.loading') || 'Loading...'}</div>;
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{t('portal.myConsultingSessions') || 'My Consulting Sessions'}</h1>

      <div style={tabsStyle}>
        <div style={tabStyle(activeTab === 'sessions')} onClick={() => setActiveTab('sessions')}>
          {t('portal.sessions') || 'Sessions'}
        </div>
        <div style={tabStyle(activeTab === 'actionItems')} onClick={() => setActiveTab('actionItems')}>
          {t('portal.actionItems') || 'Action Items'}
        </div>
        <div style={tabStyle(activeTab === 'progress')} onClick={() => setActiveTab('progress')}>
          {t('portal.progress') || 'Progress'}
        </div>
        <div style={tabStyle(activeTab === 'packages')} onClick={() => setActiveTab('packages')}>
          {t('payment.purchaseConsulting') || 'Purchase Package'}
        </div>
      </div>

      {/* SESSIONS TAB */}
      {activeTab === 'sessions' && (
        <>
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <div key={session.id} style={sessionCardStyle}>
                <div style={sessionTitleStyle}>
                  {t('portal.sessionWith') || 'Session with'} {session.consultant_first_name} {session.consultant_last_name}
                </div>

                <div style={statusBadgeStyle(session.status)}>
                  {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                </div>

                <div style={sessionMetaStyle}>
                  <div style={metaItemStyle}>
                    <div style={metaLabelStyle}>{t('portal.serviceTier') || 'Service Tier'}</div>
                    <div style={metaValueStyle}>{session.service_tier}</div>
                  </div>

                  {session.scheduled_date && (
                    <div style={metaItemStyle}>
                      <div style={metaLabelStyle}>{t('portal.date') || 'Date'}</div>
                      <div style={metaValueStyle}>
                        {new Date(session.scheduled_date).toLocaleDateString()}
                      </div>
                    </div>
                  )}

                  {session.scheduled_time && (
                    <div style={metaItemStyle}>
                      <div style={metaLabelStyle}>{t('portal.time') || 'Time'}</div>
                      <div style={metaValueStyle}>{session.scheduled_time}</div>
                    </div>
                  )}

                  <div style={metaItemStyle}>
                    <div style={metaLabelStyle}>{t('portal.requestedAreas') || 'Areas Requested'}</div>
                    <div style={metaValueStyle}>{session.areas_of_help?.length || 0}</div>
                  </div>
                </div>

                {session.meeting_link && session.status === 'scheduled' && (
                  <div style={{ marginTop: '1rem' }}>
                    <a
                      href={session.meeting_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-block',
                        padding: '0.75rem 1.5rem',
                        background: 'var(--color-primary)',
                        color: 'white',
                        borderRadius: '6px',
                        textDecoration: 'none',
                        fontWeight: '600',
                        transition: 'opacity 0.2s',
                      }}
                      onMouseEnter={(e) => (e.target.style.opacity = '0.8')}
                      onMouseLeave={(e) => (e.target.style.opacity = '1')}
                    >
                      {t('portal.joinMeeting') || 'Join Meeting'}
                    </a>
                  </div>
                )}

                {session.description && (
                  <div style={{ marginTop: '1.5rem' }}>
                    <div style={sectionTitleStyle}>{t('portal.description') || 'Your Request'}</div>
                    <p style={{ color: 'var(--color-text-muted)', lineHeight: '1.6' }}>{session.description}</p>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div style={emptyStateStyle}>
              <p>{t('portal.noSessions') || 'You have no consulting sessions yet'}</p>
              <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                {t('portal.startOne') || 'Ready to get started? Contact a consultant today!'}
              </p>
            </div>
          )}
        </>
      )}

      {/* ACTION ITEMS TAB */}
      {activeTab === 'actionItems' && (
        <>
          {sessions.length > 0 && sessions.some((s) => s.action_items?.length) ? (
            sessions
              .filter((s) => s.action_items?.length)
              .map((session) => (
                <div key={session.id}>
                  <h3 style={sectionTitleStyle}>
                    {t('portal.itemsFromSession') || 'From'} {session.consultant_first_name} {session.consultant_last_name}
                  </h3>
                  <div style={itemListStyle}>
                    {session.action_items.map((item, idx) => (
                      <div key={item.id} style={idx === session.action_items.length - 1 ? itemLastStyle : itemStyle}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '600', color: 'var(--color-text)' }}>
                            {item.title}
                          </div>
                          {item.description && (
                            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                              {item.description}
                            </p>
                          )}
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                            {item.due_date && `${t('portal.due') || 'Due'}: ${new Date(item.due_date).toLocaleDateString()}`}
                            {item.priority && ` • ${t('actionItems.priority.' + item.priority) || item.priority}`}
                          </div>
                        </div>
                        <div style={{ marginLeft: '1rem' }}>
                          <input
                            type="checkbox"
                            checked={item.completed || false}
                            disabled
                            style={{
                              width: '20px',
                              height: '20px',
                              cursor: 'not-allowed',
                              opacity: 0.5,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
          ) : (
            <div style={emptyStateStyle}>
              <p>{t('portal.noActionItems') || 'No action items assigned yet'}</p>
            </div>
          )}
        </>
      )}

      {/* PROGRESS TAB */}
      {activeTab === 'progress' && (
        <>
          {sessions.length > 0 ? (
            <div>
              <h3 style={sectionTitleStyle}>{t('portal.consultingProgress') || 'Consulting Progress'}</h3>

              <div style={sessionCardStyle}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ marginBottom: '0.5rem', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('portal.completedSessions') || 'Completed Sessions'}
                  </div>
                  <div style={progressBarStyle}>
                    <div
                      style={progressFillStyle(
                        (sessions.filter((s) => s.status === 'completed').length / sessions.length) * 100
                      )}
                    />
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                    {sessions.filter((s) => s.status === 'completed').length} / {sessions.length}
                  </div>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ marginBottom: '0.5rem', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('portal.actionItemsCompleted') || 'Action Items Completed'}
                  </div>
                  <div style={progressBarStyle}>
                    <div
                      style={progressFillStyle(
                        sessions.reduce((sum, s) => sum + (s.action_items?.filter((ai) => ai.completed).length || 0), 0) /
                          Math.max(sessions.reduce((sum, s) => sum + (s.action_items?.length || 0), 0), 1) *
                          100
                      )}
                    />
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                    {sessions.reduce((sum, s) => sum + (s.action_items?.filter((ai) => ai.completed).length || 0), 0)} /{' '}
                    {sessions.reduce((sum, s) => sum + (s.action_items?.length || 0), 0)}
                  </div>
                </div>

                <div>
                  <div style={{ marginBottom: '0.5rem', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('portal.nextSession') || 'Next Scheduled Session'}
                  </div>
                  {sessions.find((s) => s.status === 'scheduled') ? (
                    <div style={{ color: 'var(--color-text)' }}>
                      {(() => {
                        const nextSession = sessions.find((s) => s.status === 'scheduled');
                        return `${nextSession.scheduled_date ? new Date(nextSession.scheduled_date).toLocaleDateString() : 'TBD'} at ${
                          nextSession.scheduled_time || 'TBD'
                        } with ${nextSession.consultant_first_name} ${nextSession.consultant_last_name}`;
                      })()}
                    </div>
                  ) : (
                    <div style={{ color: 'var(--color-text-muted)' }}>
                      {t('portal.noUpcomingSessions') || 'No upcoming sessions'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={emptyStateStyle}>
              <p>{t('portal.noProgress') || 'Start a session to track your progress'}</p>
            </div>
          )}
        </>
      )}

      {/* PACKAGES TAB */}
      {activeTab === 'packages' && (
        <>
          {sessions.length > 0 ? (
            <div>
              <h3 style={sectionTitleStyle}>{t('payment.purchaseConsulting') || 'Purchase Consulting Package'}</h3>
              <p style={{ marginBottom: '1.5rem', color: 'var(--color-text-muted)' }}>
                {t('portal.selectSessionAndPackage') || 'Select a session and choose a package to get started.'}
              </p>

              <div style={sessionCardStyle}>
                <h4 style={{ marginBottom: '1rem', fontWeight: '600', color: 'var(--color-text)' }}>
                  {t('portal.chooseSession') || 'Select Your Session'}
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '1rem' }}>
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      style={{
                        padding: '1rem',
                        border: '1px solid var(--color-border)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        background: selectedSessionId === session.id ? 'var(--color-primary)' : 'var(--color-bg)',
                        color: selectedSessionId === session.id ? 'white' : 'var(--color-text)',
                      }}
                      onClick={() => setSelectedSessionId(session.id)}
                      onMouseEnter={(e) => {
                        if (selectedSessionId !== session.id) {
                          e.currentTarget.style.borderColor = 'var(--color-primary)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedSessionId !== session.id) {
                          e.currentTarget.style.borderColor = 'var(--color-border)';
                        }
                      }}
                    >
                      <div style={{ fontWeight: '600' }}>
                        {session.consultant_first_name} {session.consultant_last_name}
                      </div>
                      <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.8 }}>
                        {t('portal.serviceTier') || 'Service Tier'}: {session.service_tier}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedSessionId && (
                <div style={{ marginTop: '1.5rem' }}>
                  <button
                    onClick={() => setPaymentModalOpen(true)}
                    style={{
                      padding: '0.75rem 2rem',
                      background: 'var(--color-primary)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      transition: 'opacity 0.2s',
                    }}
                    onMouseEnter={(e) => (e.target.style.opacity = '0.8')}
                    onMouseLeave={(e) => (e.target.style.opacity = '1')}
                  >
                    {t('payment.pay') || 'Select Package & Pay'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={emptyStateStyle}>
              <p>{t('portal.noSessions') || 'You have no consulting sessions yet'}</p>
              <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>
                {t('portal.scheduleSessionFirst') || 'Schedule a session first to purchase a package.'}
              </p>
            </div>
          )}
        </>
      )}

      {/* Payment Modal */}
      <ConsultingPaymentModal
        sessionId={selectedSessionId}
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        onSuccess={() => {
          setPaymentModalOpen(false);
          setSelectedSessionId(null);
          loadUserSessions();
        }}
      />
    </div>
  );
}
