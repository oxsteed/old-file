'use strict';

/**
 * Staff review S-11 remainders against the real migrated schema:
 *   - open crew tasks / corrective actions are reassigned to a manager
 *     (not NULLed) on member removal,
 *   - an offboarding record is written with the retention deadline,
 *   - residual staff-history cascades are SET NULL (1202),
 *   - the rehire flow restores role/job/pay and links history.
 *
 * Opt-in disposable database:
 *   ST_W2_TEST_DATABASE_URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/st_w2
 *     npx jest __tests__/staffOffboardingRecords.db.test.js
 */
function staffDbOptIn() {
  // S-23: standard disposable test database (ci-local.sh sets it). The
  // suite runs whenever the test DB is available and self-skips only
  // when no test DB is configured at all. STATEMENT_REQUIRE_DB_TESTS
  // (set by ci-local.sh) turns a missing DB into a hard failure instead
  // of a silent skip.
  const value = process.env.STATEMENT_TEST_DATABASE_URL || '';
  if (!value) {
    if (process.env.STATEMENT_REQUIRE_DB_TESTS === 'true') {
      throw new Error('STATEMENT_TEST_DATABASE_URL is required when STATEMENT_REQUIRE_DB_TESTS=true');
    }
    return '';
  }
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (!loopback) {
    throw new Error('STATEMENT_TEST_DATABASE_URL must be a loopback database');
  }
  return value;
}

const url = staffDbOptIn();
if (url) process.env.DATABASE_URL = url;
jest.unmock('pg');
jest.unmock('../db');
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
  sendBulkNotification: jest.fn().mockResolvedValue(undefined),
}));

const db = require('../db');
const { withTransaction } = require('../utils/transaction');
const { applyStaffOffboarding } = require('../services/staffOffboarding');
const membersCtrl = require('../controllers/businessMembersController');

const suite = url ? describe : describe.skip;

function mockRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
function mockNext() {
  const next = (err) => { if (err) next.error = err; };
  next.error = null;
  return next;
}
async function call(handler, req) {
  const res = mockRes();
  const next = mockNext();
  await handler({ headers: {}, ...req }, res, next);
  return { res, error: next.error };
}

const stamp = `${Date.now()}`;
const rid = require('crypto').randomBytes(2).toString('hex');
const uid = (tail) => `d0000000-0000-4000-8000-${rid}${tail}`;
const OWNER = uid('11111111');
const MANAGER = uid('22222222');
const EMPLOYEE = uid('33333333');

let bizId;
let restaurantId;
let locationId;
let employeeMembershipId;

