const DEFAULT_AUTH_RETURN_PATH = '/dashboard';

function isSafeLocalPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

export function resolveAuthReturnPath(from, fallback = DEFAULT_AUTH_RETURN_PATH) {
  if (isSafeLocalPath(from)) return from;

  if (from && typeof from === 'object' && isSafeLocalPath(from.pathname)) {
    const search = typeof from.search === 'string' ? from.search : '';
    const hash = typeof from.hash === 'string' ? from.hash : '';
    return `${from.pathname}${search}${hash}`;
  }

  return isSafeLocalPath(fallback) ? fallback : DEFAULT_AUTH_RETURN_PATH;
}

export { DEFAULT_AUTH_RETURN_PATH };
