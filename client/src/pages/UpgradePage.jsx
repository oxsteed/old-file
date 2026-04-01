import React, { useState } from 'react';
import useSubscription from '../hooks/useSubscription';
import useAuth from '../hooks/useAuth';
import BadgeDisplay from '../components/BadgeDisplay';
import '../styles/UpgradePage.css';

export default function UpgradePage() {
  const { user } = useAuth();
  const { plans, subscription, loading, error, createCheckout, cancelSubscription, openPortal } = useSubscription();
  const [cancelling, setCancelling] = useState(false);

  if (loading) return <div className="upgrade-loading">Loading plans...</div>;

  const isSubscribed = subscription && subscription.status === 'active';

  const handleUpgrade = async (planSlug) => {
    await createCheckout(planSlug);
  };

  const handleCancel = async () => {
    if (window.confirm('Are you sure you want to cancel your subscription?')) {
      setCancelling(true);
      await cancelSubscription();
      setCancelling(false);
    }
  };

  return (
    <div className="upgrade-page">
      <div className="upgrade-header">
        <h1>Upgrade to Pro</h1>
        <p>Unlock verified status, background checks, and priority listings</p>
      </div>

      {error && <div className="upgrade-error">{error}</div>}

      {isSubscribed ? (
        <div className="subscription-active">
          <div className="current-plan-card">
            <BadgeDisplay badges={user?.badges} />
            <h2>You're on the Pro Plan</h2>
            <p className="plan-status">Status: <span className="status-active">{subscription.status}</span></p>
            <p>Current period ends: {new Date(subscription.current_period_end).toLocaleDateString()}</p>
            <div className="plan-actions">
              <button onClick={openPortal} className="btn-portal">Manage Billing</button>
              <button onClick={handleCancel} disabled={cancelling} className="btn-cancel">
                {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="plans-grid">
          {plans.map((plan) => (
            <div key={plan.id} className={`plan-card ${plan.recommended ? 'recommended' : ''}`}>
              {plan.recommended && <div className="recommended-badge">Recommended</div>}
              <h3>{plan.name}</h3>
              <div className="plan-price">
                <span className="price">${(plan.amount_cents / 100).toFixed(2)}</span>
                <span className="period">/{plan.interval}</span>
              </div>
              <ul className="plan-features">
                {plan.features?.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
              <button onClick={() => handleUpgrade(plan.slug)} className="btn-upgrade">
                Subscribe Now
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="upgrade-faq">
        <h2>Frequently Asked Questions</h2>
        <div className="faq-item">
          <h4>What's included in Pro?</h4>
          <p>Background check verification, identity verification badge, priority in search results, and access to premium job categories.</p>
        </div>
        <div className="faq-item">
          <h4>Can I cancel anytime?</h4>
          <p>Yes, you can cancel your subscription at any time. You'll retain access until the end of your billing period.</p>
        </div>
      </div>
    </div>
  );
}
