import React, { useState, useEffect } from 'react';
import useAuth from '../hooks/useAuth';
import useSubscription from '../hooks/useSubscription';
import BadgeDisplay from '../components/BadgeDisplay';
import api from '../api/axios';
import { useNavigate, useLocation } from 'react-router-dom';
import '../styles/HelperDashboard.css';

// ── Onboarding step definitions ─────────────────────────────────────────────
const ONBOARDING_STEPS = [
  {
    key: 'account',
    label: 'Create Account',
    description: 'Name, email, and password',
    check: () => true, // always done if they're here
  },
  {
    key: 'email',
    label: 'Verify Email',
    description: 'Confirm your email address',
    check: (u) => !!u?.email_verified,
  },
  {
    key: 'profile',
    label: 'Profile & Location',
    description: 'Phone, zip, skills, and a short bio',
    check: (u) => !!u?.profile_completed,
    uiStep: 4,
  },
  {
    key: 'plan',
    label: 'Choose Your Plan',
    description: 'Free or Pro — upgrade anytime',
    check: (u) => !!u?.tier_selected,
    uiStep: 5,
  },
  {
    key: 'tax',
    label: 'Tax Information',
    description: 'Required for Pro tier helpers (W-9)',
    check: (u) => !!u?.w9_completed || u?.membership_tier === 'tier1' || u?.membership_tier === 'free',
    onlyFor: (u) => u?.membership_tier === 'tier2' || u?.membership_tier === 'pro',
    uiStep: 6,
  },
  {
    key: 'review',
    label: 'Review & Complete',
    description: 'Accept terms and go live',
    check: (u) => !!u?.onboarding_completed,
    uiStep: 7,
  },
];

