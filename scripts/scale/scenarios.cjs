'use strict';

/**
 * Load scenario catalog for audit item V2-P1-05.
 *
 * Every path below is a real route mounted in server/index.js. Steps that
 * need seeded data or credentials are marked honestly: auth steps are
 * skipped (counted, not failed) when no token is supplied, and steps that
 * address synthetic IDs expect 4xx alongside 2xx until a fixture-seeded
 * staging database is used (see fixtures.cjs).
 *
 * Step fields:
 *   name      - stable identifier used in stats and reports
 *   method    - HTTP method (or 'ws' for a websocket step)
 *   path      - string or (ctx) => string; ctx has { rand, pick, int }
 *   auth      - false | 'user' | 'admin'
 *   body      - object or (ctx) => object
 *   thinkMs   - [min, max] pause after the step
 *   expect    - accepted status codes (5xx, timeouts and connection errors
 *               always count against the error budget; other 4xx are tracked
 *               separately as client responses)
 *   requiresAi- true when the step spends AI provider budget; excluded
 *               unless the harness runs with --include-ai
 *   ws        - { namespace, holdMs } for websocket steps
 *   multipart - { field, filename, bytes } for upload steps (synthetic buffer)
 */

const SEARCH_TERMS = ['plumber', 'electrician', 'cleaning', 'faucet', 'locksmith', 'painting', 'lawn', 'tutor'];
const RESTAURANT_IDS = ['1', '2', '3', '5', '8'];
const TRACKING_TOKENS = ['demo-token-a1b2', 'demo-token-c3d4', 'demo-token-e5f6'];
const AI_QUESTIONS = [
  'How do I book a plumber near me?',
  'What are the delivery hours for restaurants?',
  'How does OxSteed Credit work?',
];

