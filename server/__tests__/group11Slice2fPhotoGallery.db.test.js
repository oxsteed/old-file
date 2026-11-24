'use strict';

// Group 11 Slice 2f acceptance: Item photo gallery (559).
// Runs against a dedicated fresh database (credit_statement_test_g11f) so
// slice-local fixtures never pollute the shared credit_statement_test DB.
//
// 559: multi-photo gallery management for a tool listing — owner adds /
//   removes / reorders photos through the gallery endpoints (same upload
//   path as the single listing image: uploadFile/getPublicUrl, data-URL
//   fallback when no storage is configured); the first photo is the cover
//   (image_url); browse / public / owner rows carry the full
//   image_gallery; a single image uploaded on PUT becomes the new cover
//   instead of replacing the gallery (D-290).

jest.unmock('pg');
jest.unmock('../db');
jest.unmock('../utils/transaction');

const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');

const dbUrl = process.env.GROUP11_SLICE2F_TEST_DATABASE_URL;
if (dbUrl) {
  const url = new URL(dbUrl);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/credit_statement_test_g11f') {
    throw new Error('Group 11 Slice 2f DB tests require the loopback credit_statement_test_g11f database');
  }
  process.env.DATABASE_URL = dbUrl;
}

const mockRoles = new Map();
jest.mock('../middleware/auth', () => {
  const authenticate = (req, res, next) => {
    const id = req.get('x-test-user');
    if (!id) return res.sendStatus(401);
    req.user = {
      id,
      role: mockRoles.get(id) || 'customer',
      email: req.get('x-test-email') || `g11f-${id}@example.invalid`,
      email_verified: !req.get('x-test-unverified'),
    };
    return next();
  };
  return { authenticate, authenticateIfPresent: (req, res, next) => (
    req.get('x-test-user') ? authenticate(req, res, next) : next()
  ) };
});
jest.mock('../middleware/adminAuth', () => ({
  ...jest.requireActual('../middleware/adminAuth'),
  requireAdmin: (req, res, next) => {
    if (req.user?.role !== 'super_admin') return res.sendStatus(403);
    req.isSuper = true;
    return next();
  },
}));
jest.mock('../utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
  sendEmailOrThrow: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  sendNotification: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/bookingEmailService', () => ({
  sendBookingConfirmation: jest.fn(),
  sendBookingApproved: jest.fn(),
  sendBookingDeclined: jest.fn(),
}));
jest.mock('../growth/emit', () => ({
  emitDomainEvent: jest.fn().mockResolvedValue(undefined),
  commerceEventProps: (value) => value,
}));
jest.mock('../utils/invoiceEmail', () => ({
  sendInvoiceEmail: jest.fn().mockResolvedValue({ success: true }),
}));
// Upload validation (malware scan + EXIF strip) is exercised in
// fileScanUpload.test.js; acceptance here uses the passthrough, the same
// pattern as group10SliceE. Multer's own file filter still applies.
jest.mock('../middleware/validateFileUpload', () => (req, res, next) => next());

const describeDb = dbUrl ? describe : describe.skip;

