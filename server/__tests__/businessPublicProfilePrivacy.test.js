'use strict';

/**
 * Regression tests for the Oct 7 business privacy audit fixes (GV-5, GV-4):
 * - The PUBLIC business profile payload withholds phone, website, owner_id
 *   and team member names (admin content-preview keeps them).
 * - The public payload carries the show_services/show_faqs/show_policies/
 *   show_gallery/show_hours section flags, defaulting to visible when the
 *   sibling businesses migration has not been applied yet.
 */

const { mockQuery, resetMocks } = require('./setup');
const { getBusinessPublicProfile, getAdminProfilePreview } = require('../controllers/businessController');

const BIZ_ROW = {
  id: 1,
  business_name: 'Acme Services',
  business_type: 'plumbing',
  description: 'We fix pipes.',
  website: 'https://acme.example',
  phone: '+1-555-0100',
  logo_url: 'https://cdn/x/logo.png',
  cover_photo_url: null,
  address_city: 'Springfield',
  address_state: 'IL',
  address_country: 'US',
  is_primary: true,
  created_at: '2026-01-01',
  owner_id: 'owner-uuid-1',
  owner_first_name: 'Jane',
  owner_last_name: 'Doe',
  display_name_preference: null,
  primary_business_name: null,
  profile_headline: 'Best pipes',
  service_city: 'Springfield',
  service_state: 'IL',
  service_radius_miles: 25,
  service_lat: null,
  service_lng: null,
  avg_rating: 4.9,
  total_reviews: 12,
  completed_jobs_count: 40,
  is_business_verified: true,
  profile_slug: null,
  stripe_charges_enabled: true,
  stripe_account_status: 'active',
  owner_allow_guest_contact: true,
  active_template: 'default',
  business_kind: 'service',
  business_mode: 'mobile',
  industry_category: 'home_services',
  setup_status: 'active',
};

function makeDispatcher({ flagsRow = { show_services: false, show_faqs: true, show_policies: true, show_gallery: true, show_hours: true }, flagsThrow = false } = {}) {
  return (text, params) => {
    if (text.includes('owner_first_name')) {
      return Promise.resolve({ rows: [{ ...BIZ_ROW }] });
    }
    if (text.includes('SELECT show_services')) {
      if (flagsThrow) return Promise.reject(new Error('column "show_services" does not exist'));
      return Promise.resolve({ rows: [flagsRow] });
    }
    if (text.includes('FROM business_members bm')) {
      return Promise.resolve({
        rows: [
          { role: 'manager', first_name: 'Bob', last_name: 'Smith' },
          { role: 'member', first_name: 'Ann', last_name: 'Lee' },
        ],
      });
    }
    if (text.includes('FROM business_services')
        || text.includes('FROM business_reviews')
        || text.includes('FROM business_gallery')
        || text.includes('FROM business_faqs')
        || text.includes('FROM business_policies')
        || text.includes('FROM business_hours')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

async function getPayload(controller, dispatcherOpts) {
  resetMocks();
  mockQuery.mockImplementation(makeDispatcher(dispatcherOpts));
  const res = mockRes();
  await controller({ params: { id: '1' } }, res);
  expect(res.json).toHaveBeenCalledTimes(1);
  const payload = res.json.mock.calls[0][0];
  // What actually goes over the wire (undefined-valued keys are dropped).
  return JSON.parse(JSON.stringify(payload));
}

describe('getBusinessPublicProfile (public)', () => {
  test('withholds phone, website and owner_id', async () => {
    const payload = await getPayload(getBusinessPublicProfile);
    expect(payload.business).toBeDefined();
    expect('phone' in payload.business).toBe(false);
    expect('website' in payload.business).toBe(false);
    expect('owner_id' in payload.business).toBe(false);
    // Public-safe fields still present
    expect(payload.business.business_name).toBe('Acme Services');
    expect(payload.business.profileUrl).toBe('/businesses/public/1');
  });

  test('team rows carry roles only, no member names', async () => {
    const payload = await getPayload(getBusinessPublicProfile);
    expect(payload.team).toHaveLength(2);
    for (const member of payload.team) {
      expect(Object.keys(member)).toEqual(['role']);
    }
    expect(payload.team.map((m) => m.role)).toEqual(['manager', 'member']);
  });

  test('carries the show_* section flags from the row', async () => {
    const payload = await getPayload(getBusinessPublicProfile);
    expect(payload.business.show_services).toBe(false);
    expect(payload.business.show_faqs).toBe(true);
    expect(payload.business.show_policies).toBe(true);
    expect(payload.business.show_gallery).toBe(true);
    expect(payload.business.show_hours).toBe(true);
  });

  test('defaults show_* to true when the migration columns are absent', async () => {
    const payload = await getPayload(getBusinessPublicProfile, { flagsThrow: true });
    expect(payload.business.show_services).toBe(true);
    expect(payload.business.show_faqs).toBe(true);
    expect(payload.business.show_policies).toBe(true);
    expect(payload.business.show_gallery).toBe(true);
    expect(payload.business.show_hours).toBe(true);
  });
});

describe('getAdminProfilePreview (admin)', () => {
  test('keeps phone, website, owner_id and team names', async () => {
    const payload = await getPayload(getAdminProfilePreview);
    expect(payload.business.phone).toBe('+1-555-0100');
    expect(payload.business.website).toBe('https://acme.example');
    expect(payload.business.owner_id).toBe('owner-uuid-1');
    expect(payload.team[0]).toEqual({ role: 'manager', first_name: 'Bob', last_name: 'Smith' });
  });
});
