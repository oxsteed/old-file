import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';
import TwoFactorSetup from '../pages/Settings/TwoFactorSetup';

const adminQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

// Super Admin pages
import SuperDashboard      from './pages/super/Dashboard';
import UserDetail          from './pages/super/UserDetail';
import ConversationsAdmin  from './pages/super/ConversationsAdmin';
import Financials        from './pages/super/Financials';
import PlatformSettings  from './pages/super/PlatformSettings';
import AuditLog          from './pages/super/AuditLog';
import FeeConfig         from './pages/super/FeeConfig';
import PricingConfig     from './pages/super/PricingConfig';
import PricingOverrides  from './pages/super/PricingOverrides';
import CountryPacks      from './pages/super/CountryPacks';
import ModePolicies      from './pages/super/ModePolicies';
import ModeApprovals     from './pages/super/ModeApprovals';
import Revenue           from './pages/super/Revenue';
import MoneyPage         from './pages/super/MoneyPage';
import Payouts           from './pages/super/Payouts';
import AdminAccounts     from './pages/super/AdminAccounts';
import SearchLogs        from './pages/super/SearchLogs';
import PermissionGrants  from './pages/super/PermissionGrants';
import CreateUser        from './pages/super/CreateUser';
import RegionsManager    from './pages/super/RegionsManager';
import LogisticsInternalAccess from './pages/super/LogisticsInternalAccess';
import AccessGateLockouts from './pages/super/AccessGateLockouts';
import AuditLogUserActions from './pages/super/AuditLogUserActions';
import OneTruthPage        from './pages/super/OneTruthPage';
import CorporateOrgChart    from './pages/super/CorporateOrgChart';
import CorporateAssignments from './pages/super/CorporateAssignments';
import CorporateDepartments from './pages/super/CorporateDepartments';
import FranchiseHQPage      from './pages/super/FranchiseHQPage';

// OxSteed Logistics admin pages (migration 247)
import LogisticsAdminDashboard from './pages/logistics/LogisticsAdminDashboard';
import LanesManagement         from './pages/logistics/LanesManagement';
import SuppliersManagement     from './pages/logistics/SuppliersManagement';
import QuotesManagement        from './pages/logistics/QuotesManagement';
import CampaignsAdmin          from './pages/logistics/CampaignsAdmin';
import PurchaseOrdersAdmin     from './pages/logistics/PurchaseOrdersAdmin';
import ShipmentsAdmin          from './pages/logistics/ShipmentsAdmin';
import CustomsAdmin            from './pages/logistics/CustomsAdmin';
import WarehousesAdmin         from './pages/logistics/WarehousesAdmin';
import AllocationsAdmin        from './pages/logistics/AllocationsAdmin';
import PricingAdmin            from './pages/logistics/PricingAdmin';
import RestrictionsAdmin       from './pages/logistics/RestrictionsAdmin';
import DisputesAdmin           from './pages/logistics/DisputesAdmin';
import SourcingOpsAdmin        from './pages/logistics/SourcingOpsAdmin';
import OrganizerApprovalsAdmin from './pages/logistics/OrganizerApprovalsAdmin';
import ShipmentOpsAdmin        from './pages/logistics/ShipmentOpsAdmin';
import WarehouseOpsDashboard   from './pages/logistics/WarehouseOpsDashboard';
import ComplianceReviewAdmin   from './pages/logistics/ComplianceReviewAdmin';
import SuperAdminLogisticsControl from './pages/logistics/SuperAdminLogisticsControl';

