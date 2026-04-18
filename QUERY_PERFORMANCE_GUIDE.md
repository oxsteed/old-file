# Query Performance Testing Guide

## Overview

This guide covers the query performance testing infrastructure used to prevent performance regressions and maintain fast API response times.

## Baseline Thresholds

All queries should complete within these thresholds:

| Query Type | Threshold | Examples |
|---|---|---|
| Single row | 50ms | `SELECT * FROM users WHERE id = $1` |
| List/pagination | 100ms | `SELECT * FROM jobs LIMIT 50` |
| Aggregate | 100ms | `SELECT COUNT(*), SUM() FROM payments` |
| Complex joins | 200ms | 3+ table joins with filters |
| Full text search | 300ms | Fuzzy search queries |

## Running Tests Locally

### Setup

```bash
# Start PostgreSQL
docker run -d \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=oxsteed_test \
  -p 5432:5432 \
  postgres:15-alpine

# Wait for database to be ready
until pg_isready -h localhost -p 5432 -U postgres; do
  echo "Waiting for PostgreSQL..."
  sleep 1
done

# Run migrations
cd server
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oxsteed_test \
node migrate.js

# Run query performance tests
NODE_ENV=test npm test -- __tests__/queryPerformance.test.js
```

### Interpreting Results

```
✓ [45%] users by ID: 22ms / 50ms          ← Passing (well within threshold)
⚠ [95%] job list: 95ms / 100ms            ← Warning (close to threshold)
✗ [105%] complex search: 210ms / 200ms    ← Failing (exceeds threshold)
```

## Adding New Query Tests

### Template

```javascript
it('should [operation] in < [threshold]ms', async () => {
  const start = Date.now();

  await client.query(`
    SELECT ... FROM ...
  `);

  const duration = Date.now() - start;
  expect(duration).toBeLessThan(BASELINES.list);
  logPerformance('query description', duration, BASELINES.list);
});
```

### Example: New Business Hub Query

```javascript
describe('Business Hub Queries', () => {
  it('should fetch business analytics in < 100ms', async () => {
    const start = Date.now();

    const { rows } = await client.query(`
      SELECT
        COUNT(DISTINCT job_id) as jobs_completed,
        COUNT(DISTINCT customer_id) as customers,
        SUM(total_cents) as revenue
      FROM payments
      WHERE business_id = $1 AND status = 'captured'
    `, [1]);

    const duration = Date.now() - start;
    expect(duration).toBeLessThan(BASELINES.aggregate);
    logPerformance('business analytics', duration, BASELINES.aggregate);
  });
});
```

## CI/CD Integration

### GitHub Actions

Query performance tests run automatically on:
- Every pull request touching `server/**` files
- Every push to `main` or `develop` branches

Results are:
1. Logged in the test output
2. Uploaded as artifacts
3. Commented on pull requests with pass/fail summary

### Viewing Results

```bash
# Download artifacts from GitHub Actions
gh run download <run-id> --name performance-results

# Or view in GitHub UI: Actions → Query Performance Tests → View results
```

## Performance Optimization Strategies

### 1. Add Indexes

If a query exceeds its threshold:

```sql
-- Check if index is being used
EXPLAIN (FORMAT JSON)
SELECT * FROM jobs WHERE state = $1;

-- If not using index, create one
CREATE INDEX idx_jobs_state ON jobs(state);
CREATE INDEX idx_conversations_helper_id ON conversations(helper_id);
```

### 2. Optimize Joins

```sql
-- ❌ Bad: Multiple LEFT JOINs
SELECT u.*, COUNT(*), AVG(*), SUM(*)
FROM users u
LEFT JOIN payments p ON u.id = p.user_id
LEFT JOIN reviews r ON u.id = r.reviewer_id
LEFT JOIN jobs j ON u.id = j.assigned_helper_id
GROUP BY u.id;

-- ✅ Good: Subqueries for aggregates
SELECT
  u.*,
  (SELECT COUNT(*) FROM payments WHERE user_id = u.id) as payment_count,
  (SELECT AVG(rating) FROM reviews WHERE reviewer_id = u.id) as avg_rating
FROM users u;
```

### 3. Use Partial Indexes

```sql
-- Only index active records
CREATE INDEX idx_jobs_active ON jobs(id, status)
WHERE status IN ('open', 'assigned');
```

### 4. Pagination

```sql
-- ❌ Bad: No limit
SELECT * FROM jobs;

-- ✅ Good: Limit + offset
SELECT * FROM jobs LIMIT 50 OFFSET 0;
```

## Baseline Adjustment

If a baseline needs to be changed (e.g., new slower query type discovered):

1. Edit `BASELINES` object in `server/__tests__/queryPerformance.test.js`
2. Document the reason in the commit message
3. Get code review approval
4. Update this guide

Example:
```javascript
const BASELINES = {
  single: 50,
  list: 100,
  aggregate: 100,
  complex: 250,    // ← Increased from 200ms due to new multi-business joins
  search: 300,
};
```

## Common Issues

### "Query exceeds threshold"

1. Check if index exists: `\di` in psql
2. Check if index is being used: `EXPLAIN ANALYZE`
3. Add missing index or optimize query
4. Re-run test to verify improvement

### "Test passes locally but fails in CI"

CI databases may be slower. Add 10-20% buffer:
- Local: 45ms → CI might see 50-55ms
- Solution: Set threshold to 60ms instead of 50ms

### "Database is slow"

Ensure PostgreSQL is running with sufficient resources:
- Docker: Set `--memory 2g` limit
- VM: Allocate 2+ GB RAM to DB container

## Related Documentation

- [Database Schema](./server/migrations/)
- [Query Optimization](./docs/QUERY_OPTIMIZATION.md)
- [GitHub Actions Workflow](./github/workflows/query-performance-tests.yml)
