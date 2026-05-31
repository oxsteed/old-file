import Navbar from './Navbar';
import Footer from './Footer';
import { useTranslation } from 'react-i18next';

/**
 * PageShell - Shared layout wrapper for all OxSteed pages.
 * Provides consistent header, footer, semantic <main> landmark,
 * and skip-to-content link.
 *
 * Usage:
 *   <PageShell>
 *     <YourPageContent />
 *   </PageShell>
 *
 * @param {{ children: any, hideNav?: boolean, hideFooter?: boolean }} props
 */
export default function PageShell({ children, hideNav = false, hideFooter = false }) {
  const { t } = useTranslation('common');

  return (
    <div className="ox-page">
      <a href="#main-content" className="skip-nav">
        {t('navigation.skipToMainContent')}
      </a>
      {!hideNav && <Navbar />}
      <main id="main-content" className="ox-main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}
