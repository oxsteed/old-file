# PWA launches, installs and local photo sharing - 2026-10-22

The PWA shell now reuses fingerprinted assets without a network round trip, holds worker replacements until an explicit refresh, and supplies complete install metadata and local fonts. The existing unread-notification badge and display-install coach were extended rather than duplicated. No production configuration, Credit activation, provider call or live customer data was changed.

## Behavior

- Vite fingerprinted `/assets/` files use a shared cache-first asset cache. Unversioned public assets/icons revalidate in the background. API reads remain **network-only** and are never persisted. Private uploads, socket requests and unrelated writes are not cached or converted into HTML.
- Idle precaching accepts only same-origin public asset paths, uses same-origin fetches and rejects opaque, unsuccessful, private and no-store responses. It also includes module preloads. `/` is absent from installation precaching; `/offline.html` remains.
- Failed or 5xx HTML navigations show the offline page, with a reconnect button and the locally recorded last-opened timestamp. The page is translated in en/es/fr/ht/ar and does not show cached orders or balances.
- An installed replacement waits for `SKIP_WAITING`. Public and admin shells show a translated “Refresh to update” notice. Only the page whose user requests refresh reloads; another open checkout retains its form. That tab can explicitly refresh later, including after the first tab activated the worker.
- Main orientation is `any`; `display_override` is `standalone`, then `minimal-ui`. The existing server-generated display manifests request landscape for kitchen/queue and `any` for kiosk, keep their exact validated destination, and omit personal share targets/shortcuts. The display coach only appears on uninstalled, undismissed iPad Safari display routes, including desktop-style iPad user agents.
- The main manifest contains four actual UI captures: home/wallet at 1280 x 720 (`wide`), post-job/food ordering at 750 x 1334 (`narrow`). Data is synthetic. Separate opaque 192/512 maskable icons inset the existing SVG mark inside the mask-safe center; ordinary icons are retained.
- Main HTML supplies iOS standalone/title/status-bar tags and light/dark theme colors. Inter, Instrument Serif and Work Sans use self-hosted WOFF2, preserved unicode subsets, SIL OFL licenses and `font-display: swap`. Latin Inter alone is preloaded. Remote font imports were removed from the HTML, global CSS and job-page CSS. No measured LCP improvement is claimed.
- Unread notifications already updated the app badge. Badge failures are now caught, counts are bounded, focus/unmount clears it, and socket cleanup only removes this component's handler. Push payloads that supply an authoritative unread count can update the badge; badge failure never suppresses the notification. No new notification permission prompt was added.
- `source=app_shortcut` logs the fixed food/top-up/track/post-job label through the existing analytics adapter. It does not send arbitrary query strings or enable analytics, change consent, or enable growth collection.
- The share target accepts up to five JPEG/PNG/WebP/GIF images (10 MiB each, 20 MiB total). Its worker stores a bounded local IndexedDB hand-off and redirects to `/post-job?share=<uuid>`. The normal authenticated job form consumes it, attaches previews and requires the usual review/submission; there is no automatic upload or job posting. Drafts expire on read after 30 minutes, and subsequent shares prune expired/excess drafts with a maximum of five retained. Storage/format failures show a translated recovery message. Login preserves the local return URL including the share ID.

## Verification

- `node --test client/scripts/pwaShell.test.mjs client/scripts/pwaShell.browser-check.cjs client/scripts/pwaInstall.test.mjs client/scripts/i18nBootstrap.test.mjs client/scripts/routeReliability.test.mjs client/src/utils/displayInstall.test.mjs`: **54 passed**, including actual Chromium service-worker installation, idle precaching, offline navigation/reconnect, API isolation, file hand-off, retained checkout state across two tabs, and explicit activation/reload. Existing bootstrap/route tests now assert the intended cache-first contract.
- `npm --prefix server test -- --runInBand __tests__/pwaManifest.test.js`: **two passed**; display destinations, orientation and rejected external/query-bearing paths.
- `npm run build:ci` in `client/`: passed localization, type/build checks and **1,022 emitted assets**. A final production rebuild and asset verification cover the final entry/worker changes.
- `node scripts/capturePwaScreenshots.cjs` against an isolated loopback Vite server: four actual page captures, no page errors, and a shared image attached to the actual job form. All API data is intercepted and synthetic; all external requests are blocked. See `client/public/screenshots/README.md` for regeneration.
- Growth instrumentation remains **2,598/2,598**, with activation and consent rules unchanged. JavaScript syntax, PNG dimensions, mask-safe icon bounds and `git diff --check` verified.

Remote PR CI and physical Chrome/Android/iPadOS installation acceptance are separate checks. No production deployment was performed. Native install-dialog presentation, OS share-sheet discovery, notification permissions and installed-device badges still need device acceptance; browser checks do not substitute for that.

## API reference basis

[Service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers), [manifest screenshots](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots), [file share targets](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), and [WebKit home-screen badges](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/).
