import { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from '../hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';
import GrantGuard from './lib/GrantGuard';
import { adminRoute } from './adminRouteManifest';
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
const SuperDashboard = lazyWithRetry(() => import('./pages/super/Dashboard'));
const UserDetail = lazyWithRetry(() => import('./pages/super/UserDetail'));
const ConversationsAdmin = lazyWithRetry(() => import('./pages/super/ConversationsAdmin'));
const Financials = lazyWithRetry(() => import('./pages/super/Financials'));
const PlatformSettings = lazyWithRetry(() => import('./pages/super/PlatformSettings'));
const AuditLog = lazyWithRetry(() => import('./pages/super/AuditLog'));
const FeeConfig = lazyWithRetry(() => import('./pages/super/FeeConfig'));
const PricingConfig = lazyWithRetry(() => import('./pages/super/PricingConfig'));
const PricingOverrides = lazyWithRetry(() => import('./pages/super/PricingOverrides'));
const CountryPacks = lazyWithRetry(() => import('./pages/super/CountryPacks'));
const ModePolicies = lazyWithRetry(() => import('./pages/super/ModePolicies'));
const ModeApprovals = lazyWithRetry(() => import('./pages/super/ModeApprovals'));
const Revenue = lazyWithRetry(() => import('./pages/super/Revenue'));
const MoneyPage = lazyWithRetry(() => import('./pages/super/MoneyPage'));
const Payouts = lazyWithRetry(() => import('./pages/super/Payouts'));
const AdminAccounts = lazyWithRetry(() => import('./pages/super/AdminAccounts'));
const SearchLogs = lazyWithRetry(() => import('./pages/super/SearchLogs'));
const PermissionGrants = lazyWithRetry(() => import('./pages/super/PermissionGrants'));
const CreateUser = lazyWithRetry(() => import('./pages/super/CreateUser'));
const RegionsManager = lazyWithRetry(() => import('./pages/super/RegionsManager'));
const LogisticsInternalAccess = lazyWithRetry(() => import('./pages/super/LogisticsInternalAccess'));
const AccessGateLockouts = lazyWithRetry(() => import('./pages/super/AccessGateLockouts'));
const AuditLogUserActions = lazyWithRetry(() => import('./pages/super/AuditLogUserActions'));
const OneTruthPage = lazyWithRetry(() => import('./pages/super/OneTruthPage'));
const CorporateOrgChart = lazyWithRetry(() => import('./pages/super/CorporateOrgChart'));
const CorporateAssignments = lazyWithRetry(() => import('./pages/super/CorporateAssignments'));
const CorporateDepartments = lazyWithRetry(() => import('./pages/super/CorporateDepartments'));
const FranchiseHQPage = lazyWithRetry(() => import('./pages/super/FranchiseHQPage'));
const CareersAdmin = lazyWithRetry(() => import('./pages/super/CareersAdmin'));
const RestaurantCreditAdmin = lazyWithRetry(() => import('./pages/super/RestaurantCreditAdmin'));
const OxsteedCreditAdmin = lazyWithRetry(() => import('./pages/super/OxsteedCreditAdmin'));

// OxSteed Logistics admin pages (migration 247)
const LogisticsAdminDashboard = lazyWithRetry(() => import('./pages/logistics/LogisticsAdminDashboard'));
const LanesManagement = lazyWithRetry(() => import('./pages/logistics/LanesManagement'));
const SuppliersManagement = lazyWithRetry(() => import('./pages/logistics/SuppliersManagement'));
const QuotesManagement = lazyWithRetry(() => import('./pages/logistics/QuotesManagement'));
const CampaignsAdmin = lazyWithRetry(() => import('./pages/logistics/CampaignsAdmin'));
const PurchaseOrdersAdmin = lazyWithRetry(() => import('./pages/logistics/PurchaseOrdersAdmin'));
const ShipmentsAdmin = lazyWithRetry(() => import('./pages/logistics/ShipmentsAdmin'));
const CustomsAdmin = lazyWithRetry(() => import('./pages/logistics/CustomsAdmin'));
const WarehousesAdmin = lazyWithRetry(() => import('./pages/logistics/WarehousesAdmin'));
const AllocationsAdmin = lazyWithRetry(() => import('./pages/logistics/AllocationsAdmin'));
const PricingAdmin = lazyWithRetry(() => import('./pages/logistics/PricingAdmin'));
const RestrictionsAdmin = lazyWithRetry(() => import('./pages/logistics/RestrictionsAdmin'));
const DisputesAdmin = lazyWithRetry(() => import('./pages/logistics/DisputesAdmin'));
const SourcingOpsAdmin = lazyWithRetry(() => import('./pages/logistics/SourcingOpsAdmin'));
const OrganizerApprovalsAdmin = lazyWithRetry(() => import('./pages/logistics/OrganizerApprovalsAdmin'));
const ShipmentOpsAdmin = lazyWithRetry(() => import('./pages/logistics/ShipmentOpsAdmin'));
const WarehouseOpsDashboard = lazyWithRetry(() => import('./pages/logistics/WarehouseOpsDashboard'));
const ComplianceReviewAdmin = lazyWithRetry(() => import('./pages/logistics/ComplianceReviewAdmin'));
const SuperAdminLogisticsControl = lazyWithRetry(() => import('./pages/logistics/SuperAdminLogisticsControl'));

// Shared admin pages
const UsersList = lazyWithRetry(() => import('./pages/UsersList'));
const ReportsList = lazyWithRetry(() => import('./pages/ReportsList'));
const BusinessModeration = lazyWithRetry(() => import('./pages/BusinessModeration'));
const BusinessDetail = lazyWithRetry(() => import('./pages/BusinessDetail'));
const ToolRentalModeration = lazyWithRetry(() => import('./pages/ToolRentalModeration'));
const PlannedNeedsAdmin = lazyWithRetry(() => import('./pages/PlannedNeedsAdmin'));
const PaymentsList = lazyWithRetry(() => import('./pages/PaymentsList'));
const Disputes = lazyWithRetry(() => import('./pages/Disputes'));
const DisputeResolve = lazyWithRetry(() => import('./pages/DisputeResolve'));
const MarketZipCodes = lazyWithRetry(() => import('./pages/MarketZipCodes'));
const DirectServiceAreas = lazyWithRetry(() => import('./pages/DirectServiceAreas'));
const DirectCatalog = lazyWithRetry(() => import('./pages/DirectCatalog'));
const JobsList = lazyWithRetry(() => import('./pages/JobsList'));
const JobDetail = lazyWithRetry(() => import('./pages/JobDetail'));
const Moderation = lazyWithRetry(() => import('./pages/Moderation'));
const SkillsManager = lazyWithRetry(() => import('./pages/SkillsManager'));
const LicensesManager = lazyWithRetry(() => import('./pages/LicensesManager'));
const ContentRemovals = lazyWithRetry(() => import('./pages/ContentRemovals'));
const SupportTickets = lazyWithRetry(() => import('./pages/SupportTickets'));
const QuoteRequestsInbox = lazyWithRetry(() => import('./pages/QuoteRequestsInbox'));
const AdminSearch = lazyWithRetry(() => import('./pages/AdminSearch'));
const AdminMessages = lazyWithRetry(() => import('./pages/AdminMessages'));
const ConsultingDashboard = lazyWithRetry(() => import('./pages/ConsultingDashboard'));
const ConsultingPayments = lazyWithRetry(() => import('./pages/ConsultingPayments'));
const ConsultingScheduler = lazyWithRetry(() => import('./pages/ConsultingScheduler'));
const ConsultingAnalyticsDashboard = lazyWithRetry(() => import('./pages/ConsultingAnalyticsDashboard'));
const BusinessLaunchAdmin = lazyWithRetry(() => import('./pages/BusinessLaunchAdmin'));
const ConsultingSessionsAdmin = lazyWithRetry(() => import('./pages/ConsultingSessionsAdmin'));
const OrderManagement = lazyWithRetry(() => import('./pages/OrderManagement'));
const TemplateManagement = lazyWithRetry(() => import('./pages/TemplateManagement'));
const TemplatePreviewPage = lazyWithRetry(() => import('./pages/TemplatePreviewPage'));
const AdminLogin = lazyWithRetry(() => import('./pages/Login'));
const SupportCSATAnalytics = lazyWithRetry(() => import('./pages/SupportCSATAnalytics'));
const SupportEscalationManager = lazyWithRetry(() => import('./pages/SupportEscalationManager'));
const SupportTeamHierarchy = lazyWithRetry(() => import('./pages/SupportTeamHierarchy'));
const SupportSettingsPage = lazyWithRetry(() => import('./pages/SupportSettingsPage'));
const SupportAuditLog = lazyWithRetry(() => import('./pages/SupportAuditLog'));
const SupportAgentDashboard = lazyWithRetry(() => import('./pages/SupportAgentDashboard'));
const SupportAgentOnboarding = lazyWithRetry(() => import('./pages/SupportAgentOnboarding'));
const SupportShiftsManager = lazyWithRetry(() => import('./pages/SupportShiftsManager'));
const SupportAgentManagement = lazyWithRetry(() => import('./pages/SupportAgentManagement'));
const SupportAgentChat = lazyWithRetry(() => import('./pages/SupportAgentChat'));
const SupportKnowledgeBase = lazyWithRetry(() => import('./pages/SupportKnowledgeBase'));
const SupportTemplates = lazyWithRetry(() => import('./pages/SupportTemplates'));
const SupportMetricsDashboard = lazyWithRetry(() => import('./pages/SupportMetricsDashboard'));
const SupportSLADashboard = lazyWithRetry(() => import('./pages/SupportSLADashboard'));
const SupportPerformanceAnalytics = lazyWithRetry(() => import('./pages/SupportPerformanceAnalytics'));
const SupportQAReviews = lazyWithRetry(() => import('./pages/SupportQAReviews'));
const AdminLegalAcceptancesPage = lazyWithRetry(() => import('./pages/AdminLegalAcceptancesPage'));
const AdminLegalAuditLogPage = lazyWithRetry(() => import('./pages/AdminLegalAuditLogPage'));
const AdminComplianceMetricsPage = lazyWithRetry(() => import('./pages/AdminComplianceMetricsPage'));
const AdminCCPARequestsPage = lazyWithRetry(() => import('./pages/AdminCCPARequestsPage'));
const AdminReportsDashboard = lazyWithRetry(() => import('./pages/AdminReportsDashboard'));
const AdminEnforcementDashboard = lazyWithRetry(() => import('./pages/AdminEnforcementDashboard'));
const LearnSubmissionsAdmin = lazyWithRetry(() => import('./pages/LearnSubmissionsAdmin'));
const LearnProductLinksAdmin = lazyWithRetry(() => import('./pages/LearnProductLinksAdmin'));
const OperationsOverview = lazyWithRetry(() => import('./pages/OperationsOverview'));

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
          <Route path={adminRoute('dashboard').relative} element={<SuperDashboard />} />
          <Route path={adminRoute('operations').relative} element={<OperationsOverview />} />
          <Route path={adminRoute('users').relative} element={<UsersList />} />
          <Route path="users/:userId"       element={<UserDetail />} />
          <Route path={adminRoute('jobs').relative} element={<JobsList />} />
          <Route path="jobs/:jobId"        element={<JobDetail />} />
          <Route path={adminRoute('reports').relative} element={<ReportsList />} />
          <Route path={adminRoute('moderation').relative} element={<Moderation />} />
          <Route path="disputes"            element={<Disputes />} />
          <Route path="disputes/:disputeId" element={<DisputeResolve />} />
          <Route path="markets"             element={<MarketZipCodes />} />
          <Route path={adminRoute('directServiceAreas').relative} element={<DirectServiceAreas />} />
          <Route path={adminRoute('directCatalog').relative} element={<DirectCatalog embedded />} />
          <Route path={adminRoute('skills').relative} element={<SkillsManager />} />
          <Route path="licenses"            element={<LicensesManager />} />
          <Route path={adminRoute('contentRemovals').relative} element={<ContentRemovals />} />
          <Route path={adminRoute('support').relative} element={<SupportTickets />} />
          <Route path={adminRoute('quoteRequests').relative} element={<QuoteRequestsInbox />} />
          <Route path={adminRoute('search').relative} element={<AdminSearch />} />
          <Route path={adminRoute('messages').relative} element={
            <GrantGuard grant={adminRoute('messages').grant}><AdminMessages /></GrantGuard>
          } />
          <Route path={adminRoute('businesses').relative} element={<BusinessModeration />} />
          <Route path="businesses/:id"      element={<BusinessDetail />} />
          <Route path={adminRoute('toolRentals').relative} element={<ToolRentalModeration />} />
          <Route path={adminRoute('plannedNeeds').relative} element={<PlannedNeedsAdmin />} />
          <Route path={adminRoute('payments').relative} element={
            <GrantGuard grant={adminRoute('payments').grant}><PaymentsList /></GrantGuard>
          } />
          <Route path={adminRoute('orders').relative} element={<OrderManagement />} />
          <Route path={adminRoute('templates').relative} element={<TemplateManagement />} />
          <Route path={adminRoute('consulting').relative} element={<ConsultingDashboard />} />
          <Route path={adminRoute('consultingPayments').relative} element={<ConsultingPayments />} />
          <Route path={adminRoute('scheduling').relative} element={<ConsultingScheduler />} />
          <Route path="consulting/analytics" element={<ConsultingAnalyticsDashboard />} />
          <Route path={adminRoute('businessLaunch').relative} element={<BusinessLaunchAdmin />} />
          <Route path={adminRoute('consultingSessions').relative} element={<ConsultingSessionsAdmin />} />
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
          <Route path={adminRoute('learnSubmissions').relative} element={<LearnSubmissionsAdmin />} />
          <Route path={adminRoute('learnProductLinks').relative} element={<LearnProductLinksAdmin />} />

          {/* Reputation & Enforcement */}
          <Route path="reports/dashboard" element={<AdminReportsDashboard />} />
          <Route path={adminRoute('enforcement').relative} element={<AdminEnforcementDashboard />} />

          {/* Legal & Compliance */}
          <Route path="legal/acceptances" element={<AdminLegalAcceptancesPage />} />
          <Route path="legal/audit-log" element={<AdminLegalAuditLogPage />} />
          <Route path="legal/compliance-metrics" element={<AdminComplianceMetricsPage />} />
          <Route path="legal/ccpa-requests" element={<AdminCCPARequestsPage />} />

          {/* Super admin and grant-gated routes.
              GrantGuard checks the admin's permission grants (super-admins
              bypass via their implicit all-grants status). Pages whose server
              endpoints have no backing grant scope stay superOnly: super/fees
              (no manage_fees scope; fee mutations are super-only), and
              super/franchises + super/careers (no franchise/careers scopes). */}
          <Route path={adminRoute('superDashboard').relative} element={
            <AdminGuard superOnly={adminRoute('superDashboard').superOnly}><SuperDashboard /></AdminGuard>
          } />
          <Route path={adminRoute('revenue').relative} element={
            <GrantGuard grant={adminRoute('revenue').grant}><Revenue /></GrantGuard>
          } />
          <Route path={adminRoute('money').relative} element={
            <GrantGuard grant={adminRoute('money').grant}><MoneyPage /></GrantGuard>
          } />
          <Route path={adminRoute('restaurantCredit').relative} element={
            <AdminGuard superOnly={adminRoute('restaurantCredit').superOnly}><RestaurantCreditAdmin /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCredit').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCredit').superOnly}><OxsteedCreditAdmin /></AdminGuard>
          } />
          <Route path={adminRoute('financials').relative} element={
            <GrantGuard grant={adminRoute('financials').grant}><Financials /></GrantGuard>
          } />
          <Route path={adminRoute('payouts').relative} element={
            <GrantGuard grant={adminRoute('payouts').grant}><Payouts /></GrantGuard>
          } />
          <Route path={adminRoute('conversations').relative} element={
            <AdminGuard superOnly={adminRoute('conversations').superOnly}><ConversationsAdmin /></AdminGuard>
          } />
          <Route path={adminRoute('settings').relative} element={
            <GrantGuard grant={adminRoute('settings').grant}><PlatformSettings /></GrantGuard>
          } />
          <Route path={adminRoute('auditLog').relative} element={
            <GrantGuard grant={adminRoute('auditLog').grant}><AuditLog /></GrantGuard>
          } />
          {/* Stays superOnly: no manage_fees scope exists in the permission
              catalogue, and the fee mutations (/api/fee-config PUT + reset)
              are super-only on the server. */}
          <Route path={adminRoute('feeConfig').relative} element={
            <AdminGuard superOnly={adminRoute('feeConfig').superOnly}><FeeConfig /></AdminGuard>
          } />
          <Route path={adminRoute('pricingConfig').relative} element={
            <AdminGuard superOnly={adminRoute('pricingConfig').superOnly}><PricingConfig /></AdminGuard>
          } />
          <Route path={adminRoute('pricingOverrides').relative} element={
            <AdminGuard superOnly={adminRoute('pricingOverrides').superOnly}><PricingOverrides /></AdminGuard>
          } />
          <Route path={adminRoute('countryPacks').relative} element={
            <AdminGuard superOnly={adminRoute('countryPacks').superOnly}><CountryPacks /></AdminGuard>
          } />
          <Route path={adminRoute('modePolicies').relative} element={
            <AdminGuard superOnly={adminRoute('modePolicies').superOnly}><ModePolicies /></AdminGuard>
          } />
          <Route path={adminRoute('modeApprovals').relative} element={
            <AdminGuard superOnly={adminRoute('modeApprovals').superOnly}><ModeApprovals /></AdminGuard>
          } />
          <Route path={adminRoute('adminAccounts').relative} element={
            <GrantGuard grant={adminRoute('adminAccounts').grant}><AdminAccounts /></GrantGuard>
          } />
          <Route path={adminRoute('searchLogs').relative} element={
            <AdminGuard superOnly={adminRoute('searchLogs').superOnly}><SearchLogs /></AdminGuard>
          } />
          <Route path={adminRoute('permissions').relative} element={
            <GrantGuard grant={adminRoute('permissions').grant}><PermissionGrants /></GrantGuard>
          } />
          <Route path={adminRoute('createUser').relative} element={
            <AdminGuard superOnly={adminRoute('createUser').superOnly}><CreateUser /></AdminGuard>
          } />
          <Route path={adminRoute('regions').relative} element={
            <AdminGuard superOnly={adminRoute('regions').superOnly}><RegionsManager /></AdminGuard>
          } />
          <Route path={adminRoute('internalAccess').relative} element={
            <AdminGuard superOnly={adminRoute('internalAccess').superOnly}><LogisticsInternalAccess /></AdminGuard>
          } />
          <Route path={adminRoute('gateLockouts').relative} element={
            <AdminGuard superOnly={adminRoute('gateLockouts').superOnly}><AccessGateLockouts /></AdminGuard>
          } />
          <Route path={adminRoute('userActionLog').relative} element={
            <GrantGuard grant={adminRoute('userActionLog').grant}><AuditLogUserActions /></GrantGuard>
          } />
          <Route path={adminRoute('oneTruth').relative} element={
            <AdminGuard superOnly={adminRoute('oneTruth').superOnly}><OneTruthPage /></AdminGuard>
          } />
          {/* Stays superOnly: no franchise/careers scopes exist in the
              permission catalogue, so there is no grant to honor. */}
          <Route path={adminRoute('franchiseHq').relative} element={
            <AdminGuard superOnly={adminRoute('franchiseHq').superOnly}><FranchiseHQPage /></AdminGuard>
          } />
          <Route path={adminRoute('careers').relative} element={
            <AdminGuard superOnly={adminRoute('careers').superOnly}><CareersAdmin /></AdminGuard>
          } />

          {/* Corporate hierarchy (migration 246) - org chart open to all admins,
              assignments + departments restricted by controller-level guards. */}
          <Route path={adminRoute('orgChart').relative} element={<CorporateOrgChart />} />
          <Route path={adminRoute('corporateAssignments').relative} element={<CorporateAssignments />} />
          <Route path={adminRoute('corporateSetup').relative} element={
            <AdminGuard superOnly={adminRoute('corporateSetup').superOnly}><CorporateDepartments /></AdminGuard>
          } />

          {/* OxSteed Logistics branch (migration 247) */}
          <Route path={adminRoute('logistics').relative} element={<LogisticsAdminDashboard />} />
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
          <Route path={adminRoute('logisticsControl').relative} element={<AdminGuard superOnly={adminRoute('logisticsControl').superOnly}><SuperAdminLogisticsControl /></AdminGuard>} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </QueryClientProvider>
  );
}
