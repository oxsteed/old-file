'use strict';

// R-6 (PR #804 Track C): the moderation-flags queue and the escrow
// endpoint had no UI caller. These are wiring assertions (same pattern as
// adminAuditBundleE.test.js): the admin pages must call the endpoints,
// and every key they render must exist in all five locale catalogs.
const fs = require('fs');
const path = require('path');

const CLIENT = path.join(__dirname, '..', '..', 'client', 'src');
const LOCALES = path.join(CLIENT, 'locales');

function read(rel) {
  return fs.readFileSync(path.join(CLIENT, rel), 'utf8');
}

describe('R-6 admin UI wiring', () => {
  test('the Moderation page calls the moderation-flags endpoints', () => {
    const src = read('admin/pages/Moderation.jsx');
    expect(src).toContain("adminApi.get('/admin/moderation-flags'");
    expect(src).toContain("adminApi.post(`/admin/moderation-flags/${flag.id}/review`");
    expect(src).toContain("t('admin.moderationFlagsTab')");
    expect(src).toContain("t('admin.moderationFlagsResolve')");
    expect(src).toContain("t('admin.moderationFlagsDismiss')");
  });

  test('the Invest review queue calls the escrow-confirmation endpoint', () => {
    const src = read('admin/pages/InvestReviewQueue.jsx');
    expect(src).toContain('recordPartnerEscrowConfirmation(');
    expect(src).toContain("t('invest.review.escrow.confirm')");
    expect(src).toContain("t('invest.review.escrow.confirmed')");
    expect(src).toContain('invest_escrow_nothing_pending');
  });

  test('every R-6 key exists in all five locale catalogs', () => {
    const adminKeys = [
      'moderationJobsTab', 'moderationFlagsTab', 'moderationFlagsTitle',
      'moderationFlagsCount', 'moderationFlagsStatus', 'moderationFlagsEmpty',
      'moderationFlagsLoading', 'moderationFlagsReportedBy',
      'moderationFlagsResolve', 'moderationFlagsDismiss',
      'moderationFlagsResolutionLabel', 'moderationFlagsResolutionPlaceholder',
      'moderationFlagsAlreadyDecided', 'moderationFlagsReviewFailed',
      'moderationFlagsPage', 'moderationFlagsPrevious', 'moderationFlagsNext',
    ];
    const escrowKeys = [
      'title', 'copy', 'position', 'choosePosition', 'partnerRefLabel',
      'partnerRefPlaceholder', 'noteLabel', 'confirm', 'confirmed',
      'partnerRefRequired',
    ];
    for (const lang of ['en', 'es', 'fr', 'ht', 'ar']) {
      const catalog = JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
      for (const key of adminKeys) {
        expect(typeof catalog.admin[key]).toBe('string');
      }
      for (const key of escrowKeys) {
        expect(typeof catalog.invest.review.escrow[key]).toBe('string');
      }
      expect(typeof catalog.invest.review.errors.escrowNothingPending).toBe('string');
    }
  });
});
