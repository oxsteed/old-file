'use strict';
// Reservation estimates are conservative policy ceilings, not advertised prices.
// Actual provider usage.cost settles them. Unknown/failed responses retain the
// reservation because a timeout does not prove the provider did not charge.
const crypto = require('crypto');
const redis = require('../utils/redis');
const logger = require('../utils/logger');
const localSpend = new Map();
const localAlerts = new Set();
const TTL = 48 * 3600;
const RESERVE = `local stored=redis.call('GET',KEYS[1])
local n=tonumber(stored or '0')
if not stored then n=math.ceil(tonumber(redis.call('GET',KEYS[3]) or '0')*1000000); redis.call('SET',KEYS[1],n,'EX',ARGV[3]) end
if n+tonumber(ARGV[1])>tonumber(ARGV[2]) then return 0 end
redis.call('INCRBY',KEYS[1],ARGV[1]); redis.call('EXPIRE',KEYS[1],ARGV[3])
redis.call('SET',KEYS[2],ARGV[1],'EX',ARGV[3]); return 1`;
const SETTLE = `local n=redis.call('GET',KEYS[2]); if not n then return 0 end
redis.call('DEL',KEYS[2]); redis.call('INCRBY',KEYS[1],tonumber(ARGV[1])-tonumber(n))
redis.call('EXPIRE',KEYS[1],ARGV[2]); return 1`;
function spendCapUsd(env = process.env) {
  const n = Number(env?.OPENROUTER_DAILY_SPEND_CAP_USD ?? 5);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}
function isPaidModel(model) {
  return !(typeof model === 'string' && (model === 'openrouter/free' || model.endsWith(':free')));
}
function estimateMicros(body, env = process.env) {
  const model = body.model || '';
  const band = /mini|flash|haiku/i.test(model) ? 'economy' : /gpt|claude|gemini/i.test(model) ? 'standard' : 'unknown';
  const defaults = { economy: [5, 20], standard: [20, 100], unknown: [100, 200] };
  let rates = defaults[band];
  try {
    const configured = JSON.parse(env.OPENROUTER_MODEL_BUDGET_RATES || '{}')[model];
    if (Array.isArray(configured) && configured.length === 2 && configured.every(n => Number.isFinite(n) && n > 0)) rates = configured;
  } catch { /* invalid configuration uses conservative defaults */ }
  const prompt = Buffer.byteLength(JSON.stringify(body.messages || []), 'utf8') + 32;
  const images = (JSON.stringify(body.messages || []).match(/"image_url"/g) || []).length;
  const output = Math.max(1, Number(body.max_tokens) || 4096);
  return Math.ceil((prompt + images * 65536) * rates[0] + output * rates[1]);
}
async function reserve(body, env = process.env) {
  if (!isPaidModel(body.model)) return { free: true };
  const key = 'openrouter:spend:v2:' + new Date().toISOString().slice(0, 10);
  const amount = estimateMicros(body, env);
  const cap = Math.floor(spendCapUsd(env) * 1e6);
  const reservation = { key, amount, id: key + ':' + crypto.randomUUID() };
  try {
    if (redis) {
      if (Number(await redis.eval(RESERVE, 3, key, reservation.id, key.replace(':v2:',':v1:'), amount, cap, TTL)) === 1) return reservation;
    } else if (env.NODE_ENV !== 'production' && !env.REDIS_URL) {
      for (const k of localSpend.keys()) if (k !== key) localSpend.delete(k);
      const current = localSpend.get(key) || 0;
      if (current + amount <= cap) { localSpend.set(key, current + amount); return reservation; }
    }
  } catch { logger.warn('openrouter_budget_store_unavailable'); }
  const day = new Date().toISOString().slice(0,10);
  try {
    let alert = false;
    if (redis) alert = (await redis.set('openrouter:budget-alert:'+day,'1','EX',TTL,'NX')) === 'OK';
    else { for (const old of localAlerts) if (old!==day) localAlerts.delete(old); alert=!localAlerts.has(day); localAlerts.add(day); }
    if (alert) logger.error('openrouter_budget_unavailable_or_exceeded', { model: body.model, capUsd: cap/1e6 });
  } catch { logger.warn('openrouter_budget_alert_unavailable'); }
  return null;
}
async function settle(reservation, usage) {
  if (!reservation || reservation.free || reservation.settled) return;
  const cost = usage?.cost;
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) return;
  const actual = Math.ceil(cost * 1e6);
  try {
    if (redis) await redis.eval(SETTLE, 2, reservation.key, reservation.id, actual, TTL);
    else localSpend.set(reservation.key, Math.max(0, (localSpend.get(reservation.key) || 0) + actual - reservation.amount));
    reservation.settled = true;
  } catch { logger.warn('openrouter_budget_settlement_deferred'); }
}
// Every paid OpenRouter HTTP caller uses this boundary. Consume JSON once and
// expose the usual response methods; stream responses are deliberately rejected.
async function guardedFetch(url, options) {
  const body = JSON.parse(options.body);
  if (!isPaidModel(body.model)) return fetch(url, options);
  if (body.stream) throw new Error('budgeted_streaming_not_supported');
  body.max_tokens = Math.max(1, Math.min(16384, Math.floor(Number(body.max_tokens) || 4096)));
  const reservation = await reserve(body);
  if (!reservation) throw new Error('openrouter_spend_cap_exceeded');
  const response = await fetch(url, { ...options, body: JSON.stringify(body) });
  if (response.ok) {
    // Existing callers use either text() or json(). Settlement must cover both.
    const raw = typeof response.text === 'function' ? await response.text() : JSON.stringify(await response.json());
    try { await settle(reservation, JSON.parse(raw).usage); } catch { /* retain reservation */ }
    return { ok: response.ok, status: response.status, headers: response.headers,
      text: async () => raw, json: async () => JSON.parse(raw) };
  }
  return response;
}
function _resetLocal() { localSpend.clear(); localAlerts.clear(); }
module.exports = { spendCapUsd, isPaidModel, reserve, settle, estimateMicros, guardedFetch, _resetLocal };
