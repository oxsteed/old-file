# Transaction Wrapper Guide

## Problem

Multi-step operations in OxSteed can fail partway through, leaving the database in an inconsistent state:

**Example: Payment capture + job completion**
```
1. ✓ Capture payment from Stripe
2. ✗ Update job status (database connection lost)
3. ✗ Send notification (operation already failed)

Result: User charged, job still in "open" status, no notification
```

## Solution

Use explicit `BEGIN...COMMIT...ROLLBACK` transactions to ensure all-or-nothing atomicity.

## Basic Usage

```javascript
const { withTransaction } = require('../utils/transaction');

// Inside a controller
exports.capturePayment = async (req, res) => {
  try {
    const result = await withTransaction(pool, async (client) => {
      // All queries use the transaction client
      
      // Step 1: Charge the customer
      const charge = await client.query(
        'UPDATE payments SET status = $1 WHERE id = $2',
        ['captured', paymentId]
      );
      
      // Step 2: Update job status
      await client.query(
        'UPDATE jobs SET status = $1 WHERE id = $2',
        ['completed', jobId]
      );
      
      // Step 3: Log the action
      await client.query(
        'INSERT INTO audit_log (action, details) VALUES ($1, $2)',
        ['payment_captured', JSON.stringify({ paymentId, jobId })]
      );
      
      return charge;
    }, 'capture_payment_complete_job');
    
    res.json(result);
  } catch (err) {
    logger.error('Payment capture failed', err);
    res.status(500).json({ error: 'Failed to capture payment' });
  }
};
```

## Advanced: Retry on Deadlock

For high-concurrency operations, use `withTransactionRetry` to automatically retry on deadlocks:

```javascript
const { withTransactionRetry } = require('../utils/transaction');

// Automatically retries 3 times with exponential backoff
const result = await withTransactionRetry(
  pool,
  async (client) => {
    // Transaction code here
  },
  'fund_sinking_fund',
  3 // maxRetries
);
```

## Specialized Helpers

Use semantic helpers for common operation types:

### Payment Operations

```javascript
const { withPaymentTransaction } = require('../utils/transaction');

await withPaymentTransaction(pool, async (client) => {
  await client.query('UPDATE payments SET ...');
  await client.query('UPDATE jobs SET ...');
}, 'capture_and_complete');
```

### Subscription Operations

```javascript
const { withSubscriptionTransaction } = require('../utils/transaction');

await withSubscriptionTransaction(pool, async (client) => {
  await client.query('UPDATE subscriptions SET ...');
  await client.query('UPDATE users SET membership_tier = ...');
  await client.query('INSERT INTO audit_log ...');
}, 'upgrade_to_pro');
```

### Job Lifecycle Operations

```javascript
const { withJobTransaction } = require('../utils/transaction');

await withJobTransaction(pool, async (client) => {
  await client.query('UPDATE jobs SET status = ...');
  await client.query('DELETE FROM bids WHERE ...');
  await client.query('INSERT INTO notifications ...');
}, 'complete_job');
```

## Critical Operations to Wrap

**🔴 CRITICAL (must use transactions):**
- Payment capture + job update + notification
- Subscription upgrade/downgrade + tier change + send email
- Job completion + payment release + review eligibility
- Helper deletion + bid cancellation + refunds

**🟡 HIGH PRIORITY (should use transactions):**
- Multi-query operations that affect related tables
- Operations that update two or more tables
- Operations that mix customer-facing data with audit logs

**🟢 MEDIUM PRIORITY (optional but recommended):**
- Single-table updates with complex logic
- Operations with multiple sequential queries

## How It Works

### Success Case
```
1. BEGIN transaction
2. Run operation function
   - All queries execute
   - No commit yet
3. Operation completes successfully
4. COMMIT transaction
5. Return result
```

### Failure Case
```
1. BEGIN transaction
2. Run operation function
   - Query 1 executes
   - Query 2 fails (duplicate key, missing reference, etc.)
3. Exception thrown
4. ROLLBACK automatically called
5. Client connection released
6. Error re-thrown to caller
```

## Error Handling

All errors are logged with context:
- Operation name
- Duration
- Error message

```javascript
// Success log
INFO: Transaction committed { operation: 'capture_payment_complete_job', durationMs: 125 }

// Failure log
ERROR: Transaction rolled back { 
  operation: 'capture_payment_complete_job',
  error: 'duplicate key value violates unique constraint',
  durationMs: 45
}
```

## Deadlock Handling

When multiple transactions compete for locks, PostgreSQL can deadlock. `withTransactionRetry` handles this:

```
Attempt 1: Deadlock (error code 40P01)
  ↓ Wait 50ms
Attempt 2: Deadlock
  ↓ Wait 250ms
Attempt 3: Success!
```

## Performance Considerations

- Transactions hold locks → keep them short
- Don't do API calls inside transactions
- Don't do I/O (S3 uploads) inside transactions
- Move expensive calculations outside the transaction

**BAD:**
```javascript
await withTransaction(pool, async (client) => {
  const file = await uploadToS3(data);  // ✗ Long operation
  await client.query('INSERT INTO files ...');
});
```

**GOOD:**
```javascript
const file = await uploadToS3(data);    // ✓ Outside transaction

await withTransaction(pool, async (client) => {
  await client.query('INSERT INTO files ...');
});
```

## Testing

To test transaction rollback:

```javascript
// Temporarily add a throw to test rollback
await withTransaction(pool, async (client) => {
  await client.query('UPDATE users SET deleted = true WHERE id = 1');
  throw new Error('Test rollback');
  // ^ This line will cause all previous queries to be rolled back
});

// Later verify the user wasn't deleted
const { rows } = await pool.query('SELECT deleted FROM users WHERE id = 1');
console.log(rows[0].deleted); // Should be false
```

## Related Files

- `server/utils/transaction.js` - Transaction wrapper implementation
- Controllers using transactions: (to be updated incrementally)
  - `server/controllers/paymentController.js` (payment capture)
  - `server/controllers/jobController.js` (job completion)
  - `server/controllers/subscriptionController.js` (tier changes)
  - `server/controllers/bidController.js` (bid withdrawal + refund)
