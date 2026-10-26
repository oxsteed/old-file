"use strict";
// D-ENG-06: age verification provider registry.
//
// A provider is an object with:
//   name                       stable id stored with every decision
//   available()                true when its credentials/config are present
//   startVerification(user)    -> { redirect_url } or { pending: true }
//   parseCallback(req)         -> { userId, outcome: 'adult'|'not_adult'|'unknown', reference }
//                                 MUST verify the provider's signature itself and
//                                 throw on an unauthenticated callback.
//   lookupBatch(userIds)       optional bulk lookup used by the backfill:
//                                 -> [{ userId, outcome, reference }]
//
// No vendor is chosen in code. GROWTH_AGE_VERIFICATION_PROVIDER defaults to
// "none", which verifies nobody, so the eligible audience stays empty until
// a reviewed provider is registered here and selected in config.
const none = Object.freeze({
  name: "none",
  available: () => false,
  async startVerification() {
    const err = new Error("age_verification_unavailable");
    err.statusCode = 404;
    err.code = "age_verification_unavailable";
    throw err;
  },
  parseCallback() {
    const err = new Error("age_verification_unavailable");
    err.statusCode = 404;
    err.code = "age_verification_unavailable";
    throw err;
  },
});

const registry = new Map([["none", none]]);

function register(provider) {
  for (const fn of ["available", "startVerification", "parseCallback"])
    if (typeof provider?.[fn] !== "function")
      throw new Error(`age provider ${provider?.name || "?"} is missing ${fn}()`);
  if (!/^[a-z0-9_-]{2,40}$/.test(String(provider.name || "")))
    throw new Error("age provider name must be a short lowercase id");
  if (provider.name === "none") throw new Error("'none' is reserved");
  registry.set(provider.name, provider);
  return provider;
}

function configuredName(env = process.env) {
  const raw = String(env.GROWTH_AGE_VERIFICATION_PROVIDER || "none").trim().toLowerCase();
  return raw || "none";
}

// Unknown names resolve to "none" (fail closed), never to another provider.
function active(env = process.env) {
  return registry.get(configuredName(env)) || none;
}

function _reset() {
  for (const name of [...registry.keys()]) if (name !== "none") registry.delete(name);
}

module.exports = { register, active, configuredName, none, _reset };
