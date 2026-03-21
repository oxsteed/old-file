import React, { useState, useEffect } from 'react';
import useAuth from '../hooks/useAuth';
import useSubscription from '../hooks/useSubscription';
import BadgeDisplay from '../components/BadgeDisplay';
import api from '../api/axios';
import { useNavigate } from 'react-router-dom';
import '../styles/HelperDashboard.css';

export default function HelperDashboard() {
  const { user } = useAuth();
  const { subscription, openPortal } = useSubscription();
  const navigate = useNavigate();
  const [verification, setVerification] = useState({ background: null, identity: null });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [bgRes, idRes] = await Promise.allSettled([
          api.get('/subscription/background-check/status'),
          api.get('/subscription/identity/status'),
        ]);
        setVerification({
          background: bgRes.status === 'fulfilled' ? bgRes.value.data : null,
          identity: idRes.status === 'fulfilled' ? idRes.value.data : null,
        });
      } catch (err) {
        console.error('Failed to fetch verification status:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const startBackgroundCheck = async () => {
    try {
      await api.post('/subscription/background-check');
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start background check');
    }
  };

  const startIdentityVerification = async () => {
    try {
      const { data } = await api.post('/subscription/identity/session');
      window.location.href = data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start identity verification');
    }
  };

  const isProActive = subscription?.status === 'active';

  if (loading) return <div className="helper-dashboard-loading">Loading dashboard...</div>;

  return (
    <div className="helper-dashboard">
      <div className="dashboard-header">
        <h1>Helper Dashboard</h1>
        <BadgeDisplay badges={user?.badges} size="large" />
      </div>

      <div className="dashboard-grid">
        {/* Subscription Card */}
        <div className="dashboard-card">
          <h3>Subscription</h3>
          {isProActive ? (
            <>
              <p className="status-badge active">Pro Active</p>
              <p>Renews: {new Date(subscription.current_period_end).toLocaleDateString()}</p>
              <button onClick={openPortal} className="btn-secondary">Manage Billing</button>
            </>
          ) : (
            <>
              <p className="status-badge inactive">Free Tier</p>
              <p>Upgrade to access background checks and priority listings</p>
              <button onClick={() => navigate('/upgrade')} className="btn-primary">Upgrade to Pro</button>
            </>
          )}
        </div>

        {/* Background Check Card */}
        <div className="dashboard-card">
          <h3>Background Check</h3>
          {verification.background ? (
            <>
              <p className={`status-badge ${verification.background.status}`}>
                {verification.background.status}
              </p>
              {verification.background.completed_at && (
                <p>Completed: {new Date(verification.background.completed_at).toLocaleDateString()}</p>
              )}
            </>
          ) : isProActive ? (
            <>
              <p>Not started yet</p>
              <button onClick={startBackgroundCheck} className="btn-primary">Start Background Check</button>
            </>
          ) : (
            <p className="muted">Requires Pro subscription</p>
          )}
        </div>

        {/* Identity Verification Card */}
        <div className="dashboard-card">
          <h3>Identity Verification</h3>
          {verification.identity ? (
            <>
              <p className={`status-badge ${verification.identity.status}`}>
                {verification.identity.status}
              </p>
            </>
          ) : isProActive ? (
            <>
              <p>Not verified yet</p>
              <button onClick={startIdentityVerification} className="btn-primary">Verify Identity</button>
            </>
          ) : (
            <p className="muted">Requires Pro subscription</p>
          )}
        </div>

        {/* Stats Card */}
        <div className="dashboard-card">
          <h3>Your Stats</h3>
          <div className="stats-grid">
            <div className="stat">
              <span className="stat-value">{user?.completed_jobs || 0}</span>
              <span className="stat-label">Jobs Done</span>
            </div>
            <div className="stat">
              <span className="stat-value">{user?.avg_rating || 'N/A'}</span>
              <span className="stat-label">Avg Rating</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
