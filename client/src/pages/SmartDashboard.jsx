// client/src/pages/SmartDashboard.jsx
//
// /dashboard router. Reads user.default_mode (the unified account-type field
// introduced in migration 270) and renders the right child dashboard.
//
// Falls back to user.role for accounts created before migration 270 — that
// keeps the legacy customer/helper experience working until those users
// touch the account-type panel.

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import Dashboard from './Dashboard';
import HelperDashboard from './HelperDashboard';
import LifeDashboard from './LifeDashboard';
import ToolOwnerDashboard from './ToolOwnerDashboard';
import FranchiseApplicantDashboard from './FranchiseApplicantDashboard';
import BusinessOwnerDashboard from './BusinessOwnerDashboard';
import ConsultantContractorDashboard from './ConsultantContractorDashboard';
import BusinessManagerDashboard from './BusinessManagerDashboard';
import BusinessRepresentativeDashboard from './BusinessRepresentativeDashboard';
import BusinessEmployeeDashboard from './BusinessEmployeeDashboard';
import { dashboardKeyForMode } from '../utils/modeAccess';

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
    const key = dashboardKeyForMode(user.default_mode || user.role);
    if (key === 'support_agent') {
      navigate('/support/agent', { replace: true });
    } else if (key === 'admin') {
      navigate('/admin', { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user) return <Spinner />;

  // Effective mode falls back to legacy role for pre-migration-270 users.
  const effectiveMode = user.default_mode ||
    (['helper', 'helper_pro', 'broker'].includes(user.role) ? 'helper' : 'customer');
  const key = dashboardKeyForMode(effectiveMode);

  switch (key) {
    case 'helper':              return <HelperDashboard />;
    case 'business_owner':      return <BusinessOwnerDashboard />;
    case 'consultant':          return <ConsultantContractorDashboard />;
    case 'tool_owner':          return <ToolOwnerDashboard />;
    case 'franchise_applicant': return <FranchiseApplicantDashboard />;
    case 'life':                return <LifeDashboard />;
    case 'business_manager':    return <BusinessManagerDashboard />;
    case 'business_representative': return <BusinessRepresentativeDashboard />;
    case 'business_employee':   return <BusinessEmployeeDashboard />;
    case 'support_agent':
    case 'admin':
      // Effect above handles navigation; render spinner while it happens.
      return <Spinner />;
    case 'customer':
    default:                    return <Dashboard />;
  }
}
