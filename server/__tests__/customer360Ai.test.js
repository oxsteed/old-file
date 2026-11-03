'use strict';

// Customer 360 upgrade 3: self-hosted Ollama only, pinned digest, schema
// validated output, aggregate-only evidence, no tools.
const ai = require('../services/customer360Ai');

const DIGEST = 'a'.repeat(64);
const env = { CUSTOMER360_OLLAMA_URL: 'http://127.0.0.1:11434', CUSTOMER360_OLLAMA_MODEL: 'c360:pinned', CUSTOMER360_OLLAMA_DIGEST: `sha256:${DIGEST}` };
const evidence = ai.minimiseEvidence({
  jobs: { key: 'jobs', state: 'ready', total: 3, groups: [{ status: 'pending', count: 3, recorded_amount_cents: '999' }], records: [{ email: 'x@example.invalid' }] },
  payments: { key: 'payments', state: 'restricted' },
});

function fakeFetch(output, { digest = DIGEST } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [{ name: 'c360:pinned', digest }] }) };
    return { ok: true, text: async () => JSON.stringify({ response: JSON.stringify(output) }) };
  };
  impl.calls = calls;
  return impl;
}

test('evidence keeps only keys, states, totals and status counts', () => {
  expect(evidence).toEqual([
    { source: 'jobs', state: 'ready', total: 3, groups: [{ status: 'pending', count: 3 }] },
    { source: 'payments', state: 'restricted', total: null, groups: undefined },
  ]);
});

test('unconfigured, non-local or unpinned Ollama returns no draft and never calls out', async () => {
  const f = fakeFetch({ summary: 'x', citations: [] });
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: f, env: {} })).toBeNull();
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: f, env: { ...env, CUSTOMER360_OLLAMA_URL: 'https://api.example.com' } })).toBeNull();
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: f, env: { ...env, CUSTOMER360_OLLAMA_DIGEST: 'latest' } })).toBeNull();
  expect(f.calls).toHaveLength(0);
  const wrongDigest = fakeFetch({ summary: 'x', citations: [] }, { digest: 'b'.repeat(64) });
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: wrongDigest, env })).toBeNull();
  expect(wrongDigest.calls.map((c) => c.url)).toEqual(['http://127.0.0.1:11434/api/tags']);
});

test('summary, next-step and reply drafts are schema-validated without tools', async () => {
  const summary = fakeFetch({ summary: 'Three jobs are pending.', citations: ['jobs'] });
  const s = await ai.generate({ mode: 'summary', language: 'fr', evidence, fetchImpl: summary, env });
  expect(s).toMatchObject({ output: { citations: ['jobs'] }, model: 'c360:pinned', digest: DIGEST, promptVersion: 'c360-ai-v1' });
  const body = JSON.parse(summary.calls[1].init.body);
  expect(body).not.toHaveProperty('tools');
  expect(body.options.temperature).toBe(0);
  expect(body.prompt).toContain('French');
  expect(body.prompt).not.toMatch(/example\.invalid|999/);
  expect(body.format.properties.citations.items.enum).toEqual(['jobs']);

  const restrictedCitation = fakeFetch({ summary: 'x', citations: ['payments'] });
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: restrictedCitation, env })).toBeNull();

  const steps = fakeFetch({ steps: [{ text: 'Check the pending jobs.', citation: 'jobs', guide: 'none' }] });
  expect((await ai.generate({ mode: 'next_step', evidence, fetchImpl: steps, env })).output.steps).toHaveLength(1);
  const badGuide = fakeFetch({ steps: [{ text: 'Refund now', citation: 'jobs', guide: 'issue_refund' }] });
  expect(await ai.generate({ mode: 'next_step', evidence, fetchImpl: badGuide, env })).toBeNull();

  const reply = fakeFetch({ subject: 'Your request', body: 'Thank you for contacting us.' });
  const r = await ai.generate({ mode: 'reply_draft', language: 'ht', topic: 'order', evidence, fetchImpl: reply, env });
  expect(r.output.subject).toBe('Your request');
  const replyPrompt = JSON.parse(JSON.parse(reply.calls[1].init.body).prompt);
  expect(replyPrompt).toEqual({ language: 'Haitian Creole', topic: 'order' });

  await expect(ai.generate({ mode: 'run_tool', evidence, env })).rejects.toMatchObject({ code: 'invalid_request' });
});

test('provider failures degrade to no draft', async () => {
  const broken = async (url) => (url.endsWith('/api/tags')
    ? { ok: true, json: async () => ({ models: [{ name: 'c360:pinned', digest: DIGEST }] }) }
    : { ok: true, text: async () => '{"response":"not json"}' });
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: broken, env })).toBeNull();
  const down = async () => { throw new Error('ECONNREFUSED'); };
  expect(await ai.generate({ mode: 'summary', evidence, fetchImpl: down, env })).toBeNull();
});
