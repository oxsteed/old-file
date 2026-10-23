const PREFIX = 'oxsteed:navigation:';
let account = 'guest';
try {
  account = sessionStorage.getItem('oxsteed:navigation-account') || 'guest';
} catch {}
export function setNavigationAccount(value) {
  const next = value == null ? 'guest' : String(value);
  if (next !== account) {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
      }
    } catch {}
    account = next;
    try {
      sessionStorage.setItem('oxsteed:navigation-account', next);
    } catch {}
  }
}
export function readNavigationState(name) {
  try {
    const row = JSON.parse(
      sessionStorage.getItem(PREFIX + account + ':' + name),
    );
    return row?.expires > Date.now() ? row.value : null;
  } catch {
    return null;
  }
}
export function saveNavigationState(name, value) {
  try {
    const serialized = JSON.stringify({
      expires: Date.now() + 2 * 60 * 60 * 1000,
      value,
    });
    if (serialized.length > 32000) return;
    sessionStorage.setItem(PREFIX + account + ':' + name, serialized);
    const keys = Object.keys(sessionStorage).filter((key) =>
      key.startsWith(PREFIX),
    );
    for (const key of keys.slice(0, Math.max(0, keys.length - 60)))
      sessionStorage.removeItem(key);
  } catch {}
}
