# OxSteed Restaurants — Go-Live Runbook (Same-Day Pilot)

**Goal: get a couple of real restaurants testing the ordering loop TODAY.**

_Last updated: 2026-06-16_

---

## The honest reality (read this first)

There are two ways to put this in a restaurant. They are NOT the same speed.

| Path | Can it happen today? | Why |
|---|---|---|
| **Website on tablets** | **Yes — today.** | Every surface (kiosk, kitchen, pickup TV, counter) already runs in a browser. A tablet browser in full-screen *is* a kiosk. Zero app-store steps. |
| **Native apps via TestFlight** | **Not today, realistically.** | Each of the 9 apps needs its own App Store Connect record, a bundle ID, code signing, an Xcode archive, an upload, and internal-tester assignment. That's hours of Mac + portal work per app, and it can only be done on your Mac with your Apple Developer account — not from here. |

**Recommendation: pilot on the website today. Start the TestFlight process in parallel on your Mac for later.** The restaurant owner will not care whether the kiosk is a browser or a native app — they care that ordering works. The web path gets you in the door this afternoon.

---

## PART A — Website pilot (do this today)

### Step 1 — Deploy the backend (if not already live)

Your server auto-runs database migrations at boot, so deploying applies the restaurant tables (305 ordering, 306 operations, 307 inventory) automatically.

- Push to the branch Coolify deploys from.
- **Required env vars or the server won't boot:** `JWT_SECRET`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`. (Stripe keys are required for the server to start even though restaurant orders are pay-at-counter — use your existing keys.)
- **Strongly recommended for the pilot:** `APP_URL` / `CLIENT_URL` (so QR/links resolve), and `AWS_S3_*` (so menu/cover photos upload instead of bloating the DB).
- After deploy, confirm the server is up and migrations 305/306/307 applied (check the `_migrations` table or the boot logs).

### Step 2 — Create the pilot restaurant (5 min, per restaurant)

1. Sign in to the website as the restaurant owner's account.
2. Go to **`/restaurants/merchant`**.
3. Fill the onboarding form: name, address, **latitude/longitude** (enter manually — geocode-on-blur isn't wired yet), currency, cuisines.
4. **Upload a logo and a cover photo, and add a photo to every menu item.** This is what makes it look like a real brand instead of a demo — the apps now render real photography. Skip this and it looks flat.
5. Build the menu: categories → items (name, price, photo, modifiers).
6. In **Settings**, set the restaurant **Go Live**, and enable **online** and **in-store** ordering as desired. Set prep time.

### Step 3 — Set up the tablets (10 min, per restaurant)

You need the restaurant's numeric **restaurant ID** (visible in the merchant URLs). Open these URLs, each on its own device, in full-screen:

| Surface | URL | Device | Login? |
|---|---|---|---|
| **Order kiosk** (by the door) | `https://YOURSITE/restaurants/kiosk/<ID>` | Customer-facing tablet | No (public, guest ordering) |
| **Pickup TV** (dining room) | `https://YOURSITE/restaurants/queue/<ID>` | TV browser / spare tablet | No (public) |
| **Kitchen screen** | `https://YOURSITE/restaurants/kitchen/<ID>` | Kitchen tablet | **Yes** — owner/staff account |
| **Counter / manager** | `https://YOURSITE/restaurants/merchant` | Counter tablet/phone | **Yes** |

**Lock each customer-facing tablet to its page** so guests can't escape it:
- **iPad:** Settings → Accessibility → **Guided Access** → on. Open the kiosk page in Safari full-screen, triple-click the side button to start Guided Access. (For a fleet, MDM "Single App Mode" is sturdier.)
- **Android:** Settings → Security → **App pinning** → on. Open the page in Chrome, pin it. (For a fleet, a kiosk-mode MDM is sturdier.)
- Tip: add the page to the home screen ("Add to Home Screen") so it opens chrome-less and full-bleed.

### Step 4 — Smoke test the loop (2 min)

1. On the **kiosk**, place a test order → you get a big queue number.
2. On the **kitchen** screen, the ticket appears in **New** → tap to advance **Preparing → Ready**.
3. On the **pickup TV**, the number moves **Preparing → Ready**.
4. On the **counter/merchant**, the order shows; tap **Mark paid**.

If all four move together, you're live. Hand the owner the counter device and let them run a real order.

### What works vs. what to tell the owner

- **Works today:** in-store kiosk ordering, kitchen queue in order, pickup board, counter mark-paid, online order placement + mark-ready *status*.
- **Not yet, be honest:** the **automatic "your order is ready" text/push to online customers** is not wired yet (the pickup TV shows ready, but the customer's phone won't buzz). For an in-store pilot this doesn't matter — the customer is standing there watching the board. Only matters if you want true order-ahead-and-leave. (This is the one feature to build next; ask and I'll wire it.)
- Screens refresh every ~5–7 seconds (polling), not instantly. Fine for a pilot.

---

## PART B — Native apps / TestFlight (start on your Mac, for later)

This is the slower track. Do it in parallel; don't block today's pilot on it. All steps below happen in **Xcode + App Store Connect on your Mac** — they cannot be done from this environment.

### Per-app, for each of the 9 targets:

1. **App Store Connect:** create an app record; reserve a unique **bundle ID** (e.g. `com.oxsteed.restaurants.customer`, `.kitchen`, `.kiosk`, …).
2. **Xcode:** select the scheme, set the bundle ID + your Team, enable automatic signing.
3. **Verify it builds:** run `build_run_sim` on the simulator for that scheme. Per your own engineering notes, the apps have **not** been compiled in a real toolchain yet — expect to fix a few signing/asset issues on first archive.
4. **Archive** (Product → Archive) → **Distribute → App Store Connect → Upload**.
5. In App Store Connect, add the build to **TestFlight → Internal Testing** and invite the restaurant's testers. (Internal testing skips Apple review and is near-instant; external testing needs a review pass.)

### Realistic shortcut for today's pilot

You almost certainly do **not** need all 9 apps to pilot. For one restaurant the loop is: **Customer (or Kiosk) + Kitchen + Manager**, plus the pickup board. If you insist on native today, get **those 3–4** onto internal TestFlight and run the rest on the website. But the website covers all of it now, so the honest advice stands: **web today, native next week.**

### Known cleanup before you scale native (from your engineering notes)

- The 8 restaurant apps duplicate five core Swift files instead of sharing a package. Fine for a pilot; consolidate into a shared Swift package before they diverge further.
- `FoodTheme.swift` was just rebuilt as the shared design system and is identical across all 9 apps — verify it compiles once in Xcode (it's additive and balance-checked, but no Swift compiler ran here).

---

## One-screen summary

1. **Deploy backend** (migrations auto-apply; set the required env vars).
2. **Create + go-live the restaurant** at `/restaurants/merchant`, with photos.
3. **Open 4 URLs on 4 tablets**, lock the customer-facing ones.
4. **Smoke-test the loop**, hand it to the owner.
5. **TestFlight** runs in parallel on your Mac — not a blocker for today.

The fastest path to a real restaurant testing this **today** is the website on tablets. Native apps are a follow-up, not a prerequisite.
