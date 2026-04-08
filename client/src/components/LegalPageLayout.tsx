import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import PageShell from './PageShell';

interface LegalPageLayoutProps {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}

/**
 * LegalPageLayout — WCAG 2.1 AA compliant wrapper for all legal/policy pages.
 * Now uses the shared PageShell for consistent header/footer.
 * Provides:
 *  - Skip-to-content link (via PageShell)
 *  - Proper landmark regions (via PageShell)
 *  - Document title update
 *  - Focus management on page load
 *  - Breadcrumb navigation
 *  - Back-to-top button
 *  - Consistent heading hierarchy
 */
export default function LegalPageLayout({ title, effectiveDate, children }: LegalPageLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${title} | OxSteed`;
    mainRef.current?.focus();
  }, [title, location.pathname]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    mainRef.current?.focus();
  };

  return (
    <PageShell>
      <div
        ref={mainRef}
        tabIndex={-1}
        style={{ outline: 'none' }}
      >
        {/* Breadcrumb Navigation */}
        <nav
          aria-label="Breadcrumb"
          style={{
            maxWidth: 800,
            margin: '0 auto',
            padding: 'var(--space-5) var(--space-5) 0',
          }}
        >
          <ol style={{
            display: 'flex',
            gap: 'var(--space-2)',
            listStyle: 'none',
            padding: 0,
            margin: 0,
            fontSize: 'var(--text-sm)',
          }} role="list">
            <li style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <a
                href="/"
                style={{ color: 'var(--color-primary)', textDecoration: 'none' }}
              >
                Home
              </a>
              <span aria-hidden="true" style={{ color: 'var(--color-text-faint)' }}>/</span>
            </li>
            <li aria-current="page">
              <span style={{ color: 'var(--color-text-muted)' }}>{title}</span>
            </li>
          </ol>
        </nav>

        {/* Article Content */}
        <article style={{
          maxWidth: 800,
          margin: '0 auto',
          padding: 'var(--space-5) var(--space-5) var(--space-16)',
        }}>
          {/* Page Header */}
          <header>
            <h1 style={{
              color: 'var(--color-primary)',
              fontSize: 'var(--text-3xl)',
              fontWeight: 700,
              marginBottom: 'var(--space-2)',
              lineHeight: 1.3,
            }}>
              {title}
            </h1>
            <p style={{
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
              marginBottom: 'var(--space-8)',
            }}>
              <time dateTime={effectiveDate}>
                Effective Date: {new Date(effectiveDate).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </time>
            </p>
          </header>

          {/* Policy Content */}
          <div
            role="region"
            aria-label={`${title} sections`}
            style={{
              color: 'var(--color-text)',
              lineHeight: 1.75,
              fontSize: 'var(--text-base)',
            }}
          >
            {children}
          </div>

          {/* Navigation Footer */}
          <div style={{
            marginTop: 'var(--space-12)',
            paddingTop: 'var(--space-6)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}>
            <button
              onClick={() => navigate(-1)}
              className="ox-btn ox-btn-outline ox-btn-sm"
              aria-label="Go back to previous page"
            >
              ← Go Back
            </button>
            <button
              onClick={scrollToTop}
              className="ox-btn ox-btn-secondary ox-btn-sm"
              aria-label="Scroll to top of page"
            >
              ↑ Back to Top
            </button>
          </div>
        </article>
      </div>
    </PageShell>
  );
}
