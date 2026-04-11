import { useAuth } from '../hooks/useAuth';
import Dashboard from './Dashboard';
import HelperDashboard from './HelperDashboard';

/**
 * SmartDashboard — renders the correct dashboard based on user role.
 * This replaces the need for separate /dashboard and /helper-dashboard routes.
 * Both URLs now work: /dashboard shows the right thing automatically.
 */
export default function SmartDashboard() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="w-8 h-8 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (['helper', 'helper_pro', 'broker'].includes(user?.role)) {
    return <HelperDashboard />;
  }

  return <Dashboard />;
}
