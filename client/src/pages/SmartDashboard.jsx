// client/src/pages/SmartDashboard.jsx
//
// The dashboard uses customer Home unless the server has disabled the access projection.

import { Suspense, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { dashboardKeyForMode } from '../utils/modeAccess';
import { normalizeLaunchDashboardMode } from '../utils/launchScope';
import useAccessProjection from '../hooks/useAccessProjection';
import PersonaWorkspaceNotice from '../components/PersonaWorkspaceNotice';
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
  const projection = useAccessProjection(user);
  const effectiveMode = projection?.flags?.accessProjection === false
    ? normalizeLaunchDashboardMode(user?.default_mode || user?.role, user?.role)
    : 'customer';
  const preferredMode = normalizeLaunchDashboardMode(user?.default_mode || user?.role, user?.role);
  const key = dashboardKeyForMode(effectiveMode);

  useEffect(() => {
    if (loading || !user) return;
    if (key === 'support_agent') {
      navigate('/support/agent', { replace: true });
    } else if (key === 'investor') {
      // Gated dead link (Nov 3 audit): /investor/dashboard redirects to
      // /dashboard in the launch gate, so land there directly.
      navigate('/dashboard', { replace: true });
    } else if (key === 'logistics') {
      navigate('/logistics', { replace: true });
    } else if (key === 'admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, loading, navigate, key]);

  if (loading || !user) return <Spinner />;

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
    default:                    return withOffers(<><PersonaWorkspaceNotice preferredMode={preferredMode} projection={projection} /><Dashboard /></>);
  }
}
