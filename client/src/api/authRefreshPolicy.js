// Preserve a session when the identity service is temporarily unavailable.
export function isTransientRefreshFailure(error) {
  const status = Number(error?.response?.status || 0);
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

