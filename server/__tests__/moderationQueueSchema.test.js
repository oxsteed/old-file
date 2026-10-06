'use strict';

const fs = require('fs');
const path = require('path');

describe('moderation queue schema contract', () => {
  test('jobs exposes durable metadata for admin moderation flags', () => {
    const migration = fs.readFileSync(
      path.join(__dirname, '../migrations/699_jobs_moderation_metadata.sql'),
      'utf8'
    );

    expect(migration).toMatch(
      /ALTER TABLE jobs[\s\S]*ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb/i
    );
    expect(migration).toMatch(/idx_jobs_admin_flagged/);
  });
});
