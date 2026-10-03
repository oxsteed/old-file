'use strict';

/**
 * providerHealthController — V2-P1-07 operator view.
 *
 * One aggregate endpoint over the uniform provider-health contract
 * (services/providerHealthRegistry.js): per-provider capability status,
 * owner, alert channel, retry policy, circuit breaker state, budget,
 * rotation policy, and the customer-safe unavailable state.
 *
 * All routes require admin + the manage_operations grant (see routes).
 */

const {
  getAllProviderHealth,
  getProviderHealth,
  probeProvider,
  resetProviderCircuit,
  getCircuitBreaker,
} = require('../services/providerHealthRegistry');
const { logAdminAction } = require('../services/auditService');
const logger = require('../utils/logger');

function adminIdOf(req) {
  return req.admin?.id ?? req.user?.id ?? null;
}

async function listProviders(req, res, next) {
  try {
    const force = String(req.query?.refresh || '').toLowerCase() === 'true';
    const health = await getAllProviderHealth({ force });
    res.json(health);
  } catch (err) {
    next(err);
  }
}

async function getProvider(req, res, next) {
  try {
    const health = await getProviderHealth(req.params.id);
    res.json(health);
  } catch (err) {
    if (/Unknown provider/.test(err.message)) {
      return res.status(404).json({ error: 'Unknown provider', code: 'unknown_provider' });
    }
    next(err);
  }
}

async function runProbe(req, res, next) {
  try {
    const probe = await probeProvider(req.params.id, { force: true });
    const circuit = await getCircuitBreaker(req.params.id).getState();
    res.json({ ...probe, circuit: { state: circuit.state, failures: circuit.failures } });
  } catch (err) {
    if (/Unknown provider/.test(err.message)) {
      return res.status(404).json({ error: 'Unknown provider', code: 'unknown_provider' });
    }
    next(err);
  }
}

async function resetCircuit(req, res, next) {
  try {
    const breaker = getCircuitBreaker(req.params.id);
    const before = await breaker.getState();
    await resetProviderCircuit(req.params.id);
    const after = await breaker.getState();
    await logAdminAction({
      adminId: adminIdOf(req),
      action: 'provider_circuit_reset',
      targetType: 'provider',
      targetId: null,
      targetKey: req.params.id,
      description: `Manually reset circuit breaker for provider "${req.params.id}"`,
      before: { state: before.state, failures: before.failures },
      after: { state: after.state, failures: after.failures },
      req,
    });
    res.json({ providerId: req.params.id, circuit: { state: after.state, failures: after.failures } });
  } catch (err) {
    if (/Unknown provider/.test(err.message)) {
      return res.status(404).json({ error: 'Unknown provider', code: 'unknown_provider' });
    }
    next(err);
  }
}

module.exports = { listProviders, getProvider, runProbe, resetCircuit };
