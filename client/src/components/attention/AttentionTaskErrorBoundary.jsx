import { Component } from 'react';

// Error boundary for the embedded task workflow. React error boundaries must
// be class components. The parent remounts this boundary (via `key`) on retry
// or task change so a previous failure never sticks. The fallback UI is
// supplied by the parent so the retry control lives next to the task context.
export default class AttentionTaskErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Diagnostics only; the user sees the retry affordance from `fallback`.
    if (typeof console !== 'undefined' && typeof console.error === 'function') {
      console.error('[attention] task workflow failed', error, info?.componentStack);
    }
  }

  render() {
    const { error } = this.state;
    const { fallback, children } = this.props;
    if (error) return fallback ?? null;
    return children;
  }
}
