'use strict';

const {
  classifyDatabaseError,
  describeDatabaseTarget,
  getDatabaseSslConfig,
  parseDatabaseUrl,
} = require('../utils/databaseConfig');

test('parses PostgreSQL URLs and never includes the password in the target description', () => {
  const url = 'postgresql://oxsteed:p%40ssword@postgres.internal:5433/oxsteed_db?sslmode=require';
  expect(parseDatabaseUrl(url).hostname).toBe('postgres.internal');
  expect(describeDatabaseTarget(url)).toEqual({
    host: 'postgres.internal',
    port: '5433',
    database: 'oxsteed_db',
    user: 'oxsteed',
  });
  expect(JSON.stringify(describeDatabaseTarget(url))).not.toContain('password');
});

test('uses one SSL policy for local and production database URLs', () => {
  expect(getDatabaseSslConfig('postgresql://user:pass@postgres/db?sslmode=disable', 'production')).toBe(false);
  expect(getDatabaseSslConfig('postgresql://user:pass@postgres/db', 'production')).toEqual({ rejectUnauthorized: false });
  expect(getDatabaseSslConfig('postgresql://user:pass@localhost/db', 'test')).toBe(false);
});

test('classifies password authentication failures with a safe Coolify hint', () => {
  const result = classifyDatabaseError({ code: '28P01', message: 'password authentication failed for user "oxsteed"' });
  expect(result.category).toBe('authentication');
  expect(result.hint).toContain('DATABASE_URL');
  expect(result.hint).not.toContain('p%40ssword');
});

test('classifies database network failures', () => {
  expect(classifyDatabaseError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }).category).toBe('connection_refused');
  expect(classifyDatabaseError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND postgres' }).category).toBe('host_not_found');
});
