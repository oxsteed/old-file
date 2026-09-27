import { normalizeLaunchDashboardMode } from './launchScope.js';

export const HOW_IT_WORKS_STORAGE_KEY = 'oxsteed:how-it-works-role:v1';
export const STORY_ROLE_KEYS = Object.freeze(['customer', 'helper', 'business']);

const BUSINESS_MODES = new Set([
  'business_owner',
  'business_manager',
  'business_representative',
  'business_employee',
  'business_support_agent',
]);

const STORY_ROLES = Object.freeze({
  customer: {
    role: 'customer',
    labelKey: 'customer.label',
    shortKey: 'customer.short',
    titleKey: 'customer.title',
    descriptionKey: 'customer.description',
    steps: [
      { key: 'discover', icon: 'ClipboardList' },
      { key: 'connect', icon: 'MessageSquare' },
      { key: 'complete', icon: 'CalendarDays' },
    ],
    cards: [
      { key: 'postJob', icon: 'ClipboardList', to: '/post-job' },
      { key: 'findHelpers', icon: 'UserRoundCheck', to: '/helpers' },
      { key: 'bookings', icon: 'CalendarDays', to: '/my-bookings' },
      { key: 'messages', icon: 'MessageSquare', to: '/messages' },
    ],
    primary: { key: 'postJob', to: '/post-job' },
    secondary: { key: 'findHelpers', to: '/helpers' },
  },
  helper: {
    role: 'helper',
    labelKey: 'helper.label',
    shortKey: 'helper.short',
    titleKey: 'helper.title',
    descriptionKey: 'helper.description',
    steps: [
      { key: 'browse', icon: 'Briefcase' },
      { key: 'presence', icon: 'UserRoundCheck' },
      { key: 'respond', icon: 'MessageSquare' },
    ],
    cards: [
      { key: 'browseJobs', icon: 'Briefcase', to: '/jobs' },
      { key: 'profile', icon: 'UserRoundCheck', to: '/dashboard/edit-profile' },
      { key: 'messages', icon: 'MessageSquare', to: '/helper/messages' },
      { key: 'calendar', icon: 'CalendarDays', to: '/calendar' },
    ],
    primary: { key: 'browseJobs', to: '/jobs' },
    secondary: { key: 'profile', to: '/dashboard/edit-profile' },
  },
  business: {
    role: 'business',
    labelKey: 'business.label',
    shortKey: 'business.short',
    titleKey: 'business.title',
    descriptionKey: 'business.description',
    steps: [
      { key: 'workspace', icon: 'Building2' },
      { key: 'coordinate', icon: 'CalendarDays' },
      { key: 'followThrough', icon: 'MessageSquare' },
    ],
    cards: [
      { key: 'hub', icon: 'Building2', to: '/business-hub' },
      { key: 'calendar', icon: 'CalendarDays', to: '/calendar' },
      { key: 'messages', icon: 'MessageSquare', to: '/messages' },
    ],
    primary: { key: 'hub', to: '/business-hub' },
    secondary: { key: 'calendar', to: '/calendar' },
  },
});

function activeModeForUser(user) {
  if (!user) return null;
  return normalizeLaunchDashboardMode(user.default_mode, user.role);
}

export function isHowItWorksRole(value) {
  return STORY_ROLE_KEYS.includes(value);
}

export function getStoryRoleForUser(user) {
  const mode = activeModeForUser(user);
  if (mode === 'helper') return 'helper';
  if (BUSINESS_MODES.has(mode)) return 'business';
  return 'customer';
}

function defaultStorage() {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

export function readRememberedStoryRole(storage = null) {
  try {
    const value = (storage || defaultStorage())?.getItem(HOW_IT_WORKS_STORAGE_KEY);
    return isHowItWorksRole(value) ? value : null;
  } catch {
    return null;
  }
}

export function rememberStoryRole(role, storage = null) {
  if (!isHowItWorksRole(role)) return false;
  try {
    (storage || defaultStorage())?.setItem(HOW_IT_WORKS_STORAGE_KEY, role);
    return true;
  } catch {
    return false;
  }
}

export function selectHowItWorksStory(user, visitorPreference = null) {
  if (user) {
    return {
      role: getStoryRoleForUser(user),
      source: 'active_mode',
      story: getHowItWorksStory(user, getStoryRoleForUser(user)),
    };
  }

  const role = isHowItWorksRole(visitorPreference) ? visitorPreference : 'customer';
  return {
    role,
    source: visitorPreference ? 'visitor_preference' : 'default',
    story: getHowItWorksStory(null, role),
  };
}

export function getHowItWorksStory(user, role = getStoryRoleForUser(user)) {
  const normalizedRole = isHowItWorksRole(role) ? role : 'customer';
  const base = STORY_ROLES[normalizedRole];

  if (normalizedRole === 'business' && activeModeForUser(user) === 'business_support_agent') {
    return {
      ...base,
      cards: [
        ...base.cards,
        { key: 'support', icon: 'LifeBuoy', to: '/support/agent' },
      ],
      primary: { key: 'support', to: '/support/agent' },
    };
  }

  return base;
}
