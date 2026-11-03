import { useRef } from 'react';
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
 * @param {{ children: any, hideNav?: boolean, hideFooter?: boolean, mainId?: string }} props
 */
export default function PageShell({ children, hideNav = false, hideFooter = false, mainId = 'main-content' }) {
  const { t } = useTranslation('common');
  const mainRef = useRef(null);

  const skipToMain = (event) => {
    if (!mainRef.current || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    mainRef.current.focus();
    mainRef.current.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="ox-page">
      <a href={`#${mainId}`} className="skip-nav" onClick={skipToMain} data-track="ui.192dd89b6c.1">
        {t('navigation.skipToMainContent')}
      </a>
      {!hideNav && <Navbar />}
      <main ref={mainRef} id={mainId} className="ox-main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}
