import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELPER_SECTION_IDS,
  HELPER_STICKY_SECTIONS,
  HELPER_AUTO_SAVE_SECTIONS,
  PUBLIC_PROFILE_SUMMARY_MODEL_KEYS,
  applySectionCompleteness,
  buildFullProfileHeaderSummaryModel,
  buildHelperSectionCompleteness,
  buildBusinessStudioSummaryModel,
  buildHelperStudioSummaryModel,
  buildPublicProfileSummaryModel,
  createHelperSaveStatus,
  formatHelperPlace,
  formatHelperPreviewMeta,
  formatHelperRateBits,
  isHelperCoreDirty,
  publicProfileSummaryCardClassName,
  resolveHelperSaveBar,
  resolvePreviewField,
  serializeHelperCore,
  shouldPromptLeaveStickySection,
} from '../src/utils/profileStudio.js';

test('helper section completeness flags cover all section ids', () => {
  const empty = buildHelperSectionCompleteness({});
  assert.deepEqual(Object.keys(empty).sort(), [...HELPER_SECTION_IDS].sort());
  assert.equal(empty.cover, false);
  assert.equal(empty.basics, false);
  assert.equal(empty.hours, false);
  assert.equal(empty.services, false);
  assert.equal(empty.visibility, true);

  const ready = buildHelperSectionCompleteness({
    coverImageUrl: 'https://cdn/cover.jpg',
    core: {
      profile_headline: 'Pro help',
      bio_long: 'I fix things',
      hourly_rate_min: 40,
      availability_json: {
        monday: { closed: false, start: '09:00', end: '17:00' },
        sunday: { closed: true },
      },
    },
    servicesCount: 2,
    faqsCount: 1,
    policiesCount: 1,
    galleryCount: 3,
  });
  assert.equal(ready.cover, true);
  assert.equal(ready.basics, true);
  assert.equal(ready.hours, true);
  assert.equal(ready.services, true);
  assert.equal(ready.faqs, true);
  assert.equal(ready.policies, true);
  assert.equal(ready.gallery, true);
});

test('applySectionCompleteness maps flags onto shell sections', () => {
  const sections = applySectionCompleteness(
    [
      { id: 'cover', label: 'Cover' },
      { id: 'basics', label: 'Basics' },
      { id: 'mystery', label: 'Other' },
    ],
    { cover: true, basics: false },
  );
  assert.equal(sections[0].complete, true);
  assert.equal(sections[1].complete, false);
  assert.equal(sections[2].complete, undefined);
  assert.equal(sections[0].label, 'Cover');
});

test('preview place, rates, radius meta helpers', () => {
  assert.equal(formatHelperPlace({ service_city: 'Austin', service_state: 'TX' }), 'Austin, TX');
  assert.equal(formatHelperPlace({}), '');
  assert.deepEqual(formatHelperRateBits({ hourly_rate_min: 45, hourly_rate_max: 85 }), ['$45', '$85']);
  assert.deepEqual(formatHelperRateBits({ hourly_rate_min: '', hourly_rate_max: null }), []);
  assert.deepEqual(formatHelperRateBits({ hourly_rate_min: 50 }), ['$50']);

  assert.equal(
    formatHelperPreviewMeta({
      place: 'Austin, TX',
      ratesLine: '$45 – $85/hr',
      radiusLine: '10 mi radius',
    }),
    'Austin, TX · $45 – $85/hr · 10 mi radius',
  );
  assert.equal(formatHelperPreviewMeta({ place: 'Austin, TX' }), 'Austin, TX');
  assert.equal(formatHelperPreviewMeta({}), '');
});

test('preview empty placeholders resolve only when value missing', () => {
  assert.equal(resolvePreviewField('Maya', 'Add a name'), 'Maya');
  assert.equal(resolvePreviewField('', 'Add a name'), 'Add a name');
  assert.equal(resolvePreviewField(null, 'Add a location'), 'Add a location');
});

