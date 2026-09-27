import { normalizeLaunchDashboardMode } from './launchScope.js';

export const EXPERIENCE_ROLE_STORAGE_PREFIX = 'oxsteed:experience-guide-role:v1:';
export const EXPERIENCE_AREA_KEYS = Object.freeze([
  'food',
  'credit',
  'restaurant-credit',
  'direct',
  'rentals',
  'marketplace',
  'messages',
  'calendar',
  'business',
  'delivery',
  'logistics',
  'support',
  'consulting',
  'get-started',
]);

const BUSINESS_MODES = new Set([
  'business_owner',
  'business_manager',
  'business_representative',
  'business_employee',
]);

const RESTAURANT_MODES = new Set([
  'restaurant_owner',
  'restaurant_manager',
  'restaurant_staff',
]);

const ROLE_LABEL_KEYS = Object.freeze({
  customer: 'customer',
  helper: 'helper',
  business: 'business',
  restaurant: 'restaurant',
  kitchen: 'kitchen',
  runner: 'runner',
  support: 'support',
});

const AREAS = Object.freeze({
  food: {
    enabled: true,
    roles: {
      customer: { steps: ['discover', 'connect', 'complete'], cards: ['browseRestaurants', 'openOrders', 'restaurantCredit'] },
      restaurant: { steps: ['setup', 'orders', 'settle'], cards: ['restaurantPortal', 'kitchenQueue', 'restaurantCredit'] },
      kitchen: { steps: ['queue', 'prepare', 'handoff'], cards: ['kitchenQueue', 'restaurantOrders', 'support'] },
      runner: { steps: ['queue', 'pickup', 'handoff'], cards: ['runnerWorkspace', 'restaurantOrders', 'support'] },
    },
    defaultRole: 'customer',
  },
  credit: {
    enabled: true,
    roles: {
      customer: { steps: ['activate', 'authorize', 'review'], cards: ['openCredit', 'creditTransactions', 'creditSupport'] },
      business: { steps: ['partner', 'manage', 'reconcile'], cards: ['openCredit', 'restaurantPartners', 'creditSupport'] },
      restaurant: { steps: ['partner', 'manage', 'reconcile'], cards: ['restaurantPortal', 'restaurantPartners', 'creditSupport'] },
    },
    defaultRole: 'customer',
  },
  'restaurant-credit': {
    enabled: true,
    roles: {
      customer: { steps: ['select', 'pay', 'review'], cards: ['openRestaurantCredit', 'restaurantOrders', 'creditSupport'] },
      restaurant: { steps: ['setup', 'pay', 'reconcile'], cards: ['openRestaurantCredit', 'restaurantPortal', 'creditSupport'] },
    },
    defaultRole: 'customer',
  },
  direct: {
    enabled: true,
    roles: {
      customer: { steps: ['request', 'quote', 'schedule'], cards: ['openDirect', 'directQuotes', 'directSupport'] },
      business: { steps: ['request', 'quote', 'complete'], cards: ['directPortal', 'directJobs', 'directSupport'] },
    },
    defaultRole: 'customer',
  },
  rentals: {
    enabled: false,
    roles: {
      customer: { steps: ['browse', 'book', 'return'], cards: ['openRentals'] },
      business: { steps: ['browse', 'book', 'return'], cards: ['openRentals'] },
    },
    defaultRole: 'customer',
  },
  marketplace: {
    enabled: true,
    roles: {
      customer: { steps: ['post', 'compare', 'complete'], cards: ['postJob', 'browseHelpers', 'openMessages'] },
      helper: { steps: ['browse', 'presence', 'respond'], cards: ['browseJobs', 'helperProfile', 'openCalendar'] },
    },
    defaultRole: 'customer',
  },
  messages: {
    enabled: true,
    roles: {
      customer: { steps: ['start', 'connect', 'resolve'], cards: ['openMessages', 'browseJobs', 'openSupport'] },
      helper: { steps: ['start', 'connect', 'resolve'], cards: ['openMessages', 'browseJobs', 'openCalendar'] },
      business: { steps: ['start', 'connect', 'resolve'], cards: ['openMessages', 'openBusinessHub', 'openSupport'] },
    },
    defaultRole: 'customer',
  },
  calendar: {
    enabled: true,
    roles: {
      customer: { steps: ['request', 'confirm', 'complete'], cards: ['openCalendar', 'openBookings', 'openMessages'] },
      helper: { steps: ['request', 'confirm', 'complete'], cards: ['openCalendar', 'helperProfile', 'openMessages'] },
      business: { steps: ['request', 'confirm', 'complete'], cards: ['openCalendar', 'openBusinessHub', 'openMessages'] },
    },
    defaultRole: 'customer',
  },
  business: {
    enabled: true,
    roles: {
      business: { steps: ['setup', 'manage', 'grow'], cards: ['openBusinessHub', 'openCalendar', 'openMessages'] },
    },
    defaultRole: 'business',
  },
  delivery: {
    enabled: true,
    roles: {
      customer: { steps: ['request', 'quote', 'complete'], cards: ['openDelivery', 'openMessages', 'openSupport'] },
      helper: { steps: ['browse', 'claim', 'complete'], cards: ['openDelivery', 'helperProfile', 'openCalendar'] },
    },
    defaultRole: 'customer',
  },
  logistics: {
    enabled: true,
    roles: {
      business: { steps: ['source', 'ship', 'reconcile'], cards: ['openLogistics', 'openBusinessHub', 'openSupport'] },
    },
    defaultRole: 'business',
  },
  support: {
    enabled: true,
    roles: {
      customer: { steps: ['start', 'verify', 'resolve'], cards: ['openSupport', 'openMessages', 'openOrders'] },
      business: { steps: ['start', 'verify', 'resolve'], cards: ['openSupport', 'openBusinessHub', 'openMessages'] },
      support: { steps: ['start', 'verify', 'resolve'], cards: ['supportPortal', 'supportWorkspace', 'openMessages'] },
    },
    defaultRole: 'customer',
  },
  consulting: {
    enabled: true,
    roles: {
      customer: { steps: ['intake', 'schedule', 'followup'], cards: ['startConsulting', 'openCalendar', 'openMessages'] },
      business: { steps: ['intake', 'schedule', 'followup'], cards: ['startConsulting', 'openBusinessHub', 'openCalendar'] },
    },
    defaultRole: 'customer',
  },
  'get-started': {
    enabled: true,
    roles: {
      customer: { steps: ['join', 'profile', 'launch'], cards: ['joinOxsteed', 'postJob', 'browseRestaurants'] },
      helper: { steps: ['join', 'profile', 'launch'], cards: ['joinOxsteed', 'helperProfile', 'browseJobs'] },
      business: { steps: ['join', 'profile', 'launch'], cards: ['joinOxsteed', 'openBusinessHub', 'openCalendar'] },
    },
    defaultRole: 'customer',
  },
});

