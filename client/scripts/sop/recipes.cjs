/**
 * recipes.cjs - screenshot state recipes.
 *
 * routeForScreen(screen): substitute route params with synthetic values.
 * RECIPES: explicit per-state recipes keyed by `${screen}||${state}`.
 *   Each recipe: { user, dataMode, flags, actions }.
 *   - user: 'guest' | 'customer' | 'helper' | 'business' | 'restaurant' |
 *            'logisticsOp' | 'admin'
 *   - dataMode: 'full' | 'empty'
 *   - flags: { ... } forwarded to window.__sopFlags
 *   - actions: array interpreted by harness.applyActions
 *
 * autoRecipe(plan): heuristic fallback when no explicit recipe exists.
 */
function routeForScreen(screen) {
  return screen.replace(/:([a-zA-Z]+)/g, (m, name) => {
    if (/token|code/i.test(name)) return 'sop-token-001';
    return '11111111-1111-4111-8111-111111111111';
  });
}

const USERS = {
  guest: null,
  customer: {
    id: 'sop-user-customer', email: 'sop.customer@example.com', first_name: 'Sop', last_name: 'Customer',
    role: 'customer', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  },
  helper: {
    id: 'sop-user-helper', email: 'sop.helper@example.com', first_name: 'Sam', last_name: 'Helper',
    role: 'helper', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
    default_mode: 'helper',
  },
  helperOnboarding: {
    id: 'sop-user-helper-ob', email: 'sop.newhelper@example.com', first_name: 'Nia', last_name: 'Helper',
    role: 'helper', email_verified: true, didit_status: 'verified', onboarding_step: 'profile',
    default_mode: 'helper',
  },
  business: {
    id: 'sop-user-business', email: 'sop.owner@example.com', first_name: 'Owen', last_name: 'Owner',
    role: 'customer', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
    default_mode: 'business_owner',
  },
  restaurant: {
    id: 'sop-user-restaurant', email: 'sop.restaurant@example.com', first_name: 'Rita', last_name: 'Restaurateur',
    role: 'customer', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  },
  logisticsOp: {
    id: 'sop-user-logistics', email: 'sop.ops@example.com', first_name: 'Logan', last_name: 'Ops',
    role: 'employee', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
    internal_access_route: 'operations', logistics_role: 'logistics_coordinator',
  },
  admin: {
    id: 'sop-user-admin', email: 'sop.admin@example.com', first_name: 'Ava', last_name: 'Admin',
    role: 'super_admin', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  },
};

const RECIPES = {
 '/business-hub||Business workspace, signed in owner, light mode': {user:'business'},
 '/business/:businessId/onboarding||Business setup checks, signed in owner, light mode': {user:'business'},
  // filled per area as capture work proceeds
};

