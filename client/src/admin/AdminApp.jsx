import { Suspense } from 'react';
import { lazyWithRetry } from '../utils/lazyWithRetry';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';
import GrantGuard from './lib/GrantGuard';
import AdminErrorState from './lib/AdminErrorState';
import { adminRoute } from './adminRouteManifest';
import TwoFactorSetup from '../pages/Settings/TwoFactorSetup';
import CommandPalette from '../components/CommandPalette';

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
const Customer360 = lazyWithRetry(() => import('./pages/Customer360'));
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
const GovernancePage = lazyWithRetry(() => import('./pages/super/workspaces/GovernancePage'));
const Revenue = lazyWithRetry(() => import('./pages/super/Revenue'));
const MoneyPage = lazyWithRetry(() => import('./pages/super/MoneyPage'));
const Payouts = lazyWithRetry(() => import('./pages/super/Payouts'));
const RestaurantPayouts = lazyWithRetry(() => import('./pages/super/RestaurantPayouts'));
const TreasuryPage = lazyWithRetry(() => import('./pages/super/workspaces/TreasuryPage'));
const ReliabilityPage = lazyWithRetry(() => import('./pages/super/workspaces/ReliabilityPage'));
const ServiceOpsPage = lazyWithRetry(() => import('./pages/super/workspaces/ServiceOpsPage'));
const ReconciliationExceptions = lazyWithRetry(() => import('./pages/ReconciliationExceptions'));
const AdminAccounts = lazyWithRetry(() => import('./pages/super/AdminAccounts'));
const SearchLogs = lazyWithRetry(() => import('./pages/super/SearchLogs'));
const PermissionGrants = lazyWithRetry(() => import('./pages/super/PermissionGrants'));
const WorkforcePage = lazyWithRetry(() => import('./pages/super/workspaces/WorkforcePage'));
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
const RestaurantTopupApprovals = lazyWithRetry(() => import('./pages/super/RestaurantTopupApprovals'));
const FeaturedPlacementReview = lazyWithRetry(() => import('./pages/super/FeaturedPlacementReview'));
const StatementOperations = lazyWithRetry(() => import('./pages/super/StatementOperations'));
const OxsteedCreditOverviewPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/OverviewPage'));
const OxsteedCreditApprovalsPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/ApprovalsPage'));
const OxsteedCreditDisputesPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/DisputesPage'));
const OxsteedCreditSettlementsPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/SettlementsPage'));
const OxsteedCreditReconciliationPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/ReconciliationPage'));
const OxsteedCreditCompliancePage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/CompliancePage'));
const OxsteedCreditReservesPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/ReservesPage'));
const OxsteedCreditPartnersPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/PartnersPage'));
const OxsteedCreditHealthPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/HealthPage'));
const OxsteedCreditAuditPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/AuditPage'));
const OxsteedCreditCustomersPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/CustomersPage'));
const OxsteedCreditMoneyOutPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/MoneyOutPage'));
const OxsteedCreditCardsPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/CardsPage'));
const OxsteedCreditLedgerPage = lazyWithRetry(() => import('./pages/super/oxsteedCredit/LedgerPage'));

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
const Business360 = lazyWithRetry(() => import('./pages/Business360'));
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
const MediaFlags = lazyWithRetry(() => import('./pages/MediaFlags'));
const AdminFoodOrders = lazyWithRetry(() => import('./pages/AdminFoodOrders'));
const AdminFoodOrderDetail = lazyWithRetry(() => import('./pages/AdminFoodOrderDetail'));
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
const AdminUserSettingsPage = lazyWithRetry(() => import('../pages/admin/AdminUserSettingsPage'));
const AdminReportsDashboard = lazyWithRetry(() => import('./pages/AdminReportsDashboard'));
const AdminEnforcementDashboard = lazyWithRetry(() => import('./pages/AdminEnforcementDashboard'));
const VisitorHistoryPage = lazyWithRetry(() => import('./pages/VisitorHistoryPage'));
const ProfileVisibilityPage = lazyWithRetry(() => import('./pages/ProfileVisibilityPage'));
const LearnSubmissionsAdmin = lazyWithRetry(() => import('./pages/LearnSubmissionsAdmin'));
const LearnProductLinksAdmin = lazyWithRetry(() => import('./pages/LearnProductLinksAdmin'));
const LearnAiSuggestionsAdmin = lazyWithRetry(() => import('./pages/LearnAiSuggestionsAdmin'));
const OperationsOverview = lazyWithRetry(() => import('./pages/OperationsOverview'));
const IncidentManagement = lazyWithRetry(() => import('./pages/IncidentManagement'));
const ProviderHealthPage = lazyWithRetry(() => import('./pages/ProviderHealthPage'));

