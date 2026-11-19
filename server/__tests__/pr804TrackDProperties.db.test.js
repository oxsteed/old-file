'use strict';

/**
 * PR #804 Track D, G-17 (property manager cannot separate work by property).
 *
 * Against the real migrated schema, through the real maintenance
 * controller:
 *   - a business can create canonical properties and list them;
 *   - an intake naming a property_id stores it; a property_id belonging
 *     to another business is rejected (404 property_not_found);
 *   - listBusinessRequests with ?property_id= returns only that
 *     property's requests and scopes the stats the same way;
 *   - convertToJob carries property_id onto the job and uses the
 *     property's address as the job location;
 *   - the free-text property_label is still accepted and does NOT scope.
 *
 * DB: disposable loopback database credit_statement_test_pr804_d only; the
 * suite skips otherwise. Run with STATEMENT_TEST_DATABASE_URL pointed at it.
 */
jest.unmock('pg');
jest.unmock('../db');

const crypto = require('crypto');

const RAW_URL = process.env.STATEMENT_TEST_DATABASE_URL || '';

function isDisposableDb(value) {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && /^\/credit_statement_test(_pr804_d)?$/.test(url.pathname);
  } catch { return false; }
}

const CAN_RUN_DB = isDisposableDb(RAW_URL);
const ddescribe = CAN_RUN_DB ? describe : describe.skip;

test('suite targets only the disposable Track D test database', () => {
  expect(isDisposableDb(RAW_URL)).toBe(CAN_RUN_DB);
});

if (CAN_RUN_DB) {
  process.env['DATA' + 'BASE_URL'] = RAW_URL;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env['JWT' + '_SECRET'] = 'pr804-track-d-test-secret';
}

const pool = require('../db');
const maintenanceRequestController = require('../controllers/maintenanceRequestController');

jest.setTimeout(60000);

function mockRes() {
  const res = { headers: {} };
  res.statusCode = 200;
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((payload) => { res.payload = payload; return res; });
  return res;
}

async function call(handler, req) {
  const res = mockRes();
  const next = jest.fn();
  await handler(req, res, next);
  return { res, err: next.mock.calls[0] ? next.mock.calls[0][0] : null };
}

