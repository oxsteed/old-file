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
import ImpersonatePage     from './pages/ImpersonatePage';
import HomePage from './pages/HomePage';
import Login from './pages/Login';
import InvestorLoginPage from './pages/InvestorLoginPage';
import CustomerRegister from './pages/CustomerRegister';
import HelperRegister from './pages/HelperRegister';
import JoinPage from './pages/JoinPage';
import ConsultingIntakePage from './pages/ConsultingIntakePage';
import ConsultingFeedbackPage from './pages/ConsultingFeedbackPage';
import BusinessLaunchStatusPage from './pages/BusinessLaunchStatusPage';
import FranchiseIntakePage from './pages/FranchiseIntakePage';
import FranchiseApplicantDashboard from './pages/FranchiseApplicantDashboard';
import FranchiseTerritoryOpsPage from './pages/FranchiseTerritoryOpsPage';
import SmartDashboard from './pages/SmartDashboard';
import UpgradePage from './pages/UpgradePage';
import ActivityPage from './pages/ActivityPage';
import JobListPage from './pages/JobListPage';
import JobDetailPage from './pages/JobDetailPage';
import BidDetailPage from './pages/BidDetailPage';
import PostJobPage from './pages/PostJobPage';
import NotFoundPage from './pages/NotFoundPage';
import TermsPage from './pages/terms';
import PrivacyPage from './pages/privacy';
import DoNotSellPage from './pages/donotsell';
import SecurityPage from './pages/security';
import CookiePolicyPage from './pages/cookiepolicy';
import AccessibilityPage from './pages/accessibility';
import BackgroundCheckPage from './pages/BackgroundCheckPage';
import ArbitrationPage from './pages/ArbitrationPage';
import EscrowPolicyPage from './pages/EscrowPolicyPage';
import AccountTerminationPage from './pages/AccountTerminationPage';
import DisputeResolutionPage from './pages/DisputeResolutionPage';
import IndependentContractorPage from './pages/IndependentContractorPage';
import AboutPage from './pages/about';
import ForgotPasswordPage from './pages/ForgotPassword';
import ResetPasswordPage from './pages/ResetPassword';
import TwoFactorSetup from './pages/Settings/TwoFactorSetup';
import NotificationSettings from './pages/Settings/Notifications';
import CountrySettings from './pages/Settings/Country';
import SettingsPage from './pages/SettingsPage';
import HelperCancellationSettings from './pages/HelperCancellationSettings';
import PublicProfile from './pages/PublicProfile';
import BookHelperPage from './pages/BookHelperPage';
import BookBusinessPage from './pages/BookBusinessPage';
import BookServicePage from './pages/BookServicePage';
import TemplatePicker from './pages/TemplatePicker';
import BusinessProfilePage from './pages/BusinessProfilePage';
import HelperBusinessProfilePage from './pages/HelperBusinessProfilePage';
import HelpersDirectoryPage from './pages/HelpersDirectoryPage';
import DisputeCenter from './pages/disputes/DisputeCenter';
import DisputeDetail from './pages/disputes/DisputeDetail';
import MessagesPage from './pages/MessagesPage';
import ConversationPage from './pages/ConversationPage';
import HelperInboxPage from './pages/HelperInboxPage';
import HelperConversationPage from './pages/HelperConversationPage';
import HelperGuestInquiryPage from './pages/HelperGuestInquiryPage';
import PlannedNeedsPage from './pages/PlannedNeedsPage';
import CarCarePage from './pages/CarCarePage';
// OxSteed Food - restaurant online + in-store ordering (migration 305)
import FoodHomePage from './pages/food/FoodHomePage';
import FoodRestaurantPage from './pages/food/FoodRestaurantPage';
import FoodMerchantPage from './pages/food/FoodMerchantPage';
import FoodKitchenPage from './pages/food/FoodKitchenPage';
import FoodQueueBoardPage from './pages/food/FoodQueueBoardPage';
import FoodKioskPage from './pages/food/FoodKioskPage';
import RestaurantPOSPage from './pages/food/RestaurantPOSPage';
import RestaurantInventoryPage from './pages/food/RestaurantInventoryPage';
import RestaurantCrewPage from './pages/food/RestaurantCrewPage';
import RestaurantRunnerPage from './pages/food/RestaurantRunnerPage';
import RestaurantCreditPage from './pages/food/RestaurantCreditPage';
// OxSteed Logistics branch
import LogisticsHomePage    from './pages/logistics/LogisticsHomePage';
import BuyerDashboardPage   from './pages/logistics/BuyerDashboardPage';
import OrganizerDashboardPage from './pages/logistics/OrganizerDashboardPage';
import BusinessProcurementPage from './pages/logistics/BusinessProcurementPage';
import DistributorResellerPage from './pages/logistics/DistributorResellerPage';
import OperationsWorkspacePage from './pages/logistics/OperationsWorkspacePage';
import ComplianceWorkspacePage from './pages/logistics/ComplianceWorkspacePage';
import AdminControlWorkspacePage from './pages/logistics/AdminControlWorkspacePage';
import SourcingOpsAdmin from './admin/pages/logistics/SourcingOpsAdmin';
import OrganizerApprovalsAdmin from './admin/pages/logistics/OrganizerApprovalsAdmin';
import ShipmentOpsAdmin from './admin/pages/logistics/ShipmentOpsAdmin';
import WarehouseOpsDashboard from './admin/pages/logistics/WarehouseOpsDashboard';
import AllocationsAdmin from './admin/pages/logistics/AllocationsAdmin';
import DisputesAdmin from './admin/pages/logistics/DisputesAdmin';
import ComplianceReviewAdmin from './admin/pages/logistics/ComplianceReviewAdmin';
import CustomsAdmin from './admin/pages/logistics/CustomsAdmin';
import RestrictionsAdmin from './admin/pages/logistics/RestrictionsAdmin';
import LogisticsOperatorLoginPage from './pages/logistics/LogisticsOperatorLoginPage';
import InternalWorkspaceLoginPage from './pages/internal/InternalWorkspaceLoginPage';
import InternalDepartmentWorkspacePage from './pages/internal/InternalDepartmentWorkspacePage';
import CampaignsPage        from './pages/logistics/CampaignsPage';
import CampaignDetailPage   from './pages/logistics/CampaignDetailPage';
import SourcingPage         from './pages/logistics/SourcingPage';
import NewRequestPage       from './pages/logistics/NewRequestPage';
import RequestDetailPage    from './pages/logistics/RequestDetailPage';
import OrdersPage           from './pages/logistics/OrdersPage';
import OrderDetailPage      from './pages/logistics/OrderDetailPage';
import ShipmentsPage        from './pages/logistics/ShipmentsPage';
import ShipmentDetailPage   from './pages/logistics/ShipmentDetailPage';
import WarehousingPage      from './pages/logistics/WarehousingPage';
import DistributionPage     from './pages/logistics/DistributionPage';
import CompliancePage       from './pages/logistics/CompliancePage';
import LogisticsFinancePage from './pages/logistics/LogisticsFinancePage';
import BusinessHubPage from './pages/BusinessHubPage';
import VortexPage from './pages/VortexPage';
import NetworkAppsPage from './pages/NetworkAppsPage';
import AccessGateRecoveryPage from './pages/AccessGateRecoveryPage';
import VerifyIdentityPage from './pages/VerifyIdentityPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import PublicInvoiceView from './pages/PublicInvoiceView';
import ToolRentalsBrowse from './pages/ToolRentalsBrowse';
import DiscoverPage from './pages/DiscoverPage';
import MyBookingsPage from './pages/MyBookingsPage';
import ToolRentalsAnalytics from './pages/ToolRentalsAnalytics';
import QRCodeGeneratorPage from './pages/QRCodeGeneratorPage';
import BusinessPublicProfilePage from './pages/BusinessPublicProfilePage';
import HelperPublicProfilePage from './pages/HelperPublicProfilePage';
import JobPublicPage from './pages/JobPublicPage';
import ConsultingFullPortal from './pages/ConsultingFullPortal';
import ConsultingPortalPage from './pages/ConsultingPortalPage';
import ConsultantAvailabilityPage from './pages/ConsultantAvailabilityPage';
import ConsultantContractorDashboard from './pages/ConsultantContractorDashboard';
import InvoicesPage from './pages/InvoicesPage';
import CalendarPage from './pages/CalendarPage';
import CalendarAppointmentDetailPage from './pages/CalendarAppointmentDetailPage';
import AIPreviewPage from './pages/AIPreviewPage';
import ProductMarketplacePage from './pages/ProductMarketplacePage';
import ShoppingCartPage from './pages/ShoppingCartPage';
import SharedCartPage from './pages/SharedCartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderHistoryPage from './pages/OrderHistoryPage';
import OrderDetailsPage from './pages/OrderDetailsPage';
import SupportTicketDetailPage from './pages/SupportTicketDetailPage';
import RestaurantSupportCasePage from './pages/RestaurantSupportCasePage';
import SupportEscalationPage from './pages/SupportEscalationPage';
import SupportAgentPortalPage from './pages/SupportAgentPortalPage';
import SupportAgentWorkspacePage from './pages/SupportAgentWorkspacePage';
import StatusPage from './pages/StatusPage';
import InventoryHelpCenterPage from './pages/InventoryHelpCenterPage';
import MyJobsPage from './pages/MyJobsPage';
import MyBidsPage from './pages/MyBidsPage';
import EnforcementPolicyPage from './pages/EnforcementPolicyPage';
import HelperProfileEditPage from './pages/HelperProfileEditPage';
import BusinessProfileEditPage from './pages/BusinessProfileEditPage';
import FeatureGuidePage from './pages/FeatureGuidePage';
import LearnModePage from './pages/LearnModePage';
import PromotePage from './pages/PromotePage';
import DirectPortalPage from './pages/DirectPortalPage';
import DirectAdminPortalPage from './pages/DirectAdminPortalPage';
import MaintenanceRequestPage from './pages/MaintenanceRequestPage';
import TradesDiagnosticRequestPage from './pages/TradesDiagnosticRequestPage';
import BeautyIntakeRequestPage from './pages/BeautyIntakeRequestPage';
import CreativeIntakeRequestPage from './pages/CreativeIntakeRequestPage';
import ProfessionalIntakeRequestPage from './pages/ProfessionalIntakeRequestPage';
import ContinuityIntakeRequestPage from './pages/ContinuityIntakeRequestPage';
import TranslatorWorkspacePage from './pages/TranslatorWorkspacePage';
import InvestorDashboardPage from './pages/InvestorDashboardPage';
import AffiliateDashboardPage from './pages/AffiliateDashboardPage';

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
                    <Route path="/direct/admin/reports"    element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="reports" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/team"       element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="team" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/direct/admin/email-test" element={<Guarded><ProtectedRoute><DirectAdminRouteGate><RouteErrorBoundary><DirectAdminPortalPage view="email-test" /></RouteErrorBoundary></DirectAdminRouteGate></ProtectedRoute></Guarded>} />
                    <Route path="/request-quote"          element={<Guarded><DirectPortalPage view="request" /></Guarded>} />
                    <Route path="/quote-request"          element={<Guarded><DirectPortalPage view="request" /></Guarded>} />
                    <Route path="/consulting/feedback/:sessionId" element={<Guarded><ConsultingFeedbackPage /></Guarded>} />
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
