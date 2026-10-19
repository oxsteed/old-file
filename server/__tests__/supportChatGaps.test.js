'use strict';

/**
 * Covers the AI support-chat gap fixes that are unit-testable without a DB:
 * - launch visibility shape (gap #4)
 * - snapshot formatting omits missing sections, never invents values (gaps #1, #9)
 * - thread memory degrades gracefully without Redis (gap #5)
 */

const { getLaunchVisibility } = require('../middleware/launchGate');
const { formatSnapshotForAI } = require('../services/supportAccountSnapshot');
const supportChatThreads = require('../services/supportChatThreads');

describe('support chat gap fixes', () => {
  test('getLaunchVisibility returns a boolean map of product flags', () => {
    const vis = getLaunchVisibility();
    expect(vis).toEqual(
      expect.objectContaining({
        templates: expect.any(Boolean),
        productMarketplace: expect.any(Boolean),
        oxsteedMedia: expect.any(Boolean),
        affiliate: expect.any(Boolean),
        logisticsPayments: expect.any(Boolean),
      })
    );
  });

  test('formatSnapshotForAI cites values and omits missing sections', () => {
    const out = formatSnapshotForAI({
      credit: { balance: '$12.50', currency: 'USD' },
      latestPayout: null,
      openDisputes: 2,
      activeJobs: 0,
      openTickets: null,
    });
    expect(out).toContain('$12.50');
    expect(out).toContain('Open disputes: 2');
    expect(out).toContain('Active jobs as customer: 0');
    expect(out).not.toContain('payout');
    expect(out).not.toContain('support tickets');
  });

  test('formatSnapshotForAI returns empty string when nothing is known', () => {
    expect(formatSnapshotForAI(null)).toBe('');
    expect(
      formatSnapshotForAI({ credit: null, latestPayout: null, openDisputes: null, activeJobs: null, openTickets: null })
    ).toBe('');
  });

  test('support thread memory degrades gracefully without Redis', async () => {
    // REDIS_URL is unset in the test env, so the client is null.
    await expect(supportChatThreads.getSupportThread('some-user-id')).resolves.toEqual([]);
    await expect(
      supportChatThreads.appendSupportThread('some-user-id', 'hello', 'hi there')
    ).resolves.toBeUndefined();
  });
});