/* ================= account area ================= */
Object.assign(RECIPES, {
  '/verify-identity||Verification page loaded, signed in, light mode': { user: 'customer' },
  '/verify-identity||ID type selection, signed in, light mode': { user: 'customer' },
  '/verify-identity||Document capture step, signed in, light mode': { user: 'customer' },
  '/verify-identity||Verification approved, signed in, light mode': { user: 'customer', flags: { didit: 'verified' } },

  '/join||Blank join form, guest, light mode': { user: 'guest' },
  '/join||Join form with details filled in, guest, light mode': {
    user: 'guest',
    actions: [
      { fill: ['input[name="firstName"]', 'Sop'] },
      { fill: ['input[name="lastName"]', 'Customer'] },
      { fill: ['input[name="email"]', 'sop.customer@example.com'] },
      { fill: ['input[name="phone"]', '9375550142'] },
      { fill: ['input[name="addressLine1"]', '123 Maple Street'] },
      { fill: ['input[name="city"]', 'Dayton'] },
      { select: ['select[name="state"]', 'OH'] },
      { fill: ['input[name="postal_code"]', '45402'] },
      { fill: ['input[name="password"]', 'DemoPass123!'] },
    ],
  },
  '/join||Terms checkbox ticked, guest, light mode': {
    user: 'guest',
    actions: [
      { fill: ['input[name="firstName"]', 'Sop'] },
      { fill: ['input[name="lastName"]', 'Customer'] },
      { fill: ['input[name="email"]', 'sop.customer@example.com'] },
      { fill: ['input[name="phone"]', '9375550142'] },
      { fill: ['input[name="addressLine1"]', '123 Maple Street'] },
      { fill: ['input[name="city"]', 'Dayton'] },
      { select: ['select[name="state"]', 'OH'] },
      { fill: ['input[name="postal_code"]', '45402'] },
      { fill: ['input[name="password"]', 'DemoPass123!'] },
      { check: '#ageConfirmed' },
      { check: '#termsAccepted' },
    ],
  },
  '/join||Email verification code entry, guest, light mode': {
    user: 'guest',
    actions: [
      { fill: ['input[name="firstName"]', 'Sop'] },
      { fill: ['input[name="lastName"]', 'Customer'] },
      { fill: ['input[name="email"]', 'sop.customer@example.com'] },
      { fill: ['input[name="phone"]', '9375550142'] },
      { fill: ['input[name="addressLine1"]', '123 Maple Street'] },
      { fill: ['input[name="city"]', 'Dayton'] },
      { select: ['select[name="state"]', 'OH'] },
      { fill: ['input[name="postal_code"]', '45402'] },
      { fill: ['input[name="password"]', 'DemoPass123!'] },
      { check: '#ageConfirmed' },
      { check: '#termsAccepted' },
      { click: 'form button[type="submit"]' },
      { waitFor: '.signup-otp-input, .signup-verification' },
    ],
  },

  '/dashboard||Signed in, mode switcher closed, desktop navigation, light mode': { user: 'customer' },
  '/dashboard||Signed in, mobile menu open showing the mode switcher, light mode': {
    user: 'customer',
    actions: [
      { click: 'button.ox-btn-icon[aria-expanded]' },
      { waitFor: '.ox-nav-mobile-menu' },
    ],
  },
  '/dashboard||Mode switcher panel open, signed in, light mode': {
    user: 'customer',
    actions: [
      { eval: `(${clickModeSwitcher.toString()})()` },
      { waitFor: '[role="group"]' },
    ],
  },
  '/dashboard||Mode switcher panel open, signed in, light mode||mobile': {
    user: 'customer',
    actions: [
      { click: 'button.ox-btn-icon[aria-expanded]' },
      { waitFor: '.ox-nav-mobile-menu' },
      { eval: `(${clickModeSwitcher.toString()})()` },
      { waitFor: '[role="group"]' },
    ],
  },
  '/dashboard||Signed in after mode switch, new mode active, light mode': {
    user: 'customer',
    actions: [
      // deterministic: stash the switched mode (mirrors POST /auth/switch-role
      // persistence) then reload, the same state the app reaches after a UI switch
      { eval: `sessionStorage.setItem('__sop_mode', 'helper')` },
      { reload: true },
      { waitFor: '.ox-nav-mobile-mode' },
    ],
  },
  '/dashboard||Signed in after mode switch, new mode active, light mode||mobile': {
    user: 'customer',
    actions: [
      // deterministic: stash the switched mode (mirrors POST /auth/switch-role
      // persistence) then reload, the same state the app reaches after a UI switch
      { eval: `sessionStorage.setItem('__sop_mode', 'helper')` },
      { reload: true },
      { waitForText: 'Helper', timeout: 15000 },
      // re-open the mobile menu so the new mode is visible in the menu
      { click: 'button.ox-btn-icon[aria-expanded]' },
      { waitFor: '.ox-nav-mobile-menu' },
    ],
  },
  '/dashboard||Helper dashboard with onboarding checklist visible, signed in, light mode': {
    user: 'helperOnboarding',
    actions: [
      { waitFor: '[data-testid="helper-onboarding-checklist"]' },
      { scroll: '[data-testid="helper-onboarding-checklist"]' },
    ],
  },
  '/dashboard||Terms acceptance step open, signed in, light mode': {
    user: 'helperOnboarding',
    actions: [
      { waitFor: '[data-testid="helper-onboarding-checklist"]' },
      { scroll: '[data-testid="helper-onboarding-checklist"]' },
    ],
  },
  '/dashboard||Profile details step open, signed in, light mode': {
    user: 'helperOnboarding',
    actions: [
      { waitFor: '[data-testid="helper-onboarding-checklist"]' },
      { scroll: '[data-testid="helper-onboarding-checklist"]' },
    ],
  },
  '/dashboard||All onboarding steps done, signed in, light mode': {
    user: 'helperOnboarding', flags: { onboarding: 'ready' },
    actions: [
      { waitFor: '[data-testid="helper-onboarding-checklist"]' },
      { scroll: '[data-testid="helper-onboarding-checklist"]' },
    ],
  },
  '/dashboard||Dashboard loaded after sign in, signed in, light mode': { user: 'customer' },

  '/forgot-password||Blank forgot-password form, guest, light mode': { user: 'guest' },
  '/forgot-password||Reset link sent confirmation, guest, light mode': {
    user: 'guest',
    actions: [
      { fill: ['#email', 'sop.customer@example.com'] },
      { click: 'button[type="submit"]' },
      { waitFor: 'main .w-16.h-16' },
    ],
  },
  '/reset-password/:token||Set New Password form, guest, light mode': { user: 'guest' },

  '/login||Blank sign-in form, guest, light mode': { user: 'guest' },
  '/login||Sign-in form filled in, guest, light mode': {
    user: 'guest',
    actions: [
      { fill: ['#email', 'sop.customer@example.com'] },
      { fill: ['input[type="password"]', 'DemoPass123!'] },
      { eval: `(() => { const box = [...document.querySelectorAll('input[type=checkbox]')].find(el => el.offsetParent !== null); if (box && !box.checked) box.click(); const name = document.querySelector('input[name="signatureName"], input[placeholder*="full name" i]'); if (name) { name.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, 'Sop Customer'); name.dispatchEvent(new Event('input', { bubbles: true })); } })()` },
    ],
  },
  '/login||Two-factor verification prompt, guest, light mode': {
    user: 'guest', flags: { mfa: true },
    actions: [
      { fill: ['#email', 'sop.customer@example.com'] },
      { fill: ['input[type="password"]', 'DemoPass123!'] },
      { eval: `(() => { const box = [...document.querySelectorAll('input[type=checkbox]')].find(el => el.offsetParent !== null); if (box && !box.checked) box.click(); const name = document.querySelector('input[name="signatureName"], input[placeholder*="full name" i]'); if (name) { name.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, 'Sop Customer'); name.dispatchEvent(new Event('input', { bubbles: true })); } })()` },
      { click: 'button[type="submit"]' },
      { waitFor: '#two-factor-code' },
    ],
  },

  '/settings||Privacy & Data tab, signed in, light mode': {
    user: 'helper', // privacy toggles are helper-only in the current UI
    actions: [{ clickText: 'Privacy & Data' }, { waitForText: 'Privacy' }],
  },
  '/settings||Privacy & Data tab with a toggle changed, signed in, light mode': {
    user: 'helper',
    actions: [
      { clickText: 'Privacy & Data' },
      { waitForText: 'Privacy' },
      { eval: `(() => { const box = [...document.querySelectorAll('main input[type=checkbox]')].find(el => el.offsetParent !== null && !el.disabled); if (box) box.click(); })()` },
      { settle: 1200 },
    ],
  },
  '/settings||Export verification code entry, signed in, light mode': {
    user: 'helper',
    actions: [
      { clickText: 'Privacy & Data' },
      { waitForText: 'Privacy' },
      { clickText: 'Export My Data' },
      { eval: `(() => { const pw = [...document.querySelectorAll('main input[type=password]')].find(el => el.offsetParent !== null); if (pw) { pw.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, 'DemoPass123!'); pw.dispatchEvent(new Event('input', { bubbles: true })); } const form = pw ? pw.closest('form') : null; const btn = form ? form.querySelector('button[type=submit]') : null; if (btn) btn.click(); })()` },
      { waitFor: 'main input[type=text]' },
    ],
  },
  '/settings||Danger Zone tab with Delete Account confirmation, signed in, light mode': {
    user: 'customer',
    actions: [
      { clickText: 'Danger Zone' },
      { clickText: 'Delete Account' },
      { eval: `(() => { const inp = [...document.querySelectorAll('main input[type=text]')].find(el => el.offsetParent !== null && /delete/i.test(el.placeholder || '')); if (inp) { inp.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, 'DELETE MY ACCOUNT'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } })()` },
      { settle: 800 },
    ],
  },
  '/settings||Settings page, Profile tab active, signed in, light mode': { user: 'customer' },
  '/settings||Settings page, tab list, signed in, light mode': { user: 'customer' },
  '/settings||Profile tab, signed in, light mode': { user: 'customer' },
  '/settings/security||Security tab, signed in, light mode': {
    // /settings/security is not a route (renders 404); the Security tab lives on /settings
    user: 'customer', url: '/settings',
    actions: [{ clickText: 'Security' }, { waitForText: 'Two-factor' }],
  },
  '/settings?tab=tax||Tax documents tab, helper, signed in, light mode': { user: 'helper' },

  '/support||New support conversation, light mode': {
    user: 'customer', flags: { supportLive: true },
    actions: [{ waitFor: 'main input[type="text"]' }],
  },
  '/support/escalation||Escalation submitted, ticket identifier shown, light mode': {
    user: 'customer',
    actions: [
      { eval: `(() => { const set = (sel, v) => { const el = document.querySelector(sel); if (el && !el.value) { el.focus(); document.execCommand('selectAll', false, null); document.execCommand('insertText', false, v); el.dispatchEvent(new Event('input', { bubbles: true })); } }; set('input[name=name]', 'Sop Customer'); set('input[name=email]', 'sop.customer@example.com'); set('input[type=email]', 'sop.customer@example.com'); const ta = [...document.querySelectorAll('textarea')].find(el => el.offsetParent !== null); if (ta && !ta.value) { ta.focus(); document.execCommand('insertText', false, 'My helper cancelled the booking but I was still charged. I need a refund.'); ta.dispatchEvent(new Event('input', { bubbles: true })); } })()` },
      { eval: `(() => { const btn = [...document.querySelectorAll('button[type=submit]')].find(b => b.offsetParent !== null); if (btn) btn.click(); })()` },
      { waitFor: '.support-escalation-success' },
    ],
  },
  '/support/my-tickets/:ticketId||Ticket detail with messages thread, signed in, light mode': { user: 'customer' },
});

