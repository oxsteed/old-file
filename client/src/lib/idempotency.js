function createRequestKey(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${globalThis.crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function fingerprint(scope, payload) {
  return `${scope}:${JSON.stringify(payload)}`;
}

export function createStableIdempotencyKeyStore() {
  const keys = new Map();

  return {
    get(scope, payload) {
      const id = fingerprint(scope, payload);
      if (!keys.has(id)) keys.set(id, createRequestKey(scope));
      return keys.get(id);
    },
    clear(scope, payload) {
      keys.delete(fingerprint(scope, payload));
    },
  };
}