function AdminGuard({ children, superOnly = false }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) return (
    <div className="h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-4 border-orange-500
        border-t-transparent rounded-full" />
    </div>
  );

  if (!user) return <Navigate to="/admin/login" replace />;
  if (!['admin','super_admin'].includes(user.role)) {
    // Audit L9: an authenticated non-admin must NOT be bounced to "/".
    // "/" is not a route in the admin SPA, so the "*" catch-all sent them
    // back to /admin/dashboard -> AdminGuard -> "/" ... an infinite
    // redirect loop. Render an access-denied panel instead, which
    // terminates the navigation.
    return (
      <div className="min-h-screen bg-gray-950 p-6 flex items-start justify-center">
        <div className="w-full max-w-xl mt-16">
          <AdminErrorState
            title={t('adminGrantGuard.title')}
            message={t('adminGrantGuard.message', { grant: 'admin' })}
          />
        </div>
      </div>
    );
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
      <CommandPalette />
      <Suspense fallback={(
        <div role="status" className="min-h-screen flex items-center justify-center text-gray-700">
          Loading admin screen…
        </div>
      )}>
      <Routes>
        {/* Public login route */}
        <Route path={adminRoute('login').path} element={<AdminLogin />} />
        <Route path={adminRoute('twoFactorSetup').path} element={
          <AdminGuard><TwoFactorSetup adminSetup /></AdminGuard>
        } />

        {/* Full-width template preview (no sidebar) - still requires admin auth */}
        <Route path={adminRoute('templatePreview').path} element={
          <AdminGuard>
            <TemplatePreviewPage />
          </AdminGuard>
        } />

        {/* Protected admin routes */}
        <Route path={adminRoute('root').path} element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }>
          {/* Default redirect */}
          <Route index element={<Navigate to="/admin/dashboard" replace />} />

          {/* Regular admin */}
          <Route path={adminRoute('dashboard').relative} element={<GrantGuard grant={adminRoute('dashboard').grant}><SuperDashboard /></GrantGuard>} />
          <Route path={adminRoute('operations').relative} element={<GrantGuard grant={adminRoute('operations').grant}><OperationsOverview /></GrantGuard>} />
          <Route path={adminRoute('incidents').relative} element={
            <GrantGuard grant={adminRoute('incidents').grant}><IncidentManagement /></GrantGuard>
          } />
          <Route path={adminRoute('providerHealth').relative} element={
            <GrantGuard grant={adminRoute('providerHealth').grant}><ProviderHealthPage /></GrantGuard>
          } />
          <Route path={adminRoute('users').relative} element={<GrantGuard grant={adminRoute('users').grant}><UsersList /></GrantGuard>} />
          <Route path={adminRoute('userDetail').relative} element={<UserDetail />} />
          <Route path={adminRoute('customer360').relative} element={<Customer360 />} />
          <Route path={adminRoute('jobs').relative} element={<GrantGuard grant={adminRoute('jobs').grant}><JobsList /></GrantGuard>} />
          <Route path={adminRoute('jobDetail').relative} element={<GrantGuard grant={adminRoute('jobDetail').grant}><JobDetail /></GrantGuard>} />
          <Route path={adminRoute('reports').relative} element={<GrantGuard grant={adminRoute('reports').grant}><ReportsList /></GrantGuard>} />
          <Route path={adminRoute('moderation').relative} element={<GrantGuard grant={adminRoute('moderation').grant}><Moderation /></GrantGuard>} />
          <Route path={adminRoute('disputeList').relative} element={<GrantGuard grant={adminRoute('disputeList').grant}><Disputes /></GrantGuard>} />
          <Route path={adminRoute('disputeDetail').relative} element={<GrantGuard grant={adminRoute('disputeDetail').grant}><DisputeResolve /></GrantGuard>} />
          <Route path={adminRoute('markets').relative} element={<MarketZipCodes />} />
          <Route path={adminRoute('directServiceAreas').relative} element={<GrantGuard grant={adminRoute('directServiceAreas').grant}><DirectServiceAreas /></GrantGuard>} />
          <Route path={adminRoute('directCatalog').relative} element={<GrantGuard grant={adminRoute('directCatalog').grant}><DirectCatalog embedded /></GrantGuard>} />
          <Route path={adminRoute('skills').relative} element={<GrantGuard grant={adminRoute('skills').grant}><SkillsManager /></GrantGuard>} />
          <Route path={adminRoute('licenses').relative} element={<LicensesManager />} />
          <Route path={adminRoute('contentRemovals').relative} element={<GrantGuard grant={adminRoute('contentRemovals').grant}><ContentRemovals /></GrantGuard>} />
          <Route path={adminRoute('mediaFlags').relative} element={<GrantGuard grant={adminRoute('mediaFlags').grant}><MediaFlags /></GrantGuard>} />
          <Route path={adminRoute('foodOrders').relative} element={<GrantGuard grant={adminRoute('foodOrders').grant}><AdminFoodOrders /></GrantGuard>} />
          <Route path={adminRoute('foodOrderDetail').relative} element={<GrantGuard grant={adminRoute('foodOrderDetail').grant}><AdminFoodOrderDetail /></GrantGuard>} />
          <Route path={adminRoute('support').relative} element={<GrantGuard grant={adminRoute('support').grant}><SupportTickets /></GrantGuard>} />
          <Route path={adminRoute('supportChat').relative} element={<SupportAgentChat />} />
          <Route path={adminRoute('quoteRequests').relative} element={<GrantGuard grant={adminRoute('quoteRequests').grant}><QuoteRequestsInbox /></GrantGuard>} />
          <Route path={adminRoute('search').relative} element={<GrantGuard grant={adminRoute('search').grant}><AdminSearch /></GrantGuard>} />
          <Route path={adminRoute('messages').relative} element={
            <GrantGuard grant={adminRoute('messages').grant}><AdminMessages /></GrantGuard>
          } />
          <Route path={adminRoute('businesses').relative} element={<GrantGuard grant={adminRoute('businesses').grant}><BusinessModeration /></GrantGuard>} />
          <Route path={adminRoute('businessDetail').relative} element={<GrantGuard grant={adminRoute('businessDetail').grant}><BusinessDetail /></GrantGuard>} />
          <Route path={adminRoute('business360').relative} element={<GrantGuard grant={adminRoute('business360').grant}><Business360 /></GrantGuard>} />
          <Route path={adminRoute('toolRentals').relative} element={<GrantGuard grant={adminRoute('toolRentals').grant}><ToolRentalModeration /></GrantGuard>} />
          <Route path={adminRoute('plannedNeeds').relative} element={<GrantGuard grant={adminRoute('plannedNeeds').grant}><PlannedNeedsAdmin /></GrantGuard>} />
          <Route path={adminRoute('payments').relative} element={
            <GrantGuard grant={adminRoute('payments').grant}><PaymentsList /></GrantGuard>
          } />
          <Route path={adminRoute('orders').relative} element={<OrderManagement />} />
          <Route path={adminRoute('templates').relative} element={<TemplateManagement />} />
          <Route path={adminRoute('consulting').relative} element={<ConsultingDashboard />} />
          <Route path={adminRoute('consultingPayments').relative} element={<ConsultingPayments />} />
          <Route path={adminRoute('scheduling').relative} element={<ConsultingScheduler />} />
          <Route path={adminRoute('consultingAnalytics').relative} element={<ConsultingAnalyticsDashboard />} />
          <Route path={adminRoute('businessLaunch').relative} element={<BusinessLaunchAdmin />} />
          <Route path={adminRoute('consultingSessions').relative} element={<ConsultingSessionsAdmin />} />
          <Route path={adminRoute('supportAgentDashboard').relative} element={<SupportAgentDashboard />} />
          <Route path={adminRoute('supportAgentOnboarding').relative} element={<SupportAgentOnboarding />} />
          <Route path={adminRoute('supportShifts').relative} element={<SupportShiftsManager />} />
          <Route path={adminRoute('supportAgents').relative} element={<SupportAgentManagement />} />
          <Route path={adminRoute('supportKnowledgeBase').relative} element={<SupportKnowledgeBase />} />
          <Route path={adminRoute('supportTemplates').relative} element={<SupportTemplates />} />
          <Route path={adminRoute('supportMetrics').relative} element={<SupportMetricsDashboard />} />
          <Route path={adminRoute('supportSla').relative} element={<SupportSLADashboard />} />
          <Route path={adminRoute('supportPerformance').relative} element={<SupportPerformanceAnalytics />} />
          <Route path={adminRoute('supportCsat').relative} element={<SupportCSATAnalytics />} />
          <Route path={adminRoute('supportQa').relative} element={<SupportQAReviews />} />
          <Route path={adminRoute('supportEscalations').relative} element={<SupportEscalationManager />} />
          <Route path={adminRoute('supportTeamHierarchy').relative} element={<SupportTeamHierarchy />} />
          <Route path={adminRoute('supportSettings').relative} element={<SupportSettingsPage />} />
          <Route path={adminRoute('supportAudit').relative} element={<SupportAuditLog />} />

          {/* Learn Mode */}
          <Route path={adminRoute('learnSubmissions').relative} element={<GrantGuard grant={adminRoute('learnSubmissions').grant}><LearnSubmissionsAdmin /></GrantGuard>} />
          <Route path={adminRoute('learnProductLinks').relative} element={<GrantGuard grant={adminRoute('learnProductLinks').grant}><LearnProductLinksAdmin /></GrantGuard>} />
          <Route path={adminRoute('learnAiSuggestions').relative} element={<GrantGuard grant={adminRoute('learnAiSuggestions').grant}><LearnAiSuggestionsAdmin /></GrantGuard>} />

          {/* Reputation & Enforcement */}
          <Route path={adminRoute('reportsDashboard').relative} element={<GrantGuard grant={adminRoute('reportsDashboard').grant}><AdminReportsDashboard /></GrantGuard>} />
          <Route path={adminRoute('enforcement').relative} element={<GrantGuard grant={adminRoute('enforcement').grant}><AdminEnforcementDashboard /></GrantGuard>} />

          {/* Legal & Compliance */}
          <Route path={adminRoute('legalAcceptances').relative} element={<AdminLegalAcceptancesPage />} />
          <Route path={adminRoute('legalAuditLog').relative} element={<AdminLegalAuditLogPage />} />
          <Route path={adminRoute('legalComplianceMetrics').relative} element={<AdminComplianceMetricsPage />} />
          <Route path={adminRoute('legalCcpaRequests').relative} element={<AdminCCPARequestsPage />} />

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
          <Route path={adminRoute('restaurantTopupApprovals').relative} element={
            <GrantGuard grant={adminRoute('restaurantTopupApprovals').grant}><RestaurantTopupApprovals /></GrantGuard>
          } />
          <Route path={adminRoute('featuredPlacements').relative} element={<FeaturedPlacementReview />} />
          <Route path={adminRoute('statementOperations').relative} element={
            <GrantGuard grant={adminRoute('statementOperations').grant}><StatementOperations /></GrantGuard>
          } />
          <Route path={adminRoute('oxsteedCredit').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCredit').superOnly}><OxsteedCreditOverviewPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditApprovals').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditApprovals').superOnly}><OxsteedCreditApprovalsPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditDisputes').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditDisputes').superOnly}><OxsteedCreditDisputesPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditSettlements').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditSettlements').superOnly}><OxsteedCreditSettlementsPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditReconciliation').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditReconciliation').superOnly}><OxsteedCreditReconciliationPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditCompliance').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditCompliance').superOnly}><OxsteedCreditCompliancePage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditReserves').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditReserves').superOnly}><OxsteedCreditReservesPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditPartners').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditPartners').superOnly}><OxsteedCreditPartnersPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditHealth').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditHealth').superOnly}><OxsteedCreditHealthPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditAudit').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditAudit').superOnly}><OxsteedCreditAuditPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditCustomers').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditCustomers').superOnly}><OxsteedCreditCustomersPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditMoneyOut').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditMoneyOut').superOnly}><OxsteedCreditMoneyOutPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditCards').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditCards').superOnly}><OxsteedCreditCardsPage /></AdminGuard>
          } />
          <Route path={adminRoute('oxsteedCreditLedger').relative} element={
            <AdminGuard superOnly={adminRoute('oxsteedCreditLedger').superOnly}><OxsteedCreditLedgerPage /></AdminGuard>
          } />
          <Route path={adminRoute('financials').relative} element={
            <GrantGuard grant={adminRoute('financials').grant}><Financials /></GrantGuard>
          } />
          <Route path={adminRoute('visitors').relative} element={
            <GrantGuard grant={adminRoute('visitors').grant}><VisitorHistoryPage /></GrantGuard>
          } />
          <Route path={adminRoute('profileVisibility').relative} element={
            <GrantGuard grant={adminRoute('profileVisibility').grant}><ProfileVisibilityPage /></GrantGuard>
          } />
          <Route path={adminRoute('payouts').relative} element={
            <GrantGuard grant={adminRoute('payouts').grant}><Payouts /></GrantGuard>
          } />
          <Route path={adminRoute('restaurantPayouts').relative} element={
            <GrantGuard grant={adminRoute('restaurantPayouts').grant}><RestaurantPayouts /></GrantGuard>
          } />
          <Route path={adminRoute('reconciliationExceptions').relative} element={
            <GrantGuard grant={adminRoute('reconciliationExceptions').grant}><ReconciliationExceptions /></GrantGuard>
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
          <Route path={adminRoute('governance').relative} element={
            <AdminGuard superOnly={adminRoute('governance').superOnly}><GovernancePage /></AdminGuard>
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
          <Route path={adminRoute('workforce').relative} element={
            <GrantGuard grant={adminRoute('workforce').grant}><WorkforcePage /></GrantGuard>
          } />
          <Route path={adminRoute('treasury').relative} element={
            <GrantGuard grant={adminRoute('treasury').grant}><TreasuryPage /></GrantGuard>
          } />
          <Route path={adminRoute('reliability').relative} element={
            <GrantGuard grant={adminRoute('reliability').grant}><ReliabilityPage /></GrantGuard>
          } />
          <Route path={adminRoute('serviceOps').relative} element={
            <GrantGuard grant={adminRoute('serviceOps').grant}><ServiceOpsPage /></GrantGuard>
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
          <Route path={adminRoute('logisticsSourcingOps').relative} element={<SourcingOpsAdmin />} />
          <Route path={adminRoute('logisticsOrganizerApprovals').relative} element={<OrganizerApprovalsAdmin />} />
          <Route path={adminRoute('logisticsLanes').relative} element={<LanesManagement />} />
          <Route path={adminRoute('logisticsSuppliers').relative} element={<SuppliersManagement />} />
          <Route path={adminRoute('logisticsQuotes').relative} element={<QuotesManagement />} />
          <Route path={adminRoute('logisticsCampaigns').relative} element={<CampaignsAdmin />} />
          <Route path={adminRoute('logisticsPurchaseOrders').relative} element={<PurchaseOrdersAdmin />} />
          <Route path={adminRoute('logisticsShipmentOps').relative} element={<ShipmentOpsAdmin />} />
          <Route path={adminRoute('logisticsShipments').relative} element={<ShipmentsAdmin />} />
          <Route path={adminRoute('logisticsComplianceReview').relative} element={<ComplianceReviewAdmin />} />
          <Route path={adminRoute('logisticsCustoms').relative} element={<CustomsAdmin />} />
          <Route path={adminRoute('logisticsWarehouseOps').relative} element={<WarehouseOpsDashboard />} />
          <Route path={adminRoute('logisticsWarehouses').relative} element={<WarehousesAdmin />} />
          <Route path={adminRoute('logisticsAllocations').relative} element={<AllocationsAdmin />} />
          <Route path={adminRoute('logisticsPricing').relative} element={<PricingAdmin />} />
          <Route path={adminRoute('logisticsRestrictions').relative} element={<RestrictionsAdmin />} />
          <Route path={adminRoute('logisticsDisputes').relative} element={<DisputesAdmin />} />
          <Route path={adminRoute('logisticsControl').relative} element={<AdminGuard superOnly={adminRoute('logisticsControl').superOnly}><SuperAdminLogisticsControl /></AdminGuard>} />
          <Route path={adminRoute('userSettings').relative} element={<AdminGuard><AdminUserSettingsPage /></AdminGuard>} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
    </QueryClientProvider>
  );
}
