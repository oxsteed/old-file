'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { assertIsolated, invoke, rejectsCode } = require('../server/scripts/verify-media-credit-isolated');

const isolated = {
  NODE_ENV: 'test', MEDIA_TEST_MODE: 'true', CREDIT_TEST_PROJECT: 'oxsteed-credit-test-20261009t120000z-1234',
  DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=disable',
};

test('financial verifier only accepts the explicitly disposable compose database', () => {
  assert.doesNotThrow(() => assertIsolated(isolated));
  for (const override of [
    { NODE_ENV: 'production' }, { MEDIA_TEST_MODE: 'false' }, { CREDIT_TEST_PROJECT: 'oxsteed-production' },
    { CREDIT_TEST_PROJECT: '' }, { DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@localhost:5432/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/production?sslmode=disable' },
    { DATABASE_URL: 'postgresql://root:synthetic@postgres:5432/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5433/oxsteed_db?sslmode=disable' },
    { DATABASE_URL: 'postgresql://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=require' },
    { DATABASE_URL: 'https://oxsteed:synthetic@postgres:5432/oxsteed_db?sslmode=disable' },
  ]) assert.throws(() => assertIsolated({ ...isolated, ...override }), /disposable Media compose/);
});

test('controller adapter carries user, input and durable key without swallowing errors', async () => {
  const result = await invoke(async (req, res) => {
    assert.equal(req.user.id, 'synthetic-user');
    assert.equal(req.body.amountCents, 125);
    assert.equal(req.params.tipId, 'synthetic-tip');
    assert.equal(req.get('Idempotency-Key'), 'durable-key');
    res.status(202).json({ tip: { id: req.params.tipId } });
  }, 'synthetic-user', { amountCents: 125 }, { tipId: 'synthetic-tip' }, 'durable-key');
  assert.deepEqual(result, { status: 202, tip: { id: 'synthetic-tip' } });
  const failure = Object.assign(new Error('Funds unavailable'), { code: 'credit_insufficient_funds' });
  await rejectsCode(() => invoke(async (req, res, next) => next(failure), 'synthetic-user'), 'credit_insufficient_funds');
  await assert.rejects(() => invoke(async () => {}, 'synthetic-user'), /controller must return a response/);
});
