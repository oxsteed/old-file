// An in-memory boundary for requests that began before login, logout, or a
// verified account change. It contains no credentials or stored identity.
let epoch = 0;
export const currentAuthEpoch = () => epoch;
export const advanceAuthEpoch = () => ++epoch;
export const isCurrentAuthEpoch = value => value === epoch;
export const startsAuthSessionTransition = url => /\/(?:auth\/(?:login(?:\/2fa)?|verify-otp|register|logout|switch-role)|passkeys\/authentication\/verify)(?:[?#]|$)/.test(url || '');
export const isCredentialRequest = url => startsAuthSessionTransition(url)
  || /\/passkeys\/authentication\/options(?:[?#]|$)/.test(url || '');
export function assertCurrentAuthEpoch(value) {
  if (!isCurrentAuthEpoch(value)) {
    const error = new Error('The authentication session changed while this request was pending.');
    error.code = 'AUTH_SESSION_CHANGED';
    throw error;
  }
}
