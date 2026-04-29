import { Component } from 'react';
import { useNavigate } from 'react-router-dom';
import logger from '../utils/logger';

class OrderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorCount: 0
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState(prevState => ({
      error,
      errorInfo,
      errorCount: prevState.errorCount + 1
    }));

    // Log error to monitoring service
    logger.error('Order page error boundary caught error', {
      error: error.toString(),
      component: this.props.componentName,
      message: error.message,
      stack: error.stack
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null
    });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
            <div className="mb-6">
              <h1 className="text-2xl font-bold text-red-600 mb-2">Something went wrong</h1>
              <p className="text-gray-600">
                An unexpected error occurred while loading the {this.props.componentName || 'page'}.
                Please try again.
              </p>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-6 bg-gray-100 p-4 rounded text-xs font-mono text-red-700 overflow-auto max-h-40">
                <summary className="cursor-pointer font-semibold mb-2">Error Details</summary>
                <p>{this.state.error.toString()}</p>
                {this.state.errorInfo && (
                  <pre className="mt-2 whitespace-pre-wrap break-words">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}

            <div className="flex gap-3">
              <button
                onClick={this.handleReset}
                className="flex-1 bg-primary text-white py-2 rounded-lg hover:bg-primary-dark font-medium"
              >
                Try Again
              </button>
              <a
                href="/orders"
                className="flex-1 bg-gray-200 text-gray-800 py-2 rounded-lg hover:bg-gray-300 font-medium text-center"
              >
                Back to Orders
              </a>
            </div>

            {this.state.errorCount > 3 && (
              <p className="mt-4 text-sm text-gray-500 text-center">
                Multiple errors detected. Please contact support if this persists.
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default OrderErrorBoundary;