const SCENARIOS = [
  {
    id: 'browse-discover',
    title: 'Browse and discover helpers',
    persona: 'customer',
    weight: 34,
    description: 'Directory browsing: discover feed, helper directory, Learn guides.',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'discover-feed', method: 'GET', path: '/api/discover?limit=24', auth: false, thinkMs: [400, 1200], expect: [200] },
      { name: 'helper-directory', method: 'GET', path: (ctx) => `/api/helpers?limit=24&page=${ctx.int(1, 3)}`, auth: false, thinkMs: [400, 1200], expect: [200] },
      { name: 'learn-guides', method: 'GET', path: '/api/learn/guides?limit=12', auth: false, thinkMs: [600, 1500], expect: [200] },
    ],
  },
  {
    id: 'search-pressure',
    title: 'Search pressure (trigram index)',
    persona: 'anonymous',
    weight: 12,
    description: 'Repeated free-text search against the discover endpoint; exercises the pg_trgm index from migration 657 and the discover rate limiter.',
    pressurePoints: ['db', 'redis'],
    steps: [
      { name: 'discover-search', method: 'GET', path: (ctx) => `/api/discover?q=${ctx.pick(SEARCH_TERMS)}&limit=24`, auth: false, thinkMs: [300, 900], expect: [200, 429] },
      { name: 'discover-search-page2', method: 'GET', path: (ctx) => `/api/discover?q=${ctx.pick(SEARCH_TERMS)}&limit=24&page=2`, auth: false, thinkMs: [300, 900], expect: [200, 429] },
    ],
  },
  {
    id: 'messaging',
    title: 'Messaging and AI chat',
    persona: 'customer',
    weight: 10,
    description: 'Conversation list fetch plus the anonymous AI chat endpoint (AI steps are opt-in via --include-ai to protect provider budget).',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'conversation-list', method: 'GET', path: '/api/messages/conversations?limit=20', auth: 'user', thinkMs: [500, 1200], expect: [200] },
      {
        name: 'ai-chat-message', method: 'POST', path: '/api/chat/message', auth: false, requiresAi: true,
        body: (ctx) => ({ message: ctx.pick(AI_QUESTIONS) }),
        thinkMs: [800, 2000], timeoutMs: 45000, expect: [200, 429],
      },
    ],
  },
  {
    id: 'booking-flow',
    title: 'Booking flow (authenticated)',
    persona: 'customer',
    weight: 6,
    description: 'Booking creation with synthetic payload; skipped without a user token.',
    pressurePoints: ['api', 'db'],
    steps: [
      {
        name: 'create-booking', method: 'POST', path: '/api/bookings', auth: 'user',
        body: () => ({ helperId: '00000000-0000-0000-0000-000000000000', serviceDate: new Date(Date.now() + 86400000).toISOString(), notes: 'scale-harness synthetic booking' }),
        thinkMs: [600, 1500], expect: [200, 201, 400, 422],
      },
    ],
  },
  {
    id: 'support-journey',
    title: 'Support journey',
    persona: 'customer',
    weight: 5,
    description: 'Guest support chat initiation and ticket submission.',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'support-chat-initiate', method: 'POST', path: '/api/support-chat/initiate', auth: false, body: () => ({ topic: 'scale-harness' }), thinkMs: [500, 1200], expect: [200, 201, 429] },
      { name: 'support-ticket', method: 'POST', path: '/api/support/request', auth: false, body: () => ({ subject: 'scale-harness synthetic ticket', message: 'Synthetic load ticket, safe to ignore.' }), thinkMs: [800, 2000], expect: [200, 201, 400, 429] },
      { name: 'my-tickets', method: 'GET', path: '/api/support/my-tickets?limit=10', auth: 'user', thinkMs: [400, 900], expect: [200] },
    ],
  },
  {
    id: 'food-ordering',
    title: 'Food ordering browse and quote',
    persona: 'customer',
    weight: 12,
    description: 'Restaurant discovery plus an order quote with a synthetic restaurant id.',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'food-markets', method: 'GET', path: '/api/food/markets', auth: false, thinkMs: [400, 1000], expect: [200] },
      { name: 'food-restaurants', method: 'GET', path: '/api/food/restaurants?limit=24', auth: false, thinkMs: [400, 1000], expect: [200] },
      { name: 'food-restaurant-detail', method: 'GET', path: (ctx) => `/api/food/restaurants/${ctx.pick(RESTAURANT_IDS)}`, auth: false, thinkMs: [400, 1000], expect: [200, 404] },
      {
        name: 'food-order-quote', method: 'POST', path: (ctx) => `/api/food/restaurants/${ctx.pick(RESTAURANT_IDS)}/orders/quote`, auth: false,
        body: () => ({ items: [{ id: 'synthetic-item', quantity: 2 }] }),
        thinkMs: [600, 1500], expect: [200, 400, 404, 422],
      },
    ],
  },
  {
    id: 'delivery-tracking',
    title: 'Delivery order tracking',
    persona: 'customer',
    weight: 6,
    description: 'Public order tracking lookups with synthetic tokens; exercises the lookup path and cache behavior.',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'track-order', method: 'GET', path: (ctx) => `/api/food/orders/track/${ctx.pick(TRACKING_TOKENS)}`, auth: false, thinkMs: [800, 2000], expect: [200, 404] },
    ],
  },
  {
    id: 'wallet-credit',
    title: 'Wallet and OxSteed Credit reads',
    persona: 'customer',
    weight: 5,
    description: 'Credit account status plus the statement CSV export (heaviest read on the credit path).',
    pressurePoints: ['api', 'db'],
    steps: [
      { name: 'credit-status', method: 'GET', path: '/api/oxsteed-credit/status', auth: 'user', thinkMs: [500, 1200], expect: [200] },
      { name: 'credit-statement-csv', method: 'GET', path: '/api/oxsteed-credit/statement.csv', auth: 'user', thinkMs: [800, 2000], timeoutMs: 30000, expect: [200, 429] },
    ],
  },
  {
    id: 'payments',
    title: 'QR payments',
    persona: 'customer',
    weight: 4,
    description: 'Public pay-code lookup (synthetic code) and authenticated pay-code creation.',
    pressurePoints: ['api', 'db', 'redis'],
    steps: [
      { name: 'qr-pay-lookup', method: 'GET', path: '/api/qr-payments/pay/scale-harness-demo', auth: false, thinkMs: [500, 1200], expect: [200, 404, 429] },
      { name: 'qr-code-create', method: 'POST', path: '/api/qr-payments/codes', auth: 'user', body: () => ({ label: 'scale-harness' }), thinkMs: [600, 1500], expect: [200, 201, 400] },
    ],
  },
  {
    id: 'websocket-fanout',
    title: 'Realtime websocket fanout',
    persona: 'customer',
    weight: 5,
    description: 'Socket.IO connection hold with heartbeat accounting; models realtime fanout pressure on the socket layer and the Redis adapter.',
    pressurePoints: ['realtime', 'redis'],
    steps: [
      { name: 'ws-connect-hold', method: 'ws', path: '/socket.io/', auth: false, ws: { namespace: '/chat', holdMs: [5000, 15000] }, thinkMs: [200, 600], expect: [101] },
    ],
  },
  {
    id: 'uploads',
    title: 'Upload pressure',
    persona: 'helper',
    weight: 2,
    description: 'Synthetic 64KB image upload through the upload scanner path.',
    pressurePoints: ['api', 'storage'],
    steps: [
      { name: 'upload-image', method: 'POST', path: '/api/upload/image', auth: 'user', multipart: { field: 'image', filename: 'scale-harness.png', bytes: 65536 }, thinkMs: [800, 2000], timeoutMs: 30000, expect: [200, 201, 400, 413, 429] },
    ],
  },
  {
    id: 'exports',
    title: 'Large-tenant data export',
    persona: 'customer',
    weight: 1,
    description: 'Privacy data export, the heaviest per-request read path; strict rate limiter applies.',
    pressurePoints: ['api', 'db'],
    steps: [
      { name: 'privacy-export', method: 'GET', path: '/api/privacy/export', auth: 'user', thinkMs: [1000, 2500], timeoutMs: 60000, expect: [200, 202, 429] },
    ],
  },
  {
    id: 'admin-ops',
    title: 'Staff admin operations',
    persona: 'staff',
    weight: 4,
    description: 'Operator surfaces: provider health, monitoring, moderation report queue. Skipped without an admin token.',
    pressurePoints: ['api', 'db'],
    steps: [
      { name: 'provider-health', method: 'GET', path: '/api/provider-health', auth: 'admin', thinkMs: [500, 1200], expect: [200] },
      { name: 'monitoring-health', method: 'GET', path: '/api/monitoring/health', auth: 'admin', thinkMs: [500, 1200], expect: [200] },
      { name: 'moderation-reports', method: 'GET', path: '/api/reports/admin/all?limit=50', auth: 'admin', thinkMs: [600, 1500], expect: [200] },
    ],
  },
  {
    id: 'ops-liveness',
    title: 'Ops liveness probes',
    persona: 'anonymous',
    weight: 4,
    description: 'Health and readiness endpoints; the baseline every other scenario is compared against.',
    pressurePoints: ['api'],
    steps: [
      { name: 'health', method: 'GET', path: '/health', auth: false, thinkMs: [200, 600], expect: [200] },
      { name: 'ready', method: 'GET', path: '/ready', auth: false, thinkMs: [200, 600], expect: [200, 503] },
    ],
  },
];

