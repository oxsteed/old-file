'use strict';

const BUSINESS_CATEGORIES = [
  {
    id: 'food',
    title: 'Restaurant & Food',
    icon: 'fork.knife',
    color_key: 'orange',
    tagline: 'Cafes, bakeries, food trucks & more',
    business_mode: 'food',
    subtypes: ['Restaurant', 'Cafe / Coffee Shop', 'Bakery', 'Food Truck', 'Bar & Lounge', 'Catering'],
  },
  {
    id: 'services',
    title: 'Services',
    icon: 'wrench.and.screwdriver.fill',
    color_key: 'blue',
    tagline: 'Cleaning, repairs, skilled trades',
    business_mode: 'services_marketplace',
    subtypes: ['Cleaning', 'Plumbing', 'Electrical', 'Carpentry', 'Landscaping', 'General Repairs'],
  },
  {
    id: 'retail',
    title: 'Retail & Shop',
    icon: 'bag.fill',
    color_key: 'purple',
    tagline: 'Stores, boutiques, online shops',
    business_mode: 'retail',
    subtypes: ['Clothing & Fashion', 'Electronics', 'Grocery', 'Home & Decor', 'Books & Stationery', 'General Retail'],
  },
  {
    id: 'beauty',
    title: 'Beauty & Wellness',
    icon: 'sparkles',
    color_key: 'pink',
    tagline: 'Salons, spas, fitness studios',
    business_mode: 'services_marketplace',
    subtypes: ['Hair Salon', 'Nail Studio', 'Spa & Massage', 'Barbershop', 'Fitness Studio', 'Wellness Coaching'],
  },
  {
    id: 'consulting',
    title: 'Consulting & Pro',
    icon: 'lightbulb.fill',
    color_key: 'green',
    tagline: 'Finance, legal, strategy & coaching',
    business_mode: 'services_marketplace',
    subtypes: ['Financial Consulting', 'Legal Services', 'Business Strategy', 'Marketing & PR', 'IT & Tech', 'Life Coaching'],
  },
  {
    id: 'health',
    title: 'Healthcare',
    icon: 'cross.fill',
    color_key: 'red',
    tagline: 'Clinics, pharmacies, mental health',
    business_mode: 'services_marketplace',
    subtypes: ['Medical Clinic', 'Dental', 'Pharmacy', 'Mental Health', 'Physical Therapy', 'Veterinary'],
  },
  {
    id: 'auto',
    title: 'Auto & Transport',
    icon: 'car.fill',
    color_key: 'indigo',
    tagline: 'Mechanics, transport, auto sales',
    business_mode: 'services_marketplace',
    subtypes: ['Auto Repair', 'Car Wash', 'Auto Sales', 'Transportation & Logistics', 'Driving School', 'Towing'],
  },
];

const BUSINESS_OPERATING_MODELS = [
  {
    id: 'restaurant',
    title: 'Restaurant',
    description: 'Customers browse a menu and place food orders.',
    category_ids: ['food'],
  },
  {
    id: 'service',
    title: 'Service Business',
    description: 'Customers browse services, request work, book appointments, or discover a retail shop in Skills.',
    category_ids: ['services', 'retail', 'beauty', 'consulting', 'health', 'auto'],
  },
];

const categoriesById = new Map(BUSINESS_CATEGORIES.map((category) => [category.id, category]));
const subtypeIndex = new Map(
  BUSINESS_CATEGORIES.flatMap((category) => (
    category.subtypes.map((subtype) => [subtype.toLowerCase(), category])
  ))
);

function listBusinessCategories() {
  return BUSINESS_CATEGORIES;
}

function listBusinessOperatingModels() {
  return BUSINESS_OPERATING_MODELS;
}

function businessKindForCategory(category) {
  return category?.id === 'food' ? 'restaurant' : (category ? 'service' : null);
}

function businessKindForLegacyMode(mode) {
  if (mode === 'food') return 'restaurant';
  if (mode === 'services_marketplace' || mode === 'retail') return 'service';
  return null;
}

function normalizeBusinessCategory({ businessKind, industryCategory, businessMode, businessType } = {}) {
  const requestedKind = String(businessKind || '').trim().toLowerCase();
  const requestedCategory = String(industryCategory || '').trim().toLowerCase();
  const subtype = String(businessType || '').trim();
  const inferredCategory = subtype ? subtypeIndex.get(subtype.toLowerCase()) : null;
  const legacyKind = businessKindForLegacyMode(String(businessMode || '').trim());
  let category = requestedCategory ? categoriesById.get(requestedCategory) : inferredCategory;

  if (!category && requestedKind === 'restaurant') category = categoriesById.get('food');
  if (!category && requestedKind === 'service') category = categoriesById.get('services');

  if (requestedKind && !['restaurant', 'service'].includes(requestedKind)) {
    return {
      error: `Unsupported business operating model: ${businessKind}`,
      businessKind: null,
      industryCategory: null,
      businessMode: null,
      businessType: subtype || null,
    };
  }

  if (requestedCategory && !category) {
    return {
      error: `Unsupported business category: ${industryCategory}`,
      businessKind: null,
      industryCategory: null,
      businessMode: null,
      businessType: subtype || null,
    };
  }


  const derivedKind = businessKindForCategory(category) || requestedKind || legacyKind;
  if (requestedKind && derivedKind && requestedKind !== derivedKind) {
    return {
      error: `Business category ${category?.id || industryCategory} is not valid for ${requestedKind}`,
      businessKind: null,
      industryCategory: null,
      businessMode: null,
      businessType: subtype || null,
    };
  }

  return {
    error: null,
    businessKind: derivedKind || null,
    industryCategory: category?.id || null,
    // business_mode is a compatibility field. The server, not the client,
    // derives it from the selected category.
    businessMode: category?.business_mode || String(businessMode || '').trim() || null,
    businessType: subtype || null,
  };
}

function deriveBusinessCapabilities(business = {}) {
  const kind = business.business_kind
    || businessKindForLegacyMode(business.business_mode)
    || (business.industry_category === 'food' ? 'restaurant' : 'service');
  const restaurant = kind === 'restaurant';
  const service = kind === 'service';

  return {
    restaurant,
    service,
    foodDiscovery: restaurant,
    menu: restaurant,
    foodOrders: restaurant,
    restaurantCredit: restaurant,
    restaurantDevices: restaurant,
    skillsDiscovery: service,
    serviceCatalog: service,
    bookings: service,
    jobRequests: service,
    retailDiscovery: service && business.industry_category === 'retail',
    directPayment: service,
  };
}

function withBusinessCapabilities(business) {
  if (!business) return business;
  return {
    ...business,
    business_kind: business.business_kind
      || businessKindForLegacyMode(business.business_mode)
      || (business.industry_category === 'food' ? 'restaurant' : 'service'),
    capabilities: deriveBusinessCapabilities(business),
  };
}

module.exports = {
  listBusinessCategories,
  listBusinessOperatingModels,
  normalizeBusinessCategory,
  deriveBusinessCapabilities,
  withBusinessCapabilities,
};
