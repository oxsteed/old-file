'use strict';

/**
 * Bundle E (admin audit): Support & messaging fixes.
 *
 *  ADM-033: guest ticket HTML injection + account planting via email
 *  ADM-094: regional isolation on ticket mutation endpoints
 *  ADM-124: break-glass grant bypass on conversation detail
 *  ADM-126: webhook secrets encrypted at rest, masked in API responses
 *  ADM-023: moderation_queue reader (mobile flags were write-only)
 */

const { mockQuery, resetMocks } = require('./setup');

const supportController = require('../controllers/supportController');
const conversationsAdminController = require('../controllers/conversationsAdminController');
const moderationController = require('../controllers/moderationController');
const secrets = require('../utils/supportIntegrationSecrets');
const { sendEmail } = require('../utils/email');

const REGION_US = {
  id: 7,
  name: 'US South',
  boundary_definition: { type: 'country_only', countries: ['US'] },
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  resetMocks();
  jest.clearAllMocks();
});

// ─── ADM-033 ────────────────────────────────────────────────────────────────

describe('ADM-033 guest ticket submission', () => {
  function mockSubmitQueries({ ticketUserId = null } = {}) {
    mockQuery.mockImplementation(async (sql, params) => {
      const q = String(sql);
      if (q === 'BEGIN' || q === 'COMMIT' || q === 'ROLLBACK') return { rows: [] };
      if (q.includes('INSERT INTO support_tickets')) {
        return {
          rows: [{
            id: 'ticket-1', ticket_number: 1001, user_id: params[0],
            name: params[1], email: params[2], subject: params[3],
            priority: params[4], created_at: new Date().toISOString(),
          }],
        };
      }
      if (q.includes('INSERT INTO support_messages')) return { rows: [{ id: 'm1' }] };
      if (q.includes("WHERE role IN ('admin', 'super_admin')")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
  }

  const guestReq = () => ({
    body: {
      name: '<script>alert("xss")</script>',
      email: 'victim@example.com',
      subject: '<img src=x onerror=alert(1)> Help',
      message: 'hello',
      category: 'general',
    },
    user: undefined,
    get: () => null,
  });

  test('guest ticket is NOT linked to an account by email (no planting)', async () => {
    mockSubmitQueries();
    const req = guestReq();
    const res = mockRes();
    await supportController.submitSupportRequest(req, res, jest.fn());
    await flush();

    expect(res.status).toHaveBeenCalledWith(201);
    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO support_tickets'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBeNull(); // user_id param
    // No email-based account lookup may run for guests.
    const emailLookups = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('LOWER(email)'));
    expect(emailLookups).toHaveLength(0);
  });

  test('authenticated submission links to the session user', async () => {
    mockSubmitQueries();
    const req = { ...guestReq(), user: { id: 'user-9' } };
    const res = mockRes();
    await supportController.submitSupportRequest(req, res, jest.fn());
    await flush();

    const insertCall = mockQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO support_tickets'));
    expect(insertCall[1][0]).toBe('user-9');
  });

  test('confirmation email escapes guest-controlled name/subject', async () => {
    mockSubmitQueries();
    const req = guestReq();
    const res = mockRes();
    await supportController.submitSupportRequest(req, res, jest.fn());
    await flush();

    const confirmation = sendEmail.mock.calls.find(([args]) =>
      String(args.to).includes('victim@example.com'));
    expect(confirmation).toBeDefined();
    const html = confirmation[0].html;
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

// ─── ADM-094 ────────────────────────────────────────────────────────────────

describe('ADM-094 regional isolation on ticket mutations', () => {
  const regionalReq = (overrides = {}) => ({
    user: { id: 'admin-1', role: 'admin', first_name: 'A', last_name: 'B' },
    isSuper: false,
    assigned_regions: [REGION_US],
    params: { ticketId: 't1' },
    body: {},
    get: () => null,
    ...overrides,
  });

  function mockRegionQueries({ ticketUserId, ticketCountry }) {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes('FROM support_tickets')) {
        return { rows: [{ id: 't1', user_id: ticketUserId, status: 'open', assigned_to: null, ticket_number: 42 }] };
      }
      if (q.includes('FROM users WHERE id')) {
        return ticketUserId
          ? { rows: [{ id: ticketUserId, country: ticketCountry }] }
          : { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  test('claimTicket 403s for a ticket outside the admin region', async () => {
    mockRegionQueries({ ticketUserId: 'user-ca', ticketCountry: 'CA' });
    const res = mockRes();
    await supportController.claimTicket(regionalReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('outside your assigned region') })
    );
    const updates = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('UPDATE support_tickets'));
    expect(updates).toHaveLength(0);
  });

  test('claimTicket 403s for a guest ticket (fail closed)', async () => {
    mockRegionQueries({ ticketUserId: null });
    const res = mockRes();
    await supportController.claimTicket(regionalReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('claimTicket proceeds for a ticket inside the admin region', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes('FROM support_tickets') && q.includes('SELECT id, user_id')) {
        return { rows: [{ id: 't1', user_id: 'user-us', status: 'open', assigned_to: null, ticket_number: 42 }] };
      }
      if (q.includes('FROM users WHERE id')) {
        return { rows: [{ id: 'user-us', country: 'US' }] };
      }
      if (q.includes('UPDATE support_tickets')) return { rows: [{ id: 't1' }] };
      if (q.includes('SELECT') && q.includes('t.*')) {
        return { rows: [{ id: 't1', user_id: 'user-us', ticket_number: 42 }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await supportController.claimTicket(regionalReq(), res);

    expect(res.status).not.toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ticket: expect.anything() }));
  });

  test('updateStatus 403s for a ticket outside the admin region', async () => {
    mockRegionQueries({ ticketUserId: 'user-ca', ticketCountry: 'CA' });
    const res = mockRes();
    await supportController.updateStatus(
      regionalReq({ body: { status: 'in_progress' } }), res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('adminReply 403s for a ticket outside the admin region', async () => {
    mockRegionQueries({ ticketUserId: 'user-ca', ticketCountry: 'CA' });
    const res = mockRes();
    await supportController.adminReply(
      regionalReq({ body: { content: 'hello', is_internal: false } }), res);

    expect(res.status).toHaveBeenCalledWith(403);
    const inserts = mockQuery.mock.calls.filter(([sql]) =>
      String(sql).includes('INSERT INTO support_messages'));
    expect(inserts).toHaveLength(0);
  });

  test('missing scope fails closed with 503 on mutations', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM support_tickets')) {
        return { rows: [{ id: 't1', user_id: 'user-us' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const req = {
      user: { id: 'admin-1', role: 'admin' },
      isSuper: false,
      // assigned_regions never loaded: the route forgot the middleware
      params: { ticketId: 't1' },
      body: { priority: 'high' },
    };
    const res = mockRes();
    await supportController.updatePriority(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'SCOPE_UNAVAILABLE' }));
  });
});

// ─── ADM-124 ────────────────────────────────────────────────────────────────

describe('ADM-124 break-glass conversation access', () => {
  const superReq = (overrides = {}) => ({
    user: { id: 'super-1', role: 'super_admin' },
    isSuper: true,
    params: { id: 'conv-1' },
    query: {},
    body: {},
    headers: {},
    ...overrides,
  });

  test('query-string reason is rejected (URL lands in proxy logs)', async () => {
    const res = mockRes();
    await conversationsAdminController.getThread(
      superReq({ query: { reason: 'investigating fraud case number 12345' } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'break_glass_reason_required' }));
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('body reason is accepted', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes('FROM conversations c')) {
        return { rows: [{ id: 'conv-1', status: 'active', customer_id: 'c1', helper_id: 'h1' }] };
      }
      if (q.includes('FROM messages m')) return { rows: [] };
      if (q.includes('INSERT INTO')) return { rows: [{ id: 'log-1' }] };
      return { rows: [], rowCount: 0 };
    });
    // getThread also calls writeBreakGlassLog + loadLinkedArtifacts; stub via empty results.
    const res = mockRes();
    await conversationsAdminController.getThread(
      superReq({ body: { reason: 'investigating a reported fraud case' } }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ break_glass: expect.objectContaining({ admin_id: 'super-1' }) }));
  });

  test('route requires the investigate_conversations grant', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
    const line = src.split('\n').find((l) =>
      l.includes("get('/super/conversations/:id'") && l.includes('getThread'));
    expect(line).toBeDefined();
    expect(line).toContain("requirePermission('investigate_conversations')");
  });
});

// ─── ADM-126 ────────────────────────────────────────────────────────────────

describe('ADM-126 webhook secret handling', () => {
  test('secret fields are encrypted at rest on write', () => {
    const out = secrets.prepareSecretFieldsForWrite({
      slack_webhook_url: 'https://hooks.slack.com/services/T000/B000/SECRET1234',
      zapier_webhook_url: '',
      email_provider: 'resend',
    });
    expect(out.slack_webhook_url).toMatch(/^enc:v1:/);
    expect(out.slack_webhook_url).not.toContain('SECRET1234');
    expect(out.zapier_webhook_url).toBe(''); // explicit clear passes through
    expect(out.email_provider).toBe('resend'); // non-secret untouched
  });

  test('masked placeholder round-trips without destroying the stored secret', () => {
    const out = secrets.prepareSecretFieldsForWrite({
      slack_webhook_url: '••••••••1234',
      email_provider: 'resend',
    });
    expect(out).not.toHaveProperty('slack_webhook_url');
    expect(out.email_provider).toBe('resend');
  });

  test('API responses mask secrets to last-4 only', () => {
    const encrypted = secrets.prepareSecretFieldsForWrite({
      slack_webhook_url: 'https://hooks.slack.com/services/T000/B000/SECRET1234',
    }).slack_webhook_url;
    const masked = secrets.maskSecretsForRead({
      slack_webhook_url: encrypted,
      email_provider: 'resend',
    });
    expect(masked.slack_webhook_url).toBe('••••••••1234');
    expect(masked.email_provider).toBe('resend');
  });

  test('legacy plaintext secrets are masked too', () => {
    const masked = secrets.maskSecretsForRead({
      slack_webhook_url: 'https://hooks.slack.com/services/T000/B000/OLDSECRET',
    });
    expect(masked.slack_webhook_url).toBe('••••••••CRET');
    expect(masked.slack_webhook_url).not.toContain('hooks.slack.com');
  });
});

// ─── ADM-023 ────────────────────────────────────────────────────────────────

describe('ADM-023 moderation_queue reader', () => {
  test('listContentFlags returns pending flags with pagination', async () => {
    mockQuery.mockImplementation(async (sql) => {
      if (String(sql).includes('FROM moderation_queue q')) {
        return { rows: [{ id: 1, type: 'content_flag', status: 'pending', priority: 'high' }] };
      }
      return { rows: [{ total: 1 }] };
    });
    const res = mockRes();
    await moderationController.listContentFlags(
      { query: { status: 'pending', page: '1', limit: '25' } }, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.any(Array), total: 1, page: 1, limit: 25 }));
  });

  test('listContentFlags rejects an invalid status', async () => {
    const res = mockRes();
    await moderationController.listContentFlags({ query: { status: 'bogus' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('reviewContentFlag resolves a pending flag', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes('UPDATE moderation_queue')) {
        return { rows: [{ id: 5, type: 'content_flag', status: 'resolved' }] };
      }
      if (q.includes('INSERT INTO admin_audit_log')) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await moderationController.reviewContentFlag(
      { params: { id: '5' }, body: { decision: 'resolved', resolution: 'spam' }, user: { id: 'admin-1' } },
      res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ flag: expect.objectContaining({ status: 'resolved' }) }));
  });

  test('reviewContentFlag 409s when the flag is already decided', async () => {
    mockQuery.mockImplementation(async (sql) => {
      const q = String(sql);
      if (q.includes('UPDATE moderation_queue')) return { rows: [] };
      if (q.includes('SELECT id, status FROM moderation_queue')) {
        return { rows: [{ id: 5, status: 'dismissed' }] };
      }
      return { rows: [], rowCount: 0 };
    });
    const res = mockRes();
    await moderationController.reviewContentFlag(
      { params: { id: '5' }, body: { decision: 'resolved' }, user: { id: 'admin-1' } },
      res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  test('reviewContentFlag rejects an invalid decision', async () => {
    const res = mockRes();
    await moderationController.reviewContentFlag(
      { params: { id: '5' }, body: { decision: 'ban' }, user: { id: 'admin-1' } },
      res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('routes are mounted behind moderate_content', () => {
    const fs = require('fs');
    const src = fs.readFileSync(
      require('path').join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
    expect(src).toContain("router.get('/moderation-flags'");
    expect(src).toContain("router.post('/moderation-flags/:id/review'");
    for (const line of src.split('\n')) {
      if (line.includes('/moderation-flags')) {
        expect(line).toContain("requirePermission('moderate_content')");
      }
    }
  });
});
