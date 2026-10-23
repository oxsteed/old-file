# PWA continuity: eight follow-up improvements - 2026-10-23

Continues PR #626's caching/install changes. This batch implements all eight proposed software improvements; browser simulation and physical installed-device acceptance remain distinct.

| Item | Delivered behavior | Verification |
| --- | --- | --- |
| 1. Resume recovery | A single coalescing coordinator handles foreground return, persisted `pageshow`, and reconnection. Session revalidation precedes active query, order, wallet and message reads. Forms are retained; financial submissions are never queued or replayed. Epoch fencing rejects late session responses after logout/account changes. | Lifecycle/error tests; full production-app matrix with expired login and interrupted checkout. |
| 2. Connection indicator | Customer/admin shells show online, offline, reconnecting, last successful GET time and retry. Existing display-specific banners are preserved. API 5xx/unreachable states and expired authorization are distinguished. | API observer tests; offline/reconnect matrix. |
| 3. Bounded asset cache | Asset bodies are capped at 160 entries/80 MiB with 30-day idle expiry and an 8 MiB individual-entry limit. Writes/pruning serialize. Small metadata tracks recent use; quota failures retain usable cached responses. Private APIs/uploads are excluded. | Real worker tests and eviction regression for count/byte/age limits and other-app isolation. |
| 4. Durable draft photos | Account-scoped IndexedDB retains job text, wizard step and up to five photos (10 MiB each, 50 MiB total) for seven days. Portable byte storage works with WebKit file-picker inputs. Stable file metadata prevents multipart modification-date drift from losing photos on update. Text fallback reconciles interrupted writes without falsely claiming unsaved photos. Logout/account switch, publication, expiry and stale-write fencing are handled. Newer server text is checked before server autosave, retains local photos with an explicit review notice, and cannot replace active typing. | Real full-app reload/offline/share/update flows, quota/expiry/account-isolation races, and changing-file-date regression. |
| 5. Smaller startup | Support loads after the initial interaction window/idle or immediately on request; the command palette loads on first shortcut. Optional chunk failures show recovery controls and never automatically reload an open form. Consent and Sentry initialization retain their lifecycle. A startup dependency-closure/gzip budget runs in CI. | Measured built manifest against commit `0e721968`; first-hotkey and offline optional-module checks. |
| 6. Navigation continuity | Session/account-scoped filters, sorting and page state survive detail-page trips. Supplied URLs take precedence. History-entry scroll restores after lazy content becomes tall enough, and user scrolling cancels restoration. Helper pages rebuild saved pagination with fresh reads. | Actual router back/scroll test; memory size/account/expiry tests; production client build. |
| 7. Keyboard/safe areas | Shared visual-viewport tracking scrolls covered inputs into view, respects zoom, and cleans up listeners. Coarse-pointer inputs avoid text zoom; dialogs and form actions account for safe areas. Both HTML entrypoints use `viewport-fit=cover`. The connection indicator reserves page space and does not alter dedicated display layouts. | Viewport geometry/cleanup regression and touch-browser field-size checks. Physical keyboard/safe-area acceptance remains required. |
| 8. Automated matrix | CI runs the production app against a loopback-only synthetic API in desktop Chromium, Android-sized Chromium, and iPad-sized WebKit with installed-mode signals. Cases cover cold launch, local photos, server-text reconciliation, first-use search, resume, offline edits/reconnect, checkout state, share hand-off, explicit worker update and expired-session cleanup. | `node --test scripts/pwaInstalledMatrix.installed-check.cjs`; physical OS installation is not simulated by a real home-screen install. |

## Boundaries

- No production deployment, live provider traffic, stored-value activation or financial write was performed. Tests use synthetic accounts and intercepted/loopback services; external browser requests are blocked.
- The main HTML shell remains network-first. The offline reconnect page remains the cold-launch fallback when HTML cannot be fetched; this does not claim the entire authenticated app boots offline.
- Photo attachments remain on this device until normal job submission. Video/audio persistence is outside this photo-recovery change. Legacy unowned draft mirrors are not assigned to a guessed account.
- Local storage cleanup/expiry occurs on access, new saves and account changes. Browser eviction/private browsing can still deny storage; the form shows an explicit recovery message.
- “Last synced” means the last successful API GET observed by this shell, not proof every displayed balance or order is current.
- Desktop/mobile viewport and standalone-signal simulation does not prove Android WebAPK installation, iPadOS Home Screen behavior, OS keyboard geometry, share-sheet registration or native push permissions.

## Verification record

Client smoke tests: **565 passed**. Client `build:ci` passed localization, type checks, production compilation and **1,074 emitted assets**. **Three targeted browser checks** cover worker lifecycle, draft races/history and optional-module failure. **All three production-app matrix profiles passed**: desktop Chromium, Android-sized Chromium and iPad-sized WebKit. Commands use `client/` as working directory:

```sh
node --test scripts/*.test.mjs
npm run test:pwa:browser
npx playwright-core install webkit
npm run test:pwa:installed
npm run build:ci
node scripts/measurePwaStartup.mjs
node scripts/growthInstrumentation.mjs --check
```

The startup baseline was 850,533 initial JavaScript bytes / 255,046 gzip bytes across the static dependency closure of `index.html`, not just the entry file. Route-lazy downloads, API latency and actual LCP are separate measurements. CI enforces 800,000 JavaScript / 240,000 gzip bytes.

Startup result: **750,618 JavaScript bytes / 229,952 gzip bytes**, a reduction of **11.7% / 9.8%** against the baseline. Deferred widget downloads occur later and are excluded from the initial static closure. The budget passes.
