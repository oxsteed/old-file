'use strict';
// D24 / D-ENG-09: notice email + banner in all 20 languages, with machine
// drafts tracked as needing professional review.
const t = require('../growth/noticeTranslations');

test('every one of the 20 languages has the email subject, body and banner', () => {
  expect(t.LANGUAGES).toHaveLength(20);
  for (const row of t.report()) expect({ lang: row.lang, complete: row.complete }).toEqual({ lang: row.lang, complete: true });
});

test('banner strings keep the {{date}} placeholder in every language', () => {
  for (const lang of t.LANGUAGES) {
    const { banner, email_subject } = t.surfaces(lang);
    expect(banner.changesOn).toContain('{{date}}');
    expect(banner.changedOn).toContain('{{date}}');
    expect(email_subject).toContain('{{date}}');
  }
});

test('only English is the source; no language is claimed as professionally reviewed', () => {
  const rows = t.report();
  expect(rows.find((r) => r.lang === 'en')).toMatchObject({ status: 'source', needs_professional_review: false });
  for (const r of rows.filter((x) => x.lang !== 'en')) {
    expect(r.status).toBe('machine_draft');
    expect(r.needs_professional_review).toBe(true);
  }
  expect(rows.filter((r) => r.rtl).map((r) => r.lang)).toEqual(['ar', 'ur']);
});

test('a review is bound to the exact strings: any edit re-opens it', () => {
  const status = t.loadStatus();
  const de = t.digest('de');
  const reviewed = { ...status, languages: { ...status.languages, de: { status: 'professionally_reviewed', review_ref: 'VENDOR-1', reviewed_digest: de, reviewed_banner_digest: t.bannerDigest('de') } } };
  expect(t.report({ status: reviewed }).find((r) => r.lang === 'de').needs_professional_review).toBe(false);
  const stale = { ...status, languages: { ...status.languages, de: { status: 'professionally_reviewed', review_ref: 'VENDOR-1', reviewed_digest: 'f'.repeat(64) } } };
  expect(t.report({ status: stale }).find((r) => r.lang === 'de')).toMatchObject({ needs_professional_review: true, changed_since_review: true });
  const noRef = { ...status, languages: { ...status.languages, de: { status: 'professionally_reviewed', review_ref: '', reviewed_digest: de, reviewed_banner_digest: t.bannerDigest('de') } } };
  expect(t.report({ status: noRef }).find((r) => r.lang === 'de').needs_professional_review).toBe(true);
});

test('scheduling is blocked and lists the languages still needing review', () => {
  try {
    t.assertReadyToSchedule();
    throw new Error('should have thrown');
  } catch (e) {
    expect(e.code).toBe('notice_translations_need_professional_review');
    expect(e.fields.languages).toHaveLength(19);
    expect(e.fields.languages).not.toContain('en');
  }
});

test('a banner edit after review re-opens it', () => {
  const status = t.loadStatus();
  const edited = { ...status, languages: { ...status.languages, de: { status: 'professionally_reviewed', review_ref: 'VENDOR-1', reviewed_digest: t.digest('de'), reviewed_banner_digest: 'a'.repeat(64) } } };
  expect(t.report({ status: edited }).find((r) => r.lang === 'de').changed_since_review).toBe(true);
});
