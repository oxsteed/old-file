import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildJobTimeline, JOB_TIMELINE_KEYS } from '../src/utils/jobDetailModel.js';

// G1-A4 (item 16): chronological job status timeline, shaped from the
// timestamps the job payload already carries plus the earliest visible bid.
// Events that have not happened yet are omitted, never fabricated.

const JOB = {
  created_at: '2026-11-01T10:00:00.000Z',
  accepted_at: '2026-11-02T10:00:00.000Z',
  started_at: '2026-11-03T10:00:00.000Z',
  completed_at: '2026-11-04T10:00:00.000Z',
  cancelled_at: null,
};

test('timeline keys cover posted, bid, accepted, started, completed, cancelled', () => {
  assert.deepEqual(Object.keys(JOB_TIMELINE_KEYS), ['posted', 'bidsReceived', 'accepted', 'started', 'completed', 'cancelled']);
  assert.deepEqual(Object.values(JOB_TIMELINE_KEYS), ['timelinePosted', 'timelineBidsReceived', 'timelineAccepted', 'timelineStarted', 'timelineCompleted', 'timelineCancelled']);
});

test('full lifecycle renders chronologically with the earliest bid', () => {
  const bids = [
    { id: 'b2', created_at: '2026-11-01T15:00:00.000Z' },
    { id: 'b1', created_at: '2026-11-01T12:00:00.000Z' },
  ];
  assert.deepEqual(buildJobTimeline(JOB, bids), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
    { key: 'bidsReceived', at: '2026-11-01T12:00:00.000Z', count: 2 },
    { key: 'accepted', at: '2026-11-02T10:00:00.000Z' },
    { key: 'started', at: '2026-11-03T10:00:00.000Z' },
    { key: 'completed', at: '2026-11-04T10:00:00.000Z' },
  ]);
});

test('events that have not happened are omitted, never fabricated', () => {
  assert.deepEqual(buildJobTimeline({ created_at: JOB.created_at }, []), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
  ]);
  assert.deepEqual(buildJobTimeline({ ...JOB, started_at: null, completed_at: null }, []), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
    { key: 'accepted', at: '2026-11-02T10:00:00.000Z' },
  ]);
});

test('cancelled replaces completed and sorts by timestamp, not lifecycle order', () => {
  const job = { ...JOB, completed_at: null, cancelled_at: '2026-11-02T12:00:00.000Z', started_at: null };
  assert.deepEqual(buildJobTimeline(job, []), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
    { key: 'accepted', at: '2026-11-02T10:00:00.000Z' },
    { key: 'cancelled', at: '2026-11-02T12:00:00.000Z' },
  ]);
});

test('invalid timestamps, missing bids and non-object jobs are safe', () => {
  assert.deepEqual(buildJobTimeline({ created_at: 'not-a-date', accepted_at: '' }, [{ created_at: null }]), []);
  assert.deepEqual(buildJobTimeline({ created_at: JOB.created_at }, [{}, { created_at: 'bad' }, null]), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
  ]);
  assert.deepEqual(buildJobTimeline(null, []), []);
  assert.deepEqual(buildJobTimeline('nope', []), []);
  // A bid without a usable timestamp contributes no event and no count.
  assert.deepEqual(buildJobTimeline(JOB, [{ created_at: '2026-11-01T12:00:00.000Z' }, { created_at: 'bad' }]), [
    { key: 'posted', at: '2026-11-01T10:00:00.000Z' },
    { key: 'bidsReceived', at: '2026-11-01T12:00:00.000Z', count: 1 },
    { key: 'accepted', at: '2026-11-02T10:00:00.000Z' },
    { key: 'started', at: '2026-11-03T10:00:00.000Z' },
    { key: 'completed', at: '2026-11-04T10:00:00.000Z' },
  ]);
});

test('JobDetailPage renders the timeline from visible bids with localized labels', async () => {
  const page = await readFile(new URL('../src/pages/JobDetailPage.jsx', import.meta.url), 'utf8');
  assert.ok(page.includes('buildJobTimeline(job, visibleBids)'));
  assert.ok(page.includes("t('jobDetail.timelineHeading')"));
  for (const key of Object.values(JOB_TIMELINE_KEYS)) {
    assert.ok(page.includes(`t('jobDetail.${key}')`), key);
  }
  assert.ok(page.includes('className="jdp-timeline"'));
  assert.ok(page.includes('<time dateTime={event.at}'));
  // The timeline is an addition: revision history and the helper work
  // panel stay where they were.
  assert.ok(page.includes('<JobRevisionHistory'));
  assert.ok(page.includes('HelperWorkPanel') || page.includes('JobWorkRecord'));
  // No owner-only field is read for the timeline: private notes stay out.
  const timelineBlock = page.slice(page.indexOf('const timeline = buildJobTimeline'));
  assert.ok(!timelineBlock.slice(0, 400).includes('private_notes'));
});

test('timeline labels exist in both locale catalogs in every language', async () => {
  for (const language of ['en', 'es', 'fr', 'ht', 'ar']) {
    const legacy = JSON.parse(await readFile(new URL(`../src/locales/${language}.json`, import.meta.url)));
    const common = JSON.parse(await readFile(new URL(`../src/i18n/locales/${language}/common.json`, import.meta.url)));
    for (const key of Object.values(JOB_TIMELINE_KEYS)) {
      assert.ok(legacy.jobDetail[key]?.trim(), `${language} legacy ${key}`);
      assert.ok(common.jobDetail[key]?.trim(), `${language} namespaced ${key}`);
      assert.equal(legacy.jobDetail[key], common.jobDetail[key], `${language} ${key}`);
    }
    assert.ok(legacy.jobDetail.timelineHeading?.trim(), `${language} legacy timelineHeading`);
    assert.equal(legacy.jobDetail.timelineHeading, common.jobDetail.timelineHeading, `${language} timelineHeading`);
  }
});
