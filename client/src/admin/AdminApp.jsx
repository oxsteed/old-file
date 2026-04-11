import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';

// Super Admin pages
import SuperDashboard    from './pages/super/Dashboard';
import UserDetail        from './pages/super/UserDetail';
import Financials        from './pages/super/Financials';
import PlatformSettings  from './pages/super/PlatformSettings';
import AuditLog          from './pages/super/AuditLog';
import FeeConfig         from './pages/super/FeeConfig';
import PricingConfig     from './pages/super/PricingConfig';
import Revenue           from './pages/super/Revenue';
import Payouts           from './pages/super/Payouts';
import AdminAccounts     from './pages/super/AdminAccounts';
import SearchLogs        from './pages/super/SearchLogs';
import PermissionGrants  from './pages/super/PermissionGrants';

// Shared admin pages
import UsersList       from './pages/UsersList';
import ReportsList     from './pages/ReportsList';
import Disputes        from './pages/Disputes';
import DisputeResolve  from './pages/DisputeResolve';
import MarketZipCodes  from './pages/MarketZipCodes';
import JobsList        from './pages/JobsList';
import JobDetail       from './pages/JobDetail';
import Moderation      from './pages/Moderation';
import SkillsManager   from './pages/SkillsManager';
import LicensesManager from './pages/LicensesManager';
import ContentRemovals from './pages/ContentRemovals';
import SupportTickets  from './pages/SupportTickets';
import AdminSearch     from './pages/AdminSearch';
import AdminLogin      from './pages/Login';

function AdminGuard({ children, superOnly = false }) {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-orange-500
        border-t-transparent rounded-full" />
    </div>
  );

  if (!user) return <Navigate to="/admin/login" replace />;
  if (!['admin','super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />;
  }
  if (superOnly && user.role !== 'super_admin') {
    return <Navigate to="/admin/dashboard" replace />;
  }
  return children;
}

export default function AdminApp() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public login route */}
        <Route path="/admin/login" element={<AdminLogin />} />

        {/* Protected admin routes */}
        <Route path="/admin" element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }>
          {/* Default redirect */}
          <Route index element={<Navigate to="/admin/dashboard" replace />} />

          {/* Regular admin */}
          <Route path="dashboard"           element={<SuperDashboard />} />
          <Route path="users"               element={<UsersList />} />
          <Route path="users/:userId"       element={<UserDetail />} />
          <Route path="jobs"                element={<JobsList />} />
          <Route path="jobs/:jobId"        element={<JobDetail />} />
          <Route path="reports"             element={<ReportsList />} />
          <Route path="moderation"          element={<Moderation />} />
          <Route path="disputes"            element={<Disputes />} />
          <Route path="disputes/:disputeId" element={<DisputeResolve />} />
          <Route path="markets"             element={<MarketZipCodes />} />
          <Route path="skills"              element={<SkillsManager />} />
          <Route path="licenses"            element={<LicensesManager />} />
          <Route path="content-removals"    element={<ContentRemovals />} />
          <Route path="support"             element={<SupportTickets />} />
          <Route path="search"              element={<AdminSearch />} />

          {/* Super admin only */}
          <Route path="super/dashboard" element={
            <AdminGuard superOnly><SuperDashboard /></AdminGuard>
          } />
          <Route path="super/revenue" element={
            <AdminGuard superOnly><Revenue /></AdminGuard>
          } />
          <Route path="super/financials" element={
            <AdminGuard superOnly><Financials /></AdminGuard>
          } />
          <Route path="super/payouts" element={
            <AdminGuard superOnly><Payouts /></AdminGuard>
          } />
          <Route path="super/settings" element={
            <AdminGuard superOnly><PlatformSettings /></AdminGuard>
          } />
          <Route path="super/audit-log" element={
            <AdminGuard superOnly><AuditLog /></AdminGuard>
          } />
          <Route path="super/fees" element={
            <AdminGuard superOnly><FeeConfig /></AdminGuard>
          } />
          <Route path="super/pricing" element={
            <AdminGuard superOnly><PricingConfig /></AdminGuard>
          } />
          <Route path="super/admin-accounts" element={
            <AdminGuard superOnly><AdminAccounts /></AdminGuard>
          } />
          <Route path="super/search-logs" element={
            <AdminGuard><SearchLogs /></AdminGuard>
          } />
          <Route path="super/permissions" element={
            <AdminGuard superOnly><PermissionGrants /></AdminGuard>
          } />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