function guessUserFromState(state) {
  if (/\bguest\b/i.test(state)) return 'guest';
  if (/\bhelper\b/i.test(state)) return 'helper';
  if (/business owner/i.test(state)) return 'business';
  if (/\brestaurant\b/i.test(state)) return 'restaurant';
  if (/logistics/i.test(state)) return 'logisticsOp';
  return 'customer';
}

/**
 * Heuristic recipe from the state string. Covers common patterns:
 * dialog/panel open, tab selected, form filled, checkbox ticked,
 * validation errors, confirmation after submit, empty states.
 */
function autoRecipe(plan) {
  const state = plan.state;
  const actions = [];
  const user = guessUserFromState(state);
  const dataMode = /\bempty\b|no .*yet|zero |haven't/i.test(state) ? 'empty' : 'full';

  // tab selection: "... tab ..." -> click the tab
  const tabMatch = state.match(/^([\w &/-]+?) tab\b/i) || state.match(/\b([\w &/-]+?) tab (?:with|showing|open)/i);
  // dialog/panel/editor open: "New X dialog open" -> click trigger button
  const dialogMatch = state.match(/(?:New|Add|Create|Edit|Open|Show)\s+([\w &/-]+?)\s+(?:dialog|panel|editor|drawer|modal|form)\s+open/i);

  if (dialogMatch) {
    const thing = dialogMatch[1].trim();
    actions.push({ clickText: `New ${thing}` });
    actions.push({ waitFor: '[role=dialog], [role=alertdialog], .modal, [data-dialog]' });
  } else if (tabMatch) {
    const tab = tabMatch[1].trim();
    if (!/^(?:the|a)$/i.test(tab)) actions.push({ clickText: tab });
  }

  if (/filled|partially filled|details filled|with synthetic/i.test(state) && !/dialog open$|panel open$/i.test(state)) {
    // filling is handled per-recipe; auto fallback fills visible inputs
    actions.push({ eval: `(${fillVisibleInputs.toString()})()` });
  }
  if (/checkbox ticked|ticked|checked/i.test(state)) {
    actions.push({ eval: `(${tickFirstCheckbox.toString()})()` });
  }
  if (/validation|error/i.test(state) && /shown|visible|display/i.test(state)) {
    actions.push({ eval: `(${submitFirstForm.toString()})()` });
  }

  return { user, dataMode, flags: {}, actions };
}