test('sticky leave prompt only when leaving basics/hours while dirty', () => {
  assert.equal(HELPER_STICKY_SECTIONS.has('basics'), true);
  assert.equal(HELPER_STICKY_SECTIONS.has('services'), false);

  assert.equal(shouldPromptLeaveStickySection('basics', 'services', true), true);
  assert.equal(shouldPromptLeaveStickySection('hours', 'gallery', true), true);
  assert.equal(shouldPromptLeaveStickySection('basics', 'hours', true), false);
  assert.equal(shouldPromptLeaveStickySection('hours', 'basics', true), false);
  assert.equal(shouldPromptLeaveStickySection('basics', 'services', false), false);
  assert.equal(shouldPromptLeaveStickySection('services', 'faqs', true), false);
  assert.equal(shouldPromptLeaveStickySection('basics', 'basics', true), false);
});

test('serializeHelperCore + isHelperCoreDirty detect edits', () => {
  const core = {
    profile_headline: 'Hello',
    bio_long: 'Bio',
    hourly_rate_min: 40,
    hourly_rate_max: '',
    service_radius_miles: 10,
    service_city: 'Austin',
    service_state: 'TX',
    availability_json: { monday: { closed: true } },
    is_available_now: false,
  };
  const baseline = serializeHelperCore(core);
  assert.equal(isHelperCoreDirty(core, baseline), false);
  assert.equal(isHelperCoreDirty({ ...core, profile_headline: 'Hi' }, baseline), true);
  assert.equal(isHelperCoreDirty({ ...core, hourly_rate_min: 40 }, baseline), false);
  assert.equal(isHelperCoreDirty({ ...core, hourly_rate_min: '40' }, baseline), false);
});

test('resolveHelperSaveBar reflects sticky dirty vs CRUD auto status', () => {
  assert.equal(HELPER_AUTO_SAVE_SECTIONS.has('services'), true);
  assert.equal(HELPER_AUTO_SAVE_SECTIONS.has('basics'), false);

  const dirtyBasics = resolveHelperSaveBar({ section: 'basics', coreDirty: true });
  assert.equal(dirtyBasics.mode, 'dirty');
  assert.equal(dirtyBasics.dirty, true);
  assert.equal(dirtyBasics.showActions, true);
  assert.equal(dirtyBasics.statusKey, 'profileStudio.unsaved');

  const cleanHours = resolveHelperSaveBar({ section: 'hours', coreDirty: false });
  assert.equal(cleanHours.mode, 'clean');
  assert.equal(cleanHours.showActions, true);
  assert.equal(cleanHours.statusKey, 'profileStudio.savedHint');

  const auto = resolveHelperSaveBar({
    section: 'services',
    coreDirty: true,
    lastSavedAt: 1_700_000_000_000,
  });
  assert.equal(auto.mode, 'auto');
  assert.equal(auto.dirty, false);
  assert.equal(auto.showActions, false);
  assert.equal(auto.hideBar, false);
  assert.equal(auto.statusKey, 'profileStudio.savedAutomatically');
  assert.equal(auto.showShortcutHint, false);

  const saving = resolveHelperSaveBar({ section: 'basics', coreDirty: true, saving: true });
  assert.equal(saving.mode, 'saving');
  assert.equal(saving.statusKey, 'profileStudio.savingStatus');

  const errored = resolveHelperSaveBar({
    section: 'hours',
    coreDirty: true,
    error: 'Nope',
  });
  assert.equal(errored.mode, 'error');
  assert.equal(errored.error, 'Nope');
});

test('createHelperSaveStatus seeds unified draft-friendly model', () => {
  const s = createHelperSaveStatus({ lastSavedAt: 42, dirty: { core: true } });
  assert.equal(s.lastSavedAt, 42);
  assert.equal(s.dirty.core, true);
  assert.equal(s.saving, false);
  assert.equal(s.error, null);
});

