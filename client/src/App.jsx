import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import ScrollToTop from './components/ScrollToTop';
import HomePage from './pages/HomePage';
import Login from './pages/Login';
import CustomerRegister from './pages/CustomerRegister';
import HelperRegister from './pages/HelperRegister';
import Dashboard from './pages/Dashboard';
import UpgradePage from './pages/UpgradePage';
import HelperDashboard from './pages/HelperDashboard';
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
import AboutPage from './pages/about';
import ForgotPasswordPage from './pages/ForgotPassword';
import ResetPasswordPage from './pages/ResetPassword';
import TwoFactorSetup from './pages/Settings/TwoFactorSetup';
import SettingsPage from './pages/SettingsPage';
import PublicProfile from './pages/PublicProfile';
import CookieConsent from './components/CookieConsent';
import TermsGate from './components/TermsGate';

export default function App() {
  return (
    <ErrorBoundary>
      <Router>
        <AuthProvider>
          <ScrollToTop />
          <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
          <TermsGate>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/do-not-sell" element={<DoNotSellPage />} />
              <Route path="/security" element={<SecurityPage />} />
              <Route path="/cookie-policy" element={<CookiePolicyPage />} />
              <Route path="/accessibility" element={<AccessibilityPage />} />
              <Route path="/register/customer" element={<CustomerRegister />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/register/helper" element={<HelperRegister />} />
              <Route
                path="/dashboard"
                element={
                  <ProtectedRoute>
                    <Dashboard />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/upgrade"
                element={
                  <ProtectedRoute>
                    <UpgradePage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/helper-dashboard"
                element={
                  <ProtectedRoute>
                    <HelperDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/jobs" element={<JobListPage />} />
              <Route path="/jobs/:id" element={<JobDetailPage />} />
              <Route
                path="/post-job"
                element={
                  <ProtectedRoute>
                    <PostJobPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/settings/2fa" element={<ProtectedRoute><TwoFactorSetup /></ProtectedRoute>} />
                        <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
          <Route path="/profile/:id" element={<PublicProfile />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </TermsGate>
          <CookieConsent />
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}