function fillVisibleInputs() {
  const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]), textarea')];
  for (const el of inputs) {
    if (el.offsetParent === null || el.value || el.disabled || el.readOnly) continue;
    el.focus();
    el.value = ' ';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function tickFirstCheckbox() {
  const box = [...document.querySelectorAll('input[type=checkbox]')].find((el) => el.offsetParent !== null && !el.disabled);
  if (box && !box.checked) box.click();
}

/** Click the visible ModeSwitcher trigger (not the account menu trigger). */
function clickModeSwitcher() {
  const discs = [...document.querySelectorAll('[data-nav-disclosure]')];
  for (const d of discs) {
    const b = d.querySelector('button');
    if (b && b.offsetParent !== null && /mode/i.test(b.textContent || '')) { b.click(); return true; }
  }
  // mobile compact switcher has no "Mode" label; take any visible disclosure button in the mobile menu
  const mm = document.querySelector('.ox-nav-mobile-menu');
  if (mm) {
    const b = mm.querySelector('[data-nav-disclosure] button');
    if (b && b.offsetParent !== null) { b.click(); return true; }
  }
  const menu=document.querySelector('button.ox-btn-icon[aria-expanded="false"]');
  if(menu){menu.click();setTimeout(clickModeSwitcher,100);}
  return false;
}

function submitFirstForm() {
  const btn = document.querySelector('form button[type=submit], button[type=submit]');
  if (btn) btn.click();
}

function recipeFor(plan) {
  const vpKey = `${plan.screen}||${plan.state}||${plan.vp}`;
  if (RECIPES[vpKey]) return { ...RECIPES[vpKey] };
  const key = `${plan.screen}||${plan.state}`;
  if (RECIPES[key]) return { ...RECIPES[key] };
  return autoRecipe(plan);
}

module.exports = { routeForScreen, RECIPES, recipeFor, guessUserFromState, USERS };

/* ================= business-work area ================= */
// All business-work screens need the business_owner mode user.
const BW = { user: 'business', dataMode: 'full' };
Object.assign(RECIPES, {
  '/dashboard||Business owner dashboard, synthetic businesses, 3 open items, light mode': { ...BW },
  '/dashboard||Attention inbox dialog open with synthetic items, light mode': {
    ...BW,
    actions: [
      { clickText: 'Attention' },
      { waitFor: '.bh-modal, [role=dialog]' },
    ],
  },
  '/dashboard||Attention task view open, synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: 'Attention' },
      { waitFor: '.bh-modal, [role=dialog]' },
      { eval: `(() => { const i=[...document.querySelectorAll('[role=dialog] button')].find(b=>/invoice|overdue/i.test(b.textContent)); if(i){ i.click(); return true; } return false; })()` },
      { settle: 800 },
    ],
  },
  '/business-hub?tab=clients||Clients tab with synthetic clients, light mode': { ...BW },
  '/business-hub?tab=clients||Add client dialog open, light mode': {
    ...BW,
    actions: [{ clickText: 'Add client' }, { waitFor: '.bh-modal, [role=dialog]' }],
  },
  '/business-hub?tab=clients||Add client dialog filled with synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: 'Add client' },
      { waitFor: '.bh-modal, [role=dialog]' },
      { eval: `(() => { const d=document.querySelector('.bh-modal, [role=dialog]'); const set=(sel,v)=>{ const el=d && d.querySelector(sel); if(el){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=name]','Jane Doe'); set('input[type=email]','jane@example.com'); set('input[name=phone]','9375550101'); })()` },
    ],
  },
  '/business-hub?tab=clients||Client card with edit and archive controls, light mode': { ...BW },
  '/business-hub?tab=invoices||Invoices tab with synthetic invoices, light mode': { ...BW },
  '/business-hub?tab=invoices||New Invoice dialog open, light mode': {
    ...BW,
    actions: [{ clickText: 'New Invoice' }, { waitFor: '.bh-modal, [role=dialog]' }],
  },
  '/business-hub?tab=invoices||New Invoice dialog with synthetic line items, light mode': {
    ...BW,
    actions: [
      { clickText: 'New Invoice' },
      { waitFor: '.bh-modal, [role=dialog]' },
      { eval: `(() => { const d=document.querySelector('.bh-modal, [role=dialog]'); if(!d) return; const set=(el,v)=>{ if(el){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); } }; set(d.querySelector('input[name=client_name]'),'Jane Doe'); const li=d.querySelector('.bh-line-item'); if(li){ const inputs=[...li.querySelectorAll('input[type=text], input:not([type])')]; set(inputs[0],'Faucet repair'); set(inputs[1],'85'); } })()` },
    ],
  },
  '/business-hub?tab=invoices||Invoice rows with action buttons, synthetic data, light mode': { ...BW },
  '/invoice/p/:token||Public invoice view, synthetic data, light mode': { user: 'guest', dataMode: 'full' },
  '/post-job||Post a job wizard, details step with synthetic data, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const set=(sel,v)=>{ const el=document.querySelector(sel); if(el && !el.value){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=title]','Fix leaky kitchen faucet'); set('textarea[name=description]','Kitchen faucet drips constantly.'); set('input[name=budget_min]','50'); set('input[name=budget_max]','120'); })()` },
    ],
  },
  '/post-job||Post a job wizard, review step with synthetic data, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const set=(sel,v)=>{ const el=document.querySelector(sel); if(el && !el.value){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=title]','Fix leaky kitchen faucet'); set('textarea[name=description]','Kitchen faucet drips constantly.'); })()` },
      { clickText: 'Next Step' },
      { settle: 1000 },
    ],
  },
  '/my-jobs||My Jobs page with synthetic business jobs, light mode': { ...BW },
  '/business-hub?tab=hiring||Hiring tab with synthetic roles, light mode': { ...BW },
  '/business-hub?tab=hiring||Hiring pipeline for a synthetic role, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const r=[...document.querySelectorAll('button')].find(b=>/view|pipeline|applicants/i.test(b.textContent)); if(r){ r.click(); return true; } return false; })()` },
      { settle: 800 },
    ],
  },
  '/business-hub?tab=calendar||Schedule tab with synthetic data, light mode': { ...BW },
  '/business-hub?tab=calendar||Business hours editor with synthetic hours, light mode': {
    ...BW,
    actions: [{ clickText: 'Business hours' }, { settle: 800 }],
  },
  '/business-hub?tab=calendar||Appointments section with synthetic appointments, light mode': { ...BW },
  '/business-hub?tab=calendar||Appointment detail with action buttons, synthetic data, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const e=[...document.querySelectorAll('button')].find(b=>/faucet|repair/i.test(b.textContent)); if(e){ e.click(); return true; } return false; })()` },
      { settle: 800 },
    ],
  },
  '/business-hub||Business hub with synthetic business, light mode': { ...BW },
  '/business-hub||Business switcher dropdown open, synthetic businesses, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const s=[...document.querySelectorAll('button')].find(b=>/Maple Street/i.test(b.textContent)); if(s){ s.click(); return true; } return false; })()` },
      { settle: 600 },
    ],
  },
  '/business-hub||Business switcher open, synthetic businesses, light mode': {
    ...BW,
    actions: [
      { eval: `(() => { const s=[...document.querySelectorAll('button')].find(b=>/Maple Street/i.test(b.textContent)); if(s){ s.click(); return true; } return false; })()` },
      { settle: 600 },
    ],
  },
  '/business-hub?tab=team||Team tab with a synthetic pending invitation, light mode': { ...BW },
  '/business-hub?tab=team||Team tab with synthetic members, light mode': { ...BW },
  '/business-hub?tab=team||Invite Team Member dialog open, light mode': {
    ...BW,
    actions: [{ clickText: 'Invite' }, { waitFor: '.bh-modal, [role=dialog]' }],
  },
  '/business-hub?tab=team||Team tab with an awaiting-approval member, light mode': { ...BW },
  '/business-hub?tab=team||Team tab with member rows, light mode': { ...BW },
  '/business-hub?tab=services||Services tab with two synthetic services, light mode': { ...BW },
  '/business-hub?tab=services||Services tab with synthetic services, light mode': { ...BW },
  '/business-hub?tab=services||Add Service dialog open, light mode': {
    ...BW,
    actions: [{ clickText: '+ Add Service', exact: true }, { waitFor: '.bh-modal, [role=dialog]' }],
  },
  '/business-hub?tab=services||Add Service dialog filled with synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: '+ Add Service', exact: true },
      { waitFor: '.bh-modal, [role=dialog]' },
      { eval: `(() => { const d=document.querySelector('.bh-modal, [role=dialog]'); const set=(sel,v)=>{ const el=d && d.querySelector(sel); if(el){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=name]','Faucet Repair'); set('input[name=price]','85'); set('textarea[name=description]','Fix leaky faucets'); })()` },
    ],
  },
  '/business-hub?tab=services||Services tab with one inactive service, light mode': { ...BW },
  '/consulting-intake||Intake form, package selection step, light mode': { ...BW },
  '/consulting-intake||Intake form, business details step with synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: 'Next' },
      { settle: 800 },
      { eval: `(() => { const set=(sel,v)=>{ const el=document.querySelector(sel); if(el && !el.value){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=business_name]','Maple Street Plumbing'); set('input[name=website]','https://example.com'); })()` },
    ],
  },
  '/consulting-intake||Intake form, contact step with synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: 'Next' },
      { settle: 600 },
      { clickText: 'Next' },
      { settle: 800 },
      { eval: `(() => { const set=(sel,v)=>{ const el=document.querySelector(sel); if(el && !el.value){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=contact_name]','Owen Owner'); set('input[type=email]','owen@example.com'); })()` },
    ],
  },
  '/consulting-intake||Intake form review step, synthetic data, light mode': {
    ...BW,
    actions: [
      { clickText: 'Next' },
      { settle: 600 },
      { clickText: 'Next' },
      { settle: 600 },
      { clickText: 'Next' },
      { settle: 800 },
    ],
  },
  '/business/:businessId/onboarding||Business onboarding page, light mode': {
    ...BW, url: '/business/sop-biz-1/onboarding',
  },
  '/business/:businessId||Business profile, flag off, no intake buttons, light mode': {
    ...BW, url: '/business/sop-biz-1',
  },
  '/business/:businessId/maintenance-request||Maintenance request form, synthetic data, light mode': {
    ...BW, url: '/business/sop-biz-1/maintenance-request',
  },
  '/business/:businessId/maintenance-request||Intake form filled with synthetic data, light mode': {
    ...BW, url: '/business/sop-biz-1/maintenance-request',
    actions: [
      { eval: `(() => { const set=(sel,v)=>{ const el=document.querySelector(sel); if(el && !el.value){ el.focus(); document.execCommand('selectAll',false,null); document.execCommand('insertText',false,v); el.dispatchEvent(new Event('input',{bubbles:true})); } }; set('input[name=title]','Leaky faucet'); set('textarea[name=description]','Kitchen faucet drips.'); })()` },
    ],
  },
  '/business-hub?tab=maintenance||Hub intake ops tab with synthetic intake, light mode': { ...BW },
});

