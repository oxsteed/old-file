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
import BusinessManagerDashboard from './BusinessManagerDashboard';
import BusinessRepresentativeDashboard from './BusinessRepresentativeDashboard';
import BusinessEmployeeDashboard from './BusinessEmployeeDashboard';
import { dashboardKeyForMode } from '../utils/modeAccess';
import { launchRouteForMode } from '../utils/launchScope';

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
    const mode = user.default_mode || user.role;
    const key = dashboardKeyForMode(mode);
    if (key === 'admin') {
      navigate(launchRouteForMode('admin'), { replace: true });
    } else if (mode === 'helper' || mode === 'business_owner') {
      navigate(launchRouteForMode(mode), { replace: true });
    }
  }, [user, loading, navigate]);

  if (loading || !user) return <Spinner />;

  // Effective mode falls back to legacy role for pre-migration-270 users.
  const effectiveMode = user.default_mode ||
    (['helper', 'helper_pro', 'broker'].includes(user.role) ? 'helper' : 'customer');
  const key = dashboardKeyForMode(effectiveMode);

  switch (key) {
    case 'business_owner':
    case 'helper':
      return <Spinner />;
    case 'consultant':
    case 'tool_owner':
    case 'franchise_applicant':
    case 'life':
    case 'investor':
    case 'logistics':
    case 'support_agent':
      return <Dashboard />;
    case 'business_manager':    return <BusinessManagerDashboard />;
    case 'business_representative': return <BusinessRepresentativeDashboard />;
    case 'business_employee':   return <BusinessEmployeeDashboard />;
    case 'admin':
      // Effect above handles navigation; render spinner while it happens.
      return <Spinner />;
    case 'customer':
    default:                    return <Dashboard />;
  }
}
