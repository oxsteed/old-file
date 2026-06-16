# OxSteed Restaurants — In-Store + Online System Blueprint

**How the big brands run their ordering systems, and how OxSteed replicates it for any small restaurant, worldwide.**

_Last updated: 2026-06-16_

---

## 1. The goal, in plain terms

You walk into a small restaurant and offer them a system that makes them run like McDonald's:

1. **Order kiosk** — a tablet by the door. When there's a line, customers tap their order themselves instead of waiting for a cashier.
2. **Kitchen screen** — every order appears on a tablet in the kitchen, in the order it came in, so the cook knows exactly what to make and in what sequence.
3. **Pickup TV** — a screen in the dining room shows order numbers: who's being prepared, who's ready to collect.
4. **Online orders** — people order from their phone before arriving. The restaurant marks the order "ready," and the customer gets a notification to come pick it up.

All four are the *same order* moving through *one system*. That's the whole trick — it's not four apps, it's one order seen from four angles. This document shows how the big brands build that loop, what OxSteed already has, and the short list of things still needed to make it real in a live restaurant anywhere in the world.

---

## 2. How the big brands actually do it

### Self-order kiosk (McDonald's)

McDonald's kiosks are touchscreens inside the store that let a customer browse the menu, customize, and pay without a cashier. The key is that they're **tightly integrated with the POS and kitchen systems** — the kiosk creates "a direct line between you and the kitchen," so what the customer taps is exactly what the cook sees, removing the human mix-up in the middle. Big, appetizing food photos on the screen do double duty: they make the menu easy *and* lift the average order size. Payment is card / Apple Pay / Google Pay, with a **"Pay at Counter"** option for cash. McDonald's has rolled these out to 80%+ of locations globally — proof the model works across countries and languages.

### Kitchen Display System / KDS (Toast, Square)

A KDS replaces paper kitchen tickets with a digital screen. Orders from **every channel — dine-in kiosk, online, delivery — route to the kitchen screen instantly**, with no middleware. Staff tap an item to mark it complete; the system tracks how long each order takes and **alerts when an order exceeds its target time**. Larger setups route by station (fryer vs. cold prep), but a small restaurant just needs one screen showing tickets oldest-first. The point: the cook always sees the live queue, in order, and nothing gets lost.

### Order-ready / pickup board

A second screen — the one customers watch — shows order numbers split into **"Preparing" (left) and "Ready" (right).** It updates the moment the kitchen advances a ticket. This single screen "eliminates the need for staff to call out orders" and stops crowding at the counter, because everyone can see their own status. This is the dining-room TV in your description.

### Online order → "ready for pickup" notification

For phone/online orders, the modern standard is **automatic status texts at each milestone: confirmed → preparing → ready → picked up.** With Square, once the customer's phone number is captured at order time, marking the order complete on the KDS **automatically fires the "your order is ready" text** — no staff action beyond the tap they already do. This is what closes the loop for online ordering.

### Offline resilience (the unglamorous but critical part)

