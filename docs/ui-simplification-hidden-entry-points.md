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