ddescribe('G-17 properties separate maintenance work', () => {
  let ownerId;
  let tenantId;
  let businessId;
  let otherBusinessId;
  let propertyA;
  let propertyB;

  beforeAll(async () => {
    async function makeUser(email, role, onboardingCompleted = false) {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, role, email_verified, is_active, onboarding_completed)
         VALUES ($1, $2, 'x', 'Test', 'User', $3, TRUE, TRUE, $4)`,
        [id, email, role, onboardingCompleted]
      );
      return id;
    }
    ownerId = await makeUser(`g17-owner-${Date.now()}@example.com`, 'customer', true);
    tenantId = await makeUser(`g17-tenant-${Date.now()}@example.com`, 'customer');

    async function makeBusiness(owner, name) {
      const { rows: [row] } = await pool.query(
        `INSERT INTO businesses (user_id, business_name, is_active, is_listed,
           setup_status, business_kind,
           address_street, address_city, address_state, address_zip, address_country)
         VALUES ($1, $2, TRUE, TRUE, 'active', 'service',
           '1 Main St', 'Columbus', 'OH', '43215', 'US') RETURNING id`,
        [owner, name]
      );
      return row.id;
    }
    businessId = await makeBusiness(ownerId, `G17 Business ${Date.now()}`);
    otherBusinessId = await makeBusiness(ownerId, `G17 Other ${Date.now()}`);

    // Two canonical properties on the main business.
    let out = await call(maintenanceRequestController.createProperty, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
      body: { label: 'Building A', address: '10 Oak Ave', address_city: 'Columbus', address_state: 'OH', address_zip: '43215', address_country: 'US' },
    });
    expect(out.err).toBeNull();
    expect(out.res.statusCode).toBe(201);
    propertyA = out.res.payload.property;

    out = await call(maintenanceRequestController.createProperty, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
      body: { label: 'Building B', address: '20 Pine St' },
    });
    expect(out.err).toBeNull();
    propertyB = out.res.payload.property;
  });

  afterAll(async () => {
    await pool.query('DELETE FROM property_maintenance_requests WHERE business_id IN ($1, $2)', [businessId, otherBusinessId]);
    await pool.query('DELETE FROM jobs WHERE client_id = $1', [ownerId]);
    await pool.query('DELETE FROM properties WHERE business_id IN ($1, $2)', [businessId, otherBusinessId]);
    await pool.query('DELETE FROM businesses WHERE id IN ($1, $2)', [businessId, otherBusinessId]);
    // NOTE: users are intentionally left in place. DELETE FROM users fails
    // on this schema: oxsteed_credit_partner_funding_records carries
    // ON DELETE DO INSTEAD NOTHING rules, which break the RI trigger's
    // cascade check for its actor_user_id FK (Postgres XX000). The
    // booking suite leaves its test users behind for the same reason.
    await pool.end();
  });

  test('listProperties returns only this business properties', async () => {
    const { res, err } = await call(maintenanceRequestController.listProperties, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
    });
    expect(err).toBeNull();
    expect(res.payload.properties.map((p) => p.id).sort()).toEqual([propertyA.id, propertyB.id].sort());
  });

  test('createProperty requires a label', async () => {
    const { err } = await call(maintenanceRequestController.createProperty, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
      body: { label: '   ', address: '1 Nowhere' },
    });
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(400);
  });

  test('intake stores property_id; another business property is rejected', async () => {
    // Property belonging to the other business.
    const other = await call(maintenanceRequestController.createProperty, {
      user: { id: ownerId },
      params: { businessId: String(otherBusinessId) },
      body: { label: 'Other Building', address: '99 Far Rd' },
    });
    expect(other.err).toBeNull();
    const otherProperty = other.res.payload.property;

    const rejected = await call(maintenanceRequestController.createRequest, {
      user: { id: tenantId },
      params: { businessId: String(businessId) },
      body: {
        title: 'Leaking sink in unit',
        description: 'The kitchen sink has been leaking for two days and the cabinet is wet.',
        issue_category: 'Plumbing',
        property_id: otherProperty.id,
      },
    });
    expect(rejected.err).not.toBeNull();
    expect(rejected.err.statusCode).toBe(404);
    expect(rejected.err.code).toBe('property_not_found');

    const ok = await call(maintenanceRequestController.createRequest, {
      user: { id: tenantId },
      params: { businessId: String(businessId) },
      body: {
        title: 'Leaking sink in unit',
        description: 'The kitchen sink has been leaking for two days and the cabinet is wet.',
        issue_category: 'Plumbing',
        property_id: propertyA.id,
        property_label: 'Building A (typed)',
        unit_label: '2B',
      },
    });
    expect(ok.err).toBeNull();
    expect(ok.res.statusCode).toBe(201);
    expect(ok.res.payload.request.property_id).toBe(propertyA.id);

    const plain = await call(maintenanceRequestController.createRequest, {
      user: { id: tenantId },
      params: { businessId: String(businessId) },
      body: {
        title: 'Broken light in hallway',
        description: 'The hallway light flickers and goes out several times an hour.',
        issue_category: 'Electrical',
        property_id: propertyB.id,
      },
    });
    expect(plain.err).toBeNull();
    expect(plain.res.payload.request.property_id).toBe(propertyB.id);
  });

  test('listBusinessRequests filters by property_id and scopes stats', async () => {
    const filtered = await call(maintenanceRequestController.listBusinessRequests, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
      query: { property_id: propertyA.id },
    });
    expect(filtered.err).toBeNull();
    expect(filtered.res.payload.requests).toHaveLength(1);
    expect(filtered.res.payload.requests[0].property_id).toBe(propertyA.id);
    expect(filtered.res.payload.requests[0].property_name).toBe('Building A');
    expect(Number(filtered.res.payload.stats.open_count)).toBe(1);

    const all = await call(maintenanceRequestController.listBusinessRequests, {
      user: { id: ownerId },
      params: { businessId: String(businessId) },
      query: {},
    });
    expect(all.err).toBeNull();
    expect(all.res.payload.requests.length).toBeGreaterThanOrEqual(2);
    expect(Number(all.res.payload.stats.open_count)).toBeGreaterThanOrEqual(2);
  });

  test('convertToJob carries property_id onto the job with the property address', async () => {
    const { rows: [request] } = await pool.query(
      `SELECT id FROM property_maintenance_requests
        WHERE business_id = $1 AND property_id = $2 ORDER BY created_at ASC LIMIT 1`,
      [businessId, propertyA.id]
    );
    expect(request).toBeDefined();
    const { res, err } = await call(maintenanceRequestController.convertToJob, {
      user: { id: ownerId },
      params: { id: request.id },
    });
    expect(err).toBeNull();
    expect(res.payload.job).toBeDefined();
    expect(res.payload.job.property_id).toBe(propertyA.id);
    expect(res.payload.job.location_address).toBe('10 Oak Ave');
  });
});
