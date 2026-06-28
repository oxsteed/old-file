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

const categoriesById = new Map(BUSINESS_CATEGORIES.map((category) => [category.id, category]));
const subtypeIndex = new Map(
  BUSINESS_CATEGORIES.flatMap((category) => (
    category.subtypes.map((subtype) => [subtype.toLowerCase(), category])
  ))
);

function listBusinessCategories() {
  return BUSINESS_CATEGORIES;
}

function normalizeBusinessCategory({ industryCategory, businessMode, businessType } = {}) {
  const requestedCategory = String(industryCategory || '').trim().toLowerCase();
  const subtype = String(businessType || '').trim();
  const inferredCategory = subtype ? subtypeIndex.get(subtype.toLowerCase()) : null;
  const category = requestedCategory ? categoriesById.get(requestedCategory) : inferredCategory;

  if (requestedCategory && !category) {
    return {
      error: `Unsupported business category: ${industryCategory}`,
      industryCategory: null,
      businessMode: null,
      businessType: subtype || null,
    };
  }

  return {
    error: null,
    industryCategory: category?.id || null,
    businessMode: String(businessMode || category?.business_mode || '').trim() || null,
    businessType: subtype || null,
  };
}

module.exports = {
  listBusinessCategories,
  normalizeBusinessCategory,
};