async function insertUser(id, email) {
  await db.query(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, is_active)
     VALUES ($1, $2, 'x', 'Test', 'User', TRUE)
     ON CONFLICT (id) DO NOTHING`,
    [id, email]
  );
}

const asOwner = (body = {}, params = {}) => ({
  user: { id: OWNER, first_name: 'Olive' },
  business: { id: bizId, business_name: `Offboard Biz ${stamp}`, owner_id: OWNER },
  params: { id: String(bizId), ...params },
  body,
});

suite('S-11 offboarding records, reassignment, rehire (DB)', () => {
  beforeAll(async () => {
    await insertUser(OWNER, `off-owner-${stamp}@example.com`);
    await insertUser(MANAGER, `off-manager-${stamp}@example.com`);
    await insertUser(EMPLOYEE, `off-emp-${stamp}@example.com`);
    const { rows: [biz] } = await db.query(
      `INSERT INTO businesses (user_id, business_name) VALUES ($1, $2) RETURNING id`,
      [OWNER, `Offboard Biz ${stamp}`]
    );
    bizId = biz.id;
    await db.query(
      `INSERT INTO business_members (business_id, owner_id, member_id, role, invite_email, status, accepted_at)
       VALUES ($1, $2, $3, 'manager', $4, 'active', NOW()) ON CONFLICT DO NOTHING`,
      [bizId, OWNER, MANAGER, `off-manager-${stamp}@example.com`]
    );
    const { rows: [mem] } = await db.query(
      `INSERT INTO business_members
         (business_id, owner_id, member_id, role, invite_email, status, job_role,
          pay_rate_cents, pay_rate_period, hourly_wage_cents, accepted_at)
       VALUES ($1, $2, $3, 'employee', $4, 'active', 'cashier', 1800, 'hour', 1800, NOW())
       RETURNING id`,
      [bizId, OWNER, EMPLOYEE, `off-emp-${stamp}@example.com`]
    );
    employeeMembershipId = mem.id;
    const { rows: [rest] } = await db.query(
      `INSERT INTO food_restaurants (business_id, owner_user_id, display_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [bizId, OWNER, `Offboard Restaurant ${stamp}`]
    );
    restaurantId = rest.id;
    const { rows: [loc] } = await db.query(
      `INSERT INTO restaurant_locations (restaurant_id, name) VALUES ($1, $2) RETURNING id`,
      [restaurantId, 'Main']
    );
    locationId = loc.id;
  });

  afterAll(async () => { await db.end(); });

  test('migration 1202: offboarding table, retention policy, SET NULL FKs', async () => {
    const t = await db.query(`SELECT to_regclass('public.staff_offboarding_records') AS c`);
    expect(t.rows[0].c).toBe('staff_offboarding_records');
    const b = await db.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'staff_record_retention_years'`
    );
    expect(b.rows.length).toBe(1);
    const { rows } = await db.query(
      `SELECT conrelid::regclass::text AS tbl, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conname IN ('restaurant_staff_documents_user_id_fkey',
                          'business_staff_availability_user_id_fkey',
                          'business_shift_swap_requests_requester_user_id_fkey')`
    );
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.def.includes('ON DELETE SET NULL'))).toBe(true);
  });

  test('open tasks and corrective actions are reassigned to the manager, not NULLed', async () => {
    const { rows: [task] } = await db.query(
      `INSERT INTO restaurant_crew_tasks (restaurant_id, location_id, title, assigned_to, status)
       VALUES ($1, $2, 'Mop floors', $3, 'in_progress') RETURNING id`,
      [restaurantId, locationId, EMPLOYEE]
    );
    const { rows: [doneTask] } = await db.query(
      `INSERT INTO restaurant_crew_tasks (restaurant_id, location_id, title, assigned_to, status)
       VALUES ($1, $2, 'Done thing', $3, 'completed') RETURNING id`,
      [restaurantId, locationId, EMPLOYEE]
    );
    const { rows: [template] } = await db.query(
      `INSERT INTO restaurant_audit_templates (restaurant_id, name) VALUES ($1, 'Close-down') RETURNING id`,
      [restaurantId]
    );
    const { rows: [audit] } = await db.query(
      `INSERT INTO restaurant_audits (template_id, restaurant_id, auditor_id) VALUES ($1, $2, $3) RETURNING id`,
      [template.id, restaurantId, MANAGER]
    );
    const { rows: [finding] } = await db.query(
      `INSERT INTO restaurant_audit_findings (audit_id, severity, note) VALUES ($1, 'high', 'Fix sink') RETURNING id`,
      [audit.id]
    );
    const { rows: [action] } = await db.query(
      `INSERT INTO restaurant_corrective_actions (finding_id, audit_id, description, assignee_id, status)
       VALUES ($1, $2, 'Call plumber', $3, 'open') RETURNING id`,
      [finding.id, audit.id, EMPLOYEE]
    );

    const result = await withTransaction(db, (client) =>
      applyStaffOffboarding(client, {
        businessId: bizId,
        userId: EMPLOYEE,
        reason: 'test removal',
        membershipId: employeeMembershipId,
        removedBy: OWNER,
        reassignToUserId: MANAGER,
      })
    );

    expect(result.crewTasksReassigned).toBe(1);
    expect(result.correctiveActionsReassigned).toBe(1);
    expect(result.reassignedToUserId).toBe(MANAGER);

    const { rows: [openRow] } = await db.query(`SELECT assigned_to FROM restaurant_crew_tasks WHERE id = $1`, [task.id]);
    expect(String(openRow.assigned_to)).toBe(MANAGER);
    const { rows: [doneRow] } = await db.query(`SELECT assigned_to FROM restaurant_crew_tasks WHERE id = $1`, [doneTask.id]);
    expect(String(doneRow.assigned_to)).toBe(EMPLOYEE); // completed history keeps its assignee
    const { rows: [actionRow] } = await db.query(`SELECT assignee_id FROM restaurant_corrective_actions WHERE id = $1`, [action.id]);
    expect(String(actionRow.assignee_id)).toBe(MANAGER);
  });

  test('offboarding record is written with the retention deadline', async () => {
    const { rows: [record] } = await db.query(
      `SELECT * FROM staff_offboarding_records
        WHERE business_id = $1 AND user_id = $2 ORDER BY removed_at DESC LIMIT 1`,
      [bizId, EMPLOYEE]
    );
    expect(record).toBeTruthy();
    expect(record.membership_id).toBe(String(employeeMembershipId));
    expect(record.crew_tasks_reassigned).toBe(1);
    expect(record.corrective_actions_reassigned).toBe(1);
    expect(String(record.reassigned_to_user_id)).toBe(MANAGER);
    const retainUntil = new Date(record.retain_until);
    const sevenYearsOut = new Date();
    sevenYearsOut.setFullYear(sevenYearsOut.getFullYear() + 7);
    expect(Math.abs(retainUntil - sevenYearsOut)).toBeLessThan(86400000 * 2);
  });

  test('rehire restores role/job/pay and links the offboarding record', async () => {
    // Revoke the membership first (the rehire precondition).
    await db.query(`UPDATE business_members SET status = 'revoked' WHERE id = $1`, [employeeMembershipId]);

    const { res, error } = await call(membersCtrl.rehireMember, asOwner({ user_id: EMPLOYEE }));
    expect(error).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body.member.status).toBe('active');
    expect(res.body.member.role).toBe('employee');
    expect(res.body.member.job_role).toBe('cashier');
    expect(res.body.member.pay_rate_cents).toBe(1800);
    expect(res.body.member.hourly_wage_cents).toBe(1800);
    expect(res.body.offboardingRecord).toBeTruthy();

    const { rows: [record] } = await db.query(
      `SELECT rehired_at, rehired_membership_id FROM staff_offboarding_records
        WHERE business_id = $1 AND user_id = $2 ORDER BY removed_at DESC LIMIT 1`,
      [bizId, EMPLOYEE]
    );
    expect(record.rehired_at).toBeTruthy();
    expect(String(record.rehired_membership_id)).toBe(String(res.body.member.id));

    // Rehiring an active member is a conflict, not a duplicate.
    const again = await call(membersCtrl.rehireMember, asOwner({ user_id: EMPLOYEE }));
    expect(again.res.statusCode).toBe(409);
  });

  test('rehire of an unknown person is a 404', async () => {
    const { res } = await call(membersCtrl.rehireMember, asOwner({ email: `nobody-${stamp}@example.com` }));
    expect(res.statusCode).toBe(404);
  });

  test('staff documents support the anonymized (NULL user) survival shape', async () => {
    // A real DELETE FROM users is blocked schema-wide by the
    // food_customer_wallet_ledger append-only rule (known issue, owned by
    // credit-ledger work), so the SET NULL action itself is verified via
    // the constraint definitions above. Here we verify the surviving
    // shape: history rows persist with user_id NULL after anonymization.
    const { rows: [doc] } = await db.query(
      `INSERT INTO restaurant_staff_documents
         (restaurant_id, user_id, doc_type, title, storage_key)
       VALUES ($1, NULL, 'certificate_food_handler', 'Anonymized cert', 'test/key')
       RETURNING id, user_id`,
      [restaurantId]
    );
    expect(doc.user_id).toBeNull();
    const { rows: [avail] } = await db.query(
      `INSERT INTO business_staff_availability (business_id, user_id, day_of_week, start_time, end_time)
       VALUES ($1, NULL, 1, '09:00', '17:00') RETURNING user_id`,
      [bizId]
    );
    expect(avail.user_id).toBeNull();
  });
});
