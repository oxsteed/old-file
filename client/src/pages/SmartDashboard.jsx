// client/src/pages/SmartDashboard.jsx
//
// /dashboard router. Reads user.default_mode (the unified account-type field
// introduced in migration 270) and renders the right child dashboard.
//
// Falls back to user.role for accounts created before migration 270 — that
// keeps the legacy customer/helper experience working until those users
// touch the account-type panel.

import { Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { dashboardKeyForMode } from '../utils/modeAccess';
import { normalizeLaunchDashboardMode } from '../utils/launchScope';
import OfferCard from '../growth/OfferCard';

// Download only the active mode's dashboard. Other modes stay available
// without adding their screens and dependencies to every dashboard visit.
const Dashboard = lazyWithRetry(() => import('./Dashboard'));
const HelperDashboard = lazyWithRetry(() => import('./HelperDashboard'));
const LifeDashboard = lazyWithRetry(() => import('./LifeDashboard'));
const ToolOwnerDashboard = lazyWithRetry(() => import('./ToolOwnerDashboard'));
const FranchiseApplicantDashboard = lazyWithRetry(() => import('./FranchiseApplicantDashboard'));
const BusinessOwnerDashboard = lazyWithRetry(() => import('./BusinessOwnerDashboard'));
const ConsultantContractorDashboard = lazyWithRetry(() => import('./ConsultantContractorDashboard'));
const BusinessManagerDashboard = lazyWithRetry(() => import('./BusinessManagerDashboard'));
const BusinessRepresentativeDashboard = lazyWithRetry(() => import('./BusinessRepresentativeDashboard'));
const BusinessEmployeeDashboard = lazyWithRetry(() => import('./BusinessEmployeeDashboard'));

function Spinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-950">
      <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
    </div>
  );
}

export default function SmartDashboard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || !user) return;
    const launchMode = normalizeLaunchDashboardMode(user.default_mode || user.role, user.role);
    const key = dashboardKeyForMode(launchMode);
    if (key === 'support_agent') {
      navigate('/support/agent', { replace: true });
    } else if (key === 'investor') {
      navigate('/investor/dashboard', { replace: true });
    } else if (key === 'logistics') {
      navigate('/logistics', { replace: true });
    } else if (key === 'admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user) return <Spinner />;

  // Effective mode falls back to legacy role for pre-migration-270 users.
  const effectiveMode = normalizeLaunchDashboardMode(
    user.default_mode || user.role,
    user.role,
  );
  const key = dashboardKeyForMode(effectiveMode);

  // The "Offers for you" card (growth spec 16.1) sits at the top of every
  // role home; it renders nothing when there is no offer and no prompt.
  const withOffers = (dashboard) => (
    <>
      <div className="px-4 pt-4">
        <OfferCard />
      </div>
      <Suspense fallback={<Spinner />}>{dashboard}</Suspense>
    </>
  );

  switch (key) {
    case 'helper':              return withOffers(<HelperDashboard />);
    case 'business_owner':      return withOffers(<BusinessOwnerDashboard />);
    case 'consultant':          return withOffers(<ConsultantContractorDashboard />);
    case 'tool_owner':          return withOffers(<ToolOwnerDashboard />);
    case 'franchise_applicant': return withOffers(<FranchiseApplicantDashboard />);
    case 'life':                return withOffers(<LifeDashboard />);
    case 'business_manager':    return withOffers(<BusinessManagerDashboard />);
    case 'business_representative': return withOffers(<BusinessRepresentativeDashboard />);
    case 'business_employee':   return withOffers(<BusinessEmployeeDashboard />);
    case 'investor':
    case 'logistics':
    case 'support_agent':
    case 'admin':
      // Effect above handles navigation; render spinner while it happens.
      return <Spinner />;
    case 'customer':
    default:                    return withOffers(<Dashboard />);
  }
}