const AREA_ROUTES = Object.freeze({
  food: '/restaurants',
  credit: '/oxsteed-credit',
  'restaurant-credit': '/restaurant-credit',
  direct: '/direct',
  rentals: '/tool-rentals',
  marketplace: '/jobs',
  messages: '/messages',
  calendar: '/calendar',
  business: '/business-hub',
  delivery: '/delivery',
  logistics: '/logistics',
  support: '/support',
  consulting: '/consulting-intake',
  'get-started': '/join',
});

const ACTION_ROUTES = Object.freeze({
  browseRestaurants: '/restaurants', openOrders: '/orders', restaurantCredit: '/restaurant-credit',
  restaurantPortal: '/restaurants/merchant', kitchenQueue: '/help/kitchen', support: '/support',
  restaurantOrders: '/restaurants/merchant', runnerWorkspace: '/help/runner', openCredit: '/oxsteed-credit',
  creditTransactions: '/oxsteed-credit', creditSupport: '/support', restaurantPartners: '/restaurants',
  openRestaurantCredit: '/restaurant-credit', openDirect: '/direct', directQuotes: '/direct/view-quote',
  directSupport: '/direct/support', directPortal: '/direct', directJobs: '/direct/history', openRentals: '/tool-rentals',
  postJob: '/post-job', browseHelpers: '/helpers', openMessages: '/messages', browseJobs: '/jobs',
  helperProfile: '/dashboard/edit-profile', openCalendar: '/calendar', openBusinessHub: '/business-hub',
  openSupport: '/support', openBookings: '/my-bookings', openDelivery: '/delivery', openLogistics: '/logistics',
  supportPortal: '/support/agent', supportWorkspace: '/support/agent/workspace', startConsulting: '/consulting-intake',
  joinOxsteed: '/join',
});