// Minimal 1x1 PNG (valid magic bytes for the upload validator).
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describeDb('Group 11 Slice 2f: Item photo gallery (559)', () => {
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
      [id, `g11f-${id}@example.invalid`, role, role === 'super_admin' ? 'admin' : 'customer',
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
      image_gallery: ['https://example.invalid/drill-cover.jpg'],
      moderation_hold: false,
      accessories: JSON.stringify([{ name: 'Battery', quantity: 2 }]),
      condition_checklist: JSON.stringify(['Blade guard intact']),
      ...overrides,
    };
    const cols = ['user_id', 'name', 'category', 'description', 'daily_rate', 'hourly_rate',
      'deposit_amount', 'condition', 'brand', 'model', 'is_available', 'requires_deposit',
      'delivery_available', 'pickup_only', 'location_city', 'location_state',
      'image_gallery', 'moderation_hold', 'accessories', 'condition_checklist'];
    const vals = [ownerId, row.name, row.category, row.description, row.daily_rate,
      row.hourly_rate, row.deposit_amount, row.condition, row.brand, row.model,
      row.is_available, row.requires_deposit, row.delivery_available, row.pickup_only,
      row.location_city, row.location_state, row.image_gallery, row.moderation_hold,
      row.accessories, row.condition_checklist];
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await db.query(
      `INSERT INTO tool_rentals (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      vals,
    );
    return rows[0];
  }

  async function makeTool(overrides = {}) {
    const owner = await addUser();
    await grantToolOwner(owner);
    const tool = await insertTool(owner, overrides);
    return { owner, tool };
  }

  // An uploaded photo comes back as a storage public URL when storage is
  // configured, or as a data URL on the unconfigured fallback (D-281).
  function isStoredPhotoUrl(url) {
    return typeof url === 'string'
      && (url.startsWith('data:image/') || url.includes('/api/storage/public/tool-rentals/'));
  }

  function addPhotos(userId, toolId, count, filename = 'photo.png') {
    const req = request(app).post(`/api/tool-rentals/${toolId}/gallery`).set('x-test-user', userId);
    for (let i = 0; i < count; i += 1) req.attach('images', PNG_1X1, `${i}-${filename}`);
    return req;
  }

  describe('559: add photos', () => {
    test('owner adds photos; gallery grows, cover stays first; browse/public/me carry the full gallery', async () => {
      const { owner, tool } = await makeTool();
      const added = await addPhotos(owner, tool.id, 2).expect(201);
      expect(added.body.image_gallery).toHaveLength(3);
      expect(added.body.image_gallery[0]).toBe('https://example.invalid/drill-cover.jpg');
      expect(added.body.image_url).toBe('https://example.invalid/drill-cover.jpg');
      expect(added.body.image_gallery.slice(1).every((url) => isStoredPhotoUrl(url))).toBe(true);

      const mine = await request(app).get('/api/tool-rentals/me').set('x-test-user', owner).expect(200);
      const mineRow = mine.body.tools.find((t) => t.id === tool.id);
      expect(mineRow.image_gallery).toHaveLength(3);
      expect(mineRow.image_url).toBe('https://example.invalid/drill-cover.jpg');

      const browse = await request(app).get('/api/tool-rentals/browse').expect(200);
      const browseRow = browse.body.tools.find((t) => t.id === tool.id);
      expect(browseRow.image_gallery).toHaveLength(3);
      expect(browseRow.image_url).toBe('https://example.invalid/drill-cover.jpg');

      const pub = await request(app).get(`/api/tool-rentals/public/${tool.id}`).expect(200);
      expect(pub.body.tool.image_gallery).toHaveLength(3);
      expect(pub.body.tool.image_url).toBe('https://example.invalid/drill-cover.jpg');
    });

    test('stranger and non-owner get 404; no photos and a non-image are 400', async () => {
      const { owner, tool } = await makeTool();
      const stranger = await addUser();
      await addPhotos(stranger, tool.id, 1).expect(404);
      await addPhotos(owner, tool.id, 0).expect(400);
      await request(app)
        .post(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .attach('images', Buffer.from('not an image', 'utf8'), 'notes.txt')
        .expect(400);
      const { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].image_gallery).toHaveLength(1);
    });

    test('gallery caps at 8 photos', async () => {
      const { owner, tool } = await makeTool({ image_gallery: [] });
      await addPhotos(owner, tool.id, 8).expect(201);
      const over = await addPhotos(owner, tool.id, 1).expect(400);
      expect(over.body.code).toBe('gallery_full');
      const { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].image_gallery).toHaveLength(8);
    });

    test('create with a single image seeds a one-photo gallery, then more photos append', async () => {
      const owner = await addUser();
      await grantToolOwner(owner);
      const created = await request(app)
        .post('/api/tool-rentals')
        .set('x-test-user', owner)
        .field('name', 'Pressure washer')
        .field('category', 'Cleaning Equipment')
        .field('daily_rate', '25')
        .field('location_city', 'Austin')
        .field('owner_attestation_accepted', 'true')
        .attach('image', PNG_1X1, 'washer.png')
        .expect(201);
      const createdId = created.body.tool.id;
      const { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [createdId]);
      expect(rows[0].image_gallery).toHaveLength(1);
      const added = await addPhotos(owner, createdId, 1).expect(201);
      expect(added.body.image_gallery).toHaveLength(2);
      expect(added.body.image_url).toBe(rows[0].image_gallery[0]);
    });
  });

  describe('559: reorder / set cover', () => {
    test('reorder moves the cover; a stranger gets 404; foreign, duplicate and oversize orders are 400', async () => {
      const { owner, tool } = await makeTool({
        image_gallery: [
          'https://example.invalid/a.jpg',
          'https://example.invalid/b.jpg',
          'https://example.invalid/c.jpg',
        ],
      });
      const reordered = await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .send({ image_gallery: ['https://example.invalid/b.jpg', 'https://example.invalid/a.jpg', 'https://example.invalid/c.jpg'] })
        .expect(200);
      expect(reordered.body.image_gallery[0]).toBe('https://example.invalid/b.jpg');
      expect(reordered.body.image_url).toBe('https://example.invalid/b.jpg');

      const stranger = await addUser();
      await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', stranger)
        .send({ image_gallery: ['https://example.invalid/a.jpg'] })
        .expect(404);
      // A URL never uploaded to this gallery cannot be injected by reorder.
      await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .send({ image_gallery: ['https://example.invalid/b.jpg', 'https://example.invalid/evil.jpg'] })
        .expect(400);
      await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .send({ image_gallery: ['https://example.invalid/b.jpg', 'https://example.invalid/b.jpg'] })
        .expect(400);
      await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .send({ image_gallery: 'https://example.invalid/b.jpg' })
        .expect(400);

      const { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].image_gallery[0]).toBe('https://example.invalid/b.jpg');
    });

    test('an empty reorder clears the gallery', async () => {
      const { owner, tool } = await makeTool();
      const cleared = await request(app)
        .put(`/api/tool-rentals/${tool.id}/gallery`)
        .set('x-test-user', owner)
        .send({ image_gallery: [] })
        .expect(200);
      expect(cleared.body.image_gallery).toEqual([]);
      expect(cleared.body.image_url).toBeNull();
    });
  });

  describe('559: remove a photo', () => {
    test('removing the cover promotes the next photo; out-of-range index is 404; non-owner is 404', async () => {
      const { owner, tool } = await makeTool({
        image_gallery: [
          'https://example.invalid/a.jpg',
          'https://example.invalid/b.jpg',
        ],
      });
      const removed = await request(app)
        .delete(`/api/tool-rentals/${tool.id}/gallery/0`)
        .set('x-test-user', owner)
        .expect(200);
      expect(removed.body.image_gallery).toEqual(['https://example.invalid/b.jpg']);
      expect(removed.body.image_url).toBe('https://example.invalid/b.jpg');

      await request(app)
        .delete(`/api/tool-rentals/${tool.id}/gallery/5`)
        .set('x-test-user', owner)
        .expect(404);
      const stranger = await addUser();
      await request(app)
        .delete(`/api/tool-rentals/${tool.id}/gallery/0`)
        .set('x-test-user', stranger)
        .expect(404);
    });
  });

  describe('559: single-image edit becomes the new cover', () => {
    test('PUT with a new image prepends it and keeps the existing photos; remove_image still clears', async () => {
      const { owner, tool } = await makeTool({
        image_gallery: [
          'https://example.invalid/a.jpg',
          'https://example.invalid/b.jpg',
        ],
      });
      await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .attach('image', PNG_1X1, 'new-cover.png')
        .expect(200);
      let { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].image_gallery).toHaveLength(3);
      expect(isStoredPhotoUrl(rows[0].image_gallery[0])).toBe(true);
      expect(rows[0].image_gallery.slice(1)).toEqual([
        'https://example.invalid/a.jpg',
        'https://example.invalid/b.jpg',
      ]);

      await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .field('remove_image', 'true')
        .expect(200);
      ({ rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]));
      expect(rows[0].image_gallery).toEqual([]);
    });

    test('PUT without an image leaves the gallery untouched', async () => {
      const { owner, tool } = await makeTool({
        image_gallery: [
          'https://example.invalid/a.jpg',
          'https://example.invalid/b.jpg',
        ],
      });
      await request(app)
        .put(`/api/tool-rentals/${tool.id}`)
        .set('x-test-user', owner)
        .send({ daily_rate: 22 })
        .expect(200);
      const { rows } = await db.query('SELECT image_gallery FROM tool_rentals WHERE id = $1', [tool.id]);
      expect(rows[0].image_gallery).toEqual([
        'https://example.invalid/a.jpg',
        'https://example.invalid/b.jpg',
      ]);
    });
  });
});
