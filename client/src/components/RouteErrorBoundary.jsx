import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Per-route error boundary to isolate page crashes
 *
 * When a page component crashes, this boundary catches the error and displays
 * a friendly error UI with recovery options instead of crashing the entire app.
 *
 * Usage:
 *   <Route path="/dashboard" element={
 *     <RouteErrorBoundary>
 *       <Dashboard />
 *     </RouteErrorBoundary>
 *   } />
 */
class RouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error,
      errorInfo,
    });

    // Log error for debugging
    console.error('Route error boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <RouteErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={() => this.setState({ hasError: false, error: null, errorInfo: null })}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * Fallback UI when a route errors out
 */
function RouteErrorFallback({ error, errorInfo, onReset }) {
  const navigate = useNavigate();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.iconContainer}>
          <span style={styles.icon}>⚠️</span>
        </div>

        <h1 style={styles.title}>Something went wrong</h1>

        <p style={styles.message}>
          This page encountered an error. Your data is safe and the rest of the app is working normally.
        </p>

        {import.meta.env.DEV && (
          <details style={styles.details}>
            <summary style={styles.summary}>Error details (development only)</summary>
            <pre style={styles.errorText}>
              {error && error.toString()}
              {'\n\n'}
              {errorInfo && errorInfo.componentStack}
            </pre>
          </details>
        )}

        <div style={styles.actions}>
          <button onClick={onReset} style={{ ...styles.button, ...styles.primaryButton }}>
            Try Again
          </button>
          <button onClick={() => navigate('/')} style={{ ...styles.button, ...styles.secondaryButton }}>
            Go Home
          </button>
        </div>

        <p style={styles.hint}>
          If this keeps happening, please clear your browser cache and try again.
        </p>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: 'var(--app-bg)',
    padding: '20px',
  },
  card: {
    backgroundColor: 'var(--card-bg)',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    padding: '40px',
    maxWidth: '500px',
    textAlign: 'center',
  },
  iconContainer: {
    marginBottom: '20px',
  },
  icon: {
    fontSize: '48px',
  },
  title: {
    color: 'var(--app-text)',
    fontSize: '24px',
    fontWeight: 'bold',
    margin: '0 0 15px 0',
  },
  message: {
    color: 'var(--muted-text)',
    fontSize: '16px',
    lineHeight: '1.5',
    margin: '0 0 20px 0',
  },
  details: {
    margin: '20px 0',
    textAlign: 'left',
  },
  summary: {
    cursor: 'pointer',
    color: 'var(--muted-text)',
    fontSize: '14px',
    padding: '10px',
    borderRadius: '4px',
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  errorText: {
    backgroundColor: 'rgba(0,0,0,0.1)',
    padding: '10px',
    borderRadius: '4px',
    fontSize: '12px',
    overflow: 'auto',
    maxHeight: '200px',
    margin: '10px 0 0 0',
    color: '#d32f2f',
  },
  actions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    marginTop: '30px',
  },
  button: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: '600',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
  },
  primaryButton: {
    backgroundColor: '#1976d2',
    color: 'white',
  },
  secondaryButton: {
    backgroundColor: 'var(--border-color)',
    color: 'var(--app-text)',
  },
  hint: {
    color: 'var(--muted-text)',
    fontSize: '13px',
    marginTop: '20px',
    margin: '20px 0 0 0',
  },
};

export default RouteErrorBoundary;
