/**
 * Query Performance Test Suite
 *
 * Baseline thresholds (in milliseconds):
 * - Single row queries: 50ms
 * - List/aggregate queries: 100ms
 * - Complex joins: 200ms
 * - Full text search: 300ms
 */

const { pool } = require('../db');
const logger = require('../utils/logger');

const BASELINES = {
  single: 50,      // Single row SELECT
  list: 100,       // SELECT * with pagination
  aggregate: 100,  // COUNT, SUM, AVG
  complex: 200,    // Joins with 3+ tables
  search: 300,     // Full text search
};

describe('Query Performance Tests', () => {
  let client;

  beforeAll(async () => {
    client = await pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
  });

  describe('Single Row Queries', () => {
    it('should fetch user by ID in < 50ms', async () => {
      const start = Date.now();
      await client.query('SELECT * FROM users WHERE id = $1', [1]);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.single);
      logPerformance('users by ID', duration, BASELINES.single);
    });

    it('should fetch job by ID in < 50ms', async () => {
      const start = Date.now();
      await client.query('SELECT * FROM jobs WHERE id = $1', [1]);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.single);
      logPerformance('job by ID', duration, BASELINES.single);
    });
  });

  describe('List Queries', () => {
    it('should fetch user list with pagination in < 100ms', async () => {
      const start = Date.now();
      await client.query('SELECT id, email, role FROM users LIMIT 50 OFFSET 0');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.list);
      logPerformance('user list', duration, BASELINES.list);
    });

    it('should fetch job list by state in < 100ms', async () => {
      const start = Date.now();
      await client.query('SELECT * FROM jobs WHERE state = $1 LIMIT 50', ['open']);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.list);
      logPerformance('job list by state', duration, BASELINES.list);
    });
  });

  describe('Aggregate Queries', () => {
    it('should count jobs in < 100ms', async () => {
      const start = Date.now();
      await client.query('SELECT COUNT(*) FROM jobs');
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.aggregate);
      logPerformance('job count', duration, BASELINES.aggregate);
    });

    it('should calculate revenue by month in < 100ms', async () => {
      const start = Date.now();
      await client.query(`
        SELECT DATE_TRUNC('month', created_at) AS month, SUM(total_cents) AS revenue
        FROM payments
        WHERE status = 'captured'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY month DESC
      `);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.aggregate);
      logPerformance('revenue by month', duration, BASELINES.aggregate);
    });
  });

  describe('Complex Join Queries', () => {
    it('should fetch conversations with metadata in < 200ms', async () => {
      const start = Date.now();
      await client.query(`
        SELECT
          c.id, c.customer_id, c.helper_id, c.job_id,
          u.email, u.first_name,
          j.title,
          COUNT(m.id) FILTER (WHERE NOT m.is_read) AS unread_count
        FROM conversations c
        LEFT JOIN users u ON c.helper_id = u.id
        LEFT JOIN jobs j ON c.job_id = j.id
        LEFT JOIN messages m ON c.id = m.conversation_id
        LIMIT 20
        GROUP BY c.id, u.id, j.id
      `);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.complex);
      logPerformance('conversations with metadata', duration, BASELINES.complex);
    });

    it('should fetch jobs with bids and reviews in < 200ms', async () => {
      const start = Date.now();
      await client.query(`
        SELECT
          j.id, j.title, j.status,
          COUNT(DISTINCT b.id) AS bid_count,
          COUNT(DISTINCT r.id) AS review_count,
          AVG(r.rating) AS avg_rating
        FROM jobs j
        LEFT JOIN bids b ON j.id = b.job_id
        LEFT JOIN reviews r ON j.id = r.job_id
        WHERE j.status IN ('open', 'assigned')
        GROUP BY j.id
        LIMIT 30
      `);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(BASELINES.complex);
      logPerformance('jobs with bids and reviews', duration, BASELINES.complex);
    });
  });

  describe('Index Effectiveness', () => {
    it('should verify job state index is being used', async () => {
      const { rows } = await client.query(`
        EXPLAIN (FORMAT JSON)
        SELECT * FROM jobs WHERE state = $1 LIMIT 10
      `, ['open']);

      const plan = rows[0][0];
      const usesIndex = JSON.stringify(plan).toLowerCase().includes('index');

      expect(usesIndex).toBe(true);
      console.log('✓ Job state index is being used');
    });

    it('should verify user email index is being used', async () => {
      const { rows } = await client.query(`
        EXPLAIN (FORMAT JSON)
        SELECT * FROM users WHERE email = $1
      `, ['test@example.com']);

      const plan = rows[0][0];
      const usesIndex = JSON.stringify(plan).toLowerCase().includes('index');

      expect(usesIndex).toBe(true);
      console.log('✓ User email index is being used');
    });
  });
});

function logPerformance(query, actual, baseline) {
  const status = actual < baseline ? '✓' : '⚠';
  const pct = Math.round((actual / baseline) * 100);
  logger.info(`${status} [${pct}%] ${query}: ${actual}ms / ${baseline}ms`);
}
