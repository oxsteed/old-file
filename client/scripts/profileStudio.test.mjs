import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELPER_SECTION_IDS,
  HELPER_STICKY_SECTIONS,
  applySectionCompleteness,
  buildHelperSectionCompleteness,
  formatHelperPlace,
  formatHelperPreviewMeta,
  formatHelperRateBits,
  resolvePreviewField,
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
