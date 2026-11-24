'use strict';

// Group 11 Slice 2d acceptance: Return + Changes (576, 580, 583, 584).
// Runs against a dedicated fresh database (credit_statement_test_g11d) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 576: return schedule — owner daily return window, renter return time at
//   booking, and a renter-proposed / owner-decided return reschedule that
//   never changes charges (D-257).
describeDb('Group 11 Slice 2d: Return + Changes (576, 580, 583, 584)', () => {
  let db;
  let app;

  beforeAll(async () => {
    process.env.ACCESS_REQUESTS_ENABLED = 'true';
    db = require('../db');
    app = express();
    app.use(express.json());
    app.use('/api/tool-rentals', require('../routes/toolRentals'));
    app.use(require('../middleware/errorHandler').errorHandler);
  });

  afterAll(async () => { await db?.end(); });

  async function addUser(role = 'customer', identity = {}) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, default_mode, email_verified, is_active, onboarding_completed, didit_status, didit_verified_at)
       VALUES ($1, $2, 'x', 'Equipment', 'Fixture', $3, $4, TRUE, TRUE, TRUE, $5, $6)`,
      [id, `g11d-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer',
        identity.diditStatus || 'pending', identity.diditVerifiedAt || null],
    );
    mockRoles.set(id, role);
    return id;
  }

  async function grantToolOwner(userId) {
    await db.query(
      `INSERT INTO access_grants (user_id, capability, subject_type, subject_key, status, provenance, policy_version)
       VALUES ($1, 'tool_owner.list_equipment', 'self', 'self', 'active', 'legacy_backfill', 'tool-owner-policy-2')
       ON CONFLICT DO NOTHING`,
      [userId],
    );
  }

  async function insertTool(ownerId, overrides = {}) {
    const row = {
      name: 'Cordless drill',
      category: 'Power Tools',
      description: '18V cordless drill with two batteries.',
      daily_rate: 18,
      hourly_rate: null,
      deposit_amount: 40,
      condition: 'good',
      brand: 'DeWalt',
      model: 'DCD771',
      is_available: true,
      requires_deposit: false,
      delivery_available: false,
      pickup_only: true,
      location_city: 'Austin',
      location_state: 'TX',
      image_gallery: ['https://example.invalid/drill.jpg'],
      moderation_hold: false,
      ...overrides,
    };
    const cols = ['user_id', 'name', 'category', 'description', 'daily_rate', 'hourly_rate',
      'deposit_amount', 'condition', 'brand', 'model', 'is_available', 'requires_deposit',
      'delivery_available', 'pickup_only', 'location_city', 'location_state',
      'image_gallery', 'moderation_hold'];
    const vals = [ownerId, row.name, row.category, row.description, row.daily_rate,
      row.hourly_rate, row.deposit_amount, row.condition, row.brand, row.model,
      row.is_available, row.requires_deposit, row.delivery_available, row.pickup_only,
      row.location_city, row.location_state, row.image_gallery, row.moderation_hold];
    for (const col of ['capacity_value', 'capacity_unit', 'weight_kg', 'size_length_cm',
      'size_width_cm', 'size_height_cm', 'location_lat', 'location_lng',
      'pickup_window_start', 'pickup_window_end',
      'return_window_start', 'return_window_end', 'cleaning_instructions']) {
      if (row[col] !== undefined) {
        cols.push(col);
        vals.push(row[col]);
      }
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function insertBooking(toolId, customerId, ownerId, startDate, endDate, status = 'pending', extra = {}) {
    const cols = ['tool_id', 'customer_id', 'owner_id', 'start_date', 'end_date', 'total_price', 'status'];
    const vals = [toolId, customerId, ownerId, startDate, endDate, 36, status];
    for (const [col, value] of Object.entries(extra)) {
      cols.push(col);
      vals.push(value);
    }
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals_bookings (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function createBookingViaApi(renterId, toolId, startDate, endDate, extra = {}) {
    return request(app)
      .post('/api/tool-rentals/bookings')
      .set('x-test-user', renterId)
      .send({
        toolId, startDate, endDate, renterAgreementAccepted: true, ...extra,
      });
  }

  async function paidBooking({ withReturnTime = null } = {}) {
    const owner = await addUser();
    const renter = await addUser();
    await grantToolOwner(owner);
    const tool = await insertTool(owner, {
      name: 'Return drill',
      return_window_start: '09:00',
      return_window_end: '17:00',
    });
    const extra = withReturnTime ? { return_time: withReturnTime } : {};
    const booking = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'payment_confirmed', extra);
    return { owner, renter, tool, booking };
  }

  describe('576: return schedule', () => {
    const createTool = (user, body) => request(app)
      .post('/api/tool-rentals')
      .set('x-test-user', user)
      .send({
        name: 'Generator',
        category: 'Generators & Power',
        description: 'Portable generator.',
        daily_rate: 45,
        location_city: 'Austin',
        location_state: 'TX',
        owner_attestation_accepted: true,
        ...body,
      });

    test('owner sets a return window on the listing; a bad window is refused', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const res = await createTool(owner, { return_window_start: '09:00', return_window_end: '17:00' }).expect(201);
      expect(String(res.body.tool.return_window_start).slice(0, 5)).toBe('09:00');
      expect(String(res.body.tool.return_window_end).slice(0, 5)).toBe('17:00');
      await createTool(owner, { return_window_start: '09:00' }).expect(400);
      await createTool(owner, { return_window_start: '17:00', return_window_end: '09:00' }).expect(400);
      await createTool(owner, { return_window_start: '9:30', return_window_end: '17:00' }).expect(400);
      const bad = await createTool(owner, { return_window_start: '09:00' }).expect(400);
      expect(bad.body.code).toBe('validation_failed');
    });

    test('browse returns the return window for the booking flow', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, {
        name: 'Return window drill', return_window_start: '08:00', return_window_end: '12:00',
      });
      const res = await request(app).get('/api/tool-rentals/browse').query({ name: 'Return window drill' }).expect(200);
      const found = res.body.tools.find((t) => t.id === tool.id);
      expect(String(found.return_window_start).slice(0, 5)).toBe('08:00');
      expect(String(found.return_window_end).slice(0, 5)).toBe('12:00');
    });

    test('renter picks a return time inside the window; it is stored and frozen in the snapshot', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, {
        name: 'Slot drill', return_window_start: '09:00', return_window_end: '17:00',
      });
      const res = await createBookingViaApi(renter, tool.id, '2026-12-10', '2026-12-12', { returnTime: '16:30' });
      expect(res.status).toBe(201);
      expect(String(res.body.return_time).slice(0, 5)).toBe('16:30');
      expect(res.body.agreement_snapshot.rental.returnTime).toBe('16:30');
      // Both booking lists show the slot, and the receipt does too.
      const mine = await request(app).get('/api/tool-rentals/bookings/my').set('x-test-user', renter).expect(200);
      expect(String(mine.body.find((b) => b.id === res.body.id).return_time).slice(0, 5)).toBe('16:30');
      const receipt = await request(app)
        .get(`/api/tool-rentals/bookings/${res.body.id}/receipt`)
        .set('x-test-user', renter)
        .expect(200);
      expect(String(receipt.body.booking.return_time).slice(0, 5)).toBe('16:30');
    });

    test('a return time outside the window or a bad time is refused', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, {
        name: 'Strict return drill', return_window_start: '09:00', return_window_end: '17:00',
      });
      const outside = await createBookingViaApi(renter, tool.id, '2026-12-10', '2026-12-12', { returnTime: '08:30' });
      expect(outside.status).toBe(400);
      expect(outside.body.code).toBe('validation_failed');
      const late = await createBookingViaApi(renter, tool.id, '2026-12-10', '2026-12-12', { returnTime: '17:30' });
      expect(late.status).toBe(400);
      const badFormat = await createBookingViaApi(renter, tool.id, '2026-12-10', '2026-12-12', { returnTime: '4:30pm' });
      expect(badFormat.status).toBe(400);
    });

    test('no window means any return time works; no time means no slot', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Open return drill' });
      const withTime = await createBookingViaApi(renter, tool.id, '2026-12-10', '2026-12-12', { returnTime: '07:00' });
      expect(withTime.status).toBe(201);
      expect(String(withTime.body.return_time).slice(0, 5)).toBe('07:00');
      const withoutTime = await createBookingViaApi(renter, tool.id, '2026-12-13', '2026-12-15');
      expect(withoutTime.status).toBe(201);
      expect(withoutTime.body.return_time).toBeNull();
    });

    test('renter proposes a new return date; owner approves and the date moves with no charge change', async () => {
      const { owner, renter, booking } = await paidBooking({ withReturnTime: '16:00' });
      const proposed = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-14', proposedTime: '10:00' })
        .expect(200);
      expect(proposed.body.return_reschedule_status).toBe('proposed');
      expect(String(proposed.body.return_reschedule_proposed_end_date)).toContain('2026-12-14');
      expect(String(proposed.body.return_reschedule_proposed_time).slice(0, 5)).toBe('10:00');
      // A second proposal while one is pending is refused.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-15' })
        .expect(409);
      // The owner approves: end_date moves, return_time applies, and the
      // total price does not change (no-charge reschedule, D-257).
      const approved = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', owner)
        .expect(200);
      expect(approved.body.return_reschedule_status).toBe('approved');
      expect(String(approved.body.end_date)).toContain('2026-12-14');
      expect(String(approved.body.return_time).slice(0, 5)).toBe('10:00');
      expect(Number(approved.body.total_price)).toBe(36);
      expect(approved.body.return_reschedule_decided_at).toBeTruthy();
    });

    test('owner declines a proposed return date with a reason; the date does not move', async () => {
      const { owner, renter, booking } = await paidBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-14' })
        .expect(200);
      const declined = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/decline`)
        .set('x-test-user', owner)
        .send({ reason: 'I need the tool back that day for another job.' })
        .expect(200);
      expect(declined.body.return_reschedule_status).toBe('declined');
      expect(declined.body.return_reschedule_reason).toBe('I need the tool back that day for another job.');
      expect(String(declined.body.end_date)).toContain('2026-12-12');
      // Declining again is refused, and declining without a reason is too.
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/decline`)
        .set('x-test-user', owner)
        .send({ reason: 'Again.' })
        .expect(409);
    });

    test('only the renter proposes and only the owner decides; strangers get 404', async () => {
      const { owner, renter, booking } = await paidBooking();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', owner)
        .send({ proposedEndDate: '2026-12-14' })
        .expect(403);
      const stranger = await addUser();
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', stranger)
        .send({ proposedEndDate: '2026-12-14' })
        .expect(404);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-14' })
        .expect(200);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', renter)
        .expect(403);
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', stranger)
        .expect(404);
    });

    test('reschedule needs payment_confirmed and a return date after pickup', async () => {
      const owner = await addUser();
      const renter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Early reschedule drill' });
      const pending = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'pending');
      const early = await request(app)
        .post(`/api/tool-rentals/bookings/${pending.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-14' });
      expect(early.status).toBe(409);
      expect(early.body.code).toBe('state_conflict');

      const paid = await paidBooking();
      const sameDay = await request(app)
        .post(`/api/tool-rentals/bookings/${paid.booking.id}/return-reschedule`)
        .set('x-test-user', paid.renter)
        .send({ proposedEndDate: '2026-12-10' });
      expect(sameDay.status).toBe(400);
      expect(sameDay.body.code).toBe('validation_failed');
    });

    test('approval is refused when the new return date overlaps another booking', async () => {
      const owner = await addUser();
      const renter = await addUser();
      const otherRenter = await addUser();
      await grantToolOwner(owner);
      const tool = await insertTool(owner, { name: 'Overlap drill' });
      const booking = await insertBooking(tool.id, renter, owner, '2026-12-10', '2026-12-12', 'payment_confirmed');
      // Another live booking starts the day after the current return.
      await insertBooking(tool.id, otherRenter, owner, '2026-12-13', '2026-12-15', 'payment_confirmed');
      await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule`)
        .set('x-test-user', renter)
        .send({ proposedEndDate: '2026-12-14' })
        .expect(200);
      const blocked = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/approve`)
        .set('x-test-user', owner);
      expect(blocked.status).toBe(409);
      expect(blocked.body.code).toBe('conflict');
      // The proposal is still waiting, so the owner can decline it.
      const declined = await request(app)
        .post(`/api/tool-rentals/bookings/${booking.id}/return-reschedule/decline`)
        .set('x-test-user', owner)
        .send({ reason: 'Another booking starts then.' })
        .expect(200);
      expect(declined.body.return_reschedule_status).toBe('declined');
    });
  });

});
