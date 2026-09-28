import { Suspense } from 'react';
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
import { lazyWithRetry } from './utils/lazyWithRetry';
import { routeLoaders } from './utils/routePrefetch';
const ImpersonatePage = lazyWithRetry(() => import('./pages/ImpersonatePage'));
const HomePage = lazyWithRetry(() => import('./pages/HomePage'));
const Login = lazyWithRetry(() => import('./pages/Login'));
const InvestorLoginPage = lazyWithRetry(() => import('./pages/InvestorLoginPage'));
const CustomerRegister = lazyWithRetry(() => import('./pages/CustomerRegister'));
const HelperRegister = lazyWithRetry(() => import('./pages/HelperRegister'));
const JoinPage = lazyWithRetry(() => import('./pages/JoinPage'));
const ConsultingIntakePage = lazyWithRetry(() => import('./pages/ConsultingIntakePage'));
const ConsultingFeedbackPage = lazyWithRetry(() => import('./pages/ConsultingFeedbackPage'));
const BusinessLaunchStatusPage = lazyWithRetry(() => import('./pages/BusinessLaunchStatusPage'));
const FranchiseIntakePage = lazyWithRetry(() => import('./pages/FranchiseIntakePage'));
const FranchiseApplicantDashboard = lazyWithRetry(() => import('./pages/FranchiseApplicantDashboard'));
const FranchiseTerritoryOpsPage = lazyWithRetry(() => import('./pages/FranchiseTerritoryOpsPage'));
const SmartDashboard = lazyWithRetry(() => import('./pages/SmartDashboard'));
const HelperDashboard = lazyWithRetry(() => import('./pages/HelperDashboard'));
const ClientManagementPage = lazyWithRetry(routeLoaders.clientManagement, { name: 'clientManagement' });
const UpgradePage = lazyWithRetry(() => import('./pages/UpgradePage'));
const ActivityPage = lazyWithRetry(() => import('./pages/ActivityPage'));
const JobListPage = lazyWithRetry(routeLoaders.jobs, { name: 'jobs' });
const JobDetailPage = lazyWithRetry(() => import('./pages/JobDetailPage'));
const BidDetailPage = lazyWithRetry(() => import('./pages/BidDetailPage'));
const PostJobPage = lazyWithRetry(() => import('./pages/PostJobPage'));
const NotFoundPage = lazyWithRetry(() => import('./pages/NotFoundPage'));
const TermsPage = lazyWithRetry(() => import('./pages/terms'));
const PrivacyPage = lazyWithRetry(() => import('./pages/privacy'));
const DoNotSellPage = lazyWithRetry(() => import('./pages/donotsell'));
const SecurityPage = lazyWithRetry(() => import('./pages/security'));
const CookiePolicyPage = lazyWithRetry(() => import('./pages/cookiepolicy'));
const AccessibilityPage = lazyWithRetry(() => import('./pages/accessibility'));
const BackgroundCheckPage = lazyWithRetry(() => import('./pages/BackgroundCheckPage'));
const ArbitrationPage = lazyWithRetry(() => import('./pages/ArbitrationPage'));
const EscrowPolicyPage = lazyWithRetry(() => import('./pages/EscrowPolicyPage'));
const AccountTerminationPage = lazyWithRetry(() => import('./pages/AccountTerminationPage'));
const DisputeResolutionPage = lazyWithRetry(() => import('./pages/DisputeResolutionPage'));
const IndependentContractorPage = lazyWithRetry(() => import('./pages/IndependentContractorPage'));
const AboutPage = lazyWithRetry(() => import('./pages/about'));
const CareersPage = lazyWithRetry(routeLoaders.careers, { name: 'careers' });
const CareerOpeningPage = lazyWithRetry(() => import('./pages/CareerOpeningPage'));
const MyCareerApplicationsPage = lazyWithRetry(() => import('./pages/MyCareerApplicationsPage'));
const ForgotPasswordPage = lazyWithRetry(() => import('./pages/ForgotPassword'));
const ResetPasswordPage = lazyWithRetry(() => import('./pages/ResetPassword'));
const TwoFactorSetup = lazyWithRetry(() => import('./pages/Settings/TwoFactorSetup'));
const NotificationSettings = lazyWithRetry(() => import('./pages/Settings/Notifications'));
const CountrySettings = lazyWithRetry(() => import('./pages/Settings/Country'));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage'));
const HelperCancellationSettings = lazyWithRetry(() => import('./pages/HelperCancellationSettings'));
const PublicProfile = lazyWithRetry(() => import('./pages/PublicProfile'));
const BookHelperPage = lazyWithRetry(() => import('./pages/BookHelperPage'));
const BookBusinessPage = lazyWithRetry(() => import('./pages/BookBusinessPage'));
const BookServicePage = lazyWithRetry(() => import('./pages/BookServicePage'));
const TemplatePicker = lazyWithRetry(() => import('./pages/TemplatePicker'));
const BusinessProfilePage = lazyWithRetry(() => import('./pages/BusinessProfilePage'));
const HelperBusinessProfilePage = lazyWithRetry(() => import('./pages/HelperBusinessProfilePage'));
const HelpersDirectoryPage = lazyWithRetry(() => import('./pages/HelpersDirectoryPage'));
const DisputeCenter = lazyWithRetry(() => import('./pages/disputes/DisputeCenter'));
const DisputeDetail = lazyWithRetry(() => import('./pages/disputes/DisputeDetail'));
const MessagesPage = lazyWithRetry(() => import('./pages/MessagesPage'));
const ConversationPage = lazyWithRetry(() => import('./pages/ConversationPage'));
const HelperInboxPage = lazyWithRetry(() => import('./pages/HelperInboxPage'));
const HelperConversationPage = lazyWithRetry(() => import('./pages/HelperConversationPage'));
const HelperGuestInquiryPage = lazyWithRetry(() => import('./pages/HelperGuestInquiryPage'));
const PlannedNeedsPage = lazyWithRetry(() => import('./pages/PlannedNeedsPage'));
const CarCarePage = lazyWithRetry(() => import('./pages/CarCarePage'));
// OxSteed Food - restaurant online + in-store ordering (migration 305)
const FoodHomePage = lazyWithRetry(routeLoaders.restaurants, { name: 'restaurants' });
const FoodRestaurantPage = lazyWithRetry(() => import('./pages/food/FoodRestaurantPage'));
const FoodMerchantPage = lazyWithRetry(() => import('./pages/food/FoodMerchantPage'));
const FoodKitchenPage = lazyWithRetry(() => import('./pages/food/FoodKitchenPage'));
const FoodQueueBoardPage = lazyWithRetry(() => import('./pages/food/FoodQueueBoardPage'));
const FoodKioskPage = lazyWithRetry(() => import('./pages/food/FoodKioskPage'));
const RestaurantPOSPage = lazyWithRetry(() => import('./pages/food/RestaurantPOSPage'));
const RestaurantInventoryPage = lazyWithRetry(() => import('./pages/food/RestaurantInventoryPage'));
const RestaurantCrewPage = lazyWithRetry(() => import('./pages/food/RestaurantCrewPage'));
const RestaurantRunnerPage = lazyWithRetry(() => import('./pages/food/RestaurantRunnerPage'));
const RestaurantCreditPage = lazyWithRetry(() => import('./pages/food/RestaurantCreditPage'));
const OxsteedCreditPage = lazyWithRetry(() => import('./pages/food/OxsteedCreditPage'));
const OxsteedCreditCardsPage = lazyWithRetry(() => import('./pages/food/OxsteedCreditCardsPage'));
const OxsteedCreditTransactionPage = lazyWithRetry(() => import('./pages/food/OxsteedCreditTransactionPage'));
// OxSteed Logistics branch
const LogisticsHomePage = lazyWithRetry(routeLoaders.logistics, { name: 'logistics' });
const DeliveryPage = lazyWithRetry(() => import('./pages/DeliveryPage'));
const DeliveryDetailPage = lazyWithRetry(() => import('./pages/DeliveryDetailPage'));
const DeliveryDispatchPage = lazyWithRetry(() => import('./pages/DeliveryDispatchPage'));
const BuyerDashboardPage = lazyWithRetry(() => import('./pages/logistics/BuyerDashboardPage'));
const OrganizerDashboardPage = lazyWithRetry(() => import('./pages/logistics/OrganizerDashboardPage'));
const BusinessProcurementPage = lazyWithRetry(() => import('./pages/logistics/BusinessProcurementPage'));
const DistributorResellerPage = lazyWithRetry(() => import('./pages/logistics/DistributorResellerPage'));
const OperationsWorkspacePage = lazyWithRetry(() => import('./pages/logistics/OperationsWorkspacePage'));
const ComplianceWorkspacePage = lazyWithRetry(() => import('./pages/logistics/ComplianceWorkspacePage'));
const AdminControlWorkspacePage = lazyWithRetry(() => import('./pages/logistics/AdminControlWorkspacePage'));
const SourcingOpsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/SourcingOpsAdmin'));
const OrganizerApprovalsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/OrganizerApprovalsAdmin'));
const ShipmentOpsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/ShipmentOpsAdmin'));
const WarehouseOpsDashboard = lazyWithRetry(() => import('./admin/pages/logistics/WarehouseOpsDashboard'));
const AllocationsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/AllocationsAdmin'));
const DisputesAdmin = lazyWithRetry(() => import('./admin/pages/logistics/DisputesAdmin'));
const ComplianceReviewAdmin = lazyWithRetry(() => import('./admin/pages/logistics/ComplianceReviewAdmin'));
const CustomsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/CustomsAdmin'));
const RestrictionsAdmin = lazyWithRetry(() => import('./admin/pages/logistics/RestrictionsAdmin'));
const LogisticsOperatorLoginPage = lazyWithRetry(() => import('./pages/logistics/LogisticsOperatorLoginPage'));
const InternalWorkspaceLoginPage = lazyWithRetry(() => import('./pages/internal/InternalWorkspaceLoginPage'));
const InternalDepartmentWorkspacePage = lazyWithRetry(() => import('./pages/internal/InternalDepartmentWorkspacePage'));
const CampaignsPage = lazyWithRetry(() => import('./pages/logistics/CampaignsPage'));
const CampaignDetailPage = lazyWithRetry(() => import('./pages/logistics/CampaignDetailPage'));
const SourcingPage = lazyWithRetry(() => import('./pages/logistics/SourcingPage'));
const NewRequestPage = lazyWithRetry(() => import('./pages/logistics/NewRequestPage'));
const RequestDetailPage = lazyWithRetry(() => import('./pages/logistics/RequestDetailPage'));
const OrdersPage = lazyWithRetry(() => import('./pages/logistics/OrdersPage'));
const OrderDetailPage = lazyWithRetry(() => import('./pages/logistics/OrderDetailPage'));
const ShipmentsPage = lazyWithRetry(() => import('./pages/logistics/ShipmentsPage'));
const ShipmentDetailPage = lazyWithRetry(() => import('./pages/logistics/ShipmentDetailPage'));
const WarehousingPage = lazyWithRetry(() => import('./pages/logistics/WarehousingPage'));
const DistributionPage = lazyWithRetry(() => import('./pages/logistics/DistributionPage'));
const CompliancePage = lazyWithRetry(() => import('./pages/logistics/CompliancePage'));
const LogisticsFinancePage = lazyWithRetry(() => import('./pages/logistics/LogisticsFinancePage'));
const BusinessHubPage = lazyWithRetry(() => import('./pages/BusinessHubPage'));
const VortexPage = lazyWithRetry(() => import('./pages/VortexPage'));
const NetworkAppsPage = lazyWithRetry(() => import('./pages/NetworkAppsPage'));
const AccessGateRecoveryPage = lazyWithRetry(() => import('./pages/AccessGateRecoveryPage'));
const VerifyIdentityPage = lazyWithRetry(() => import('./pages/VerifyIdentityPage'));
const VerifyEmailPage = lazyWithRetry(() => import('./pages/VerifyEmailPage'));
const PublicInvoiceView = lazyWithRetry(() => import('./pages/PublicInvoiceView'));
const ToolRentalsBrowse = lazyWithRetry(() => import('./pages/ToolRentalsBrowse'));
const DiscoverPage = lazyWithRetry(() => import('./pages/DiscoverPage'));
const MyBookingsPage = lazyWithRetry(() => import('./pages/MyBookingsPage'));
const ToolRentalsAnalytics = lazyWithRetry(() => import('./pages/ToolRentalsAnalytics'));
const QRCodeGeneratorPage = lazyWithRetry(routeLoaders.qrGenerator, { name: 'qrGenerator' });
const BusinessPublicProfilePage = lazyWithRetry(() => import('./pages/BusinessPublicProfilePage'));
const HelperPublicProfilePage = lazyWithRetry(() => import('./pages/HelperPublicProfilePage'));
const JobPublicPage = lazyWithRetry(() => import('./pages/JobPublicPage'));
const ConsultingFullPortal = lazyWithRetry(() => import('./pages/ConsultingFullPortal'));
const ConsultingPortalPage = lazyWithRetry(() => import('./pages/ConsultingPortalPage'));
const ConsultantAvailabilityPage = lazyWithRetry(() => import('./pages/ConsultantAvailabilityPage'));
const ConsultantContractorDashboard = lazyWithRetry(() => import('./pages/ConsultantContractorDashboard'));
const InvoicesPage = lazyWithRetry(() => import('./pages/InvoicesPage'));
const CalendarPage = lazyWithRetry(() => import('./pages/CalendarPage'));
const CalendarAppointmentDetailPage = lazyWithRetry(() => import('./pages/CalendarAppointmentDetailPage'));
const AIPreviewPage = lazyWithRetry(() => import('./pages/AIPreviewPage'));
const ProductMarketplacePage = lazyWithRetry(() => import('./pages/ProductMarketplacePage'));
const ShoppingCartPage = lazyWithRetry(() => import('./pages/ShoppingCartPage'));
const SharedCartPage = lazyWithRetry(() => import('./pages/SharedCartPage'));
const CheckoutPage = lazyWithRetry(() => import('./pages/CheckoutPage'));
const OrderHistoryPage = lazyWithRetry(() => import('./pages/OrderHistoryPage'));
const OrderDetailsPage = lazyWithRetry(() => import('./pages/OrderDetailsPage'));
const SupportTicketDetailPage = lazyWithRetry(() => import('./pages/SupportTicketDetailPage'));
const RestaurantSupportCasePage = lazyWithRetry(() => import('./pages/RestaurantSupportCasePage'));
const SupportEscalationPage = lazyWithRetry(() => import('./pages/SupportEscalationPage'));
const SupportAgentPortalPage = lazyWithRetry(() => import('./pages/SupportAgentPortalPage'));
const SupportAgentWorkspacePage = lazyWithRetry(() => import('./pages/SupportAgentWorkspacePage'));
const StatusPage = lazyWithRetry(() => import('./pages/StatusPage'));
const InventoryHelpCenterPage = lazyWithRetry(() => import('./pages/InventoryHelpCenterPage'));
const MyJobsPage = lazyWithRetry(() => import('./pages/MyJobsPage'));
const MyBidsPage = lazyWithRetry(() => import('./pages/MyBidsPage'));
const EnforcementPolicyPage = lazyWithRetry(() => import('./pages/EnforcementPolicyPage'));
const HelperProfileEditPage = lazyWithRetry(() => import('./pages/HelperProfileEditPage'));
const BusinessProfileEditPage = lazyWithRetry(() => import('./pages/BusinessProfileEditPage'));
const FeatureGuidePage = lazyWithRetry(() => import('./pages/FeatureGuidePage'));
const ExperienceGuidePage = lazyWithRetry(() => import('./pages/ExperienceGuidePage'));
const LearnModePage = lazyWithRetry(() => import('./pages/LearnModePage'));
const PromotePage = lazyWithRetry(() => import('./pages/PromotePage'));
const DirectPortalPage = lazyWithRetry(() => import('./pages/DirectPortalPage'));
const DirectAdminPortalPage = lazyWithRetry(() => import('./pages/DirectAdminPortalPage'));
const DirectCatalog = lazyWithRetry(() => import('./admin/pages/DirectCatalog'));
const MaintenanceRequestPage = lazyWithRetry(() => import('./pages/MaintenanceRequestPage'));
const TradesDiagnosticRequestPage = lazyWithRetry(() => import('./pages/TradesDiagnosticRequestPage'));
const BeautyIntakeRequestPage = lazyWithRetry(() => import('./pages/BeautyIntakeRequestPage'));
const CreativeIntakeRequestPage = lazyWithRetry(() => import('./pages/CreativeIntakeRequestPage'));
const ProfessionalIntakeRequestPage = lazyWithRetry(() => import('./pages/ProfessionalIntakeRequestPage'));
const ContinuityIntakeRequestPage = lazyWithRetry(() => import('./pages/ContinuityIntakeRequestPage'));
const TranslatorWorkspacePage = lazyWithRetry(() => import('./pages/TranslatorWorkspacePage'));
const InvestorDashboardPage = lazyWithRetry(() => import('./pages/InvestorDashboardPage'));
const AffiliateDashboardPage = lazyWithRetry(() => import('./pages/AffiliateDashboardPage'));

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
                    <Route path="/how-it-works/:area"      element={<Guarded><ExperienceGuidePage /></Guarded>} />
                    <Route path="/features"                element={<Navigate to="/how-it-works" replace />} />
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
                    <Route path="/careers"                 element={<Guarded><CareersPage /></Guarded>} />
                    <Route path="/careers/me"              element={<Guarded><ProtectedRoute><RouteErrorBoundary><MyCareerApplicationsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/careers/:id"             element={<Guarded><CareerOpeningPage /></Guarded>} />
                    <Route path="/business/:businessId/careers" element={<Guarded><CareersPage /></Guarded>} />
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
                    {/* Workspace URLs must be declared before the public /business/:id
                        profile so a just-created draft at /business/1/workspace cannot
                        be treated as a public profile load. */}
                    <Route path="/business/:businessId/workspace"          element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:businessId/workspace/:tab"     element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
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
                    <Route path="/helper-dashboard" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/clients" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ClientManagementPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
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
                    <Route path="/messages/guest/:inquiryId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperGuestInquiryPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
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

                    {/* Local Food Directory — new branch name for the same operating
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
                    <Route path="/oxsteed-credit/cards" element={<Guarded><ProtectedRoute><RouteErrorBoundary><OxsteedCreditCardsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* OxSteed Logistics branch (migration 247) */}
                    <Route path="/delivery"                  element={<Guarded><ProtectedRoute><RouteErrorBoundary><DeliveryPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/delivery/jobs/:id"           element={<Guarded><ProtectedRoute><RouteErrorBoundary><DeliveryDetailPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/delivery/operations"          element={<Guarded><LogisticsOperatorGuard><RouteErrorBoundary><DeliveryDispatchPage /></RouteErrorBoundary></LogisticsOperatorGuard></Guarded>} />
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