Restaurants have flaky Wi-Fi. Serious systems are **offline-first**: a local "hub" device holds the menu and keeps taking orders even when the internet drops, then syncs to the cloud when it returns. The hard parts the pros warn about: **deduplication** (don't double-charge or double-fire a ticket when reconnecting) and **not hiding cloud dependencies** (the kiosk must have local menu data and local order creation, or it dies the moment Wi-Fi blips). The emerging pattern is a *mesh* of in-store devices that share order state with each other even when the network is down.

### The strategic gap the big brands leave open

Here's the most important finding for OxSteed. **Toast and Square are effectively locked to a handful of countries** — roughly 96% of Toast's customers are in the US, with small footprints in Canada and the UK; Square is similar. They can't go truly worldwide because **their business model is bundled payment processing**, and payment processing is regulated country-by-country. A restaurant in Haiti, Rwanda, or Brazil largely cannot buy Toast.

OxSteed's **pay-at-counter / track-only model is the unlock.** Because OxSteed doesn't process the food payment (the restaurant takes payment in store, the platform just tracks the order and amount), OxSteed sidesteps the single biggest barrier that keeps Toast and Square out of most of the planet. That is a real, defensible reason OxSteed can be "available worldwide" where the incumbents structurally cannot.

---

## 3. The reference architecture

One cloud backend. One order record. Five front-end surfaces that all read and write that same record in real time.

```
                         ┌───────────────────────────┐
                         │     OxSteed cloud backend  │
                         │  one order record per sale │
                         │  status: received →        │
                         │  accepted → preparing →    │
                         │  ready → completed         │
                         └─────────────┬─────────────┘
                                       │ real-time (push) + REST
        ┌───────────────┬──────────────┼──────────────┬────────────────┐
        │               │              │              │                │
   ┌────▼────┐    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐   ┌──────▼──────┐
   │  KIOSK  │    │  CUSTOMER │  │  KITCHEN  │  │  PICKUP   │   │   MANAGER   │
   │ tablet  │    │ phone app │  │  display  │  │  TV board │   │   / POS     │
   │ in store│    │ (online)  │  │  (cook)   │  │ (diners)  │   │  (counter)  │
   └─────────┘    └───────────┘  └───────────┘  └───────────┘   └─────────────┘
   creates order  orders ahead   advances        shows           takes cash,
   pay at counter gets "ready"   status, sees    Preparing/       marks paid,
                  notification   the queue       Ready numbers    goes live
```

**The rule that makes it coherent:** the kiosk, the cook's tap, the counter, and the online order all touch the *same* status field on the *same* order. When the cook taps "ready," that one change instantly lights up the pickup TV *and* fires the customer's notification. Nobody re-enters anything.

---

## 4. Where OxSteed stands today (gap analysis)

OxSteed has already built most of this loop. The backend (`/api/food`) and the iOS/web surfaces exist. Here's the honest scorecard against the flow you described.

| Capability | Status in OxSteed today | Notes |
|---|---|---|
| In-store kiosk ordering on a tablet | **Built** | Kiosk self-order flow + guest ordering (no login), giant queue number, auto-reset for next customer. |
| Order routes to kitchen screen, in order | **Built** | Kitchen Display surface, live `active` order feed, New/Preparing/Ready columns, tap-to-advance. |
| Pickup TV showing Preparing / Ready | **Built** | Public queue-board endpoint + board screen, giant numbers. |
| Online ordering + "mark ready for pickup" | **Built (status side)** | Online orders create the same record; staff can advance to "ready." |
| **Customer notification when order is ready** | **MISSING** | This is the key gap. Today there is no push/SMS fan-out on order events. |
| **Real-time updates (vs. polling)** | **Partial** | Screens currently poll every 5–7s; order events broadcast to the business inbox only on a best-effort basis. Needs proper real-time push to every surface. |
| Pay-at-counter (track-only) model | **Built** | The worldwide unlock — already the platform's design. |
| Offline resilience | **MISSING** | No local hub / offline order capture yet. Needed for flaky-Wi-Fi restaurants. |
| Tablet lock-down (kiosk can't be exited) | **Not a code gap** | Handled by device setup: iPad Guided Access / Single App Mode, Android app-pinning or MDM kiosk mode. Operational, not engineering. |
| Multi-currency / multi-language | **Built / partial** | Per-restaurant currency, 5 locales (en/es/fr/ht/ar); good base for worldwide. |

**Bottom line:** the skeleton is there and working. To deliver exactly the experience you described to a real restaurant, the two things that genuinely need building are **(1) the customer "your order is ready" notification** and **(2) real-time push** so the kitchen tap lights up the TV and the customer's phone instantly. Offline mode is the third priority, important for reliability but not required for a first pilot in a place with decent Wi-Fi.

---

## 5. The critical missing piece, spelled out

Everything hinges on one event: **the cook taps "Ready."** Today that updates the order's status and (after a few seconds' poll) the pickup TV. To match the big brands, that one tap must also, in the same instant:

1. **Push to the pickup TV** — move the number from Preparing to Ready (real-time, not a 7-second poll).
2. **Notify the customer** — for online orders, send a push notification (app) or SMS (phone number captured at checkout): _"Your order #34 is ready for pickup."_
3. **Update the customer's own phone screen** — if they have the app open, the live order screen flips to "Ready."

OxSteed already has the building blocks for the notification fan-out elsewhere in the platform (web push keys, SMS via Twilio, email via Resend, a notification service). The work is wiring the food order's status-change to those channels — capturing the customer's contact at order time, and firing on the `ready` transition. This is the highest-leverage single feature on the roadmap, because it's the difference between "a digital menu" and "a system that runs the restaurant."

---

## 6. Worldwide strategy

**Payments — the deliberate non-feature.** Keep pay-at-counter as the default everywhere. It's why OxSteed can launch in countries Toast/Square can't touch. Later, *optionally*, plug in local payment rails per country (card, Apple/Google Pay where available, and mobile money like M-Pesa / MTN MoMo in Africa, Pix in Brazil) as an *add-on* — never a requirement. The order loop must work with zero payment integration so a restaurant anywhere can start day one.

**Language.** Kiosk and customer surfaces must be fully localized per market (the 5 locales today are a strong start; add markets as you expand). Big food photos reduce the language barrier further — a picture menu works in any language, which is exactly why McDonald's kiosks lean on imagery.

**Hardware — keep it cheap and off-the-shelf.** No proprietary terminals. Any iPad or Android tablet runs the apps. Lock each one to a single app: **iPad → Guided Access or MDM Single App Mode; Android → app-pinning or a kiosk-mode MDM.** A small restaurant can stand this up with tablets they buy locally plus a cheap stand — total cost a fraction of a Toast hardware bundle.

**Reliability.** Prioritize offline order capture before scaling. A restaurant that loses orders during a Wi-Fi blip will quit. A local hub device that keeps taking kiosk orders and syncs on reconnect (with deduplication so nothing fires twice) is the reliability bar to clear.

---

## 7. Phased rollout — putting it in one real restaurant

**Phase 1 — Pilot the loop (the demo that closes the deal).**
Get all four surfaces running on tablets in one restaurant with decent Wi-Fi: kiosk by the door, kitchen screen, pickup TV, and the counter/manager app. This already works today with polling. Use it to prove the in-store experience and gather the owner's feedback.

**Phase 2 — Real-time + the "ready" notification.**
Wire the status-change fan-out (Section 5): instant push to all screens, plus the customer "order is ready" push/SMS for online orders. This is what makes online ordering genuinely useful and makes the whole system feel instant. **Highest priority build.**

**Phase 3 — Offline resilience.**
Local hub device + offline kiosk order capture + dedup on reconnect. This is what lets you confidently sell to restaurants with unreliable internet — which, worldwide, is most of them.

**Phase 4 — Optional local payments.**
Per-country payment rails as an add-on for restaurants that want in-app payment. Never required.

**Phase 5 — Scale the playbook.**
A repeatable onboarding: create the restaurant, load the menu (with photos), print the kiosk/TV QR links, lock the tablets, train the staff in 20 minutes. The goal is that signing up a new restaurant takes an afternoon, not a sales cycle.

---

## 8. The in-restaurant pitch (how you walk in and offer it)

Keep it concrete and about *their* pain:

- _"When you get a line, you lose customers who won't wait. Put this tablet by the door — people order themselves, and it goes straight to your kitchen."_
- _"Your cook sees every order on this screen in the order it came in. Nothing gets lost, nothing gets forgotten."_
- _"This TV tells customers when their food is ready, so nobody crowds your counter asking."_
- _"People can order from their phone before they arrive. You tap 'ready,' they get a text, they walk in and grab it."_
- _"No special machines to buy — any tablet works. And you keep taking payment your way, at the counter. We don't touch your money."_
- _"It's your restaurant's name and look on the screen. We just power it."_

That last point matters: the customer-facing design now leads with **the restaurant's own identity** (their logo, cover photo, and a per-restaurant accent color) with a quiet "Powered by OxSteed Restaurants" — so the owner feels it's *their* system, not a takeover.

---

## 9. Sources

- [Toast — Kitchen Display Systems (KDS)](https://pos.toasttab.com/hardware/kitchen-display-system) · [Toast KDS platform guide](https://doc.toasttab.com/doc/platformguide/platformKDSOverview.html) · [Toast — KDS benefits](https://pos.toasttab.com/blog/on-the-line/kitchen-display-system)
- [Wavetec — McDonald's self-ordering kiosks](https://www.wavetec.com/blog/mcdonalds-leveraging-self-service-technologies/) · [BestKiosk — why McDonald's uses kiosks](https://www.bestkiosk.com/4-main-reasons-why-mcdonalds-is-rolling-out-self-ordering-kiosks-globally/)
- [Toast — Order Ready Board overview](https://support.toasttab.com/en/article/Order-Ready-Board-Overview-Configuration) · [Lightspeed — Order Display Screen](https://k-series-support.lightspeedhq.com/hc/en-us/articles/4413369711771-About-Lightspeed-Order-Display-Screen) · [Chowbus — order display screen](https://www.chowbus.com/blog/restaurant-order-display-screen)
- [Square — send order-ready texts](https://squareup.com/help/us/en/article/8069-text-customers-order-is-ready-with-square-for-restaurants) · [Ordering.Tools — SMS order notifications](https://www.ordering.tools/en/features/sms-notifications) · [TablesReady — Square notifications](https://www.tablesready.com/square/)
- [Toast — Offline mode with local sync](https://doc.toasttab.com/doc/platformguide/platformOfflineModeLocalSync.html) · [Why offline-first is no longer optional for POS](https://medium.com/@alabeau/why-offline-first-architecture-is-no-longer-optional-for-pos-systems-15fd6edc133b)
- [6sense — Toast market share by country](https://6sense.com/tech/pos-systems/toast-market-share) · [6sense — Square for Restaurants market share](https://6sense.com/tech/point-of-sale-pos/square-for-restaurants-market-share)
- [Appaloosa — kiosk mode (Android + iOS)](https://www.appaloosa.io/blog/kiosk-mode) · [EasyControl — iPad kiosk mode guide](https://www.easycontrol.io/blog/ipad-kiosk-mode-the-complete-2025-guide)