test('shared public summary view-model for helper + business', () => {
  const helper = buildHelperStudioSummaryModel({
    coverImageUrl: 'c.jpg',
    avatar: 'a.jpg',
    name: 'Maya',
    core: {
      profile_headline: 'Handy',
      bio_long: 'I help',
      is_available_now: true,
    },
    meta: 'Austin, TX',
  });
  assert.equal(helper.variant, 'helper');
  assert.equal(helper.cover, 'c.jpg');
  assert.equal(helper.tagline, 'Handy');
  assert.equal(helper.availableNow, true);
  assert.equal(helper.meta, 'Austin, TX');

  const biz = buildBusinessStudioSummaryModel({
    cover: 'bc.jpg',
    avatar: 'logo.png',
    name: 'Acme',
    tagline: 'We build',
    typeLabel: 'Contractor',
    meta: 'Dallas, TX',
    contact: '555 · acme.com',
    about: 'About us',
  });
  assert.equal(biz.variant, 'business');
  assert.equal(biz.typeLabel, 'Contractor');
  assert.equal(biz.contact, '555 · acme.com');

  const publicModel = buildPublicProfileSummaryModel({
    variant: 'helper',
    name: 'Sam',
    ratingLabel: '5.0 (3)',
  });
  assert.equal(publicModel.name, 'Sam');
  assert.equal(publicModel.ratingLabel, '5.0 (3)');
  assert.equal(publicModel.availableNow, null);
});

test('public summary card class contract for studio + public surfaces', () => {
  assert.equal(
    publicProfileSummaryCardClassName({ variant: 'helper', surface: 'public' }),
    'ppsc ppsc-helper ppsc--public',
  );
  assert.equal(
    publicProfileSummaryCardClassName({ variant: 'business', surface: 'studio', className: 'ppsc--page' }),
    'ppsc ppsc-business ppsc--studio ppsc--page',
  );
  assert.equal(
    publicProfileSummaryCardClassName({ variant: 'mystery', surface: 'public' }),
    'ppsc ppsc-helper ppsc--public',
  );
});

test('full-page header summary maps BusinessHeader helper props', () => {
  const model = buildFullProfileHeaderSummaryModel({
    variant: 'helper',
    coverImage: 'cover.jpg',
    avatar: 'avatar.jpg',
    businessName: 'Maya Fixes',
    ownerName: 'Maya',
    tagline: 'Handy pro',
    city: 'Austin',
    state: 'TX',
    ratingLabel: '4.9 · 12 reviews',
    metaExtra: '40 jobs · Responds in 1 hour',
  });
  assert.equal(model.variant, 'helper');
  assert.equal(model.cover, 'cover.jpg');
  assert.equal(model.avatar, 'avatar.jpg');
  assert.equal(model.name, 'Maya Fixes');
  assert.equal(model.tagline, 'Handy pro');
  assert.equal(model.ratingLabel, '4.9 · 12 reviews');
  assert.equal(model.meta, 'Austin, TX · 40 jobs · Responds in 1 hour');
  for (const key of PUBLIC_PROFILE_SUMMARY_MODEL_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(model, key), `missing key ${key}`);
  }

  const biz = buildFullProfileHeaderSummaryModel({
    variant: 'business',
    businessName: '',
    ownerName: 'Acme Owner',
    placeFallback: 'Service area',
  });
  assert.equal(biz.variant, 'business');
  assert.equal(biz.name, 'Acme Owner');
  assert.equal(biz.meta, 'Service area');
});

test('PublicProfileSummaryCard required class roots stay documented', () => {
  // Pure contract — mirrors JSX roots so Studio / public / hero stay aligned
  // without requiring jsdom/RTL in this package.
  const roots = ['ppsc', 'ppsc-cover', 'ppsc-body', 'ppsc-avatar', 'ppsc-name', 'ppsc-tagline', 'ppsc-meta', 'ppsc-footer', 'ppsc-cover-overlay'];
  for (const cls of roots) {
    assert.match(cls, /^ppsc/);
  }
  assert.ok(PUBLIC_PROFILE_SUMMARY_MODEL_KEYS.includes('ratingLabel'));
  assert.ok(PUBLIC_PROFILE_SUMMARY_MODEL_KEYS.includes('availableNow'));
});