/* ================= financial area ================= */
Object.assign(RECIPES, {
  '/oxsteed-credit||OxSteed Credit page with guardrails, light mode': { user: 'customer' },
  '/oxsteed-credit||Withdraw to your bank panel, light mode': { user: 'customer' },
  '/oxsteed-credit||Convert Credit panel, light mode': { user: 'customer' },
  '/oxsteed-credit||In-store authorization panel with hold ID, light mode': { user: 'customer' },
  '/oxsteed-credit||Convert restaurant credit panel, light mode': { user: 'customer' },
  '/oxsteed-credit||Recent activity list with transaction actions, light mode': { user: 'customer' },
  '/oxsteed-credit/cards||My Cards page with issue panel, light mode': { user: 'customer' },
  '/oxsteed-credit/statements||Account statements with period picker, light mode': { user: 'customer' },
  '/oxsteed-credit/statements||Posted activity with advanced filters open, light mode': { user: 'customer' },
  '/oxsteed-credit/statements/archive||Statement archive with statement list, light mode': { user: 'customer' },
  '/oxsteed-credit/statements/archive||Archive with product selector open, light mode': {
    user: 'customer',
    actions: [{ eval: `(() => { const s=document.querySelector('select'); if(s){ s.focus(); s.click(); return true; } return false; })()` }, { settle: 600 }],
  },
  '/oxsteed-credit/statements/archive||Issued statement with download actions, light mode': { user: 'customer' },
  '/wallet||Wallet overview with balances, light mode': { user: 'customer' },
  '/wallet||Wallet Add money panel, light mode': { user: 'customer' },
  '/wallet||Add money panel with amount field, light mode': { user: 'customer' },
  '/wallet||OxSteed Credit balance card, light mode': { user: 'customer' },
  '/wallet||Restaurant credit summary card, light mode': { user: 'customer' },
  '/wallet||Restaurant wallets list, light mode': { user: 'customer' },
  '/wallet||Expanded account details, light mode': {
    user: 'customer',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('main button')].find(x=>/details|expand/i.test(x.textContent)); if(b){ b.click(); return true; } return false; })()` }, { settle: 600 }],
  },
  '/qr-payments||QR payments setup with connect gate, light mode': { user: 'customer' },
  '/qr-payments||Create QR code form with amount options, light mode': {
    user: 'customer',
    actions: [{ clickText: 'Create' }, { settle: 800 }],
  },
  '/qr-payments||Payment QR code cards with actions, light mode': { user: 'customer' },
  '/pay/:code||Pay by QR page with amount and email, light mode': { user: 'guest', url: '/pay/sop-token-001' },
  '/pay/:code||Payment successful confirmation, light mode': {
    user: 'guest', url: '/pay/sop-token-001',
    actions: [
      { eval: `(() => { const i=document.querySelector('input[type=email]'); if(i){ i.focus(); document.execCommand('insertText',false,'sop.customer@example.com'); i.dispatchEvent(new Event('input',{bubbles:true})); } const b=document.querySelector('button[type=submit]'); if(b) b.click(); })()` },
      { settle: 1500 },
    ],
  },
  '/pay/:code/success||Payment successful confirmation, light mode': { user: 'guest', url: '/pay/sop-token-001/success' },
  '/direct/payments/:id||Direct payment receipt confirmation, light mode': { user: 'customer', url: '/direct/payments/sop-pay-1' },
  '/food/orders/:orderId||Order detail with summary and payment cards, light mode': { user: 'customer', url: '/food/orders/sop-order-1' },
  '/food/track/:token||Track Order page with Print Receipt, light mode': { user: 'guest', url: '/food/track/sop-token-001' },
  '/restaurant-credit||Restaurant credit page with restaurant selected, light mode': { user: 'customer' },
  '/restaurant-credit||Add money card top-up dialog, light mode': { user: 'customer' },
  '/restaurant-credit||Add credit proof request form, light mode': {
    user: 'customer',
    actions: [{ clickText: 'Request' }, { settle: 800 }],
  },
  '/restaurant-credit||One-time payment QR displayed, light mode': { user: 'customer' },
  '/restaurant-credit||Send restaurant credit dialog, light mode': { user: 'customer' },
  '/restaurant-credit||Restaurant credit activity list, light mode': { user: 'customer' },
  '/restaurants/merchant||Restaurant credit manager with pending requests, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Grant credit form, light mode': { user: 'restaurant' },
  '/statements||Statement center with accounts, light mode': { user: 'customer' },
  '/statements/exports/:jobId||Export panel with request form, light mode': { user: 'customer', url: '/statements/exports/sop-job-1' },
  '/statements/exports/:jobId||Export form with parameters filled, light mode': {
    user: 'customer', url: '/statements/exports/sop-job-1',
    actions: [{ eval: `(() => { const s=document.querySelector('select'); if(s){ s.selectedIndex=1; s.dispatchEvent(new Event('change',{bubbles:true})); } })()` }, { settle: 600 }],
  },
  '/statements/exports/:jobId||Completed export job with files, light mode': { user: 'customer', url: '/statements/exports/sop-job-1' },
  '/statements/:documentId/entries/:entryId||Statement transaction entry details, light mode': { user: 'customer', url: '/statements/sop-doc-1/entries/sop-entry-1' },
  '/statements/:documentId/accessible||Accessible statement formats, light mode': { user: 'customer', url: '/statements/sop-doc-1/accessible' },
});

/* ================= helper-work area ================= */
Object.assign(RECIPES, {
  '/calendar||Helper calendar, booking requests view, synthetic data, light mode': { user: 'helper' },
  '/calendar||Helper calendar, synthetic data, light mode': { user: 'helper' },
  '/calendar||Pending Booking Requests panel with two synthetic requests, light mode': { user: 'helper' },
  '/calendar||Pending Booking Requests panel with one synthetic request, light mode': { user: 'helper', dataMode: 'empty' },
  '/calendar||Booking request card with action buttons, synthetic data, light mode': { user: 'helper' },
  '/my-jobs||My Jobs page with synthetic jobs, light mode': { user: 'helper' },
  '/dashboard?tab=availability||Availability tab, helper offline in directory, light mode': { user: 'helper' },
  '/dashboard?tab=availability||Availability tab, helper online in directory, light mode': { user: 'helper' },
  '/dashboard?tab=availability||Availability tab, helper live for chat, light mode': { user: 'helper' },
  '/dashboard?tab=availability||Weekly schedule editor with synthetic hours, light mode': { user: 'helper' },
  '/jobs/:id||Job detail with synthetic data, bid form visible, light mode': { user: 'helper', url: '/jobs/sop-job-1' },
  '/jobs/:id||Bid form filled with synthetic data, light mode': {
    user: 'helper', url: '/jobs/sop-job-1',
    actions: [{ eval: `(() => { const i=document.querySelector('main input[type=number], main input[name=amount]'); if(i){ i.focus(); document.execCommand('insertText',false,'85'); i.dispatchEvent(new Event('input',{bubbles:true})); } })()` }],
  },
  '/jobs/:id||Bid submitted, confirmation shown, light mode': {
    user: 'helper', url: '/jobs/sop-job-1',
    actions: [
      { eval: `(() => { const i=document.querySelector('main input[type=number], main input[name=amount]'); if(i){ i.focus(); document.execCommand('insertText',false,'85'); i.dispatchEvent(new Event('input',{bubbles:true})); } const b=[...document.querySelectorAll('main button')].find(x=>/submit|bid/i.test(x.textContent)); if(b) b.click(); })()` },
      { settle: 1200 },
    ],
  },
  '/jobs/:id||Job detail with synthetic data, light mode': { user: 'helper', url: '/jobs/sop-job-1' },
  '/my-bids||My Bids page with synthetic bids, light mode': { user: 'helper' },
  '/helper/clients||Client management page with synthetic clients, light mode': { user: 'helper' },
  '/helper/clients||Client management page with Unread filter active, light mode': {
    user: 'helper',
    actions: [{ clickText: 'Unread' }, { settle: 600 }],
  },
  '/helper/clients||Client card with Open conversation control, light mode': { user: 'helper' },
  '/dashboard||Helper dashboard tabs, Earnings tab absent (flag off), light mode': { user: 'helper' },
  '/helper/payouts||Payouts page with synthetic balances, light mode': { user: 'helper' },
  '/helper/payouts||Payouts page showing the tax gate notice, light mode': { user: 'helper' },
  '/helper/payouts||Payouts page with instant payout button, light mode': { user: 'helper' },
  '/helper-earnings/statements||Earnings statements list with synthetic data, light mode': { user: 'helper' },
  '/dashboard?tab=earnings||Earnings tab with synthetic data (flag enabled), light mode': { user: 'helper' },
  '/jobs||Jobs page with synthetic listings, light mode': { user: 'helper' },
  '/jobs||Jobs page with filters open and synthetic listings, light mode': { user: 'helper' },
  '/jobs||Jobs page with filters open, light mode': { user: 'helper' },
  '/saved-searches||Saved searches page with one synthetic search, light mode': { user: 'helper' },
  '/dashboard?tab=invoices||Invoices tab with synthetic invoices, light mode': { user: 'helper' },
  '/dashboard?tab=invoices||Create Invoice dialog open, light mode': { user: 'helper' },
  '/dashboard?tab=invoices||Create Invoice dialog filled with synthetic data, light mode': { user: 'helper' },
  '/dashboard?tab=invoices||Invoices tab with a sent invoice, light mode': { user: 'helper' },
  '/invoice/p/:token||Public invoice view, synthetic data, light mode': { user: 'guest', url: '/invoice/p/sop-token-001' },
  '/dashboard?tab=editprofile||Edit Profile tab open, synthetic helper data, light mode': { user: 'helper' },
  '/dashboard?tab=editprofile||Basic Info section filled with synthetic helper data, light mode': { user: 'helper' },
  '/dashboard?tab=editprofile||Services section with two synthetic services, light mode': { user: 'helper' },
  '/dashboard?tab=editprofile||Photos section with synthetic photos, light mode': { user: 'helper' },
  '/dashboard?tab=editprofile||Availability section with weekly hours, light mode': { user: 'helper' },
  '/helpers/:id||Public helper profile with synthetic data, light mode': { user: 'guest', url: '/helpers/sop-helper-1' },
  '/messages/:conversationId||Conversation open, synthetic messages, light mode': { user: 'helper', url: '/messages/sop-conv-1' },
  '/messages/:conversationId||Share a quote panel open, light mode': { user: 'helper', url: '/messages/sop-conv-1' },
  '/messages/:conversationId||Quick build tab with two synthetic line items, light mode': { user: 'helper', url: '/messages/sop-conv-1' },
  '/messages/:conversationId||Quick build tab with one synthetic line item, light mode': { user: 'helper', url: '/messages/sop-conv-1' },
  '/messages/:conversationId||Quote card posted in thread, synthetic data, light mode': { user: 'helper', url: '/messages/sop-conv-1' },
  '/dashboard?tab=quotes||Quotes tab with synthetic sent quotes, light mode': { user: 'helper' },
  '/dashboard?tab=skills||Skills tab with one synthetic skill, light mode': { user: 'helper' },
  '/dashboard?tab=skills||Add a Skill dialog open, light mode': { user: 'helper' },
  '/dashboard?tab=skills||Add a Skill dialog filled with synthetic data, light mode': { user: 'helper' },
  '/dashboard?tab=skills||Skills tab with two synthetic skills, light mode': { user: 'helper' },
});

/* ================= hiring area ================= */
Object.assign(RECIPES, {
  '/book/:id||Booking page loaded with slots, signed in, light mode': { user: 'customer', url: '/book/sop-helper-1' },
  '/book/:id||Slot selected, terms agreed, signed in, light mode': {
    user: 'customer', url: '/book/sop-helper-1',
    actions: [{ eval: `(() => { const s=[...document.querySelectorAll('button')].find(b=>/9:00|10:00|slot/i.test(b.textContent)); if(s) s.click(); const t=document.querySelector('input[type=checkbox]'); if(t && !t.checked) t.click(); })()` }, { settle: 800 }],
  },
  '/my-bookings||Bookings list with pending booking, signed in, light mode': { user: 'customer' },
  '/my-bookings||Bookings list with cancel confirm, signed in, light mode': {
    user: 'customer',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/cancel/i.test(x.textContent)); if(b) b.click(); })()` }, { settle: 800 }],
  },
  '/my-bookings||Bookings list, signed in, light mode': { user: 'customer' },
  '/jobs/:id||Cancel this job dialog open, signed in, light mode': {
    user: 'customer', url: '/jobs/sop-job-1',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/cancel.*job/i.test(x.textContent)); if(b) b.click(); })()` }, { settle: 800 }],
  },
  '/jobs/:id||Cancel job dialog open, signed in, light mode': {
    user: 'customer', url: '/jobs/sop-job-1',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/cancel/i.test(x.textContent)); if(b) b.click(); })()` }, { settle: 800 }],
  },
  '/settings/payment-policies||Payment and Cancellation Policies page, helper, signed in, light mode': { user: 'helper' },
  '/jobs/:id||Job detail, Bids section visible, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Job detail with bids, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/bids/:bidId||Bid Details page, signed in, light mode': { user: 'customer', url: '/bids/sop-bid-1' },
  '/jobs/:id||Bid accepted, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Finished job detail, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Job completed confirmation, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Completed job with review action, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Leave a Review dialog filled in, signed in, light mode': {
    user: 'customer', url: '/jobs/sop-job-1',
    actions: [
      { eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/review/i.test(x.textContent)); if(b) b.click(); })()` },
      { settle: 800 },
      { eval: `(() => { const t=document.querySelector('textarea'); if(t){ t.focus(); document.execCommand('insertText',false,'Great work, very professional.'); t.dispatchEvent(new Event('input',{bubbles:true})); } })()` },
    ],
  },
  '/jobs/:id||Review submitted confirmation, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/jobs/:id||Review with respond action, signed in, light mode': { user: 'customer', url: '/jobs/sop-job-1' },
  '/agreements/:id||Work agreement with Confirm complete, signed in, light mode': { user: 'customer', url: '/agreements/sop-ag-1' },
  '/agreements/:id||Signature pad open, signed in, light mode': {
    user: 'customer', url: '/agreements/sop-ag-1',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/sign/i.test(x.textContent)); if(b) b.click(); })()` }, { settle: 800 }],
  },
  '/agreements/:id||Change orders section, signed in, light mode': { user: 'customer', url: '/agreements/sop-ag-1' },
  '/agreements/:id||Agreement with vault and warranty sections, light mode': { user: 'customer', url: '/agreements/sop-ag-1' },
  '/agreements/new||New work agreement form filled in, signed in, light mode': { user: 'customer' },
  '/disputes||Dispute center with disputes listed, signed in, light mode': { user: 'customer' },
  '/disputes/:id||Dispute detail, evidence section open, signed in, light mode': { user: 'customer', url: '/disputes/sop-dsp-1' },
  '/disputes/:id||Dispute detail, messages thread, signed in, light mode': { user: 'customer', url: '/disputes/sop-dsp-1' },
  '/helpers||Directory loaded with search results, guest, light mode': { user: 'guest' },
  '/helpers||Filters open, guest, light mode': {
    user: 'guest',
    actions: [{ eval: `(() => { const b=[...document.querySelectorAll('button')].find(x=>/filter/i.test(x.textContent)); if(b) b.click(); })()` }, { settle: 600 }],
  },
  '/helpers/:id||Public helper profile loaded, guest, light mode': { user: 'guest', url: '/helpers/sop-helper-1' },
  '/helpers/:id||Helper profile hero with CTAs, guest, light mode': { user: 'guest', url: '/helpers/sop-helper-1' },
  '/my-jobs||My Jobs list with posted jobs, signed in, light mode': { user: 'customer' },
  '/messages||Messages inbox with conversations, signed in, light mode': { user: 'customer' },
  '/messages/:conversationId||Conversation thread open, signed in, light mode': { user: 'customer', url: '/messages/sop-conv-1' },
  '/orders||Order History with orders, signed in, light mode': { user: 'customer' },
  '/orders/:id||Order detail with payment records, signed in, light mode': { user: 'customer', url: '/orders/sop-order-1' },
  '/food/track/:token||Food order tracking page, guest, light mode': { user: 'guest', url: '/food/track/sop-token-001' },
  '/post-job||Blank post-job form step 1, signed in, light mode': { user: 'customer' },
  '/post-job||Job description step filled in, signed in, light mode': {
    user: 'customer',
    actions: [{ eval: `(() => { const t=document.querySelector('textarea[name=description]'); if(t){ t.focus(); document.execCommand('insertText',false,'Kitchen faucet drips constantly, needs repair.'); t.dispatchEvent(new Event('input',{bubbles:true})); } })()` }],
  },
  '/post-job||Location, schedule, and budget step, signed in, light mode': { user: 'customer' },
  '/post-job||Review and Post step, signed in, light mode': { user: 'customer' },
  '/direct/request-quote||Blank quote request form, guest, light mode': { user: 'guest' },
  '/direct/request-quote||Quote request form filled in, guest, light mode': {
    user: 'guest',
    actions: [{ eval: `(() => { const t=document.querySelector('textarea'); if(t){ t.focus(); document.execCommand('insertText',false,'Need faucet repair quote.'); t.dispatchEvent(new Event('input',{bubbles:true})); } })()` }],
  },
  '/direct/request-quote||Quote request sent confirmation, guest, light mode': { user: 'guest' },
  '/direct/view-quote||View your quote code lookup, guest, light mode': { user: 'guest' },
});

