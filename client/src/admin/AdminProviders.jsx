import { HelmetProvider } from 'react-helmet-async';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { ThemeProvider } from '../context/ThemeContext';
import { CookieConsentProvider } from '../context/CookieConsentContext';
import CookieConsent from '../components/CookieConsent';

export default function AdminProviders({ children }) {
  return (
    <HelmetProvider>
      <LanguageProvider>
        <ThemeProvider>
          <CookieConsentProvider>
            <AuthProvider>
              {children}
              <CookieConsent />
              <Toaster position="top-right" toastOptions={{ duration: 4000 }} />
            </AuthProvider>
          </CookieConsentProvider>
        </ThemeProvider>
      </LanguageProvider>
    </HelmetProvider>
  );
}
