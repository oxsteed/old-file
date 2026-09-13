import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CookieConsentProvider } from './context/CookieConsentContext';
import './i18n'; // initialise i18next before any component renders
import ProtectedRoute from './components/ProtectedRoute';
import LogisticsOperatorGuard from './components/LogisticsOperatorGuard';
import InternalWorkspaceGuard from './components/InternalWorkspaceGuard';
import ErrorBoundary, { RouterAwareErrorBoundary } from './components/ErrorBoundary';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import ImpersonationBanner from './components/ImpersonationBanner';
const ImpersonatePage = lazy(() => import('./pages/ImpersonatePage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const Login = lazy(() => import('./pages/Login'));
const InvestorLoginPage = lazy(() => import('./pages/InvestorLoginPage'));
const CustomerRegister = lazy(() => import('./pages/CustomerRegister'));
const HelperRegister = lazy(() => import('./pages/HelperRegister'));
const JoinPage = lazy(() => import('./pages/JoinPage'));
const ConsultingIntakePage = lazy(() => import('./pages/ConsultingIntakePage'));
const ConsultingFeedbackPage = lazy(() => import('./pages/ConsultingFeedbackPage'));
const BusinessLaunchStatusPage = lazy(() => import('./pages/BusinessLaunchStatusPage'));
const FranchiseIntakePage = lazy(() => import('./pages/FranchiseIntakePage'));
const FranchiseApplicantDashboard = lazy(() => import('./pages/FranchiseApplicantDashboard'));
const FranchiseTerritoryOpsPage = lazy(() => import('./pages/FranchiseTerritoryOpsPage'));
const SmartDashboard = lazy(() => import('./pages/SmartDashboard'));
const UpgradePage = lazy(() => import('./pages/UpgradePage'));
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const JobListPage = lazy(() => import('./pages/JobListPage'));
const JobDetailPage = lazy(() => import('./pages/JobDetailPage'));
const BidDetailPage = lazy(() => import('./pages/BidDetailPage'));
const PostJobPage = lazy(() => import('./pages/PostJobPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const TermsPage = lazy(() => import('./pages/terms'));
const PrivacyPage = lazy(() => import('./pages/privacy'));
const DoNotSellPage = lazy(() => import('./pages/donotsell'));
const SecurityPage = lazy(() => import('./pages/security'));
const CookiePolicyPage = lazy(() => import('./pages/cookiepolicy'));
const AccessibilityPage = lazy(() => import('./pages/accessibility'));
const BackgroundCheckPage = lazy(() => import('./pages/BackgroundCheckPage'));
const ArbitrationPage = lazy(() => import('./pages/ArbitrationPage'));
const EscrowPolicyPage = lazy(() => import('./pages/EscrowPolicyPage'));
const AccountTerminationPage = lazy(() => import('./pages/AccountTerminationPage'));
const DisputeResolutionPage = lazy(() => import('./pages/DisputeResolutionPage'));
const IndependentContractorPage = lazy(() => import('./pages/IndependentContractorPage'));
const AboutPage = lazy(() => import('./pages/about'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPassword'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPassword'));
const TwoFactorSetup = lazy(() => import('./pages/Settings/TwoFactorSetup'));
const NotificationSettings = lazy(() => import('./pages/Settings/Notifications'));
const CountrySettings = lazy(() => import('./pages/Settings/Country'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const HelperCancellationSettings = lazy(() => import('./pages/HelperCancellationSettings'));
const PublicProfile = lazy(() => import('./pages/PublicProfile'));
const BookHelperPage = lazy(() => import('./pages/BookHelperPage'));
const BookBusinessPage = lazy(() => import('./pages/BookBusinessPage'));
const BookServicePage = lazy(() => import('./pages/BookServicePage'));
const TemplatePicker = lazy(() => import('./pages/TemplatePicker'));
const BusinessProfilePage = lazy(() => import('./pages/BusinessProfilePage'));
const HelperBusinessProfilePage = lazy(() => import('./pages/HelperBusinessProfilePage'));
const HelpersDirectoryPage = lazy(() => import('./pages/HelpersDirectoryPage'));
const DisputeCenter = lazy(() => import('./pages/disputes/DisputeCenter'));
const DisputeDetail = lazy(() => import('./pages/disputes/DisputeDetail'));
const MessagesPage = lazy(() => import('./pages/MessagesPage'));
const ConversationPage = lazy(() => import('./pages/ConversationPage'));
const HelperInboxPage = lazy(() => import('./pages/HelperInboxPage'));
const HelperConversationPage = lazy(() => import('./pages/HelperConversationPage'));
const HelperGuestInquiryPage = lazy(() => import('./pages/HelperGuestInquiryPage'));
const PlannedNeedsPage = lazy(() => import('./pages/PlannedNeedsPage'));
const CarCarePage = lazy(() => import('./pages/CarCarePage'));
// OxSteed Food - restaurant online + in-store ordering (migration 305)
const FoodHomePage = lazy(() => import('./pages/food/FoodHomePage'));
const FoodRestaurantPage = lazy(() => import('./pages/food/FoodRestaurantPage'));
const FoodMerchantPage = lazy(() => import('./pages/food/FoodMerchantPage'));
const FoodKitchenPage = lazy(() => import('./pages/food/FoodKitchenPage'));
const FoodQueueBoardPage = lazy(() => import('./pages/food/FoodQueueBoardPage'));
const FoodKioskPage = lazy(() => import('./pages/food/FoodKioskPage'));
const RestaurantPOSPage = lazy(() => import('./pages/food/RestaurantPOSPage'));
const RestaurantInventoryPage = lazy(() => import('./pages/food/RestaurantInventoryPage'));
const RestaurantCrewPage = lazy(() => import('./pages/food/RestaurantCrewPage'));
const RestaurantRunnerPage = lazy(() => import('./pages/food/RestaurantRunnerPage'));
const RestaurantCreditPage = lazy(() => import('./pages/food/RestaurantCreditPage'));
const OxsteedCreditPage = lazy(() => import('./pages/food/OxsteedCreditPage'));
const OxsteedCreditTransactionPage = lazy(() => import('./pages/food/OxsteedCreditTransactionPage'));
// OxSteed Logistics branch
const LogisticsHomePage = lazy(() => import('./pages/logistics/LogisticsHomePage'));
const BuyerDashboardPage = lazy(() => import('./pages/logistics/BuyerDashboardPage'));
const OrganizerDashboardPage = lazy(() => import('./pages/logistics/OrganizerDashboardPage'));
const BusinessProcurementPage = lazy(() => import('./pages/logistics/BusinessProcurementPage'));
const DistributorResellerPage = lazy(() => import('./pages/logistics/DistributorResellerPage'));
const OperationsWorkspacePage = lazy(() => import('./pages/logistics/OperationsWorkspacePage'));
const ComplianceWorkspacePage = lazy(() => import('./pages/logistics/ComplianceWorkspacePage'));
const AdminControlWorkspacePage = lazy(() => import('./pages/logistics/AdminControlWorkspacePage'));
const SourcingOpsAdmin = lazy(() => import('./admin/pages/logistics/SourcingOpsAdmin'));
const OrganizerApprovalsAdmin = lazy(() => import('./admin/pages/logistics/OrganizerApprovalsAdmin'));
const ShipmentOpsAdmin = lazy(() => import('./admin/pages/logistics/ShipmentOpsAdmin'));
const WarehouseOpsDashboard = lazy(() => import('./admin/pages/logistics/WarehouseOpsDashboard'));
const AllocationsAdmin = lazy(() => import('./admin/pages/logistics/AllocationsAdmin'));
const DisputesAdmin = lazy(() => import('./admin/pages/logistics/DisputesAdmin'));
const ComplianceReviewAdmin = lazy(() => import('./admin/pages/logistics/ComplianceReviewAdmin'));
const CustomsAdmin = lazy(() => import('./admin/pages/logistics/CustomsAdmin'));
const RestrictionsAdmin = lazy(() => import('./admin/pages/logistics/RestrictionsAdmin'));
const LogisticsOperatorLoginPage = lazy(() => import('./pages/logistics/LogisticsOperatorLoginPage'));
const InternalWorkspaceLoginPage = lazy(() => import('./pages/internal/InternalWorkspaceLoginPage'));
const InternalDepartmentWorkspacePage = lazy(() => import('./pages/internal/InternalDepartmentWorkspacePage'));
const CampaignsPage = lazy(() => import('./pages/logistics/CampaignsPage'));
const CampaignDetailPage = lazy(() => import('./pages/logistics/CampaignDetailPage'));
const SourcingPage = lazy(() => import('./pages/logistics/SourcingPage'));
const NewRequestPage = lazy(() => import('./pages/logistics/NewRequestPage'));
const RequestDetailPage = lazy(() => import('./pages/logistics/RequestDetailPage'));
const OrdersPage = lazy(() => import('./pages/logistics/OrdersPage'));
const OrderDetailPage = lazy(() => import('./pages/logistics/OrderDetailPage'));
const ShipmentsPage = lazy(() => import('./pages/logistics/ShipmentsPage'));
const ShipmentDetailPage = lazy(() => import('./pages/logistics/ShipmentDetailPage'));
const WarehousingPage = lazy(() => import('./pages/logistics/WarehousingPage'));
const DistributionPage = lazy(() => import('./pages/logistics/DistributionPage'));
const CompliancePage = lazy(() => import('./pages/logistics/CompliancePage'));
const LogisticsFinancePage = lazy(() => import('./pages/logistics/LogisticsFinancePage'));
const BusinessHubPage = lazy(() => import('./pages/BusinessHubPage'));
const VortexPage = lazy(() => import('./pages/VortexPage'));
const NetworkAppsPage = lazy(() => import('./pages/NetworkAppsPage'));
const AccessGateRecoveryPage = lazy(() => import('./pages/AccessGateRecoveryPage'));
const VerifyIdentityPage = lazy(() => import('./pages/VerifyIdentityPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const PublicInvoiceView = lazy(() => import('./pages/PublicInvoiceView'));
const ToolRentalsBrowse = lazy(() => import('./pages/ToolRentalsBrowse'));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage'));
const MyBookingsPage = lazy(() => import('./pages/MyBookingsPage'));
const ToolRentalsAnalytics = lazy(() => import('./pages/ToolRentalsAnalytics'));
const QRCodeGeneratorPage = lazy(() => import('./pages/QRCodeGeneratorPage'));
const BusinessPublicProfilePage = lazy(() => import('./pages/BusinessPublicProfilePage'));
const HelperPublicProfilePage = lazy(() => import('./pages/HelperPublicProfilePage'));
const JobPublicPage = lazy(() => import('./pages/JobPublicPage'));
const ConsultingFullPortal = lazy(() => import('./pages/ConsultingFullPortal'));
const ConsultingPortalPage = lazy(() => import('./pages/ConsultingPortalPage'));
const ConsultantAvailabilityPage = lazy(() => import('./pages/ConsultantAvailabilityPage'));
const ConsultantContractorDashboard = lazy(() => import('./pages/ConsultantContractorDashboard'));
const InvoicesPage = lazy(() => import('./pages/InvoicesPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const CalendarAppointmentDetailPage = lazy(() => import('./pages/CalendarAppointmentDetailPage'));
const AIPreviewPage = lazy(() => import('./pages/AIPreviewPage'));
const ProductMarketplacePage = lazy(() => import('./pages/ProductMarketplacePage'));
const ShoppingCartPage = lazy(() => import('./pages/ShoppingCartPage'));
const SharedCartPage = lazy(() => import('./pages/SharedCartPage'));
const CheckoutPage = lazy(() => import('./pages/CheckoutPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const OrderDetailsPage = lazy(() => import('./pages/OrderDetailsPage'));
const SupportTicketDetailPage = lazy(() => import('./pages/SupportTicketDetailPage'));
const RestaurantSupportCasePage = lazy(() => import('./pages/RestaurantSupportCasePage'));
const SupportEscalationPage = lazy(() => import('./pages/SupportEscalationPage'));
const SupportAgentPortalPage = lazy(() => import('./pages/SupportAgentPortalPage'));
const SupportAgentWorkspacePage = lazy(() => import('./pages/SupportAgentWorkspacePage'));
const StatusPage = lazy(() => import('./pages/StatusPage'));
const InventoryHelpCenterPage = lazy(() => import('./pages/InventoryHelpCenterPage'));
const MyJobsPage = lazy(() => import('./pages/MyJobsPage'));
const MyBidsPage = lazy(() => import('./pages/MyBidsPage'));
const EnforcementPolicyPage = lazy(() => import('./pages/EnforcementPolicyPage'));
const HelperProfileEditPage = lazy(() => import('./pages/HelperProfileEditPage'));
const BusinessProfileEditPage = lazy(() => import('./pages/BusinessProfileEditPage'));
const FeatureGuidePage = lazy(() => import('./pages/FeatureGuidePage'));
const LearnModePage = lazy(() => import('./pages/LearnModePage'));
const PromotePage = lazy(() => import('./pages/PromotePage'));
const DirectPortalPage = lazy(() => import('./pages/DirectPortalPage'));
const DirectAdminPortalPage = lazy(() => import('./pages/DirectAdminPortalPage'));
const DirectCatalog = lazy(() => import('./admin/pages/DirectCatalog'));
const MaintenanceRequestPage = lazy(() => import('./pages/MaintenanceRequestPage'));
const TradesDiagnosticRequestPage = lazy(() => import('./pages/TradesDiagnosticRequestPage'));
const BeautyIntakeRequestPage = lazy(() => import('./pages/BeautyIntakeRequestPage'));
const CreativeIntakeRequestPage = lazy(() => import('./pages/CreativeIntakeRequestPage'));
const ProfessionalIntakeRequestPage = lazy(() => import('./pages/ProfessionalIntakeRequestPage'));
const ContinuityIntakeRequestPage = lazy(() => import('./pages/ContinuityIntakeRequestPage'));
const TranslatorWorkspacePage = lazy(() => import('./pages/TranslatorWorkspacePage'));
const InvestorDashboardPage = lazy(() => import('./pages/InvestorDashboardPage'));
const AffiliateDashboardPage = lazy(() => import('./pages/AffiliateDashboardPage'));

import CookieConsent from './components/CookieConsent';
import TermsGate from './components/TermsGate';
import { ThemeProvider } from './context/ThemeContext';
import SupportWidget from './components/SupportWidget';
import { LanguageProvider } from './context/LanguageContext';
import { getLaunchRedirect } from './utils/launchScope';

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (formerly cacheTime)
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Wraps each route element in its own error boundary so a crash in one page
// doesn't blank the entire app - only that route shows an error.
// Plain ErrorBoundary is fine here: these are already inside <Router>.
function Guarded({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

function RouteLoadingFallback() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-300" aria-live="polite">
      Loading...
    </main>
  );
}

function LaunchScopeRouteGate({ children }) {
  const location = useLocation();
  const redirect = getLaunchRedirect(location.pathname);
  if (redirect && redirect !== location.pathname) {
    return <Navigate to={redirect} replace />;
  }
  return children;
}

function DirectAdminRouteGate({ children }) {
  const { user } = useAuth();
  if (user && !['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

export default function App() {
  const isStatusHost = typeof window !== 'undefined'
    && window.location.hostname.toLowerCase() === 'status.oxsteed.com';

  return (
    <HelmetProvider>
      <LanguageProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          {/*
            Root boundary: RouterAwareErrorBoundary must sit INSIDE <Router> so
            useNavigate() is available. The outer ThemeProvider/HelmetProvider
            layer is stateless - catastrophic failures there are vanishingly rare
            and would prevent the Router from mounting anyway.
          */}
          <Router>
            {/* Single shared cookie-consent state - Footer and CookieConsent
                both consume this via useCookieConsentContext(). */}
            <CookieConsentProvider>
              <RouterAwareErrorBoundary>
                <AuthProvider>
                <ScrollToTop />
                <ImpersonationBanner />
                <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
                <TermsGate>
                  <LaunchScopeRouteGate>
                  <Suspense fallback={<RouteLoadingFallback />}>
                  <Routes>
                    {/* ── Impersonation landing (super-admin only, new tab) ── */}
                    <Route path="/impersonate"             element={<ImpersonatePage />} />
                    {/* ── Public routes ────────────────────────────────────── */}
                    <Route path="/"                        element={<Guarded>{isStatusHost ? <StatusPage /> : <HomePage />}</Guarded>} />
                    <Route path="/status"                  element={<Guarded><StatusPage /></Guarded>} />
                    <Route path="/login"                   element={<Guarded><Login /></Guarded>} />
                    <Route path="/investor/login"          element={<Guarded><InvestorLoginPage /></Guarded>} />
                    <Route path="/register/customer"       element={<Guarded><CustomerRegister /></Guarded>} />
                    <Route path="/register/helper"         element={<Guarded><HelperRegister /></Guarded>} />
                    {/* ── Unified signup (post-2026-05). Replaces the navbar's */}
                    {/*    customer/helper choice. Old /register/* routes kept   */}
                    {/*    intact for inbound links + back-compat.               */}
                    <Route path="/join"                    element={<Guarded><JoinPage /></Guarded>} />
                    <Route path="/forgot-password"         element={<Guarded><ForgotPasswordPage /></Guarded>} />
                    <Route path="/reset-password/:token"   element={<Guarded><ResetPasswordPage /></Guarded>} />
                    <Route path="/how-it-works"            element={<Guarded><FeatureGuidePage /></Guarded>} />
                    <Route path="/features"                element={<Guarded><FeatureGuidePage /></Guarded>} />
                    <Route path="/help/crew"               element={<Guarded><InventoryHelpCenterPage appKey="crew" /></Guarded>} />
                    <Route path="/help/display"            element={<Guarded><InventoryHelpCenterPage appKey="display" /></Guarded>} />
                    <Route path="/help/inventory"          element={<Guarded><InventoryHelpCenterPage appKey="inventory" /></Guarded>} />
                    <Route path="/help/kitchen"            element={<Guarded><InventoryHelpCenterPage appKey="kitchen" /></Guarded>} />
                    <Route path="/help/manager"            element={<Guarded><InventoryHelpCenterPage appKey="manager" /></Guarded>} />
                    <Route path="/help/pos"                element={<Guarded><InventoryHelpCenterPage appKey="pos" /></Guarded>} />
                    <Route path="/help/restaurant"         element={<Guarded><InventoryHelpCenterPage appKey="restaurant" /></Guarded>} />
                    <Route path="/help/runner"             element={<Guarded><InventoryHelpCenterPage appKey="runner" /></Guarded>} />
                    <Route path="/help/:restaurantAppHelpSlug" element={<Guarded><InventoryHelpCenterPage /></Guarded>} />
                    <Route path="/learn"                   element={<Guarded><LearnModePage /></Guarded>} />
                    <Route path="/translator"              element={<Guarded><TranslatorWorkspacePage /></Guarded>} />
                    <Route path="/about"                   element={<Guarded><AboutPage /></Guarded>} />
                    <Route path="/jobs"                    element={<Guarded><JobListPage /></Guarded>} />
                    <Route path="/jobs/:id"                element={<Guarded><JobDetailPage /></Guarded>} />
                    <Route path="/bids/:bidId"             element={<Guarded><ProtectedRoute><RouteErrorBoundary><BidDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/jobs/public/:jobId"      element={<JobPublicPage />} />
                    <Route path="/profile/:id"             element={<Guarded><PublicProfile /></Guarded>} />
                    <Route path="/helpers"                 element={<Guarded><HelpersDirectoryPage /></Guarded>} />
                    <Route path="/helpers/public/:helperId" element={<HelperPublicProfilePage />} />
                    <Route path="/discover"                element={<Guarded><DiscoverPage /></Guarded>} />
                    <Route path="/consulting-intake"       element={<Guarded><ConsultingIntakePage /></Guarded>} />
                    <Route path="/direct"                  element={<Guarded><DirectPortalPage view="landing" /></Guarded>} />
                    <Route path="/direct/services"         element={<Guarded><DirectPortalPage view="landing" /></Guarded>} />
                    <Route path="/direct/request-quote"    element={<Guarded><DirectPortalPage view="request" /></Guarded>} />
                    <Route path="/direct/request-quote/thanks" element={<Guarded><DirectPortalPage view="thanks" /></Guarded>} />
                    <Route path="/direct/view-quote"       element={<Guarded><DirectPortalPage view="lookup" /></Guarded>} />
                    <Route path="/direct/quotes/:id"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="quote" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/book/:id"         element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="book" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/jobs/:id"         element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="job" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/payments/:id/proof" element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="proof" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/payments/:id"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="receipt" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/history"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="history" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/support"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="support" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/account"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="account" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/jobs/:id/change"  element={<Guarded><ProtectedRoute><RouteErrorBoundary><DirectPortalPage view="change" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin"           element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="dashboard" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/dashboard" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="dashboard" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/inbox"     element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="inbox" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/quotes/:id" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="quote" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/calendar"   element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="calendar" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/jobs/:id"   element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="job" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/payments/:id" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="payment" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/customers/:userId" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="customer" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/settings"   element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="settings" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/catalog"   element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectCatalog /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/reports"    element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="reports" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/team"       element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="team" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/email-test" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="email-test" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/request-quote"          element={<Guarded><DirectPortalPage view="request" /></Guarded>} />
                    <Route path="/quote-request"          element={<Guarded><DirectPortalPage view="request" /></Guarded>} />
                    <Route path="/consulting/feedback/:sessionId/:token" element={<Guarded><ConsultingFeedbackPage /></Guarded>} />
                    <Route path="/business-launch-status"  element={<Guarded><BusinessLaunchStatusPage /></Guarded>} />
                    <Route path="/franchise/apply"         element={<Guarded><FranchiseIntakePage /></Guarded>} />
                    <Route path="/franchise/status"        element={<Guarded><ProtectedRoute><RouteErrorBoundary><FranchiseApplicantDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/franchise/territory"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><FranchiseTerritoryOpsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helpers/:id"             element={<Guarded><HelperBusinessProfilePage /></Guarded>} />
                    <Route path="/businesses/public/:businessId" element={<BusinessPublicProfilePage />} />
                    <Route path="/book/:id"                element={<Guarded><ProtectedRoute><RouteErrorBoundary><BookHelperPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/book/business/:id"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><BookBusinessPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:businessId/services/:serviceId/book" element={<Guarded><ProtectedRoute><RouteErrorBoundary><BookServicePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:id"            element={<Guarded><BusinessProfilePage /></Guarded>} />
                    <Route path="/business/:businessId/maintenance-request" element={<Guarded><ProtectedRoute><RouteErrorBoundary><MaintenanceRequestPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:businessId/trades-request" element={<Guarded><RouteErrorBoundary><TradesDiagnosticRequestPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/business/:businessId/beauty-intake" element={<Guarded><RouteErrorBoundary><BeautyIntakeRequestPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/business/:businessId/creative-intake" element={<Guarded><RouteErrorBoundary><CreativeIntakeRequestPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/business/:businessId/professional-intake" element={<Guarded><RouteErrorBoundary><ProfessionalIntakeRequestPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/business/:businessId/continuity-intake" element={<Guarded><RouteErrorBoundary><ContinuityIntakeRequestPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/tool-rentals"            element={<Guarded><ToolRentalsBrowse /></Guarded>} />
                    <Route path="/tool-rentals/:toolId"    element={<Guarded><ToolRentalsBrowse /></Guarded>} />
                    <Route path="/my-bookings"             element={<Guarded><ProtectedRoute><MyBookingsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/tool-rentals/analytics"  element={<Guarded><ProtectedRoute><ToolRentalsAnalytics /></ProtectedRoute></Guarded>} />
                    <Route path="/invoice/p/:token"        element={<Guarded><PublicInvoiceView /></Guarded>} />

                    {/* ── Product Marketplace ──────────────────────────────── */}
                    <Route path="/products"                element={<Guarded><ProductMarketplacePage /></Guarded>} />
                    <Route path="/cart/:cartId"           element={<Guarded><ProtectedRoute><ShoppingCartPage /></ProtectedRoute></Guarded>} />
                    <Route path="/shared-cart/:shareToken" element={<Guarded><SharedCartPage /></Guarded>} />
                    <Route path="/checkout/:cartId"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><CheckoutPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/orders"                  element={<Guarded><ProtectedRoute><OrderHistoryPage /></ProtectedRoute></Guarded>} />
                    <Route path="/orders/:id"             element={<Guarded><ProtectedRoute><RouteErrorBoundary><OrderDetailsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/food/orders/:orderId"   element={<Guarded><ProtectedRoute><RouteErrorBoundary><OrderDetailsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* ── Support & Help ───────────────────────────────────── */}
                    <Route path="/support"                element={<Guarded><SupportEscalationPage /></Guarded>} />
                    <Route path="/support/escalation"     element={<Guarded><SupportEscalationPage /></Guarded>} />
                    <Route path="/support/my-tickets/:ticketId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><SupportTicketDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/support/agent" element={<Guarded><ProtectedRoute><SupportAgentPortalPage /></ProtectedRoute></Guarded>} />
                    <Route path="/support/agent/workspace" element={<Guarded><ProtectedRoute><RouteErrorBoundary><SupportAgentWorkspacePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/restaurants/support/cases/:caseId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><RestaurantSupportCasePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* ── Legal / policy pages ─────────────────────────────── */}
                    <Route path="/terms"          element={<Guarded><TermsPage /></Guarded>} />
                    <Route path="/privacy"        element={<Guarded><PrivacyPage /></Guarded>} />
                    <Route path="/do-not-sell"    element={<Guarded><DoNotSellPage /></Guarded>} />
                    <Route path="/security"       element={<Guarded><SecurityPage /></Guarded>} />
                    <Route path="/cookie-policy"  element={<Guarded><CookiePolicyPage /></Guarded>} />
                    <Route path="/accessibility"  element={<Guarded><AccessibilityPage /></Guarded>} />
                    <Route path="/legal/background-check"      element={<Guarded><BackgroundCheckPage /></Guarded>} />
                    <Route path="/legal/arbitration"           element={<Guarded><ArbitrationPage /></Guarded>} />
                    <Route path="/legal/escrow-policy"         element={<Guarded><EscrowPolicyPage /></Guarded>} />
                    <Route path="/legal/account-termination"   element={<Guarded><AccountTerminationPage /></Guarded>} />
                    <Route path="/legal/dispute-resolution"    element={<Guarded><DisputeResolutionPage /></Guarded>} />
                    <Route path="/legal/independent-contractor" element={<Guarded><IndependentContractorPage /></Guarded>} />

                    {/* ── Authenticated routes ────────────────────────────── */}
                    {/* verify-email is exempt from email verification gate in ProtectedRoute (see EMAIL_VERIFICATION_EXEMPT_PATHS) */}
                    <Route path="/verify-email" element={<Guarded><ProtectedRoute><VerifyEmailPage /></ProtectedRoute></Guarded>} />
                    {/* verify-identity is exempt from the Didit gate in ProtectedRoute (see DIDIT_EXEMPT_PATHS) */}
                    <Route path="/verify-identity" element={<Guarded><ProtectedRoute><VerifyIdentityPage /></ProtectedRoute></Guarded>} />

                    {/* Critical routes: wrapped in RouteErrorBoundary to isolate crashes */}
                    <Route path="/dashboard"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><SmartDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/investor/dashboard" element={<Guarded><ProtectedRoute><RouteErrorBoundary><InvestorDashboardPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/affiliate" element={<Guarded><ProtectedRoute><RouteErrorBoundary><AffiliateDashboardPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper-dashboard" element={<Guarded><ProtectedRoute><RouteErrorBoundary><SmartDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/activity"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><ActivityPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/upgrade"        element={<Guarded><ProtectedRoute><UpgradePage /></ProtectedRoute></Guarded>} />
                    <Route path="/templates"      element={<Guarded><ProtectedRoute><TemplatePicker /></ProtectedRoute></Guarded>} />
                    <Route path="/promote"        element={<Guarded><ProtectedRoute><RouteErrorBoundary><PromotePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/dashboard/ai-preview" element={<Guarded><ProtectedRoute><RouteErrorBoundary><AIPreviewPage profileType="helper" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:id/ai-preview" element={<Guarded><ProtectedRoute><RouteErrorBoundary><AIPreviewPage profileType="business" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Critical: Job posting form with media upload */}
                    <Route path="/post-job"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><PostJobPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/my-jobs"        element={<Guarded><ProtectedRoute><MyJobsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/my-bids"        element={<Guarded><ProtectedRoute><MyBidsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/invoices"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><InvoicesPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/consultant-availability" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultantAvailabilityPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/consulting/contractor-dashboard" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultantContractorDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Redirect tool-rentals listing CTA to the dashboard skills tab */}
                    <Route path="/profile/tool-rentals" element={<Navigate to="/dashboard?tab=skills" replace />} />
                    <Route path="/settings"       element={<Guarded><ProtectedRoute><SettingsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/settings/2fa"   element={<Guarded><ProtectedRoute><TwoFactorSetup /></ProtectedRoute></Guarded>} />
                    <Route path="/settings/notifications" element={<Guarded><ProtectedRoute><NotificationSettings /></ProtectedRoute></Guarded>} />
                    <Route path="/settings/country" element={<Guarded><CountrySettings /></Guarded>} />
                    <Route path="/settings/payment-policies" element={<Guarded><ProtectedRoute><HelperCancellationSettings /></ProtectedRoute></Guarded>} />
                    <Route path="/dashboard/edit-profile" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperProfileEditPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/edit-profile" element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessProfileEditPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/enforcement-policy" element={<Guarded><EnforcementPolicyPage /></Guarded>} />

                    {/* Disputes: wrapped in RouteErrorBoundary to isolate crashes */}
                    <Route path="/disputes"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><DisputeCenter /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/disputes/:id"   element={<Guarded><ProtectedRoute><RouteErrorBoundary><DisputeDetail /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Messaging: wrapped in RouteErrorBoundary to isolate crashes */}
                    <Route path="/messages"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><MessagesPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/messages/:conversationId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConversationPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Back-compat for backend activity URLs that still emit /messages/conversations/:id */}
                    <Route path="/messages/conversations/:conversationId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConversationPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/messages" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperInboxPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/messages/guest/:inquiryId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperGuestInquiryPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/messages/:conversationId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperConversationPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Financial planning: wrapped in RouteErrorBoundary to isolate crashes */}
                    <Route path="/planned-needs" element={<Guarded><ProtectedRoute><RouteErrorBoundary><PlannedNeedsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/car-care"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><CarCarePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* OxSteed Food (migration 305): discovery + ordering are public;
                        queue board + kiosk are public in-store screens; merchant
                        dashboard and kitchen display require sign-in. */}
                    <Route path="/food"                       element={<Guarded><RouteErrorBoundary><FoodHomePage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/food/restaurants/:restaurantId" element={<Guarded><RouteErrorBoundary><FoodRestaurantPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/food/queue/:restaurantId"   element={<RouteErrorBoundary><FoodQueueBoardPage /></RouteErrorBoundary>} />
                    <Route path="/food/kiosk/:restaurantId"   element={<RouteErrorBoundary><FoodKioskPage /></RouteErrorBoundary>} />
                    <Route path="/food/merchant"              element={<Guarded><ProtectedRoute><RouteErrorBoundary><FoodMerchantPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/food/kitchen/:restaurantId" element={<ProtectedRoute><RouteErrorBoundary><FoodKitchenPage /></RouteErrorBoundary></ProtectedRoute>} />

                    {/* OxSteed Restaurants — new branch name for the same operating
                        surface. The /restaurants/* paths are the canonical routes going
                        forward; the /food/* paths above are preserved for back-compat
                        (existing links, QR codes, kiosk/queue displays already deployed). */}
                    <Route path="/restaurants"                       element={<Guarded><RouteErrorBoundary><FoodHomePage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/restaurants/r/:restaurantId"       element={<Guarded><RouteErrorBoundary><FoodRestaurantPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/restaurants/queue/:restaurantId"   element={<RouteErrorBoundary><FoodQueueBoardPage /></RouteErrorBoundary>} />
                    <Route path="/restaurants/kiosk/:restaurantId"   element={<RouteErrorBoundary><FoodKioskPage /></RouteErrorBoundary>} />
                    <Route path="/restaurants/merchant"              element={<Guarded><ProtectedRoute><RouteErrorBoundary><FoodMerchantPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/restaurants/kitchen/:restaurantId"   element={<ProtectedRoute><RouteErrorBoundary><FoodKitchenPage /></RouteErrorBoundary></ProtectedRoute>} />
                    <Route path="/restaurants/pos/:restaurantId"       element={<ProtectedRoute><RouteErrorBoundary><RestaurantPOSPage /></RouteErrorBoundary></ProtectedRoute>} />
                    <Route path="/restaurants/inventory/:restaurantId" element={<ProtectedRoute><RouteErrorBoundary><RestaurantInventoryPage /></RouteErrorBoundary></ProtectedRoute>} />
                    <Route path="/restaurants/crew/:restaurantId"      element={<ProtectedRoute><RouteErrorBoundary><RestaurantCrewPage /></RouteErrorBoundary></ProtectedRoute>} />
                    <Route path="/restaurants/runner/:restaurantId"    element={<ProtectedRoute><RouteErrorBoundary><RestaurantRunnerPage /></RouteErrorBoundary></ProtectedRoute>} />
                    <Route path="/restaurant-credit" element={<Guarded><ProtectedRoute><RouteErrorBoundary><RestaurantCreditPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/oxsteed-credit/transactions/:transactionId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><OxsteedCreditTransactionPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/oxsteed-credit" element={<Guarded><ProtectedRoute><RouteErrorBoundary><OxsteedCreditPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* OxSteed Logistics branch (migration 247) */}
                    <Route path="/logistics"                  element={<Guarded><RouteErrorBoundary><LogisticsHomePage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/logistics/internal/login"   element={<Guarded><LogisticsOperatorLoginPage /></Guarded>} />
                    <Route path="/logistics/operations/login" element={<Guarded><LogisticsOperatorLoginPage /></Guarded>} />
                    <Route path="/logistics/compliance-workspace/login" element={<Guarded><LogisticsOperatorLoginPage /></Guarded>} />
                    <Route path="/logistics/admin-control/login" element={<Guarded><LogisticsOperatorLoginPage /></Guarded>} />
                    <Route path="/internal/:workspace/login" element={<Guarded><InternalWorkspaceLoginPage /></Guarded>} />
                    <Route path="/internal/:workspace" element={<Guarded><InternalWorkspaceGuard><RouteErrorBoundary><InternalDepartmentWorkspacePage /></RouteErrorBoundary></InternalWorkspaceGuard></Guarded>} />
                    <Route path="/logistics/buyer"            element={<Guarded><ProtectedRoute><RouteErrorBoundary><BuyerDashboardPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/organizer"        element={<Guarded><ProtectedRoute><RouteErrorBoundary><OrganizerDashboardPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/business-procurement" element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessProcurementPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/distributor"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><DistributorResellerPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/operations"       element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><OperationsWorkspacePage /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/sourcing-ops" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><SourcingOpsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/organizer-approvals" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><OrganizerApprovalsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/shipment-ops" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><ShipmentOpsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/warehouse-ops" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><WarehouseOpsDashboard /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/allocations" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><AllocationsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/operations/disputes" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><DisputesAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/compliance-workspace" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><ComplianceWorkspacePage /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/compliance-workspace/review" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><ComplianceReviewAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/compliance-workspace/customs" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><CustomsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/compliance-workspace/restrictions" element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><RestrictionsAdmin /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/admin-control"    element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><AdminControlWorkspacePage /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
                    <Route path="/logistics/campaigns"        element={<Guarded><RouteErrorBoundary><CampaignsPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/logistics/campaigns/:id"    element={<Guarded><RouteErrorBoundary><CampaignDetailPage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/logistics/sourcing"         element={<Guarded><ProtectedRoute><RouteErrorBoundary><SourcingPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/sourcing/new"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><NewRequestPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/requests/new"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><NewRequestPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/requests/:id"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><RequestDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/orders"           element={<Guarded><ProtectedRoute><RouteErrorBoundary><OrdersPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/orders/:id"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><OrderDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/shipments"        element={<Guarded><ProtectedRoute><RouteErrorBoundary><ShipmentsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/shipments/:id"    element={<Guarded><ProtectedRoute><RouteErrorBoundary><ShipmentDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/warehousing"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><WarehousingPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/distribution"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><DistributionPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/logistics/compliance"       element={<Guarded><RouteErrorBoundary><CompliancePage /></RouteErrorBoundary></Guarded>} />
                    <Route path="/logistics/finance"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><LogisticsFinancePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Vortex - unified workspace + access-code entry point (team-role spec) */}
                    <Route path="/vortex"        element={<Guarded><ProtectedRoute><RouteErrorBoundary><VortexPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* OxSteed Network — full-page branch launcher (the navbar switcher
                        is the quick version; this is the standalone page). */}
                    <Route path="/network"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><NetworkAppsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/network/apps" element={<Guarded><ProtectedRoute><RouteErrorBoundary><NetworkAppsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Access gate recovery link target (public — token-gated server-side) */}
                    <Route path="/access-gate/recovery" element={<RouteErrorBoundary><AccessGateRecoveryPage /></RouteErrorBoundary>} />
                    {/* Critical: Business analytics dashboard with multiple tabs */}
                    <Route path="/business-hub"  element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Per-business workspace URLs. The businessId in the URL is the source of truth;
                        BusinessHubPage reads useParams().businessId before falling back to localStorage. */}
                    <Route path="/business/:businessId/workspace"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:businessId/workspace/:tab"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Role-aware appointment + availability calendar system */}
                    <Route path="/calendar" element={<Guarded><ProtectedRoute><RouteErrorBoundary><CalendarPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/calendar/appointments/:appointmentId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><CalendarAppointmentDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Pro feature: QR Code Generator */}
                    <Route path="/qr-generator"  element={<Guarded><ProtectedRoute><RouteErrorBoundary><QRCodeGeneratorPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Consulting Portal (All Phases) */}
                    <Route path="/consulting/portal" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultingFullPortal /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Client Consulting Portal - Track Progress */}
                    <Route path="/consulting" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultingPortalPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                  <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                  </Suspense>
                  </LaunchScopeRouteGate>
                </TermsGate>
                {!isStatusHost && <CookieConsent />}
                {!isStatusHost && <SupportWidget />}
                </AuthProvider>
              </RouterAwareErrorBoundary>
            </CookieConsentProvider>
          </Router>
        </QueryClientProvider>
      </ThemeProvider>
      </LanguageProvider>
    </HelmetProvider>
  );
}
