/**
 * client/src/utils/errorClassifier.js
 *
 * Classifies errors into actionable categories.
 * Converts raw API errors into structured, predictable error objects.
 *
 * Usage:
 *   try {
 *     await api.post('/jobs', data);
 *   } catch (err) {
 *     const classified = classifyError(err);
 *     if (classified.type === 'validation') {
 *       setErrors(classified.fields);  // Show field errors
 *     } else if (classified.type === 'auth') {
 *       navigate('/login');  // Redirect to login
 *     }
 *   }
 */

/**
 * @typedef {Object} ClassifiedError
 * @property {'auth' | 'validation' | 'not_found' | 'conflict' | 'network' | 'server' | 'unknown'} type
 * @property {number} statusCode - HTTP status code
 * @property {string} message - User-facing message
 * @property {string} [code] - Machine-readable code
 * @property {Record<string, string>} [fields] - Validation field errors
 * @property {boolean} retryable - Whether the operation can be retried
 * @property {string} [shouldRedirect] - Path to redirect to (if needed)
 */

/**
 * Classify an error and return structured error object
 * @param {Error | AxiosError} err - The error to classify
 * @returns {ClassifiedError} Classified error object
 */
export function classifyError(err) {
  // Default error
  const defaultError = {
    type: 'unknown',
    statusCode: 500,
    message: 'An unexpected error occurred. Please try again.',
    retryable: false,
  };

  // Handle null/undefined
  if (!err) {
    return defaultError;
  }

  // Extract Axios error details
  const status = err?.response?.status;
  const data = err?.response?.data || {};
  const message = err?.message || 'Unknown error';

  // Network errors (no response)
  if (!err.response && err.message?.includes('Network')) {
    return {
      type: 'network',
      statusCode: 0,
      message: 'Network error. Please check your connection.',
      code: 'network_error',
      retryable: true,
    };
  }

  // Timeout
  if (err.code === 'ECONNABORTED' || message.includes('timeout')) {
    return {
      type: 'network',
      statusCode: 0,
      message: 'Request timeout. Please try again.',
      code: 'timeout',
      retryable: true,
    };
  }

  // No response (likely offline)
  if (!err.response) {
    return {
      type: 'network',
      statusCode: 0,
      message: 'Unable to reach the server. Please check your connection.',
      code: 'no_response',
      retryable: true,
    };
  }

  // 401 Unauthorized - Auth related
  if (status === 401) {
    // Check for specific auth error codes
    const code = data.code || 'auth_failed';
    let authMessage = data.error || 'Your session has expired. Please log in again.';

    return {
      type: 'auth',
      statusCode: 401,
      message: authMessage,
      code,
      retryable: false,
      shouldRedirect: '/login',
    };
  }

  // 403 Forbidden - Permission error (auth related)
  if (status === 403) {
    return {
      type: 'auth',
      statusCode: 403,
      message: data.error || 'You do not have permission to perform this action.',
      code: data.code || 'forbidden',
      retryable: false,
    };
  }

  // 400 Bad Request - Validation error
  if (status === 400) {
    const code = data.code || 'bad_request';

    // If fields present, it's a validation error
    if (data.fields && Object.keys(data.fields).length > 0) {
      return {
        type: 'validation',
        statusCode: 400,
        message: data.error || 'Please check the form and try again.',
        code: 'validation_failed',
        fields: data.fields,
        retryable: false,
      };
    }

    // Generic bad request
    return {
      type: 'validation',
      statusCode: 400,
      message: data.error || 'Invalid request. Please check your input.',
      code,
      retryable: false,
    };
  }

  // 404 Not Found
  if (status === 404) {
    return {
      type: 'not_found',
      statusCode: 404,
      message: data.error || 'The resource you are looking for does not exist.',
      code: data.code || 'not_found',
      retryable: false,
    };
  }

  // 409 Conflict
  if (status === 409) {
    return {
      type: 'conflict',
      statusCode: 409,
      message: data.error || 'This resource already exists or conflicts with another.',
      code: data.code || 'conflict',
      retryable: false,
      fields: data.fields,
    };
  }

  // 429 Too Many Requests - Rate limit
  if (status === 429) {
    return {
      type: 'network',
      statusCode: 429,
      message: 'Too many requests. Please wait a moment and try again.',
      code: 'rate_limited',
      retryable: true,
    };
  }

  // 5xx Server errors
  if (status >= 500) {
    return {
      type: 'server',
      statusCode: status,
      message: data.error || 'Server error. Our team has been notified. Please try again later.',
      code: data.code || 'server_error',
      retryable: true,
    };
  }

  // Fallback for any other status codes
  return {
    type: 'unknown',
    statusCode: status || 500,
    message: data.error || message || 'An error occurred. Please try again.',
    code: data.code,
    retryable: status >= 500,
  };
}

/**
 * Get a user-friendly error message from a classified error
 * @param {ClassifiedError} classified - The classified error
 * @returns {string} User-friendly message
 */
export function getErrorMessage(classified) {
  if (!classified) {
    return 'An unexpected error occurred.';
  }

  return classified.message || 'An unexpected error occurred.';
}

/**
 * Check if error is retryable
 * @param {ClassifiedError} classified - The classified error
 * @returns {boolean} Whether the operation can be retried
 */
export function isErrorRetryable(classified) {
  return classified?.retryable === true;
}

/**
 * Check if error requires authentication
 * @param {ClassifiedError} classified - The classified error
 * @returns {boolean} Whether user needs to authenticate
 */
export function isAuthError(classified) {
  return classified?.type === 'auth' || classified?.statusCode === 401;
}

/**
 * Check if error is validation error
 * @param {ClassifiedError} classified - The classified error
 * @returns {boolean} Whether error is validation-related
 */
export function isValidationError(classified) {
  return classified?.type === 'validation' && !!classified?.fields;
}

/**
 * Check if error is network error
 * @param {ClassifiedError} classified - The classified error
 * @returns {boolean} Whether error is network-related
 */
export function isNetworkError(classified) {
  return classified?.type === 'network';
}

/**
 * Log error with context (for debugging)
 * @param {string} context - Where the error occurred
 * @param {Error} err - The original error
 * @param {ClassifiedError} classified - The classified error
 */
export function logErrorContext(context, err, classified) {
  console.error(`[${context}] Error classified as "${classified.type}":`, {
    statusCode: classified.statusCode,
    code: classified.code,
    message: classified.message,
    fields: classified.fields,
    originalError: err?.message,
  });
}
