import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Compact error boundary for isolating a single tab/panel crash so the rest
 * of the page (e.g. Business Hub chrome + other tabs) stays usable.
 *
 * Reset by changing `resetKey` (typically the active tab id) or via Try again.
 */
class TabErrorBoundaryInner extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[TabErrorBoundary]', this.props.label || 'tab', error, errorInfo);
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <TabErrorFallback
          label={this.props.label}
          error={this.state.error}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}

function TabErrorFallback({ label, error, onRetry }) {
  const { t } = useTranslation();
  const showDetails = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV;
  return (
    <div
      role="alert"
      style={{
        marginTop: '1rem',
        padding: '1.25rem 1.5rem',
        borderRadius: 12,
        border: '1px solid rgba(248,113,113,0.35)',
        background: 'rgba(127,29,29,0.15)',
      }}
    >
      <p style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
        {t('errorBoundary.title', { defaultValue: 'Something went wrong' })}
        {label ? ` — ${label}` : ''}
      </p>
      <p style={{ color: 'var(--color-text-muted, #9ca3af)', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
        {t('errorBoundary.message', {
          defaultValue: 'This section hit an error. You can try again or switch to another tab.',
        })}
      </p>
      {showDetails && error && (
        <pre
          style={{
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 120,
            marginBottom: '0.75rem',
            color: '#fca5a5',
          }}
        >
          {error.message || String(error)}
        </pre>
      )}
      <button type="button" className="bh-btn primary" onClick={onRetry}>
        {t('errorBoundary.tryAgain', { defaultValue: 'Try again' })}
      </button>
    </div>
  );
}

export default function TabErrorBoundary({ children, label, resetKey }) {
  return (
    <TabErrorBoundaryInner label={label} resetKey={resetKey}>
      {children}
    </TabErrorBoundaryInner>
  );
}
