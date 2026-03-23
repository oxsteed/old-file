import { useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Home } from 'lucide-react';
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

      {/* Branded Header Nav */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(11,14,24,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid #1f2937' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <Home style={{ width: 20, height: 20, color: '#f97316' }} />
            <span style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>OxSteed</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Link to="/" style={{ fontSize: 14, color: '#9ca3af', textDecoration: 'none' }}>Home</Link>
            <Link to="/jobs" style={{ fontSize: 14, color: '#9ca3af', textDecoration: 'none' }}>Browse Jobs</Link>
            <Link to="/login" style={{ fontSize: 14, color: '#fff', background: '#ea580c', padding: '8px 16px', borderRadius: 8, textDecoration: 'none', fontWeight: 500 }}>Sign In</Link>
          </div>
        </div>
      </nav>

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

                    {/* Page Navigation */}
              <div style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid #222', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <button onClick={() => navigate(-1)} style={styles.backBtn} aria-label="Go back to previous page">&larr; Go Back</button>
                <button onClick={scrollToTop} style={styles.topBtn} aria-label="Scroll to top of page">&uarr; Back to Top</button>
              </div>
            </article>
          </main>

      {/* Branded Site Footer */}
      <footer style={{ borderTop: '1px solid #1f2937', background: '#0b0e18' }}>
        <div style={{ maxWidth: 1152, margin: '0 auto', padding: '32px 16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 16 }} className="md-flex-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Home style={{ width: 16, height: 16, color: '#f97316' }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff' }}>OxSteed</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12, color: '#6b7280' }}>
              <Link to="/terms" style={{ color: '#6b7280', textDecoration: 'none' }}>Terms of Service</Link>
              <Link to="/privacy" style={{ color: '#6b7280', textDecoration: 'none' }}>Privacy Policy</Link>
              <Link to="/security" style={{ color: '#6b7280', textDecoration: 'none' }}>Security</Link>
              <Link to="/cookie-policy" style={{ color: '#6b7280', textDecoration: 'none' }}>Cookie Policy</Link>
              <Link to="/do-not-sell" style={{ color: '#6b7280', textDecoration: 'none' }}>Do Not Sell My Info</Link>
            </div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #1f2937', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12, color: '#4b5563' }} className="md-flex-row">
            <p>&copy; {new Date().getFullYear()} OxSteed LLC</p>
            <p>For questions, contact <a href="mailto:legal@oxsteed.com" style={{ color: '#f97316', textDecoration: 'underline' }}>legal@oxsteed.com</a></p>
          </div>
        </div>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', background: '#0b0e18', color: '#e0e0e0', display: 'flex', flexDirection: 'column' as const,
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
    padding: '20px 20px 60px', outline: 'none', flex: 1,
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
