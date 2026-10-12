# Compact footer verification

Implemented on 2026-10-12 in the web client. The footer is consistent across
customer, helper, and business modes, with content-sized brand and legal cards.
Explore, Company, and Help are independent labeled navigation groups. Contact
links live in the brand card. The duplicate Consulting shortcut is removed;
Founder Development Program retains its existing destination.

Media, products, team access, and QR entry points honor their launch flags.
QR additionally requires the existing Pro entitlement. Navbar and footer use a
shared React Query membership check at `/support/agent/me`, keyed by account ID,
with one in-flight request, cancellation on account changes, no retries, and no
shortcut during unresolved, refetching, failed, or malformed results. This
changes discoverability only; the API's authorization is unchanged.

## Local evidence

- `node --test scripts/footerNavigation.test.mjs scripts/navbarNavigation.test.mjs`
  in `client/`: 13 tests passed for ordered destinations, launch/entitlement gates,
  guest and legacy accounts, and matching new labels in all five catalogs.
- `node --test scripts/navbarNavigation.browser-check.cjs`: passed 90 combinations
  of mode, language, theme, and width, plus existing disclosure, unread, mode,
  business-selection, and sign-out behaviors. Its fixture now supplies the app's
  existing QueryClient provider.
- `FOOTER_SCREENSHOT_DIR=/tmp/oxsteed-footer-qa npm run test:footer-navigation-browser`:
  passed 120 combinations (guest/customer/helper/business owner; English/French/
  Arabic; light/dark; 320/390/768/1360/1600px). Mounted real Footer and Navbar with
  synthetic API/auth data. Checked ordered links, six legal links, cookie button,
  wrapping/overflow, labeled navigation, 44px targets, natural Tab order and
  visible keyboard focus. Verified pending/error/malformed membership handling,
  immediate account isolation, late-result isolation, deduplicated requests, and
  no guest membership requests. The real shared cookie provider/dialog opened
  from the footer. A synthetic pending invitation reopened after sign-in and
  redeemed through a mocked API.
- Visually inspected English desktop, French mobile, and Arabic desktop/mobile
  screenshots. Cards, wrapped French labels, bidirectional contacts, and RTL
  alignment are correct. The fixed assistant fixture uses the existing launcher's
  responsive positioning; no footer links intersected it at the bottom of the
  page. Screenshots hide the sticky navbar only during capture to avoid its
  overlay in tall element screenshots.

- `npm run build:ci` in `client/`: passed all 277 reported tests, localization
  verification, TypeScript checking, Vite production build, and verification of
  770 emitted assets. `git diff --check` passed.

These checks use a local browser fixture, not live accounts or live invitation
redemption. They are automated keyboard/layout checks, not a human screen-reader
pass. No backend, authorization, homepage, or invitation implementation changed.

## Delivery boundary

Commit and push on the verified GitHub default branch `old-files-claude`.
Local validation and delivery are separate from deployment. Do not wait for
Coolify or poll deployment after the push; production release remains unverified
unless separately observed.
