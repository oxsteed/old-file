'use strict';

/**
 * adapterRegistry.js
 *
 * Maps provider keys (matching the `provider` CHECK constraint on
 * `delivery_telematics_connections`) to their telematics adapter modules.
 * Every registered adapter is validated against the adapter contract at load.
 */

const { validateAdapter } = require('./adapterContract');
const geotabAdapter = require('./geotabAdapter');
const samsaraAdapter = require('./samsaraAdapter');
const motiveAdapter = require('./motiveAdapter');
const verizonConnectAdapter = require('./verizonConnectAdapter');

const ADAPTERS = {
  geotab: geotabAdapter,
  samsara: samsaraAdapter,
  motive: motiveAdapter,
  verizon_connect: verizonConnectAdapter,
};

const SUPPORTED_PROVIDERS = Object.freeze(Object.keys(ADAPTERS));

for (const [provider, adapter] of Object.entries(ADAPTERS)) {
  validateAdapter(adapter);
  if (adapter.providerName !== provider) {
    throw new Error(
      `Telematics adapter registry mismatch: key '${provider}' exposes providerName '${adapter.providerName}'.`
    );
  }
}

/**
 * Returns the adapter for a supported provider key.
 * Throws an Error for unknown providers (fail fast: never silently accept an
 * unconfigured provider name into webhook or polling paths).
 */
function getAdapter(provider) {
  const adapter = ADAPTERS[provider];
  if (!adapter) {
    throw new Error(
      `Unknown telematics provider '${provider}'. Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}.`
    );
  }
  return adapter;
}

module.exports = {
  getAdapter,
  SUPPORTED_PROVIDERS,
  ADAPTERS,
};
