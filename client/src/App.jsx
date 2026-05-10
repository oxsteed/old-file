import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './context/AuthContext';
import { CookieConsentProvider } from './context/CookieConsentContext';
import './i18n'; // initialise i18next before any component renders
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary, { RouterAwareErrorBoundary } from './components/ErrorBoundary';
import RouteErrorBoundary from './components/RouteErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import ImpersonationBanner from './components/ImpersonationBanner';
import ImpersonatePage     from './pages/ImpersonatePage';
import HomePage from './pages/HomePage';
import Login from './pages/Login';
import CustomerRegister from './pages/CustomerRegister';
import HelperRegister from './pages/HelperRegister';
import ConsultingIntakePage from './pages/ConsultingIntakePage';
import ConsultingFeedbackPage from './pages/ConsultingFeedbackPage';
import BusinessLaunchStatusPage from './pages/BusinessLaunchStatusPage';
import SmartDashboard from './pages/SmartDashboard';
import UpgradePage from './pages/UpgradePage';
import JobListPage from './pages/JobListPage';
import JobDetailPage from './pages/JobDetailPage';
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
import HowItWorksPage from './pages/HowItWorks';
import AboutPage from './pages/about';
import ForgotPasswordPage from './pages/ForgotPassword';
import ResetPasswordPage from './pages/ResetPassword';
import TwoFactorSetup from './pages/Settings/TwoFactorSetup';
import NotificationSettings from './pages/Settings/Notifications';
import SettingsPage from './pages/SettingsPage';
import HelperCancellationSettings from './pages/HelperCancellationSettings';
import PublicProfile from './pages/PublicProfile';
import BookHelperPage from './pages/BookHelperPage';
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
import BusinessHubPage from './pages/BusinessHubPage';
import VerifyIdentityPage from './pages/VerifyIdentityPage';
import VerifyEmailPage from './pages/VerifyEmailPage';
import PublicInvoiceView from './pages/PublicInvoiceView';
import ToolRentalsBrowse from './pages/ToolRentalsBrowse';
import DiscoverPage from './pages/DiscoverPage';
import MyBookingsPage from './pages/MyBookingsPage';
import ToolRentalsAnalytics from './pages/ToolRentalsAnalytics';
import QRCodeGeneratorPage from './pages/QRCodeGeneratorPage';
import ConsultingFullPortal from './pages/ConsultingFullPortal';
import ConsultingPortalPage from './pages/ConsultingPortalPage';
import ConsultantAvailabilityPage from './pages/ConsultantAvailabilityPage';
import InvoicesPage from './pages/InvoicesPage';
import CalendarPage from './pages/CalendarPage';
import AIPreviewPage from './pages/AIPreviewPage';
import ProductMarketplacePage from './pages/ProductMarketplacePage';
import ShoppingCartPage from './pages/ShoppingCartPage';
import SharedCartPage from './pages/SharedCartPage';
import CheckoutPage from './pages/CheckoutPage';
import OrderHistoryPage from './pages/OrderHistoryPage';
import OrderDetailsPage from './pages/OrderDetailsPage';
import SupportEscalationPage from './pages/SupportEscalationPage';
import SupportAgentPortalPage from './pages/SupportAgentPortalPage';
import MyJobsPage from './pages/MyJobsPage';
import MyBidsPage from './pages/MyBidsPage';
import EnforcementPolicyPage from './pages/EnforcementPolicyPage';
import HelperProfileEditPage from './pages/HelperProfileEditPage';
import BusinessProfileEditPage from './pages/BusinessProfileEditPage';
import FeatureGuidePage from './pages/FeatureGuidePage';

import CookieConsent from './components/CookieConsent';
import TermsGate from './components/TermsGate';
import { ThemeProvider } from './context/ThemeContext';
import SupportWidget from './components/SupportWidget';
import { LanguageProvider } from './context/LanguageContext';

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