function storageFor(areaKey) {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

function roleForUser(user, area) {
  if (!user) return area.defaultRole;
  const mode = normalizeLaunchDashboardMode(user.default_mode, user.role);
  if (mode === 'business_support_agent' || user.role === 'support_agent') return 'support';
  if (RESTAURANT_MODES.has(user.default_mode)) {
    if (user.default_mode === 'restaurant_staff') return 'kitchen';
    return 'restaurant';
  }
  if (mode === 'helper') return 'helper';
  if (BUSINESS_MODES.has(mode)) return 'business';
  return area.defaultRole;
}

export function getExperienceArea(areaKey) {
  return EXPERIENCE_AREA_KEYS.includes(areaKey) ? { key: areaKey, ...AREAS[areaKey], route: AREA_ROUTES[areaKey] } : null;
}

export function experienceAreaTranslationKey(areaKey) {
  return String(areaKey || '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function getExperienceAreaKeys() {
  return EXPERIENCE_AREA_KEYS.slice();
}

export function getExperienceRole(user, areaKey, requestedRole = null) {
  const area = getExperienceArea(areaKey);
  if (!area) return 'customer';
  const active = roleForUser(user, area);
  if (requestedRole && Object.prototype.hasOwnProperty.call(area.roles, requestedRole)) return requestedRole;
  if (Object.prototype.hasOwnProperty.call(area.roles, active)) return active;
  return area.defaultRole;
}

export function getRememberedExperienceRole(areaKey, storage = null) {
  try {
    const value = (storage || storageFor(areaKey))?.getItem(`${EXPERIENCE_ROLE_STORAGE_PREFIX}${areaKey}`);
    return value || null;
  } catch {
    return null;
  }
}

export function rememberExperienceRole(areaKey, role, storage = null) {
  const area = getExperienceArea(areaKey);
  if (!area || !Object.prototype.hasOwnProperty.call(area.roles, role)) return false;
  try {
    (storage || storageFor(areaKey))?.setItem(`${EXPERIENCE_ROLE_STORAGE_PREFIX}${areaKey}`, role);
    return true;
  } catch {
    return false;
  }
}

export function getExperienceGuide(areaKey, user, requestedRole = null) {
  const area = getExperienceArea(areaKey);
  if (!area) return null;
  const role = getExperienceRole(user, areaKey, requestedRole);
  const story = area.roles[role];
  const cards = area.enabled ? story.cards.map((key) => ({ key, to: ACTION_ROUTES[key] || area.route })) : [];
  return {
    ...area,
    role,
    roleKey: ROLE_LABEL_KEYS[role] || 'customer',
    steps: story.steps,
    cards,
    primary: cards[0] || null,
    secondary: cards[1] || cards[0] || null,
    supportedRoles: Object.keys(area.roles),
  };
}

export function isExperienceAreaEnabled(areaKey) {
  return Boolean(getExperienceArea(areaKey)?.enabled);
}

export { ACTION_ROUTES, ROLE_LABEL_KEYS };
