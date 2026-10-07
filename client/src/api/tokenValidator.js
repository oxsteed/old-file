/**
 * Token validation helper for API calls
 * Ensures token exists before making authenticated requests
 */

export class NoTokenError extends Error {
  constructor() {
    super('No authentication token found. Please log in and try again.');
    this.code = 'NO_TOKEN';
    this.response = { data: { error: this.message } };
    this.status = 401;
  }
}

export class SessionExpiredError extends Error {
  constructor(originalError) {
    super('Your session has expired. Please log in again.');
    this.code = 'AUTH_EXPIRED';
    this.response = originalError?.response;
    this.status = 401;
  }
}

/**
 * Validate that authentication token exists
 * @throws {NoTokenError} if token is missing
 */
export function validateToken() {
  // With httpOnly cookies, JS cannot read the access token. We check for
  // a stored user instead, which indicates an active session. The actual
  // token validation happens server-side via the cookie.
  const user = localStorage.getItem('user');
  const impersonationToken = typeof sessionStorage !== 'undefined'
    ? sessionStorage.getItem('oxs:impersonation_token')
    : null;
  if (!user && !impersonationToken) {
    throw new NoTokenError();
  }
  return impersonationToken || 'cookie';
}

/**
 * Handle 401 response by clearing tokens and throwing SessionExpiredError
 * @param {Error} error - The axios error
 * @throws {SessionExpiredError} if status is 401
 * @throws {Error} otherwise
 */
export function handleAuthError(error) {
  if (error.response?.status === 401) {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    throw new SessionExpiredError(error);
  }
  throw error;
}

/**
 * Wrap an API call with token validation
 * @param {Function} apiCall - Async function that makes the API call
 * @returns {Promise} Result of the API call
 */
export async function withTokenValidation(apiCall) {
  validateToken(); // Throws if no token
  try {
    return await apiCall();
  } catch (err) {
    return handleAuthError(err); // Throws if 401
  }
}
