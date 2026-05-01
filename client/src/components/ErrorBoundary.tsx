import React from 'react';
import i18next from 'i18next';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  // Injected by RouterAwareErrorBoundary - kept optional so the class
  // component can be unit-tested in isolation without a router context.
  navigateHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary - Catches unhandled React rendering errors
 * and displays a user-friendly fallback UI instead of a blank page.
 * Includes a retry button and contact information.
 *
 * Use <RouterAwareErrorBoundary> (exported below) in App.jsx so the
 * "Go to Homepage" button navigates via React Router instead of doing a
 * hard reload with window.location.href.
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    if (this.props.navigateHome) {
      // Navigate first so children re-render at '/' rather than the broken
      // route. Resetting state before navigating would cause a re-render at
      // the crashed route, which could immediately re-trigger
      // getDerivedStateFromError and snap hasError back to true before the
      // URL update fires.
      this.props.navigateHome();
      this.setState({ hasError: false, error: null });
    } else {
      // Fallback: hard redirect when rendered outside a Router (e.g. tests)
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>{i18next.t('errorBoundary.title')}</h1>
            <p style={styles.message}>
              {i18next.t('errorBoundary.message')}
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre style={styles.errorDetail}>
                {this.state.error.message}\n{this.state.error.stack}
              </pre>
            )}
            <div style={styles.actions}>
              <button onClick={this.handleRetry} style={styles.retryBtn}>
                {i18next.t('errorBoundary.tryAgain')}
              </button>
              <button
                onClick={this.handleGoHome}
                style={styles.homeBtn}
              >
                {i18next.t('errorBoundary.goHome')}
              </button>
            </div>
            <p style={styles.contact}>
              {i18next.t('errorBoundary.needHelp')}{' '}
              <a href="mailto:support@oxsteed.com" style={styles.link}>
                support@oxsteed.com
              </a>
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * RouterAwareErrorBoundary
 *
 * Thin functional wrapper that injects useNavigate() into the class-based
 * ErrorBoundary. Use this instead of <ErrorBoundary> anywhere you need
 * React Router navigation on crash (i.e. in App.jsx).
 *
 * React class components cannot call hooks directly; this wrapper is the
 * idiomatic solution.
 *
 * Usage in App.jsx:
 *   import ErrorBoundary, { RouterAwareErrorBoundary } from './components/ErrorBoundary';
 *   <RouterAwareErrorBoundary> ← root boundary (inside <Router>)
 *     ...
 *   </RouterAwareErrorBoundary>
 *   // Per-route <Guarded> wrappers continue using <ErrorBoundary> directly.
 */
import { useNavigate } from 'react-router-dom';

export function RouterAwareErrorBoundary({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <ErrorBoundary navigateHome={() => navigate('/', { replace: true })}>
      {children}
    </ErrorBoundary>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#0b0e18',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    maxWidth: 500,
    width: '100%',
    background: '#111827',
    borderRadius: 12,
    padding: 40,
    textAlign: 'center',
    border: '1px solid #1f2937',
  },
  icon: { fontSize: 48, marginBottom: 16 },
  title: {
    color: '#f97316',
    fontSize: 24,
    fontWeight: 700,
    marginBottom: 12,
  },
  message: {
    color: '#9ca3af',
    fontSize: 14,
    lineHeight: 1.6,
    marginBottom: 24,
  },
  errorDetail: {
    background: '#1a1a2e',
    color: '#ef4444',
    padding: 16,
    borderRadius: 8,
    fontSize: 11,
    textAlign: 'left',
    overflow: 'auto',
    maxHeight: 200,
    marginBottom: 24,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
    marginBottom: 20,
  },
  retryBtn: {
    background: '#f97316',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  homeBtn: {
    background: 'transparent',
    color: '#f97316',
    border: '1px solid #f97316',
    borderRadius: 8,
    padding: '10px 24px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  contact: { color: '#6b7280', fontSize: 12 },
  link: { color: '#f97316', textDecoration: 'underline' },
};
