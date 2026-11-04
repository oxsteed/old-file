// An in-memory boundary for requests that began before login, logout, or a
// verified account change. It contains no credentials or stored identity.
let epoch = 0;
export const currentAuthEpoch = () => epoch;
export const advanceAuthEpoch = () => ++epoch;
export const isCurrentAuthEpoch = value => value === epoch;
export const startsAuthSessionTransition = (url, method) => {
  const path = String(url || '').split(/[?#]/)[0];
  if (/\/auth\/(?:login(?:\/(?:2fa|passkey))?|verify-otp|register(?:\/verify-otp)?|logout|switch-role|internal-access\/(?:login|recovery\/use))$/.test(path)
    || /\/(?:helper-registration\/verify-otp|passkeys\/authentication\/verify)$/.test(path)) return true;
  // Profile writes can also switch modes and rotate both session cookies.
  return ['put', 'patch'].includes(String(method || '').toLowerCase())
    && /\/auth\/(?:profile|me)$/.test(path);
};
export const isCredentialRequest = url => startsAuthSessionTransition(url)
  || /\/passkeys\/authentication\/options(?:[?#]|$)/.test(url || '');
export function assertCurrentAuthEpoch(value) {
  if (!isCurrentAuthEpoch(value)) {
    const error = new Error('The authentication session changed while this request was pending.');
    error.code = 'AUTH_SESSION_CHANGED';
    throw error;
  }
}
