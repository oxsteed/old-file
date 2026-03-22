import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ErrorBoundary — Catches unhandled React rendering errors
 * and displays a user-friendly fallback UI instead of a blank page.
 * Includes a retry button and contact information.
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
    // TODO: Send to error reporting service (e.g., Sentry)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>Something went wrong</h1>
            <p style={styles.message}>
              An unexpected error occurred. Please try again or contact support
              if the problem persists.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre style={styles.errorDetail}>
                {this.state.error.message}\n{this.state.error.stack}
              </pre>
            )}
            <div style={styles.actions}>
              <button onClick={this.handleRetry} style={styles.retryBtn}>
                Try Again
              </button>
              <button
                onClick={() => window.location.href = '/'}
                style={styles.homeBtn}
              >
                Go to Homepage
              </button>
            </div>
            <p style={styles.contact}>
              Need help?{' '}
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