export default function App() {
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
                  <Routes>
                    {/* ── Impersonation landing (super-admin only, new tab) ── */}
                    <Route path="/impersonate"             element={<ImpersonatePage />} />
                    {/* ── Public routes ────────────────────────────────────── */}
                    <Route path="/"                        element={<Guarded><HomePage /></Guarded>} />
                    <Route path="/login"                   element={<Guarded><Login /></Guarded>} />
                    <Route path="/register/customer"       element={<Guarded><CustomerRegister /></Guarded>} />
                    <Route path="/register/helper"         element={<Guarded><HelperRegister /></Guarded>} />
                    <Route path="/forgot-password"         element={<Guarded><ForgotPasswordPage /></Guarded>} />
                    <Route path="/reset-password/:token"   element={<Guarded><ResetPasswordPage /></Guarded>} />
                    <Route path="/how-it-works"            element={<Guarded><HowItWorksPage /></Guarded>} />
                    <Route path="/features"                element={<Guarded><FeatureGuidePage /></Guarded>} />
                    <Route path="/about"                   element={<Guarded><AboutPage /></Guarded>} />
                    <Route path="/jobs"                    element={<Guarded><JobListPage /></Guarded>} />
                    <Route path="/jobs/:id"                element={<Guarded><JobDetailPage /></Guarded>} />
                    <Route path="/profile/:id"             element={<Guarded><PublicProfile /></Guarded>} />
                    <Route path="/helpers"                 element={<Guarded><HelpersDirectoryPage /></Guarded>} />
                    <Route path="/discover"                element={<Guarded><DiscoverPage /></Guarded>} />
                    <Route path="/consulting-intake"       element={<Guarded><ConsultingIntakePage /></Guarded>} />
                    <Route path="/consulting/feedback/:sessionId" element={<Guarded><ConsultingFeedbackPage /></Guarded>} />
                    <Route path="/business-launch-status"  element={<Guarded><BusinessLaunchStatusPage /></Guarded>} />
                    <Route path="/helpers/:id"             element={<Guarded><HelperBusinessProfilePage /></Guarded>} />
                    <Route path="/book/:id"               element={<Guarded><ProtectedRoute><RouteErrorBoundary><BookHelperPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:id"            element={<Guarded><BusinessProfilePage /></Guarded>} />
                    <Route path="/tool-rentals"            element={<Guarded><ToolRentalsBrowse /></Guarded>} />
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

                    {/* ── Support & Help ───────────────────────────────────── */}
                    <Route path="/support/escalation"     element={<Guarded><SupportEscalationPage /></Guarded>} />
                    <Route path="/support/agent" element={<Guarded><ProtectedRoute><SupportAgentPortalPage /></ProtectedRoute></Guarded>} />

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
                    <Route path="/helper-dashboard" element={<Guarded><ProtectedRoute><RouteErrorBoundary><SmartDashboard /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/upgrade"        element={<Guarded><ProtectedRoute><UpgradePage /></ProtectedRoute></Guarded>} />
                    <Route path="/templates"      element={<Guarded><ProtectedRoute><TemplatePicker /></ProtectedRoute></Guarded>} />
                    <Route path="/dashboard/ai-preview" element={<Guarded><ProtectedRoute><RouteErrorBoundary><AIPreviewPage profileType="helper" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/business/:id/ai-preview" element={<Guarded><ProtectedRoute><RouteErrorBoundary><AIPreviewPage profileType="business" /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Critical: Job posting form with media upload */}
                    <Route path="/post-job"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><PostJobPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/my-jobs"        element={<Guarded><ProtectedRoute><MyJobsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/my-bids"        element={<Guarded><ProtectedRoute><MyBidsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/invoices"       element={<Guarded><ProtectedRoute><RouteErrorBoundary><InvoicesPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/consultant-availability" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultantAvailabilityPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Redirect tool-rentals listing CTA to the dashboard skills tab */}
                    <Route path="/profile/tool-rentals" element={<Navigate to="/dashboard?tab=skills" replace />} />
                    <Route path="/settings"       element={<Guarded><ProtectedRoute><SettingsPage /></ProtectedRoute></Guarded>} />
                    <Route path="/settings/2fa"   element={<Guarded><ProtectedRoute><TwoFactorSetup /></ProtectedRoute></Guarded>} />
                    <Route path="/settings/notifications" element={<Guarded><ProtectedRoute><NotificationSettings /></ProtectedRoute></Guarded>} />
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
                    <Route path="/helper/messages" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperInboxPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/messages/guest/:inquiryId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperGuestInquiryPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/helper/messages/:conversationId" element={<Guarded><ProtectedRoute><RouteErrorBoundary><HelperConversationPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    {/* Financial planning: wrapped in RouteErrorBoundary to isolate crashes */}
                    <Route path="/planned-needs" element={<Guarded><ProtectedRoute><RouteErrorBoundary><PlannedNeedsPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />
                    <Route path="/car-care"      element={<Guarded><ProtectedRoute><RouteErrorBoundary><CarCarePage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Critical: Business analytics dashboard with multiple tabs */}
                    <Route path="/business-hub"  element={<Guarded><ProtectedRoute><RouteErrorBoundary><BusinessHubPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Role-aware appointment + availability calendar system */}
                    <Route path="/calendar" element={<Guarded><ProtectedRoute><RouteErrorBoundary><CalendarPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Pro feature: QR Code Generator */}
                    <Route path="/qr-generator"  element={<Guarded><ProtectedRoute><RouteErrorBoundary><QRCodeGeneratorPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Consulting Portal (All Phases) */}
                    <Route path="/consulting/portal" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultingFullPortal /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    {/* Client Consulting Portal - Track Progress */}
                    <Route path="/consulting" element={<Guarded><ProtectedRoute><RouteErrorBoundary><ConsultingPortalPage /></RouteErrorBoundary></ProtectedRoute></Guarded>} />

                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </TermsGate>
                <CookieConsent />
                <SupportWidget />
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
