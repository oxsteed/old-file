import { lazy, Suspense } from 'react';
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
const SuperDashboard = lazy(() => import('./pages/super/Dashboard'));
const UserDetail = lazy(() => import('./pages/super/UserDetail'));
const ConversationsAdmin = lazy(() => import('./pages/super/ConversationsAdmin'));
const Financials = lazy(() => import('./pages/super/Financials'));
const PlatformSettings = lazy(() => import('./pages/super/PlatformSettings'));
const AuditLog = lazy(() => import('./pages/super/AuditLog'));
const FeeConfig = lazy(() => import('./pages/super/FeeConfig'));
const PricingConfig = lazy(() => import('./pages/super/PricingConfig'));
const PricingOverrides = lazy(() => import('./pages/super/PricingOverrides'));
const CountryPacks = lazy(() => import('./pages/super/CountryPacks'));
const ModePolicies = lazy(() => import('./pages/super/ModePolicies'));
const ModeApprovals = lazy(() => import('./pages/super/ModeApprovals'));
const Revenue = lazy(() => import('./pages/super/Revenue'));
const MoneyPage = lazy(() => import('./pages/super/MoneyPage'));
const Payouts = lazy(() => import('./pages/super/Payouts'));
const AdminAccounts = lazy(() => import('./pages/super/AdminAccounts'));
const SearchLogs = lazy(() => import('./pages/super/SearchLogs'));
const PermissionGrants = lazy(() => import('./pages/super/PermissionGrants'));
const CreateUser = lazy(() => import('./pages/super/CreateUser'));
const RegionsManager = lazy(() => import('./pages/super/RegionsManager'));
const LogisticsInternalAccess = lazy(() => import('./pages/super/LogisticsInternalAccess'));
const AccessGateLockouts = lazy(() => import('./pages/super/AccessGateLockouts'));
const AuditLogUserActions = lazy(() => import('./pages/super/AuditLogUserActions'));
const OneTruthPage = lazy(() => import('./pages/super/OneTruthPage'));
const CorporateOrgChart = lazy(() => import('./pages/super/CorporateOrgChart'));
const CorporateAssignments = lazy(() => import('./pages/super/CorporateAssignments'));
const CorporateDepartments = lazy(() => import('./pages/super/CorporateDepartments'));
const FranchiseHQPage = lazy(() => import('./pages/super/FranchiseHQPage'));
const CareersAdmin = lazy(() => import('./pages/super/CareersAdmin'));
const RestaurantCreditAdmin = lazy(() => import('./pages/super/RestaurantCreditAdmin'));
const OxsteedCreditAdmin = lazy(() => import('./pages/super/OxsteedCreditAdmin'));

// OxSteed Logistics admin pages (migration 247)
const LogisticsAdminDashboard = lazy(() => import('./pages/logistics/LogisticsAdminDashboard'));
const LanesManagement = lazy(() => import('./pages/logistics/LanesManagement'));
const SuppliersManagement = lazy(() => import('./pages/logistics/SuppliersManagement'));
const QuotesManagement = lazy(() => import('./pages/logistics/QuotesManagement'));
const CampaignsAdmin = lazy(() => import('./pages/logistics/CampaignsAdmin'));
const PurchaseOrdersAdmin = lazy(() => import('./pages/logistics/PurchaseOrdersAdmin'));
const ShipmentsAdmin = lazy(() => import('./pages/logistics/ShipmentsAdmin'));
const CustomsAdmin = lazy(() => import('./pages/logistics/CustomsAdmin'));
const WarehousesAdmin = lazy(() => import('./pages/logistics/WarehousesAdmin'));
const AllocationsAdmin = lazy(() => import('./pages/logistics/AllocationsAdmin'));
const PricingAdmin = lazy(() => import('./pages/logistics/PricingAdmin'));
const RestrictionsAdmin = lazy(() => import('./pages/logistics/RestrictionsAdmin'));
const DisputesAdmin = lazy(() => import('./pages/logistics/DisputesAdmin'));
const SourcingOpsAdmin = lazy(() => import('./pages/logistics/SourcingOpsAdmin'));
const OrganizerApprovalsAdmin = lazy(() => import('./pages/logistics/OrganizerApprovalsAdmin'));
const ShipmentOpsAdmin = lazy(() => import('./pages/logistics/ShipmentOpsAdmin'));
const WarehouseOpsDashboard = lazy(() => import('./pages/logistics/WarehouseOpsDashboard'));
const ComplianceReviewAdmin = lazy(() => import('./pages/logistics/ComplianceReviewAdmin'));
const SuperAdminLogisticsControl = lazy(() => import('./pages/logistics/SuperAdminLogisticsControl'));