// Shared admin pages
import UsersList            from './pages/UsersList';
import ReportsList          from './pages/ReportsList';
import BusinessModeration   from './pages/BusinessModeration';
import BusinessDetail       from './pages/BusinessDetail';
import ToolRentalModeration from './pages/ToolRentalModeration';
import PlannedNeedsAdmin    from './pages/PlannedNeedsAdmin';
import PaymentsList         from './pages/PaymentsList';
import Disputes        from './pages/Disputes';
import DisputeResolve  from './pages/DisputeResolve';
import MarketZipCodes  from './pages/MarketZipCodes';
import DirectServiceAreas from './pages/DirectServiceAreas';
import DirectCatalog from './pages/DirectCatalog';
import JobsList        from './pages/JobsList';
import JobDetail       from './pages/JobDetail';
import Moderation      from './pages/Moderation';
import SkillsManager   from './pages/SkillsManager';
import LicensesManager from './pages/LicensesManager';
import ContentRemovals from './pages/ContentRemovals';
import SupportTickets  from './pages/SupportTickets';
import QuoteRequestsInbox from './pages/QuoteRequestsInbox';
import AdminSearch     from './pages/AdminSearch';
import AdminMessages   from './pages/AdminMessages';
import ConsultingDashboard from './pages/ConsultingDashboard';
import ConsultingPayments from './pages/ConsultingPayments';
import ConsultingScheduler from './pages/ConsultingScheduler';
import ConsultingAnalyticsDashboard from './pages/ConsultingAnalyticsDashboard';
import BusinessLaunchAdmin from './pages/BusinessLaunchAdmin';
import ConsultingSessionsAdmin from './pages/ConsultingSessionsAdmin';
import OrderManagement from './pages/OrderManagement';
import TemplateManagement from './pages/TemplateManagement';
import TemplatePreviewPage from './pages/TemplatePreviewPage';
import AdminLogin      from './pages/Login';
import SupportCSATAnalytics from './pages/SupportCSATAnalytics';
import SupportEscalationManager from './pages/SupportEscalationManager';
import SupportTeamHierarchy from './pages/SupportTeamHierarchy';
import SupportSettingsPage from './pages/SupportSettingsPage';
import SupportAuditLog from './pages/SupportAuditLog';
import SupportAgentDashboard from './pages/SupportAgentDashboard';
import SupportAgentOnboarding from './pages/SupportAgentOnboarding';
import SupportShiftsManager from './pages/SupportShiftsManager';
import SupportAgentManagement from './pages/SupportAgentManagement';
import SupportAgentChat from './pages/SupportAgentChat';
import SupportKnowledgeBase from './pages/SupportKnowledgeBase';
import SupportTemplates from './pages/SupportTemplates';
import SupportMetricsDashboard from './pages/SupportMetricsDashboard';
import SupportSLADashboard from './pages/SupportSLADashboard';
import SupportPerformanceAnalytics from './pages/SupportPerformanceAnalytics';
import AdminLegalAcceptancesPage from './pages/AdminLegalAcceptancesPage';
import AdminLegalAuditLogPage from './pages/AdminLegalAuditLogPage';
import AdminComplianceMetricsPage from './pages/AdminComplianceMetricsPage';
import AdminCCPARequestsPage from './pages/AdminCCPARequestsPage';
import AdminReportsDashboard from './pages/AdminReportsDashboard';
import AdminEnforcementDashboard from './pages/AdminEnforcementDashboard';
import LearnSubmissionsAdmin    from './pages/LearnSubmissionsAdmin';
import LearnProductLinksAdmin   from './pages/LearnProductLinksAdmin';

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
    <QueryClientProvider client={adminQueryClient}>
    <BrowserRouter>
      <Routes>
        {/* Public login route */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/2fa-setup" element={
          <AdminGuard><TwoFactorSetup adminSetup /></AdminGuard>
        } />

        {/* Full-width template preview (no sidebar) - still requires admin auth */}
        <Route path="/admin/template-preview" element={
          <AdminGuard>
            <TemplatePreviewPage />
          </AdminGuard>
        } />

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
          <Route path="direct-service-areas" element={<DirectServiceAreas />} />
          <Route path="direct-catalog" element={<DirectCatalog embedded />} />
          <Route path="skills"              element={<SkillsManager />} />
          <Route path="licenses"            element={<LicensesManager />} />
          <Route path="content-removals"    element={<ContentRemovals />} />
          <Route path="support"             element={<SupportTickets />} />
          <Route path="quote-requests"      element={<QuoteRequestsInbox />} />
          <Route path="search"              element={<AdminSearch />} />
          <Route path="messages"            element={<AdminMessages />} />
          <Route path="businesses"          element={<BusinessModeration />} />
          <Route path="businesses/:id"      element={<BusinessDetail />} />
          <Route path="tool-rentals"        element={<ToolRentalModeration />} />
          <Route path="planned-needs"       element={<PlannedNeedsAdmin />} />
          <Route path="payments"            element={<PaymentsList />} />
          <Route path="orders"              element={<OrderManagement />} />
          <Route path="templates"           element={<TemplateManagement />} />
          <Route path="consulting"          element={<ConsultingDashboard />} />
          <Route path="consulting/payments" element={<ConsultingPayments />} />
          <Route path="consulting/scheduler" element={<ConsultingScheduler />} />
          <Route path="consulting/analytics" element={<ConsultingAnalyticsDashboard />} />
          <Route path="consulting/business-launch" element={<BusinessLaunchAdmin />} />
          <Route path="consulting/sessions" element={<ConsultingSessionsAdmin />} />
          <Route path="support/agent-dashboard" element={<SupportAgentDashboard />} />
          <Route path="support/agent-onboarding" element={<SupportAgentOnboarding />} />
          <Route path="support/shifts" element={<SupportShiftsManager />} />
          <Route path="support/agents" element={<SupportAgentManagement />} />
          <Route path="support/chat" element={<SupportAgentChat />} />
          <Route path="support/kb" element={<SupportKnowledgeBase />} />
          <Route path="support/templates" element={<SupportTemplates />} />
          <Route path="support/metrics" element={<SupportMetricsDashboard />} />
          <Route path="support/sla" element={<SupportSLADashboard />} />
          <Route path="support/performance" element={<SupportPerformanceAnalytics />} />
          <Route path="support/csat" element={<SupportCSATAnalytics />} />
          <Route path="support/escalations" element={<SupportEscalationManager />} />
          <Route path="support/team-hierarchy" element={<SupportTeamHierarchy />} />
          <Route path="support/settings" element={<SupportSettingsPage />} />
          <Route path="support/audit" element={<SupportAuditLog />} />

          {/* Learn Mode */}
          <Route path="learn/submissions"    element={<LearnSubmissionsAdmin />} />
          <Route path="learn/product-links"  element={<LearnProductLinksAdmin />} />

          {/* Reputation & Enforcement */}
          <Route path="reports" element={<AdminReportsDashboard />} />
          <Route path="enforcement" element={<AdminEnforcementDashboard />} />

          {/* Legal & Compliance */}
          <Route path="legal/acceptances" element={<AdminLegalAcceptancesPage />} />
          <Route path="legal/audit-log" element={<AdminLegalAuditLogPage />} />
          <Route path="legal/compliance-metrics" element={<AdminComplianceMetricsPage />} />
          <Route path="legal/ccpa-requests" element={<AdminCCPARequestsPage />} />

          {/* Super admin only */}
          <Route path="super/dashboard" element={
            <AdminGuard superOnly><SuperDashboard /></AdminGuard>
          } />
          <Route path="super/revenue" element={
            <AdminGuard superOnly><Revenue /></AdminGuard>
          } />
          <Route path="super/money" element={
            <AdminGuard superOnly><MoneyPage /></AdminGuard>
          } />
          <Route path="super/financials" element={
            <AdminGuard superOnly><Financials /></AdminGuard>
          } />
          <Route path="super/payouts" element={
            <AdminGuard superOnly><Payouts /></AdminGuard>
          } />
          <Route path="super/conversations" element={
            <AdminGuard superOnly><ConversationsAdmin /></AdminGuard>
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
          <Route path="super/pricing-overrides" element={
            <AdminGuard superOnly><PricingOverrides /></AdminGuard>
          } />
          <Route path="super/country-packs" element={
            <AdminGuard superOnly><CountryPacks /></AdminGuard>
          } />
          <Route path="super/mode-policies" element={
            <AdminGuard superOnly><ModePolicies /></AdminGuard>
          } />
          <Route path="super/mode-approvals" element={
            <AdminGuard superOnly><ModeApprovals /></AdminGuard>
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
          <Route path="super/users/create" element={
            <AdminGuard superOnly><CreateUser /></AdminGuard>
          } />
          <Route path="super/regions" element={
            <AdminGuard superOnly><RegionsManager /></AdminGuard>
          } />
          <Route path="super/logistics-internal-access" element={
            <AdminGuard superOnly><LogisticsInternalAccess /></AdminGuard>
          } />
          <Route path="super/access-gate-lockouts" element={
            <AdminGuard superOnly><AccessGateLockouts /></AdminGuard>
          } />
          <Route path="super/audit-log/user-actions" element={
            <AdminGuard superOnly><AuditLogUserActions /></AdminGuard>
          } />
          <Route path="super/one-truth" element={
            <AdminGuard superOnly><OneTruthPage /></AdminGuard>
          } />
          <Route path="super/franchises" element={
            <AdminGuard superOnly><FranchiseHQPage /></AdminGuard>
          } />

          {/* Corporate hierarchy (migration 246) - org chart open to all admins,
              assignments + departments restricted by controller-level guards. */}
          <Route path="corporate/org-chart" element={<CorporateOrgChart />} />
          <Route path="corporate/assignments" element={<CorporateAssignments />} />
          <Route path="super/corporate/departments" element={
            <AdminGuard superOnly><CorporateDepartments /></AdminGuard>
          } />

          {/* OxSteed Logistics branch (migration 247) */}
          <Route path="logistics"                    element={<LogisticsAdminDashboard />} />
          <Route path="logistics/sourcing-ops"       element={<SourcingOpsAdmin />} />
          <Route path="logistics/organizer-approvals" element={<OrganizerApprovalsAdmin />} />
          <Route path="logistics/lanes"              element={<LanesManagement />} />
          <Route path="logistics/suppliers"          element={<SuppliersManagement />} />
          <Route path="logistics/quotes"             element={<QuotesManagement />} />
          <Route path="logistics/campaigns"          element={<CampaignsAdmin />} />
          <Route path="logistics/purchase-orders"   element={<PurchaseOrdersAdmin />} />
          <Route path="logistics/shipment-ops"       element={<ShipmentOpsAdmin />} />
          <Route path="logistics/shipments"          element={<ShipmentsAdmin />} />
          <Route path="logistics/compliance-review"  element={<ComplianceReviewAdmin />} />
          <Route path="logistics/customs"            element={<CustomsAdmin />} />
          <Route path="logistics/warehouse-ops"      element={<WarehouseOpsDashboard />} />
          <Route path="logistics/warehouses"         element={<WarehousesAdmin />} />
          <Route path="logistics/allocations"        element={<AllocationsAdmin />} />
          <Route path="logistics/pricing"            element={<PricingAdmin />} />
          <Route path="logistics/restrictions"       element={<RestrictionsAdmin />} />
          <Route path="logistics/disputes"           element={<DisputesAdmin />} />
          <Route path="logistics/control"            element={<AdminGuard superOnly><SuperAdminLogisticsControl /></AdminGuard>} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
    </QueryClientProvider>
  );
}
