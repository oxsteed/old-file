// In-memory CSRF token store shared by the axios request interceptor
// (which attaches the token to state-changing requests) and the auth
// response interceptor (which captures it from server responses).
// Memory-only by design: the token is re-captured from the next
// authenticated response after reloads and session transitions, so a
// stale token can never be sent for a different user. The token itself is
// not a credential: it only proves the request came from a page that
// already holds the session, complementing the SameSite cookie.
let csrfToken = null;

export function getCsrfToken() {
  return csrfToken;
}

export function setCsrfToken(token) {
  if (typeof token === 'string' && token) csrfToken = token;
}

export function clearCsrfToken() {
  csrfToken = null;
}
