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
import AdminDashboard from './pages/AdminDashboard';
import NotFoundPage from './pages/NotFoundPage';
import TermsPage from './pages/terms';
import PrivacyPage from './pages/privacy';
import DoNotSellPage from './pages/donotsell';
import SecurityPage from './pages/security';
import CookiePolicyPage from './pages/cookiepolicy';
import CookieConsent from './components/CookieConsent';
import TermsGate from './components/TermsGate';
import PricingConfig from './pages/admin/PricingConfig';

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
              <Route path="/register/customer" element={<CustomerRegister />} />
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
              <Route
                path="/jobs"
                element={
                  <ProtectedRoute>
                    <JobListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/jobs/:id"
                element={
                  <ProtectedRoute>
                    <JobDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/post-job"
                element={
                  <ProtectedRoute>
                    <PostJobPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin"
                element={
                  <ProtectedRoute>
                    <AdminDashboard />
                  </ProtectedRoute>
                }
              />
              <Route path="/admin/pricing" element={<ProtectedRoute><PricingConfig /></ProtectedRoute>} />             <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </TermsGate>
          <CookieConsent />
        </AuthProvider>
      </Router>
    </ErrorBoundary>
  );
}