// Shared admin pages
const UsersList = lazy(() => import('./pages/UsersList'));
const ReportsList = lazy(() => import('./pages/ReportsList'));
const BusinessModeration = lazy(() => import('./pages/BusinessModeration'));
const BusinessDetail = lazy(() => import('./pages/BusinessDetail'));
const ToolRentalModeration = lazy(() => import('./pages/ToolRentalModeration'));
const PlannedNeedsAdmin = lazy(() => import('./pages/PlannedNeedsAdmin'));
const PaymentsList = lazy(() => import('./pages/PaymentsList'));
const Disputes = lazy(() => import('./pages/Disputes'));
const DisputeResolve = lazy(() => import('./pages/DisputeResolve'));
const MarketZipCodes = lazy(() => import('./pages/MarketZipCodes'));
const DirectServiceAreas = lazy(() => import('./pages/DirectServiceAreas'));
const DirectCatalog = lazy(() => import('./pages/DirectCatalog'));
const JobsList = lazy(() => import('./pages/JobsList'));
const JobDetail = lazy(() => import('./pages/JobDetail'));
const Moderation = lazy(() => import('./pages/Moderation'));
const SkillsManager = lazy(() => import('./pages/SkillsManager'));
const LicensesManager = lazy(() => import('./pages/LicensesManager'));
const ContentRemovals = lazy(() => import('./pages/ContentRemovals'));
const SupportTickets = lazy(() => import('./pages/SupportTickets'));
const QuoteRequestsInbox = lazy(() => import('./pages/QuoteRequestsInbox'));
const AdminSearch = lazy(() => import('./pages/AdminSearch'));
const AdminMessages = lazy(() => import('./pages/AdminMessages'));
const ConsultingDashboard = lazy(() => import('./pages/ConsultingDashboard'));
const ConsultingPayments = lazy(() => import('./pages/ConsultingPayments'));
const ConsultingScheduler = lazy(() => import('./pages/ConsultingScheduler'));
const ConsultingAnalyticsDashboard = lazy(() => import('./pages/ConsultingAnalyticsDashboard'));
const BusinessLaunchAdmin = lazy(() => import('./pages/BusinessLaunchAdmin'));
const ConsultingSessionsAdmin = lazy(() => import('./pages/ConsultingSessionsAdmin'));
const OrderManagement = lazy(() => import('./pages/OrderManagement'));
const TemplateManagement = lazy(() => import('./pages/TemplateManagement'));
const TemplatePreviewPage = lazy(() => import('./pages/TemplatePreviewPage'));
const AdminLogin = lazy(() => import('./pages/Login'));
const SupportCSATAnalytics = lazy(() => import('./pages/SupportCSATAnalytics'));
const SupportEscalationManager = lazy(() => import('./pages/SupportEscalationManager'));
const SupportTeamHierarchy = lazy(() => import('./pages/SupportTeamHierarchy'));
const SupportSettingsPage = lazy(() => import('./pages/SupportSettingsPage'));
const SupportAuditLog = lazy(() => import('./pages/SupportAuditLog'));
const SupportAgentDashboard = lazy(() => import('./pages/SupportAgentDashboard'));
const SupportAgentOnboarding = lazy(() => import('./pages/SupportAgentOnboarding'));
const SupportShiftsManager = lazy(() => import('./pages/SupportShiftsManager'));
const SupportAgentManagement = lazy(() => import('./pages/SupportAgentManagement'));
const SupportAgentChat = lazy(() => import('./pages/SupportAgentChat'));
const SupportKnowledgeBase = lazy(() => import('./pages/SupportKnowledgeBase'));
const SupportTemplates = lazy(() => import('./pages/SupportTemplates'));
const SupportMetricsDashboard = lazy(() => import('./pages/SupportMetricsDashboard'));
const SupportSLADashboard = lazy(() => import('./pages/SupportSLADashboard'));
const SupportPerformanceAnalytics = lazy(() => import('./pages/SupportPerformanceAnalytics'));
const SupportQAReviews = lazy(() => import('./pages/SupportQAReviews'));
const AdminLegalAcceptancesPage = lazy(() => import('./pages/AdminLegalAcceptancesPage'));
const AdminLegalAuditLogPage = lazy(() => import('./pages/AdminLegalAuditLogPage'));
const AdminComplianceMetricsPage = lazy(() => import('./pages/AdminComplianceMetricsPage'));
const AdminCCPARequestsPage = lazy(() => import('./pages/AdminCCPARequestsPage'));
const AdminReportsDashboard = lazy(() => import('./pages/AdminReportsDashboard'));
const AdminEnforcementDashboard = lazy(() => import('./pages/AdminEnforcementDashboard'));
const LearnSubmissionsAdmin = lazy(() => import('./pages/LearnSubmissionsAdmin'));
const LearnProductLinksAdmin = lazy(() => import('./pages/LearnProductLinksAdmin'));

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
      <Suspense fallback={(
        <div role="status" className="min-h-screen flex items-center justify-center text-gray-700">
          Loading admin screen…
        </div>
      )}>
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
          <Route path="support/qa" element={<SupportQAReviews />} />
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
          <Route path="super/restaurant-credit" element={
            <AdminGuard superOnly><RestaurantCreditAdmin /></AdminGuard>
          } />
          <Route path="super/oxsteed-credit" element={
            <AdminGuard superOnly><OxsteedCreditAdmin /></AdminGuard>
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
          <Route path="super/careers" element={
            <AdminGuard superOnly><CareersAdmin /></AdminGuard>
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
      </Suspense>
    </BrowserRouter>
    </QueryClientProvider>
  );
}
