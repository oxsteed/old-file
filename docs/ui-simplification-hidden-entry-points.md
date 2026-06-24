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