function OnboardingProgress({ user, onResume }) {
  const steps = ONBOARDING_STEPS.filter(
    (s) => !s.onlyFor || s.onlyFor(user)
  );

  const completedCount = steps.filter((s) => s.check(user)).length;
  const pct = Math.round((completedCount / steps.length) * 100);

  // Find the first incomplete step to resume from
  const nextStep = steps.find((s) => !s.check(user));

  return (
    <div className="onboarding-resume-card">
      <div className="onboarding-resume-header">
        <div>
          <h2 className="onboarding-resume-title">
            Complete Your Profile to Start Getting Jobs
          </h2>
          <p className="onboarding-resume-subtitle">
            Your profile is hidden from search until setup is finished.
          </p>
        </div>
        <span className="onboarding-pct">{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="onboarding-bar-track" aria-label={`Setup ${pct}% complete`}>
        <div
          className="onboarding-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step list */}
      <ul className="onboarding-step-list">
        {steps.map((s) => {
          const done = s.check(user);
          return (
            <li key={s.key} className={`onboarding-step-item ${done ? 'done' : 'pending'}`}>
              <span className={`onboarding-step-icon ${done ? 'done' : 'pending'}`}>
                {done ? '✓' : '○'}
              </span>
              <div className="onboarding-step-text">
                <span className="onboarding-step-label">{s.label}</span>
                <span className="onboarding-step-desc">{s.description}</span>
              </div>
            </li>
          );
        })}
      </ul>

      {nextStep && (
        <button onClick={onResume} className="btn btn-primary onboarding-resume-btn">
          {nextStep.key === 'profile' ? 'Add Profile & Location →' :
           nextStep.key === 'plan'    ? 'Choose a Plan →' :
           nextStep.key === 'tax'     ? 'Add Tax Info →' :
           nextStep.key === 'review'  ? 'Review & Go Live →' :
           'Continue Setup →'}
        </button>
      )}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────
export default function HelperDashboard() {
  const { user, isOnboardingComplete } = useAuth();
  const { subscription, openPortal } = useSubscription();
  const navigate = useNavigate();
  const location = useLocation();
  const [verification, setVerification] = useState({ backgroundCheck: null, identity: null });
  const [loading, setLoading] = useState(true);
  const [welcomeMsg] = useState(location.state?.message || null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [bgRes, idRes] = await Promise.allSettled([
          api.get('/verification/background-check/status'),
          api.get('/verification/identity/status'),
        ]);
        setVerification({
          backgroundCheck:
            bgRes.status === 'fulfilled' ? bgRes.value.data?.backgroundCheck || null : null,
          identity:
            idRes.status === 'fulfilled' ? idRes.value.data?.identity || null : null,
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
      await api.post('/verification/background-check');
      window.location.reload();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start background check');
    }
  };

  const startIdentityVerification = async () => {
    try {
      const { data } = await api.post('/verification/identity/session');
      window.location.href = data.url;
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start identity verification');
    }
  };

  const isProActive = subscription?.status === 'active';
  const showOnboarding = !isOnboardingComplete;

  if (loading) {
    return (
      <div className="helper-dashboard">
        <div className="dashboard-loading">
          <div className="loading-spinner" />
          <span>Loading your dashboard…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="helper-dashboard">
      {/* Welcome toast */}
      {welcomeMsg && (
        <div className="welcome-banner" role="status">
          <span>🎉</span>
          <span>{welcomeMsg}</span>
        </div>
      )}

      <div className="dashboard-header">
        <div>
          <h1>
            {showOnboarding
              ? `Welcome, ${user?.first_name || 'Helper'}!`
              : `Hello, ${user?.first_name || 'Helper'}`}
          </h1>
          {showOnboarding && (
            <p className="subtitle">Your account is created — finish setup to go live.</p>
          )}
        </div>
        <BadgeDisplay badges={user?.badges} size="large" />
      </div>

      {/* ── Onboarding resume section (shown until complete) ── */}
      {showOnboarding && (
        <OnboardingProgress
          user={user}
          onResume={() => navigate('/register/helper')}
        />
      )}

      {/* ── Main dashboard cards ── */}
      <div className={`dashboard-grid ${showOnboarding ? 'dimmed' : ''}`}>
        {/* Subscription Card */}
        <div className="dashboard-card subscription-card">
          <h3>
            <span className="card-icon">💳</span> Subscription
          </h3>
          {isProActive ? (
            <>
              <p className="plan-name">Pro</p>
              <p className="plan-status active">Active</p>
              <p className="plan-period">
                Renews {new Date(subscription.current_period_end).toLocaleDateString()}
              </p>
              <button onClick={openPortal} className="btn btn-secondary">
                Manage Billing
              </button>
            </>
          ) : (
            <>
              <p className="plan-name">Free</p>
              <p className="plan-status free">Basic access</p>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', margin: '0.5rem 0 1rem' }}>
                Upgrade to get a verified badge, priority placement, and background check.
              </p>
              {showOnboarding ? (
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  Available after setup is complete.
                </p>
              ) : (
                <button onClick={() => navigate('/upgrade')} className="btn btn-primary">
                  Upgrade to Pro
                </button>
              )}
            </>
          )}
        </div>

        {/* Background Check Card */}
        <div className={`dashboard-card ${showOnboarding ? 'locked-card' : ''}`}>
          <h3>
            <span className="card-icon">🛡️</span> Background Check
            {showOnboarding && <span className="locked-badge">After setup</span>}
          </h3>
          {showOnboarding ? (
            <p className="muted">Complete your profile first to unlock background checks.</p>
          ) : verification.backgroundCheck ? (
            <>
              <p className={`status-badge ${verification.backgroundCheck.status}`}>
                {verification.backgroundCheck.status}
              </p>
              {verification.backgroundCheck.completed_at && (
                <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  Completed{' '}
                  {new Date(verification.backgroundCheck.completed_at).toLocaleDateString()}
                </p>
              )}
            </>
          ) : isProActive ? (
            <>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Not started yet. A passed check adds a badge to your profile.
              </p>
              <button onClick={startBackgroundCheck} className="btn btn-primary">
                Start Background Check
              </button>
            </>
          ) : (
            <p className="muted">Requires a Pro subscription.</p>
          )}
        </div>

        {/* Identity Verification Card */}
        <div className={`dashboard-card ${showOnboarding ? 'locked-card' : ''}`}>
          <h3>
            <span className="card-icon">🪪</span> Identity Verification
            {showOnboarding && <span className="locked-badge">After setup</span>}
          </h3>
          {showOnboarding ? (
            <p className="muted">Finish onboarding to unlock identity verification.</p>
          ) : verification.identity ? (
            <p className={`status-badge ${verification.identity.status}`}>
              {verification.identity.status}
            </p>
          ) : isProActive ? (
            <>
              <p style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: '1rem' }}>
                Verify your ID to build trust with customers.
              </p>
              <button onClick={startIdentityVerification} className="btn btn-primary">
                Verify My Identity
              </button>
            </>
          ) : (
            <p className="muted">Requires a Pro subscription.</p>
          )}
        </div>

        {/* Stats Card */}
        <div className="dashboard-card">
          <h3>
            <span className="card-icon">📊</span> Your Stats
          </h3>
          {showOnboarding ? (
            <p className="muted" style={{ fontSize: '0.85rem' }}>
              Stats will appear once your profile is live and you start accepting jobs.
            </p>
          ) : (
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{user?.completed_jobs || 0}</span>
                <span className="stat-label">Jobs Done</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{user?.avg_rating || '—'}</span>
                <span className="stat-label">Avg Rating</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
