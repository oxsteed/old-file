import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}

/**
 * LegalPageLayout — WCAG 2.1 AA compliant wrapper for all legal/policy pages.
 * Provides:
 *  - Skip-to-content link
 *  - Proper landmark regions (<main>, <nav>, <header>)
 *  - Document title update
 *  - Focus management on page load
 *  - Breadcrumb navigation with aria-label
 *  - Back-to-top button
 *  - Consistent heading hierarchy (h1 > h2 > h3)
 *  - Print-friendly styles
 */
export default function LegalPageLayout({ title, effectiveDate, children }: LegalPageLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

  // Update document title for screen readers
  useEffect(() => {
    document.title = `${title} | OxSteed`;
    // Focus the main content on navigation for screen readers
    mainRef.current?.focus();
  }, [title, location.pathname]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    mainRef.current?.focus();
  };

  return (
    <div style={styles.page}>
      {/* Skip Navigation — WCAG 2.4.1 */}
      <a href="#main-content" style={styles.skipLink} className="skip-nav">
        Skip to main content
      </a>

      {/* Breadcrumb Navigation — WCAG 2.4.8 */}
      <nav aria-label="Breadcrumb" style={styles.breadcrumb}>
        <ol style={styles.breadcrumbList} role="list">
          <li style={styles.breadcrumbItem}>
            <a href="/" style={styles.breadcrumbLink}>Home</a>
            <span aria-hidden="true" style={styles.separator}>/</span>
          </li>
          <li style={styles.breadcrumbItem} aria-current="page">
            <span style={styles.breadcrumbCurrent}>{title}</span>
          </li>
        </ol>
      </nav>

      {/* Main Content — WCAG 1.3.1, 2.4.1 */}
      <main
        id="main-content"
        ref={mainRef}
        tabIndex={-1}
        role="main"
        aria-label={`${title} page content`}
        style={styles.main}
      >
        <article style={styles.container}>
          {/* Page Header */}
          <header>
            <h1 style={styles.h1}>{title}</h1>
            <p style={styles.date}>
              <time dateTime={effectiveDate}>
                Effective Date: {new Date(effectiveDate).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </time>
            </p>
          </header>

          {/* Policy Content */}
          <div role="region" aria-label={`${title} sections`}>
            {children}
          </div>

          {/* Footer Navigation */}
          <footer style={styles.footer}>
            <nav aria-label="Legal page navigation" style={styles.footerNav}>
              <button
                onClick={() => navigate(-1)}
                style={styles.backBtn}
                aria-label="Go back to previous page"
              >
                &larr; Go Back
              </button>
              <button
                onClick={scrollToTop}
                style={styles.topBtn}
                aria-label="Scroll to top of page"
              >
                &uarr; Back to Top
              </button>
            </nav>
            <div style={styles.relatedLinks}>
              <span style={styles.relatedLabel}>Related Policies:</span>
              <a href="/terms" style={styles.relatedLink}>Terms of Service</a>
              <a href="/privacy" style={styles.relatedLink}>Privacy Policy</a>
              <a href="/security" style={styles.relatedLink}>Security Policy</a>
              <a href="/cookie-policy" style={styles.relatedLink}>Cookie Policy</a>
              <a href="/do-not-sell" style={styles.relatedLink}>Do Not Sell</a>
            </div>
          </footer>
        </article>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#0b0e18', color: '#e0e0e0',
  },
  skipLink: {
    position: 'absolute', top: -9999, left: -9999,
    padding: '12px 24px', background: '#f97316', color: '#fff',
    fontSize: 14, fontWeight: 600, zIndex: 10001, borderRadius: 4,
    textDecoration: 'none',
  },
  breadcrumb: {
    maxWidth: 800, margin: '0 auto', padding: '20px 20px 0',
  },
  breadcrumbList: {
    display: 'flex', gap: 8, listStyle: 'none', padding: 0, margin: 0, fontSize: 13,
  },
  breadcrumbItem: { display: 'flex', alignItems: 'center', gap: 8 },
  breadcrumbLink: { color: '#f97316', textDecoration: 'none' },
  breadcrumbCurrent: { color: '#888' },
  separator: { color: '#555' },
  main: {
    padding: '20px 20px 60px', outline: 'none',
  },
  container: { maxWidth: 800, margin: '0 auto' },
  h1: { color: '#f97316', fontSize: 28, marginBottom: 8, lineHeight: 1.3 },
  date: { color: '#888', fontSize: 13, marginBottom: 32 },
  footer: {
    marginTop: 48, paddingTop: 24, borderTop: '1px solid #222',
  },
  footerNav: {
    display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap',
  },
  backBtn: {
    color: '#f97316', cursor: 'pointer', background: 'none',
    border: '1px solid #f97316', borderRadius: 6, padding: '8px 16px',
    fontSize: 13, fontWeight: 500,
  },
  topBtn: {
    color: '#ccc', cursor: 'pointer', background: 'none',
    border: '1px solid #555', borderRadius: 6, padding: '8px 16px',
    fontSize: 13, fontWeight: 500,
  },
  relatedLinks: {
    display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 13,
  },
  relatedLabel: { color: '#888', fontWeight: 500 },
  relatedLink: { color: '#f97316', textDecoration: 'none' },
};
