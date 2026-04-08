import Navbar from './Navbar';
import Footer from './Footer';

/**
 * PageShell — Shared layout wrapper for all OxSteed pages.
 * Provides consistent header, footer, semantic <main> landmark,
 * and skip-to-content link.
 *
 * Usage:
 *   <PageShell>
 *     <YourPageContent />
 *   </PageShell>
 *
 * @param {boolean} hideNav  — hide the navbar (e.g. for pages with custom nav)
 * @param {boolean} hideFooter — hide the footer
 */
export default function PageShell({ children, hideNav = false, hideFooter = false }) {
  return (
    <div className="ox-page">
      <a href="#main-content" className="skip-nav">
        Skip to main content
      </a>
      {!hideNav && <Navbar />}
      <main id="main-content" className="ox-main" tabIndex={-1} style={{ outline: 'none' }}>
        {children}
      </main>
      {!hideFooter && <Footer />}
    </div>
  );
}
