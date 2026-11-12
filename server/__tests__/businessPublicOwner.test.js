'use strict';

const { resolvePublicBusinessOwner } = require('../services/businessPublicOwner');

test('public business owner resolution mirrors the onboarding visibility gate', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

  await expect(resolvePublicBusinessOwner('41', db)).resolves.toBeNull();

  const sql = db.query.mock.calls[0][0];
  expect(sql).toMatch(/b\.is_listed = TRUE/);
  expect(sql).toMatch(/b\.setup_status = 'active'/);
  expect(sql).toMatch(/b\.business_kind = 'service'/);
  expect(sql).toMatch(/u\.email_verified = TRUE/);
  expect(sql).toMatch(/u\.onboarding_completed = TRUE/);
});

test('public business owner resolution returns only the live owner tuple', async () => {
  const db = { query: jest.fn().mockResolvedValue({ rows: [{ business_id: 41, owner_id: 'owner-1' }] }) };

  await expect(resolvePublicBusinessOwner('41', db)).resolves.toEqual({ businessId: 41, ownerId: 'owner-1' });
});
