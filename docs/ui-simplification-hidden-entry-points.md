# UI Simplification Hidden Entry Points

Goal: keep the website focused on two public business angles: the skills marketplace and restaurants.

No routes or page components were deleted. The items below were only removed from visible UI entry points so they can be restored later.

## Global Navigation

- Hidden desktop authenticated network switcher button.
  - File: `client/src/components/Navbar.jsx`
  - Restore by setting `SHOW_NETWORK_BRANCH_SWITCHER` to `true`.

- Hidden desktop authenticated Resources dropdown.
  - File: `client/src/components/Navbar.jsx`
  - Hidden links: How OxSteed Works, Tool Rentals, Learn, Business Hub, QR Generator.
  - Restore by setting `SHOW_LEGACY_NAV_RESOURCES` to `true`.

- Hidden desktop guest How It Works link.
  - File: `client/src/components/Navbar.jsx`
  - Restaurant navigation was added beside Browse Jobs instead.

- Hidden mobile authenticated resource links.
  - File: `client/src/components/Navbar.jsx`
  - Hidden links: How OxSteed Works, Tool Rentals, Learn, QR Generator.
  - Restore by setting `SHOW_LEGACY_NAV_RESOURCES` to `true`.

- Hidden mobile authenticated network switcher.
  - File: `client/src/components/Navbar.jsx`
  - Restore by setting `SHOW_NETWORK_BRANCH_SWITCHER` to `true`.

- Hidden mobile guest How It Works link.
  - File: `client/src/components/Navbar.jsx`
  - Restaurant navigation was added beside Browse Jobs instead.

## Network Launcher

- Hidden non-core branch cards from the shared network catalog.
  - File: `client/src/utils/networkBranches.js`
  - Hidden cards: Logistics, Business Launch, Consulting, Support Workspace, Vortex, Settings.
  - Remaining cards: OxSteed Marketplace and OxSteed Restaurants.
  - Restore by returning `[...focusedBranches, ...hiddenLegacyBranches]`.

## Footer

- Hidden footer utility pill buttons.
  - File: `client/src/components/Footer.jsx`
  - Hidden buttons: Vortex, Support Workspace, Consulting.
  - Restore by setting `SHOW_FOOTER_UTILITY_PILLS` to `true`.

## Homepage

- Hidden Discover All search tab.
  - File: `client/src/pages/HomePage.jsx`
  - Restore by setting `SHOW_DISCOVER_SEARCH_TAB` to `true`.

- Hidden Business Ascension Consulting promotional section.
  - File: `client/src/pages/HomePage.jsx`
  - Hidden CTA: Start with OxSteed Consulting.
  - Restore by setting `SHOW_BUSINESS_ASCENSION_CONSULTING` to `true`.

## Join Page

- Hidden non-core signup modes from the public mode dropdown.
  - File: `client/src/pages/JoinPage.jsx`
  - Visible modes: Customer, Helper, Business Owner.
  - Hidden modes: Investor, Logistics, Consultant, Tool Owner, Franchise Applicant, Life Only.
  - Restore by adding the mode keys back into `VISIBLE_SIGNUP_MODES`.

## Mode Switcher

- Hidden non-core modes from the signed-in navbar mode switcher.
  - File: `client/src/components/ModeSwitcher.jsx`
  - Visible modes: Customer, Helper, Business Owner, granted business roles, Admin.
  - Hidden modes: Investor, Logistics, Consultant, Tool Owner, Franchise Applicant, Life.
  - Restore by adding the mode keys back into `FOCUSED_MODE_SWITCHER_MODES`.

## Customer Dashboard

- Hidden the "What to do next" recommendation card area.
  - File: `client/src/pages/Dashboard.jsx`
  - This removes visible prompts like Learn guides from the main customer dashboard.
  - Restore by setting `SHOW_LEGACY_CUSTOMER_RECOMMENDATIONS` to `true`.

- Hidden the legacy customer dashboard tab bar.
  - File: `client/src/pages/Dashboard.jsx`
  - Hidden tabs: Money, Home, Goals, Personal Care, Car Care, Skills & Tools.
  - Restore by setting `SHOW_LEGACY_CUSTOMER_DASHBOARD_TABS` to `true` and adding desired tab IDs to `VISIBLE_CUSTOMER_DASHBOARD_TABS`.

- Hidden personal-life dashboard widgets from the pulse overview.
  - File: `client/src/pages/Dashboard.jsx`
  - Hidden widgets: Net This Month, This Week, Goals Progress, Financial Pulse, Planned Needs snapshot, Community+ upgrade CTA.
  - Restore by setting `SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS` to `true`.

- Hidden non-core customer dashboard quick actions.
  - File: `client/src/pages/Dashboard.jsx`
  - Hidden buttons: Planned Needs, Browse Tools.
  - Remaining buttons: Post a New Job, My Jobs, Browse Helpers, Messages.
  - Restore by setting `SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS` to `true` or by removing the quick-action filter.