/* ================= restaurants area ================= */
Object.assign(RECIPES, {
  '/orders/:orderId||Order detail page with actions, light mode': { user: 'customer', url: '/orders/sop-order-1' },
  '/orders/:orderId||Order detail with Cancel order button, light mode': { user: 'customer', url: '/orders/sop-order-1' },
  '/food/orders/:orderId||Order detail with Get help panel, light mode': { user: 'customer', url: '/food/orders/sop-order-1' },
  '/food/orders/:orderId||Cancelled order with payment status, light mode': { user: 'customer', url: '/food/orders/sop-order-1' },
  '/restaurants/merchant||Order center with order detail and Cancel button, light mode': { user: 'restaurant' },
  '/restaurants/kitchen/:restaurantId||Kitchen ticket with Recall button, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/kitchen/:restaurantId||Kitchen display with ticket columns, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/kitchen/:restaurantId||New ticket with Acknowledge button, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/kitchen/:restaurantId||Preparing ticket with item buttons, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/kitchen/:restaurantId||Ready ticket with Mark ready button, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/kitchen/:restaurantId||Ready ticket with Confirm handoff button, light mode': { user: 'restaurant', url: '/restaurants/kitchen/sop-rest-1' },
  '/restaurants/merchant||Menu manager with items listed, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Menu manager with category field highlighted, light mode': { user: 'restaurant' },
  '/restaurants/merchant||New item editor with fields filled, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Option group editor, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Item actions and bulk publish controls, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Item marked sold out, light mode': { user: 'restaurant' },
  '/food||Food directory with restaurant results, light mode': { user: 'guest' },
  '/food/restaurants/:restaurantId||Restaurant page menu tab, light mode': { user: 'guest', url: '/food/restaurants/sop-rest-1' },
  '/food/restaurants/:restaurantId||Restaurant page with items in the order tray, light mode': { user: 'guest', url: '/food/restaurants/sop-rest-1' },
  '/food/restaurants/:restaurantId||Cart with items and checkout button, light mode': { user: 'guest', url: '/food/restaurants/sop-rest-1' },
  '/food/restaurants/:restaurantId||Payment method selection, light mode': { user: 'guest', url: '/food/restaurants/sop-rest-1' },
  '/food/restaurants/:restaurantId||Order summary with Place order button, light mode': { user: 'guest', url: '/food/restaurants/sop-rest-1' },
  '/food/track/:token||Order placed confirmation with live status, light mode': { user: 'guest', url: '/food/track/sop-token-001' },
  '/food/track/:token||Track Order page with order status, light mode': { user: 'guest', url: '/food/track/sop-token-001' },
  '/restaurants/runner/:restaurantId||Runner page with new delivery offers, light mode': { user: 'restaurant', url: '/restaurants/runner/sop-rest-1' },
  '/restaurants/runner/:restaurantId||Active delivery task with location sharing, light mode': { user: 'restaurant', url: '/restaurants/runner/sop-rest-1' },
  '/restaurants/runner/:restaurantId||Delivery task with proof form, light mode': { user: 'restaurant', url: '/restaurants/runner/sop-rest-1' },
  '/restaurants/runner/:restaurantId||Runner settlements section, light mode': { user: 'restaurant', url: '/restaurants/runner/sop-rest-1' },
  '/restaurants/runner/:restaurantId||Runner page with tasks, light mode': { user: 'restaurant', url: '/restaurants/runner/sop-rest-1' },
  '/food/queue/:restaurantId||Queue board with ready orders, light mode': { user: 'guest', url: '/food/queue/sop-rest-1' },
  '/restaurant-credit||Restaurant credit activity with Dispute button, light mode': { user: 'customer' },
  '/restaurants/merchant||Restaurant credit manager refund form, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Issue Refund dialog, light mode': { user: 'restaurant' },
  '/restaurants/support/cases/:caseId||Support case detail with reply box, light mode': { user: 'restaurant', url: '/restaurants/support/cases/sop-case-1' },
  '/restaurants/merchant||Restaurant dashboard with restaurant list, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Add your restaurant form, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Setup checklist with incomplete steps, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Fund your credit reserve panel, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Settings tab ordering section, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Settings tab At a glance chips, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Ordering and kitchen workflow sections, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Operating hours editor, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Money section with tax and direct payment, light mode': { user: 'restaurant' },
  '/restaurants/merchant||In-store screens links, light mode': { user: 'restaurant' },
  '/restaurants/merchant||Operations tab with checklists and SOPs, light mode': { user: 'restaurant' },
  '/restaurants/pos/:restaurantId||POS with items and ticket, light mode': { user: 'restaurant', url: '/restaurants/pos/sop-rest-1' },
  '/restaurants/pos/:restaurantId||POS payment panel, light mode': { user: 'restaurant', url: '/restaurants/pos/sop-rest-1' },
  '/restaurants/inventory/:restaurantId||Inventory list with adjust dialog, light mode': { user: 'restaurant', url: '/restaurants/inventory/sop-rest-1' },
  '/restaurants/inventory/:restaurantId||Inventory purchase order form, light mode': { user: 'restaurant', url: '/restaurants/inventory/sop-rest-1' },
  '/restaurants/crew/:restaurantId||Crew page with shifts and checklists, light mode': { user: 'restaurant', url: '/restaurants/crew/sop-rest-1' },
});

Object.assign(RECIPES, {
 '/oxsteed-credit/statements/archive||Export panel with request form, light mode': {user:'customer',actions:[{click:'details.sa-export-disclosure > summary'}]},
 '/oxsteed-credit/statements/archive||Export form with parameters filled, light mode': {user:'customer',actions:[{click:'details.sa-export-disclosure > summary'}]},
});
