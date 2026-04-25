import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import consultingAnalyticsApi from '../../api/consultingAnalytics';

export default function ConsultingAnalyticsDashboard() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [platformStats, setPlatformStats] = useState(null);
  const [topConsultants, setTopConsultants] = useState([]);
  const [conversionFunnel, setConversionFunnel] = useState([]);
  const [feedbackTrends, setFeedbackTrends] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');

  // Load all analytics on mount
  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      const [stats, consultants, funnel, trends] = await Promise.all([
        consultingAnalyticsApi.getPlatformStats(),
        consultingAnalyticsApi.getTopConsultants(10, 3),
        consultingAnalyticsApi.getConversionFunnel(30),
        consultingAnalyticsApi.getFeedbackTrends(12),
      ]);

      setPlatformStats(stats.data);
      setTopConsultants(consultants.data);
      setConversionFunnel(funnel.data);
      setFeedbackTrends(trends.data);
    } catch (err) {
      toast.error(t('common.errorLoading') || 'Failed to load analytics');
      console.error('Failed to load analytics', err);
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

  const statsGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem',
  };

  const statCardStyle = {
    background: 'var(--color-surface)',
    padding: '1.5rem',
    borderRadius: '12px',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
  };

  const statLabelStyle = {
    fontSize: '0.875rem',
    color: 'var(--color-text-muted)',
    marginBottom: '0.5rem',
  };

  const statValueStyle = {
    fontSize: '2rem',
    fontWeight: 'bold',
    color: 'var(--color-text)',
  };

  const sectionTitleStyle = {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    marginBottom: '1.5rem',
    marginTop: '2rem',
    color: 'var(--color-text)',
  };

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'var(--color-surface)',
    borderRadius: '12px',
    overflow: 'hidden',
  };

  const tableHeaderStyle = {
    background: 'var(--color-bg)',
    padding: '1rem',
    textAlign: 'left',
    fontWeight: '600',
    borderBottom: '2px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const tableCellStyle = {
    padding: '1rem',
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  const chartContainerStyle = {
    background: 'var(--color-surface)',
    padding: '2rem',
    borderRadius: '12px',
    marginBottom: '2rem',
    minHeight: '300px',
  };

  const chartBarStyle = (percentage) => ({
    height: '20px',
    background: 'linear-gradient(to right, var(--color-primary), var(--color-primary))',
    borderRadius: '4px',
    width: `${Math.min(percentage, 100)}%`,
    transition: 'width 0.3s',
  });

  const ratingStyle = (rating) => {
    let color = '#ef4444'; // red
    if (rating >= 4.5) color = '#10b981'; // green
    else if (rating >= 4) color = '#3b82f6'; // blue
    else if (rating >= 3) color = '#f59e0b'; // amber

    return {
      color,
      fontWeight: 'bold',
      fontSize: '1.1rem',
    };
  };

  if (loading) {
    return <div style={pageStyle}>{t('common.loading') || 'Loading...'}</div>;
  }

  return (
    <div style={pageStyle}>
      <h1 style={titleStyle}>{t('analytics.consultingAnalytics') || 'Consulting Analytics Dashboard'}</h1>

      <div style={tabsStyle}>
        <div style={tabStyle(activeTab === 'overview')} onClick={() => setActiveTab('overview')}>
          {t('analytics.overview') || 'Overview'}
        </div>
        <div style={tabStyle(activeTab === 'consultants')} onClick={() => setActiveTab('consultants')}>
          {t('analytics.consultants') || 'Consultants'}
        </div>
        <div style={tabStyle(activeTab === 'conversion')} onClick={() => setActiveTab('conversion')}>
          {t('analytics.conversion') || 'Conversion'}
        </div>
        <div style={tabStyle(activeTab === 'feedback')} onClick={() => setActiveTab('feedback')}>
          {t('analytics.feedback') || 'Feedback'}
        </div>
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && platformStats && (
        <>
          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.totalIntakeForms') || 'Total Intake Forms'}</div>
              <div style={statValueStyle}>{platformStats.allTime?.total_intake_forms || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.scheduledForms') || 'Scheduled Forms'}</div>
              <div style={statValueStyle}>{platformStats.allTime?.scheduled_forms || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.completedForms') || 'Completed Forms'}</div>
              <div style={statValueStyle}>{platformStats.allTime?.completed_forms || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.avgRating') || 'Avg Rating'}</div>
              <div style={{ ...statValueStyle, ...ratingStyle(platformStats.ratings?.platform_avg_rating || 0) }}>
                {(platformStats.ratings?.platform_avg_rating || 0).toFixed(2)} / 5
              </div>
            </div>
          </div>

          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.thisMonthIntake') || 'This Month - Intakes'}</div>
              <div style={statValueStyle}>{platformStats.thisMonth?.intake_forms || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.thisMonthScheduled') || 'This Month - Scheduled'}</div>
              <div style={statValueStyle}>{platformStats.thisMonth?.scheduled_sessions || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.thisMonthCompleted') || 'This Month - Completed'}</div>
              <div style={statValueStyle}>{platformStats.thisMonth?.completed_sessions || 0}</div>
            </div>
            <div style={statCardStyle}>
              <div style={statLabelStyle}>{t('analytics.totalFeedback') || 'Total Feedback'}</div>
              <div style={statValueStyle}>{platformStats.ratings?.total_feedback || 0}</div>
            </div>
          </div>
        </>
      )}

      {/* CONSULTANTS TAB */}
      {activeTab === 'consultants' && (
        <>
          <h2 style={sectionTitleStyle}>{t('analytics.topConsultants') || 'Top Performing Consultants'}</h2>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: 'var(--color-bg)' }}>
                <th style={tableHeaderStyle}>{t('analytics.name') || 'Name'}</th>
                <th style={tableHeaderStyle}>{t('analytics.sessions') || 'Sessions'}</th>
                <th style={tableHeaderStyle}>{t('analytics.completedSessions') || 'Completed'}</th>
                <th style={tableHeaderStyle}>{t('analytics.rating') || 'Rating'}</th>
                <th style={tableHeaderStyle}>{t('analytics.feedback') || 'Feedback'}</th>
                <th style={tableHeaderStyle}>{t('analytics.completionRate') || 'Completion Rate'}</th>
              </tr>
            </thead>
            <tbody>
              {topConsultants.map((consultant) => (
                <tr key={consultant.consultant_id}>
                  <td style={tableCellStyle}>
                    {consultant.first_name} {consultant.last_name}
                  </td>
                  <td style={tableCellStyle}>{consultant.total_sessions}</td>
                  <td style={tableCellStyle}>{consultant.completed_sessions}</td>
                  <td style={{ ...tableCellStyle, ...ratingStyle(consultant.avg_rating || 0) }}>
                    {consultant.avg_rating ? consultant.avg_rating.toFixed(2) : 'N/A'}
                  </td>
                  <td style={tableCellStyle}>{consultant.feedback_count}</td>
                  <td style={tableCellStyle}>
                    <div style={chartBarStyle(consultant.completion_rate || 0)} />
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                      {(consultant.completion_rate || 0).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* CONVERSION TAB */}
      {activeTab === 'conversion' && (
        <>
          <h2 style={sectionTitleStyle}>{t('analytics.conversionFunnel') || 'Conversion Funnel (Last 30 Days)'}</h2>
          <div style={chartContainerStyle}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)', marginBottom: '1rem' }}>
                    {t('analytics.date') || 'Date'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.intakes') || 'Intakes'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.scheduled') || 'Scheduled'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.completed') || 'Completed'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.schedulingRate') || 'Scheduling %'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.completionRate') || 'Completion %'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {conversionFunnel.slice(0, 15).map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ ...tableCellStyle, fontWeight: '500' }}>
                      {new Date(row.date).toLocaleDateString('en-US')}
                    </td>
                    <td style={tableCellStyle}>{row.intake_forms}</td>
                    <td style={tableCellStyle}>{row.scheduled_sessions}</td>
                    <td style={tableCellStyle}>{row.completed_sessions}</td>
                    <td style={tableCellStyle}>
                      <div style={chartBarStyle(row.scheduling_rate || 0)} />
                      {(row.scheduling_rate || 0).toFixed(1)}%
                    </td>
                    <td style={tableCellStyle}>
                      <div style={chartBarStyle(row.completion_rate || 0)} />
                      {(row.completion_rate || 0).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* FEEDBACK TAB */}
      {activeTab === 'feedback' && (
        <>
          <h2 style={sectionTitleStyle}>{t('analytics.feedbackTrends') || 'Feedback Trends (Last 12 Weeks)'}</h2>
          <div style={chartContainerStyle}>
            <table style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.week') || 'Week'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.feedbackCount') || 'Feedback Count'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.avgRating') || 'Avg Rating'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.positive') || 'Positive'}
                  </th>
                  <th style={{ textAlign: 'left', fontWeight: '600', color: 'var(--color-text)' }}>
                    {t('analytics.negative') || 'Negative'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {feedbackTrends.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ ...tableCellStyle, fontWeight: '500' }}>
                      {new Date(row.week_start).toLocaleDateString('en-US')}
                    </td>
                    <td style={tableCellStyle}>{row.total_feedback}</td>
                    <td style={{ ...tableCellStyle, ...ratingStyle(row.avg_rating || 0) }}>
                      {row.avg_rating ? row.avg_rating.toFixed(2) : 'N/A'} / 5
                    </td>
                    <td style={{ ...tableCellStyle, color: '#10b981' }}>{row.positive_count}</td>
                    <td style={{ ...tableCellStyle, color: '#ef4444' }}>{row.negative_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
