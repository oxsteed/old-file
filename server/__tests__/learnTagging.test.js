'use strict';

/**
 * learnTagging.test.js — OpenRouter AI tagging pipeline (service layer).
 * fetch is stubbed; the pg pool is the shared jest mock.
 */

const { mockQuery, resetMocks } = require('./setup');
const {
  tagGuideWithAI,
  extractJson,
  matchLearnCategory,
} = require('../services/learnTagging');

const realFetch = global.fetch;

beforeEach(() => {
  resetMocks();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
});

const aiPayload = {
  tools: [{ name: 'Adjustable wrench', purpose: 'Tighten fittings', rent_search: 'adjustable wrench rental', buy_search: 'adjustable wrench' }],
  materials: [{ name: 'PTFE tape', purpose: 'Seal threads', buy_search: 'ptfe thread seal tape' }],
  service: { category: 'Plumbing', description: 'Fix leaks' },
};

const okFetch = (payload) =>
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  });

/** Route DB queries by SQL text for the happy-path test. */
function mockTaggingDb() {
  mockQuery.mockImplementation(async (text) => {
    if (text.includes('FROM learn_guides')) {
      return { rows: [{ id: 'g1', title: 'Fix a Leaky Faucet', category: 'plumbing', intro: 'Drips.' }] };
    }
    if (text.includes('direct_catalog_tools')) {
      return { rows: [{ slug: 'adjustable-wrench', en_name: 'Adjustable wrench' }] };
    }
    if (text.includes('learn_product_links')) {
      return { rows: [{ buy_url: 'https://example.com/tape', rent_url: null }] };
    }
    if (text.includes('learn_guide_ai_suggestions')) {
      return { rowCount: 1 };
    }
    return { rows: [] };
  });
}

describe('tagGuideWithAI', () => {
  test('skips silently when no API key is configured', async () => {
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ skipped: 'no-key' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('skips when the guide does not exist', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const res = await tagGuideWithAI('nope');
    expect(res).toEqual({ skipped: 'guide-not-found' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('handles malformed model JSON without throwing', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', title: 'T', category: 'plumbing', intro: '' }] });
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }),
    });
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ skipped: 'bad-json' });
  });

  test('handles HTTP 429 as rate-limited', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', title: 'T', category: 'plumbing', intro: '' }] });
    global.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ skipped: 'rate-limited' });
  });

  test('handles request timeout without throwing', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', title: 'T', category: 'plumbing', intro: '' }] });
    global.fetch.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ skipped: 'timeout' });
  });

  test('happy path writes tool, material, and service suggestions with matches', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    okFetch(aiPayload);
    mockTaggingDb();

    const res = await tagGuideWithAI('g1');
    expect(res.ok).toBe(true);
    expect(res.created).toBe(3);

    const inserts = mockQuery.mock.calls.filter(([text]) =>
      text.includes('INSERT INTO learn_guide_ai_suggestions')
    );
    expect(inserts).toHaveLength(3);

    const kinds = inserts.map(([, params]) => params[1]).sort();
    expect(kinds).toEqual(['material', 'service', 'tool']);

    // Tool got the rental match → rent URL built from slug.
    const toolParams = inserts.find(([, p]) => p[1] === 'tool')[1];
    expect(toolParams[2]).toBe('Adjustable wrench');
    expect(toolParams[4]).toBe('/tool-rentals?search=adjustable-wrench');
    expect(toolParams[6]).toBe('adjustable-wrench');

    // Material fell back to the existing product link buy_url.
    const matParams = inserts.find(([, p]) => p[1] === 'material')[1];
    expect(matParams[5]).toBe('https://example.com/tape');

    // Service category fuzzy-matched to the Learn slug.
    const svcParams = inserts.find(([, p]) => p[1] === 'service')[1];
    expect(svcParams[7]).toBe('plumbing');
  });

  test('dedupe: ON CONFLICT DO NOTHING means re-tags create nothing new', async () => {
    process.env.OPENROUTER_API_KEY = 'k';
    okFetch({ tools: [{ name: 'Wrench' }], materials: [], service: null });
    mockQuery.mockImplementation(async (text) => {
      if (text.includes('FROM learn_guides')) {
        return { rows: [{ id: 'g1', title: 'T', category: 'plumbing', intro: '' }] };
      }
      if (text.includes('learn_guide_ai_suggestions')) {
        return { rowCount: 0 }; // conflict → skipped
      }
      return { rows: [] };
    });
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ ok: true, guide_id: 'g1', created: 0 });
  });

  test('never leaks the API key in logs or errors', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-super-secret';
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'g1', title: 'T', category: 'plumbing', intro: '' }] });
    global.fetch.mockRejectedValue(new Error('boom'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await tagGuideWithAI('g1');
    expect(res).toEqual({ skipped: 'network-error' });
    const logged = warn.mock.calls.map((c) => JSON.stringify(c)).join(' ');
    expect(logged).not.toContain('sk-or-v1-super-secret');
    warn.mockRestore();
  });
});

describe('extractJson', () => {
  test('strips code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  test('returns null for non-JSON', () => {
    expect(extractJson('hello')).toBeNull();
    expect(extractJson(null)).toBeNull();
  });
});

describe('matchLearnCategory', () => {
  test('matches case-insensitively and normalizes separators', () => {
    expect(matchLearnCategory('Plumbing')).toEqual({ slug: 'plumbing', confidence: 0.95 });
    expect(matchLearnCategory('car care')).toEqual({ slug: 'car-care', confidence: 0.95 });
  });
  test('returns null for unknown categories', () => {
    expect(matchLearnCategory('Rocket science')).toBeNull();
    expect(matchLearnCategory(null)).toBeNull();
  });
});
