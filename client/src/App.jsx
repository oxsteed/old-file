import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import HomePage from './pages/HomePage';
import Login from './pages/Login';
import CustomerRegister from './pages/CustomerRegister';
import HelperRegister from './pages/HelperRegister';
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
import HowItWorksPage from './pages/HowItWorks';
import AboutPage from './pages/about';
import ForgotPasswordPage from './pages/ForgotPassword';
import ResetPasswordPage from './pages/ResetPassword';
import TwoFactorSetup from './pages/Settings/TwoFactorSetup';
import NotificationSettings from './pages/Settings/Notifications';
import SettingsPage from './pages/SettingsPage';
import PublicProfile from './pages/PublicProfile';
import HelperBusinessProfilePage from './pages/HelperBusinessProfilePage';
import HelpersDirectoryPage from './pages/HelpersDirectoryPage';
import DisputeCenter from './pages/disputes/DisputeCenter';
import DisputeDetail from './pages/disputes/DisputeDetail';
import MessagesPage from './pages/MessagesPage';
import ConversationPage from './pages/ConversationPage';
import PlannedNeedsPage from './pages/PlannedNeedsPage';
import CarCarePage from './pages/CarCarePage';
import HelperInboxPage from './pages/HelperInboxPage';
import HelperConversationPage from './pages/HelperConversationPage';

import CookieConsent from './components/CookieConsent';
import TermsGate from './components/TermsGate';
import { ThemeProvider } from './context/ThemeContext';
import SupportWidget from './components/SupportWidget';

// Wraps each route element in its own error boundary so a crash in one page
// doesn't blank the entire app — only that route shows an error.
function Guarded({ children }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export default function App() {
  return (
    <HelmetProvider>
      <ThemeProvider>
        {/* Root boundary catches catastrophic failures (Router, AuthProvider, etc.) */}
        <ErrorBoundary>
          <Router>
            <AuthProvider>
              <ScrollToTop />
              <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
              <TermsGate>
                <Routes>
                  {/* ── Public routes ──────────────────────────────────── */}
                  <Route path="/"                        element={<Guarded><HomePage /></Guarded>} />
                  <Route path="/login"                   element={<Guarded><Login /></Guarded>} />
                  <Route path="/register/customer"       element={<Guarded><CustomerRegister /></Guarded>} />
                  <Route path="/register/helper"         element={<Guarded><HelperRegister /></Guarded>} />
                  <Route path="/forgot-password"         element={<Guarded><ForgotPasswordPage /></Guarded>} />
                  <Route path="/reset-password/:token"   element={<Guarded><ResetPasswordPage /></Guarded>} />
                  <Route path="/how-it-works"            element={<Guarded><HowItWorksPage /></Guarded>} />
                  <Route path="/about"                   element={<Guarded><AboutPage /></Guarded>} />
                  <Route path="/jobs"                    element={<Guarded><JobListPage /></Guarded>} />
                  <Route path="/jobs/:id"                element={<Guarded><JobDetailPage /></Guarded>} />
                  <Route path="/profile/:id"             element={<Guarded><PublicProfile /></Guarded>} />
                  <Route path="/helpers"                 element={<Guarded><HelpersDirectoryPage /></Guarded>} />
                  <Route path="/helpers/:id"             element={<Guarded><HelperBusinessProfilePage /></Guarded>} />

                  {/* ── Legal / policy pages ───────────────────────────── */}
                  <Route path="/terms"          element={<Guarded><TermsPage /></Guarded>} />
                  <Route path="/privacy"        element={<Guarded><PrivacyPage /></Guarded>} />
                  <Route path="/do-not-sell"    element={<Guarded><DoNotSellPage /></Guarded>} />
                  <Route path="/security"       element={<Guarded><SecurityPage /></Guarded>} />
                  <Route path="/cookie-policy"  element={<Guarded><CookiePolicyPage /></Guarded>} />
                  <Route path="/accessibility"  element={<Guarded><AccessibilityPage /></Guarded>} />

                  {/* ── Authenticated routes ───────────────────────────── */}
                  <Route path="/dashboard"      element={<Guarded><ProtectedRoute><SmartDashboard /></ProtectedRoute></Guarded>} />
                  <Route path="/helper-dashboard" element={<Guarded><ProtectedRoute><SmartDashboard /></ProtectedRoute></Guarded>} />
                  <Route path="/upgrade"        element={<Guarded><ProtectedRoute><UpgradePage /></ProtectedRoute></Guarded>} />
                  <Route path="/post-job"       element={<Guarded><ProtectedRoute><PostJobPage /></ProtectedRoute></Guarded>} />
                  <Route path="/settings"       element={<Guarded><ProtectedRoute><SettingsPage /></ProtectedRoute></Guarded>} />
                  <Route path="/settings/2fa"   element={<Guarded><ProtectedRoute><TwoFactorSetup /></ProtectedRoute></Guarded>} />
                  <Route path="/settings/notifications" element={<Guarded><ProtectedRoute><NotificationSettings /></ProtectedRoute></Guarded>} />
                  <Route path="/disputes"       element={<Guarded><ProtectedRoute><DisputeCenter /></ProtectedRoute></Guarded>} />
                  <Route path="/disputes/:id"   element={<Guarded><ProtectedRoute><DisputeDetail /></ProtectedRoute></Guarded>} />

                  {/* ── Customer messaging ─────────────────────────────── */}
                  <Route path="/messages"       element={<Guarded><ProtectedRoute><MessagesPage /></ProtectedRoute></Guarded>} />
                  <Route path="/messages/:conversationId" element={<Guarded><ProtectedRoute><ConversationPage /></ProtectedRoute></Guarded>} />

                  {/* ── Helper messaging (profile-chat live delivery) ───── */}
                  <Route path="/helper/messages" element={<Guarded><ProtectedRoute><HelperInboxPage /></ProtectedRoute></Guarded>} />
                  <Route path="/helper/messages/:conversationId" element={<Guarded><ProtectedRoute><HelperConversationPage /></ProtectedRoute></Guarded>} />

                  <Route path="/planned-needs" element={<Guarded><ProtectedRoute><PlannedNeedsPage /></ProtectedRoute></Guarded>} />
                  <Route path="/car-care"      element={<Guarded><ProtectedRoute><CarCarePage /></ProtectedRoute></Guarded>} />

                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </TermsGate>
              <CookieConsent />
              <SupportWidget />
            </AuthProvider>
          </Router>
        </ErrorBoundary>
      </ThemeProvider>
    </HelmetProvider>
  );
}