- Hidden non-core Community Pulse stats.
  - File: `client/src/pages/Dashboard.jsx`
  - Hidden stats: Tools for Rent, Products for Sale.
  - Remaining stats: New Helpers This Week, Active Helpers.
  - Restore by setting `SHOW_PERSONAL_LIFE_DASHBOARD_WIDGETS` to `true`.

## Helper Dashboard

- Hidden the helper "What to do next" recommendation card area.
  - File: `client/src/pages/HelperDashboard.jsx`
  - This removes visible prompts like Learn guides from the helper dashboard.
  - Restore by setting `SHOW_LEGACY_HELPER_RECOMMENDATIONS` to `true`.

- Hidden the helper Growth Center promo card.
  - File: `client/src/pages/HelperDashboard.jsx`
  - Hidden button: Open Growth Center.
  - Restore by setting `SHOW_LEGACY_HELPER_GROWTH_CENTER` to `true`.

- Hidden personal-life helper dashboard tabs.
  - File: `client/src/pages/HelperDashboard.jsx`
  - Hidden tabs: Money, Home, Goals, Personal Care, Car Care.
  - Restore by setting `SHOW_LEGACY_HELPER_LIFE_TABS` to `true` and adding the tab IDs back into `FOCUSED_HELPER_DASHBOARD_TABS`.

- Hidden the helper Products tab.
  - File: `client/src/pages/HelperDashboard.jsx`
  - Restore by setting `SHOW_LEGACY_HELPER_PRODUCTS_TAB` to `true` and adding `products` back into `FOCUSED_HELPER_DASHBOARD_TABS`.

## Current Launch Policy (Authoritative)

Launch visibility is now centralized in `client/src/utils/launchScope.js`. The historical notes above describe the original local flags; use the centralized policy for future restoration.

- Publicly selectable modes: Customer, Helper, and Business Owner.
- Granted team roles remain available to users who already have them: Business Manager, Business Representative, Business Employee, and Business Support Agent.
- Admin remains available to authorized administrators.
- Future routes and implementations remain in the repository. Only their normal user-facing entry points are hidden.

### Settings Hidden For Later

- Subscription and trial promotion.
- Tool Rentals settings.
- Referral Program settings.
- Visible launch settings remain Profile, Security, Businesses, Notifications, Privacy, Account, and Delete Account.
- Restore through `LAUNCH_SETTINGS_TABS` and `LAUNCH_VISIBILITY.subscriptions`.

### Customer Dashboard Hidden For Later

- What-to-do-next recommendations and learning prompts.
- Money, Home, Goals, Personal Care, Car Care, and Skills & Tools legacy tabs.
- Net This Month, This Week, Goals Progress, Financial Pulse, Planned Needs, Home Maintenance, and Community+ upgrade widgets.
- Planned Needs and Browse Tools quick actions.
- Tool-rental and product-marketplace community statistics.
- Related hidden-feature API requests are skipped so they cannot create launch-time errors or unnecessary traffic.
- Restore with `LAUNCH_VISIBILITY.personalLifeDashboard`.

### Helper Dashboard Hidden For Later

- What-to-do-next recommendations and Growth Center.
- AI Knowledge, standalone Earnings, and Invoices tabs.
- Money, Home, Goals, Personal Care, Car Care, and Products tabs.
- Subscription/trial, Upgrade, and Pro promotion.
- Background Check promotion until the workflow is launch-ready.
- Tool-rental management and Browse Tools entry points.
- Templates and Community Pulse.
- Core launch surfaces remain Overview, Edit Profile, Availability, Find Jobs, Skills, My Bids, Reviews, Messages, identity verification, job metrics, and nearby jobs.
- Restore with the matching `LAUNCH_VISIBILITY` flag in `client/src/utils/launchScope.js`.

### Workspace And Support Entry Points Hidden For Later

- Vortex workspace entry from the business switcher.
- Network branch switcher and Resources dropdown.
- Footer utility buttons for Vortex, Support Workspace, and Consulting.
- Discover Everything and Business Ascension Consulting homepage sections.
- Default support prompts for escrow and Pro subscriptions; launch prompts explain direct payments and restaurant credit instead.

### Preserved Product Areas Hidden For Later

- Investor and affiliate products.
- Logistics, procurement, sourcing, warehousing, distribution, and internal operations workspaces.
- Consulting, tool-owner, franchise, Life, Vortex, and internal department modes.
- General products marketplace, standalone retail/discover-all, tool rentals, templates, generic QR generator, promotions, and growth tooling.
- Personal finance, goals, home maintenance, planned needs, personal care, car care, and product/tool marketplace statistics.
- Dormant Stripe/card onboarding, escrow, withdrawal, payout, and bank-style expansion UI. Restaurant credit and user-to-user direct-payment proof/confirmation remain the launch payment model.
- Advanced restaurant logistics, campaigns, cross-credit expansion, franchise, and general-navigation promotion for restaurant companion apps.