function validateScenarios(scenarios = SCENARIOS) {
  const errors = [];
  const ids = new Set();
  for (const scenario of scenarios) {
    if (!scenario.id || ids.has(scenario.id)) errors.push(`duplicate or missing scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.title) errors.push(`scenario ${scenario.id} missing title`);
    if (!(scenario.weight > 0)) errors.push(`scenario ${scenario.id} has non-positive weight`);
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) errors.push(`scenario ${scenario.id} has no steps`);
    for (const step of scenario.steps || []) {
      if (!step.name) errors.push(`scenario ${scenario.id} has a step without a name`);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'ws'].includes(step.method)) {
        errors.push(`scenario ${scenario.id} step ${step.name} has invalid method ${step.method}`);
      }
      if (step.method === 'ws') {
        if (typeof step.path !== 'string' || !step.path.startsWith('/socket.io')) {
          errors.push(`scenario ${scenario.id} step ${step.name} ws path must target /socket.io`);
        }
      } else if (typeof step.path !== 'string' && typeof step.path !== 'function') {
        errors.push(`scenario ${scenario.id} step ${step.name} path must be a string or function`);
      } else if (typeof step.path === 'string' && !step.path.startsWith('/')) {
        errors.push(`scenario ${scenario.id} step ${step.name} path must start with /`);
      }
      if (![false, 'user', 'admin'].includes(step.auth)) {
        errors.push(`scenario ${scenario.id} step ${step.name} has invalid auth ${step.auth}`);
      }
      if (!Array.isArray(step.expect) || step.expect.length === 0) {
        errors.push(`scenario ${scenario.id} step ${step.name} must declare expected statuses`);
      }
    }
  }
  return errors;
}

function totalWeight(scenarios = SCENARIOS) {
  return scenarios.reduce((acc, s) => acc + s.weight, 0);
}

module.exports = { SCENARIOS, validateScenarios, totalWeight };
