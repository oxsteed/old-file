/**
 * Map a business record (create payload, list row, or editor payload)
 * onto the Business Hub profile form so a just-created draft can render
 * even if profile-edit is still catching up.
 */
export function profileFormFromBusiness(biz = {}) {
  return {
    business_name: biz.business_name || '',
    business_type: biz.business_type || '',
    profile_headline: biz.profile_headline || '',
    description: biz.description || biz.bio_short || '',
    phone: biz.phone || '',
    website: biz.website || '',
    address_street: biz.address_street || '',
    address_city: biz.address_city || '',
    address_state: biz.address_state || '',
    address_zip: biz.address_zip || '',
    address_country: biz.address_country || 'US',
    service_radius_miles: biz.service_radius_miles || '',
    logo_url: biz.logo_url || '',
    cover_photo_url: biz.cover_photo_url || '',
  };
}

export function tagOwnedBusiness(business) {
  if (!business || business.id == null) return null;
  return { ...business, _role: business._role || 'owner' };
}

export function mergeBusinessList(existing = [], incoming = []) {
  const byId = new Map();
  for (const row of incoming) {
    if (row?.id == null) continue;
    byId.set(String(row.id), row);
  }
  for (const row of existing) {
    if (row?.id == null) continue;
    const key = String(row.id);
    if (!byId.has(key)) byId.set(key, row);
  }
  return [...byId.values()];
}

export function isBusinessPubliclyListed(biz) {
  return Boolean(
    biz
    && biz.setup_status === 'active'
    && biz.is_listed !== false
    && biz.is_active !== false
  );
}
