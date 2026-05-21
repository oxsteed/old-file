// client/src/utils/modeRouter.js
//
// Single source of truth for the unified Mode model that the new /join
// signup writes to users.default_mode (migration 270).
//
// Two responsibilities:
//   1. Map a mode → landing route (used right after OTP verification and
//      every time the user signs in or flips the mode switcher).
//   2. Catalog of mode metadata (label key, hint key, icon, "switcher" eligibility)
//      so the Join dropdown, Settings page, and Mode Switcher all stay in sync.
//
// All user-facing strings live in i18n under the `modes.*` namespace — this
// file never hardcodes English copy.

// ── Self-selectable on signup ────────────────────────────────────────────────
// Must mirror SELF_SELECTABLE_MODES in server/controllers/authController.js
// and the CHECK constraint in migration 270.
export const SELF_SELECTABLE_MODES = [
  'customer',
  'helper',
  'business_owner',
  'consultant',
  'tool_owner',
  'franchise_applicant',
  'life_only',
];

// ── Granted by an owner / employer ───────────────────────────────────────────
// These never appear in the public signup dropdown but are valid values in the
// mode switcher once a user has been assigned the role.
export const GRANTED_MODES = [
  'business_manager',
  'business_representative',
  'business_employee',
  'business_support_agent',
];

export const ALL_MODES = [...SELF_SELECTABLE_MODES, ...GRANTED_MODES, 'admin'];

// ── Mode → landing route ─────────────────────────────────────────────────────
// Keep these routes existing — don't invent URLs. If a mode needs a route that
// doesn't exist yet, fall back to /dashboard and surface the right tab there.
const ROUTE_BY_MODE = {
  customer:                 '/dashboard',
  helper:                   '/helper-dashboard',
  business_owner:           '/business-hub',
  consultant:               '/consulting/portal',
  tool_owner:               '/profile/tool-rentals',
  franchise_applicant:      '/business-launch-status',
  life_only:                '/dashboard',
  business_manager:         '/business-hub',
  business_representative:  '/business-hub',
  business_employee:        '/business-hub',
  business_support_agent:   '/support/agent',
  admin:                    '/admin',
};

// Helpers that wrap routes so the JoinPage can chain into Didit / onboarding
// the same way the legacy CustomerRegister / HelperRegister did. These are
// the "first stop" after OTP succeeds — not necessarily the long-term home.
const POST_SIGNUP_ROUTE_BY_MODE = {
  // Helpers must still pass identity verification before they can list/bid.
  helper:                   '/verify-identity',
  business_owner:           '/business-launch-status',
  consultant:               '/consulting/portal',
  tool_owner:               '/profile/tool-rentals',
  franchise_applicant:      '/business-launch-status',
  // customer + life_only land straight on the dashboard.
};

export function routeForMode(mode) {
  if (!mode) return '/dashboard';
  return ROUTE_BY_MODE[mode] || '/dashboard';
}

export function postSignupRouteForMode(mode) {
  if (!mode) return '/dashboard';
  return POST_SIGNUP_ROUTE_BY_MODE[mode] || routeForMode(mode);
}

// ── Catalog used by the Join dropdown + Mode Switcher ────────────────────────
// `labelKey` and `hintKey` resolve through i18next.
export const MODE_CATALOG = {
  customer: {
    labelKey: 'modes.customer.label',
    hintKey:  'modes.customer.hint',
    icon: 'shopping-bag',
    selfSelectable: true,
  },
  helper: {
    labelKey: 'modes.helper.label',
    hintKey:  'modes.helper.hint',
    icon: 'briefcase',
    selfSelectable: true,
  },
  business_owner: {
    labelKey: 'modes.business_owner.label',
    hintKey:  'modes.business_owner.hint',
    icon: 'building-2',
    selfSelectable: true,
  },
  consultant: {
    labelKey: 'modes.consultant.label',
    hintKey:  'modes.consultant.hint',
    icon: 'graduation-cap',
    selfSelectable: true,
  },
  tool_owner: {
    labelKey: 'modes.tool_owner.label',
    hintKey:  'modes.tool_owner.hint',
    icon: 'wrench',
    selfSelectable: true,
  },
  franchise_applicant: {
    labelKey: 'modes.franchise_applicant.label',
    hintKey:  'modes.franchise_applicant.hint',
    icon: 'flag',
    selfSelectable: true,
  },
  life_only: {
    labelKey: 'modes.life_only.label',
    hintKey:  'modes.life_only.hint',
    icon: 'heart-pulse',
    selfSelectable: true,
  },
  business_manager: {
    labelKey: 'modes.business_manager.label',
    hintKey:  'modes.business_manager.hint',
    icon: 'user-cog',
    selfSelectable: false,
  },
  business_representative: {
    labelKey: 'modes.business_representative.label',
    hintKey:  'modes.business_representative.hint',
    icon: 'user-check',
    selfSelectable: false,
  },
  business_employee: {
    labelKey: 'modes.business_employee.label',
    hintKey:  'modes.business_employee.hint',
    icon: 'user',
    selfSelectable: false,
  },
  business_support_agent: {
    labelKey: 'modes.business_support_agent.label',
    hintKey:  'modes.business_support_agent.hint',
    icon: 'life-buoy',
    selfSelectable: false,
  },
  admin: {
    labelKey: 'modes.admin.label',
    hintKey:  'modes.admin.hint',
    icon: 'shield',
    selfSelectable: false,
  },
};

// Resolve which modes the current user is allowed to be in. Used by the Mode
// Switcher to decide which entries to show. Anyone can be a `customer`; a
// helper-role user also gets `helper`; the granted modes flow in from the
// caller's known memberships (passed via opts).
export function getAvailableModesForUser(user, opts = {}) {
  if (!user) return [];
  const set = new Set(['customer']);
  if (user.role === 'helper' || user.role === 'admin' || user.role === 'super_admin') {
    set.add('helper');
  }
  if (user.role === 'admin' || user.role === 'super_admin') {
    set.add('admin');
  }
  // life_only is a UX preference — anyone may switch into it.
  set.add('life_only');
  // Memberships → granted modes. Caller passes { memberships: [{role}] }.
  const memberships = Array.isArray(opts.memberships) ? opts.memberships : [];
  for (const m of memberships) {
    switch (m.role) {
      case 'owner':           set.add('business_owner'); break;
      case 'manager':         set.add('business_manager'); break;
      case 'representative':  set.add('business_representative'); break;
      case 'employee':        set.add('business_employee'); break;
      case 'support_agent':   set.add('business_support_agent'); break;
      default: break;
    }
  }
  // Always include the user's saved default so the switcher can show it even
  // if the membership endpoint hasn't loaded yet.
  if (user.default_mode && ALL_MODES.includes(user.default_mode)) {
    set.add(user.default_mode);
  }
  // Preserve a sensible order: self-selectable first, then granted.
  const ordered = [];
  for (const m of SELF_SELECTABLE_MODES) if (set.has(m)) ordered.push(m);
  for (const m of GRANTED_MODES) if (set.has(m)) ordered.push(m);
  if (set.has('admin')) ordered.push('admin');
  return ordered;
}

export default {
  SELF_SELECTABLE_MODES,
  GRANTED_MODES,
  ALL_MODES,
  MODE_CATALOG,
  routeForMode,
  postSignupRouteForMode,
  getAvailableModesForUser,
};
