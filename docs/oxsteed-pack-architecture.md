# OxSteed — Pack Architecture: Personas × Countries

**Last updated:** 2026-06-10
**Supersedes/combines:** `docs/oxsteed-four-tabs-by-persona.md` (per-persona tab experiences) + the country-pack architecture decisions of 2026-06-10.
**Companion to:** `docs/oxsteed-product-definition.md` (what the product *is*; this document defines how it's *built and updated*).

---

## 1. The one rule

> **Anything that varies — by persona or by country — is a pack you register, never a condition you check.**

The enemy of independent updates is the scattered `if`: `if persona == .helper`, `if country == "US"`. Every such line couples experiences together, so improving one risks breaking another. In this architecture those conditions are forbidden outside the registry. A persona is a sealed module. A country is a sealed module. You add one, update one, or remove one by touching *its* files only.

**The guarantee, stated as the product requirement it came from:**

- Ship a better Helper experience → no Customer file is in the diff → the Customer experience *cannot* change.
- Add Rwanda → no US file is in the diff → the US experience *cannot* change.
- Same mechanism, both axes.

---

## 2. The composition formula

Every screen any user ever sees is the product of three layers:

```
Experience = Base × PersonaPack × CountryPack
```

```
┌────────────────────────────────────────────────────────────┐
│ BASE (country-agnostic, persona-agnostic)                  │
│  4-tab shell · auth · networking · Pulse engine ·          │
│  Learn engine · Growth ladder engine · jobs/bids/payments  │
│  core logic · design system · i18n machinery               │
├────────────────────────────────────────────────────────────┤
│ PERSONA PACKS (one sealed module per persona)              │
│  Customer · Helper · BusinessOwner · Consultant ·          │
│  ToolOwner · Franchise · Investor                          │
│  └ Business sub-role packs: Manager · Representative ·     │
│    ChatSupportAgent · Employee                             │
│  Each defines: Tab 1, Tab 3, Tab 4 composition, lingo,     │
│  ladder steps, default screens. (Tab 2 comes from Base.)   │
├────────────────────────────────────────────────────────────┤
│ COUNTRY PACKS (one sealed config+adapters set per country) │
│  US · HT · RW · …                                          │
│  Each defines: payment rails, currency, languages,         │
│  categories, verification, addressing, connectivity        │
│  profile, enabled personas, compliance copy, trust model   │
└────────────────────────────────────────────────────────────┘
```

A Rwandan Helper gets: Base + the Helper pack's tabs + the RW pack's rails (MoMo instead of Stripe, Kinyarwanda strings, moto-repair categories, low-data defaults). A US Helper gets the *same Helper pack* with the US pack's rails. Neither country's team edited the other's files; neither persona's team edited another persona's files.

### Precedence rules (who wins when layers disagree)

1. **Country can veto, never redesign.** A country pack may disable a persona (Rwanda launches without Investor), swap an adapter (payment, verification, addressing), or filter content (categories, guides). It may **not** restructure a persona's tabs — that belongs to the persona pack. This keeps "the Helper experience" one thing worldwide, dressed locally.
2. **Persona defines structure; country defines substance.** Tabs, sections, ladder shape = persona. Currencies, rails, categories, language, compliance = country.
3. **Base defines physics.** Escrow logic, two-way reviews, Pulse math — no pack may alter these; packs may only configure exposed parameters.

---

## 3. Pack mechanics — how update independence is real, not aspirational

### 3.1 Persona packs: isolation by compiler

Each persona is a local Swift Package (iOS) / workspace package (web). The shell is a thin composition root (~200 lines): tab bar, persona switcher, deep-link router, registry.

```swift
// The only contract a persona pack exposes:
protocol PersonaModule {
    var id: Persona { get }
    func tab1() -> AnyView            // operate
    func tab3() -> AnyView            // move up
    func tab4() -> AnyView            // get better
    var ladder: [LadderStepSpec] { get }
    // Tab 2 (Pulse) is provided by Base/OxLife for everyone.
}

// The registry — the ONLY place persona identity is switched on:
let registry: [Persona: any PersonaModule] = [
    .customer: CustomerModule(), .helper: HelperModule(), …
]
```

- `PersonaHelper` cannot import `PersonaCustomer` — the dependency does not exist in its `Package.swift`. Cross-contamination is a **compile error**, not a code-review catch.
- Each pack has its own demo app target: run "just the Helper app" in the simulator. Designers iterate on one persona in isolation.
- Each pack has its own test suite. CI rule: a PR touching only `PersonaHelper/` must pass the full suites of all *other* packs unchanged — trivially true, since their code didn't change.
- Shared engines (Pulse, Learn, Growth ladder) live in Base packages (`OxCore`, `OxDesign`, `OxLife`, `OxLearn`, `OxGrowth`). Personas consume them through stable, versioned interfaces. **Pulse never forks.**

### 3.2 Country packs: isolation by config + adapters

A country pack is (a) a server-side config record and (b) a set of adapter implementations behind Base interfaces.

```
GET /api/country-config?country=RW
→ {
    currency, locales, enabled_personas, categories,
    payment_methods, verification_provider, address_scheme,
    connectivity_profile, notification_channels,
    feature_flags, compliance_copy_refs, pricing_ref
  }
```

- Base defines the interfaces: `PaymentRail`, `VerificationProvider`, `AddressScheme`, `NotificationChannel`, `ConnectivityProfile`. Country packs supply implementations. No `if country` anywhere else.
- **The US is pack #1, not the base.** Stripe, ZIP codes, imperial units, always-online assumptions — all live in the US pack. If an American assumption leaks into Base, Rwanda doesn't *add* a pack, it *fights* the base. That fight is where regressions come from.
- The backend already keys by country (`pricing_overrides`, `country_access_rules`, `trade_rules`, logistics lanes, `admin_regions`); the country-config endpoint consolidates them into one surface.

### 3.3 The two kinds of update (both axes)

| Update type | Mechanism | Who's affected | Speed |
|---|---|---|---|
| **Config update** | Server-side: flags, categories, pricing, copy, enabled personas | Only the targeted country (or persona within a country) | Instant, no release |
| **Code update** | New pack code ships inside the shared binary, **dark** | Everyone downloads it; only the targeted pack *executes* it | App-release cadence |

**Ship dark, light up with config.** Rwanda's MoMo adapter ships disabled in v3.4; you flip the flag server-side for RW only, optionally to 5% of Rwandan users first. Release timing and activation timing are two separate decisions. The same applies to personas: a rebuilt Consultant Tab 1 ships dark and lights up for consultants only — even per-country ("new Consultant pipeline live in US, not yet in HT").

**Separate binaries** (an "OxSteed Rwanda" store listing with its own bundle ID) remain available via per-country build targets when a country needs different release schedules, branding, or legal separation — the pack architecture makes that cheap later. Default to one binary.

### 3.4 The update-independence matrix

| Change | US Customer | US Helper | RW Customer | RW Helper |
|---|---|---|---|---|
| Edit Helper pack code | — | ✔ next release | — | ✔ next release |
| Flip Helper flag for US only | — | ✔ instant | — | — |
| Edit RW country config | — | — | ✔ instant | ✔ instant |
| Add new country (CD) | — | — | — | — |
| Edit Base (e.g., Pulse engine) | ⚠ all | ⚠ all | ⚠ all | ⚠ all |

The last row is the honest caveat: **Base changes touch everyone.** That's the point of keeping Base small, interface-stable, and guarded by a contract-test suite every pack must pass. The discipline shifts from "don't touch other experiences" (the architecture enforces that) to "keep Base boring."

---

## 4. The persona axis — the four tabs per pack

The tabs change clothes, never bones: Tab 1 = *operate*, Tab 2 = *my life* (constant, from Base), Tab 3 = *move up*, Tab 4 = *get better*. Lingo is respectful mimicry — the words used on the job site, in the office, on the call. Deep links and push always land in Tab 1, whatever it's named.

| Persona pack | Tab 1 | Tab 2 | Tab 3 | Tab 4 |
|---|---|---|---|---|
| Customer | **Today** | Pulse | **Plan** | **Learn** |
| Helper | **Jobs** | Pulse | **Level Up** | **Skills** |
| Business Owner | **Shop** | Pulse | **Scale** | **Academy** |
| Consultant | **Clients** | Pulse | **Practice** | **Playbooks** |
| Tool Owner | **The Yard** | Pulse | **Fleet** | **Workshop** |
| Franchise Owner | **Territory** | Pulse | **Expansion** | **Academy** |
| Investor | **Portfolio** | Pulse | **Deal Flow** | **Diligence** |
| — Manager | **Ops Board** | Pulse | **Bench** | **Crew Training** |
| — Representative | **Pipeline** | Pulse | **Targets** | **Scripts** |
| — Chat Support Agent | **Queue** | Pulse | **Track** | **Triage Lab** |
| — Employee | **My Day** | Pulse | **Path** | **Skills** |

### 4.1 Customer pack

*Lingo: "quotes," "the guy/the gal," "get someone out here," "what's it gonna run me."*

- **Today** — opens on "Your next move": one job, one action (*"3 quotes came in on 'Fix the fence' — pick one"*). Jobs sorted by what needs them (review quotes → confirm schedule → in progress → leave a review). **My People** (saved helpers, one-tap rebook). Money group: *"Your money's held safe until the work's done."* Primary button: *"What needs doing?"*
- **Pulse** — the fullest Life experience: 6-pillar ring, urgency queue where every item offers both doors (DIY guide or hire, with local price range), planned needs (*"Brakes due around August — we'll line up quotes two weeks before"*), sinking funds in kitchen-table language.
- **Plan** — ladder: get your pulse going → plan 3 needs ahead → put 2 jobs out there → try a guide yourself. Deals nearby, seasonal price intel, sinking-fund suggestions. Quiet door at the bottom: *"Handy yourself? People near you are paying for what you already know."*
- **Learn** — hero *"Learn before you hire."* Scoping, judging quotes, spotting good work. Every guide ends with **Do it myself** or **Get it done**.

### 4.2 Helper pack

*Lingo: "jobs," "bids," "the rate," "booked solid," "my truck," "getting paid."*

- **Jobs** — list/map of nearby work, distance + budget + **Bid** on every card (three taps from open to bid-in). Stat strip: Earned this month · Jobs nearby · Bids out · My rating. Schedule + Availability (*"You're marked open Friday–Sunday"*). Rate-your-customers queue. Get-paid status: *"$340 lands Tuesday."*
- **Pulse** — Money pillar leads, fed by payouts; honesty over pep (*"Lighter week. Your regulars usually book around the 1st"*). Truck & tools under Car Care/Sinking Funds. Rest guarded: *"You've worked 9 days straight. Sunday's empty — keep it that way?"*
- **Level Up** — ladder: first guide done → stack 5 jobs → earn 3 badges → go bigger (financing, wholesale, your own shop). Wholesale crews (*"Buy like a contractor, pay like a crew"*). Gear financing framed as work math. **Your storefront**: profile share + QR — *"Slap it on the truck."*
- **Skills** — hero *"Skills that turn into income."* Every guide leads with the money line (*"Re-grout tile — 2 hrs, ~$80 kit, jobs run $150–300"*). Finish → one-tap *Add to my services*; category done → public badge. *"Teach it back"* submission door.

### 4.3 Business Owner pack

*Lingo: "the shop," "the books," "my crew," "callbacks," "what's the margin."*

- **Shop** — signals strip first (late jobs, unread customers, low stock, health alerts), then the dispatch Board (today's jobs, who's on what, unassigned), then the grouped Console: Crew & Vortex codes · Invoices & Quotes · Services & Pricing · Clients & Leads · Products & Inventory · Expenses & Books. Payout QR: *"They scan, you're paid."*
- **Pulse** — deliberately personal, not P&L: *"The shop's fine. How are you?"* Owner-burnout watch; personal sinking funds.
- **Scale** — ladder: systematize (templates, workflows, pricing rules) → staff it (first Vortex hire) → fund it (financing, volume wholesale) → multiply (second location, franchise talk). Commercial/facility-manager demand surfaced. Consulting intake: *"Stuck between 'busy' and 'bigger'? That's what consultants here untangle."*
- **Academy** — hero *"Train your team faster."* Guides as onboarding tracks ("New tech, week one"); badge completion per crew member. *"Publish your playbook — businesses that teach get hired."*

The four sub-role packs (4.8–4.11) plug in under this pack via Vortex codes and the permission system.

### 4.4 Consultant pack

*Lingo: "engagement," "the pipe," "discovery call," "retainer," "my book of business."*

- **Clients** — pipeline header (Active · Won · Pipeline $ · Generated $), stage pipeline (intake → discovery → proposal → engaged → won/lost), today's sessions, client inbox (*"Rivera follow-up is 4 days cold"*), activity feed.
- **Pulse** — smooths feast-or-famine: *"Strong quarter. Your slow season starts in November — retainer push now?"*
- **Practice** — ladder: define your offer → productize → build the engine (intake leads flowing) → become the name. Warm leads from Growth's consulting intake land here.
- **Playbooks** — hero *"Share what you know."* Workflows for consumption; **authorship as the hero CTA** (*"One good playbook onboards a hundred future clients"*). Published-guide reach stats: *"312 people finished your pricing guide."*

### 4.5 Tool Owner pack

*Lingo: "the yard," "my gear," "out on rent," "deposit," "bring it back clean."*

- **The Yard** — Out / Due / Idle strip; catalog cards with day rate, status, lifetime earnings (*"Tile saw: $1,240 since March"*); launch checklist for first listing; today's handoffs with condition checklists (*"Walk around it together — 30 seconds now saves an argument later"*).
- **Pulse** — Sinking Funds leads: *"The pressure washer has paid for its replacement 1.4× over."* Gear maintenance in the urgency queue.
- **Fleet** — ladder: first tool live → five clean rentals → fill the gaps (demand radar: *"4 jobs nearby needed a pressure washer last month"* — monthly at most, dismissible forever) → run a real fleet (pooled wholesale buying).
- **Workshop** — hero *"Rent smarter."* Prep, photos, pricing, damage calls. Renter-side guides as protection: *"A renter who watched it brings it back working."*

### 4.6 Franchise Owner pack

*Lingo: "my territory," "operators," "coverage," "good standing," "density."*

- **Territory** — at-a-glance (active operators, jobs flowing, coverage map with cold zones), application status (collapses post-onboarding), operator roster + onboarding pipeline + escalations, compliance checklist in plain words (*"2 items before your Q3 review. Both under an hour."*).
- **Pulse** — personal: *"Record week for the territory. You've also been on the road 12 days this month."*
- **Expansion** — ladder: stand it up → cover the map (every core category staffed) → deepen the bench (2+ per category) → earn the next territory. Territory-scale Vortex codes, prospect lists, territory-scale financing.
- **Academy** — hero *"Operate with consistency."* Standards, QA, coaching; badge telemetry across operators as a mirror, not a whip (*"Your plumbing badge rate: 84%. Network: 71%."*).

### 4.7 Investor pack

*Lingo: "the book," "exposure," "operator quality," "unit economics," "signal, not noise."*

- **Portfolio** — revenue trend (unsmoothing, bad weeks visible), platform health, franchise pipeline, my positions with the same honest panel each.
- **Pulse** — personal; property holders get multi-unit Home Care (per-property systems, schedules, sinking funds in one ring).
- **Deal Flow** — ladder: learn the market → first position → build the book (diversified) → compound locally (operators recruiting operators). Backable opportunities with unvarnished operating data.
- **Diligence** — hero *"Know what you're buying."* Due-diligence library (`inspect-investment-property`, `estimate-repair-costs`, category economics). *"The best investments here are the people doing it right."*

### 4.8 Manager pack (business sub-role)

*Lingo: "the board," "who's on," "unassigned," "running late," "escalate it to me."*

- **Ops Board** — today's jobs by crew member, color by status, unassigned glowing (*"2 jobs unassigned tomorrow. Dre and Kim have room."*). Widgets: today's jobs · unassigned · late · staff availability · overdue replies · open escalations. One-tap reassign. No owner books/payroll — not grayed out, simply absent.
- **Pulse** — theirs: *"31 jobs closed this week. Your own furnace filter is overdue — funny how that works."*
- **Bench** — ladder: run a clean week → build the bench (2 people per job type) → develop someone (a crew badge under your watch) → run it like it's yours. *"Managers who develop people stop being the only one who can fix things."*
- **Crew Training** — assign tracks, see per-person badge progress; their own guides (scheduling, work-order quality, hard-customer calls). *"A trained crew is a quiet radio."*

### 4.9 Representative pack (business sub-role)

*Lingo: "leads," "the pipe," "follow-up," "closed it," "hot one."*

- **Pipeline** — lands on Leads; aging shown honestly (*"Ramirez lead is 26 hours old. Reps who answer in 2 win twice as often."*). Widgets: new leads · quotes awaiting · follow-ups today · consultations · conversion rate · unread lead convos. Quotes with status; scripts one swipe away.
- **Pulse** — commissions in Money: *"Best commission month yet. Also: you skipped lunch 9 times."*
- **Targets** — ladder: know the offer cold → first 10 closed → own a number → build your book (repeat clients asking for *you*). Performance self-facing first (your trend vs. your past).
- **Scripts** — templates by moment (first touch, follow-up, "thinking about it," the close); objection guides; product knowledge tracks. *"You absorb scripts until you sound like yourself, but sharper."*

### 4.10 Chat Support Agent pack (business sub-role)

*Lingo: "the queue," "tickets," "first response," "macro," "CSAT," "truck roll."*

- **Queue** — lands on the inbox; unassigned first, one-tap claim. Widgets: unassigned · first-response SLA · escalations · reschedules · CSAT · AI drafts. The clock visible but kind (*"3 in queue. Oldest: 11 min."*). Macros a swipe away; inline KB; structured one-tap escalation. **Go online/offline is theirs**, prominent, judgment-free.
- **Pulse** — shift-work care: *"0 breaks in 6 hours. The queue will survive 15 minutes."* Wages across multiple employers.
- **Track** — ladder: certified on the queue → resolve without the truck → teach the queue (answers becoming KB/macros) → choose your door (senior, manager — or the field: *"You've remote-diagnosed 60 plumbing issues. Helpers charge $90/hr to do what you describe."*). The agent→helper path named out loud.
- **Triage Lab** — remote-diagnosis guides (`diagnose-plumbing-remotely`, `diagnose-electrical-remotely`), dispatch-judgment guides, contribute-back door (*"Write it down once, never type it again."*).

### 4.11 Employee pack (business sub-role)

*Lingo: "my day," "where am I headed," "the ticket," "signed off," "clock out."*

- **My Day** — lands on the calendar; **Next Job** as a big card (tap address = directions, time window, scope, customer, gate codes). Per-job checklist: arrive → before photos → work → after photos → sign-off (*"Photos protect you as much as the customer."*). Messages scoped to their jobs only. A clean screen for a long day.
- **Pulse** — their whole life, not their shift: *"You fix other people's stuff all day. Your own brake pads are due."*
- **Path** — the dignity tab. Ladder: solid hand → badge up (visible to your boss) → take bigger tickets → your move (senior tech, crew lead — or your own helper profile: *"Everything you've done here counts. Your badges come with you."*). Never disparages staying: *"A great hand is a great career. The door's just always open."*
- **Skills** — assigned tracks beside self-chosen guides; identical badges either way. *"The shop trains you for today. The badges are yours forever."*

---

## 5. The country axis — what a country pack controls

A US user and a Congolese user differ in far more than currency. Every row below is an interface in Base with a per-country implementation in the pack:

| Dimension | US pack | RW/CD pack (illustrative) |
|---|---|---|
| Payment rails | Stripe cards + escrow | MTN MoMo / Airtel Money; cash-on-completion with photo proof |
| Trust mechanism | Escrow + background checks | Community vouching, badge density, in-person reputation |
| Identity | Didit | National ID; phone-number-as-identity |
| Categories | HVAC, lawn care, pool service | Moto repair, water delivery, solar install, tailoring |
| Connectivity | Assume online | Offline-first: queued actions, low-data image policy |
| Languages | EN/ES | Kinyarwanda, French, Swahili |
| Addressing | Street + ZIP, geocoding | Landmark-based descriptions |
| Notification fallback | Push | SMS first-class; possibly USSD entry |
| Personas at launch | All | e.g., Customer + Helper + Tool Owner first; others lit later |
| Device reality | iOS-heavy | Android/PWA-first, small storage, shared phones |
| Pricing | `pricing_overrides` USD baseline | PPP-adjusted (already supported, 24 countries seeded) |

### 5.1 How a user gets a country's experience

Country selection (signup or settings) → `GET /api/country-config?country=XX` → the app composes itself from the response. No release needed for config-level changes. Personas the country hasn't enabled simply don't appear in the switcher there.

### 5.2 Adding a country — the runbook

Adding Rwanda is creating new files, never editing US ones:

1. **Define the pack**: country-config record (currency, locales, personas, categories, flags — all `is_active: false`).
2. **Locale files**: add `rw.json` / Kinyarwanda `.lproj` (additive).
3. **Adapters**: implement `PaymentRail` (MoMo), `VerificationProvider` (national ID), `AddressScheme` — new files behind existing Base interfaces. Ship dark.
4. **Seed content**: categories, Learn guide relevance, compliance copy.
5. **Contract tests**: the RW pack passes the Base contract suite; CI re-runs all other countries' suites — trivially green, since their files didn't change.
6. **Beta**: flip `is_active` for test accounts; Rwanda appears in their country picker.
7. **Launch**: flip for everyone. US diff for the entire process: zero lines.

### 5.3 Capability vs. config — the honest boundary

Currency, categories, copy, persona availability = **config** (any pack can set them today). Offline-first sync, SMS channels, USSD = **capabilities** that must exist in Base before a pack can switch them on. Build the pack *mechanism* now while US-only (cheap now, brutal later); build heavy capabilities when the first country needing them is actually on the roadmap — behind interfaces, so they arrive as additions, not rewrites.

---

## 6. Personas get the country treatment — the symmetry, spelled out

The user requirement: *the same way a country can be updated without affecting other countries, a persona must be updatable without affecting other personas.* The mechanisms map one-to-one:

| Guarantee | Country axis | Persona axis |
|---|---|---|
| Sealed module | Country pack (config + adapters) | Persona pack (Swift/JS package) |
| No cross-imports | No `if country` outside registry | No `if persona` outside registry; packs can't import each other (compile error) |
| Add without touching others | Add-a-country runbook (§5.2) | Add-a-persona runbook (below) |
| Instant targeted update | Country config flip | Persona feature flag (optionally per-country) |
| Code ships dark | MoMo adapter dark until RW flag | Rebuilt Consultant Tab 1 dark until consultant flag |
| Staged rollout | 5% of RW users | 5% of consultants (in one country if desired) |
| CI proof | Other countries' suites unchanged | Other personas' suites unchanged |
| Independent demo | Country preview env | Per-pack demo app target |

### Adding a persona — the runbook

(E.g., promoting Facilities Manager from web role to app persona.)

1. Create `PersonaFacilitiesManager` package implementing `PersonaModule` (Tab 1/3/4 + ladder spec). New files only.
2. Add locale keys for its lingo (additive).
3. Register it in the registry — the one shared line that changes.
4. Ship dark; flip the flag for beta accounts; staged rollout; launch.
5. Country packs opt in: Facilities Manager appears only in countries whose config enables it.

Diff to the other ten personas: zero lines.

### Per-persona-per-country updates

Because flags compose across both axes, the unit of update can be as narrow as one persona in one country: *"new Helper bidding flow — live for Helpers in the US, dark everywhere else."* This is the finest-grained reality the architecture supports, and it falls out of the design for free.

---

## 7. Update-independence summary

| You want to… | You touch… | Affected users | Release needed? |
|---|---|---|---|
| Improve the Helper Tab 1 | `PersonaHelper/` only | Helpers (where flag is on) | Ship dark, flag on |
| Reword Customer copy | Customer locale keys | Customers | No (server/OTA strings) or next release |
| Add Rwanda | New RW pack files + registry row | Rwandan users only | Adapters ship dark; config instant |
| Change RW categories | RW config record | Rwandan users | No |
| Add Facilities Manager persona | New persona package + registry row | Opted-in users only | Ship dark, flag on |
| New payment rail for HT | New adapter behind `PaymentRail` | Haitian users | Ship dark, flag on |
| Change Pulse scoring | Base (`OxLife`) | **Everyone** | Yes — contract tests + all pack suites must pass |

The last row is the architecture's tax: Base is shared, so Base stays small, boring, interface-stable, and heavily tested. Everything exciting happens in packs.

---

## 8. Migration from the current codebase

1. **Split `PersonaHomes.swift`** (~3,700 lines, all 7 homes) into per-persona folders. Zero behavior change.
2. **Extract Base packages**: `OxCore` (Networking/, Models/, Stores/), `OxDesign` (Design/), `OxLife` (Life/), `OxLearn` (Learn/), `OxGrowth` (Growth/ engine — ladder specs move to persona packs).
3. **Promote persona folders to packages**, each implementing `PersonaModule`; shell (`RootShellView` + registry) replaces direct references.
4. **Hunt the `if`s**: every `switch auth.activePersona` outside the registry (e.g., `growthLadder` in `GrowthTabView.swift`, hero selection in `LearnTabView.swift`) moves into the relevant persona pack as data (`LadderStepSpec`, hero spec).
5. **Build the country-config endpoint** consolidating `pricing_overrides`, `country_access_rules`, `trade_rules` + new fields (personas, payment methods, locales, flags).
6. **Make the US a pack**: move Stripe/Didit/ZIP/imperial assumptions behind `PaymentRail` / `VerificationProvider` / `AddressScheme` interfaces with US implementations. This is the single most important step for future countries.
7. **Wire CI**: per-pack test suites; PR rule — packs you didn't touch must pass unchanged; Base PRs run everything plus contract tests.
8. **Web client mirrors the same shape**: workspace packages per persona, route-level code splitting, the same country-config endpoint, the same registry pattern (`businessHubRoleMenu.js` is already halfway to a persona registry for the sub-roles).

---

## 9. Codebase anchors

| Concept | Source today |
|---|---|
| Tab shell | `ios/build-atom/Shell/RootShellView.swift` |
| Persona enum + switcher | `ios/build-atom/Models/Persona.swift`, `Home/PersonaSwitcherSheet.swift` |
| All persona homes (to be split) | `ios/build-atom/Home/PersonaHomes.swift` |
| Persona-conditional ladder (to move into packs) | `ios/build-atom/Growth/GrowthTabView.swift` (`growthLadder`) |
| Persona heroes in Learn (to move into packs) | `ios/build-atom/Learn/LearnTabView.swift`; web `client/src/pages/LearnModePage.jsx` |
| Sub-role registry precedent | `client/src/utils/businessHubRoleMenu.js` (`ROLE_MENUS`, `TAB_PERMISSIONS`) |
| Country-keyed backend (to consolidate) | `pricing_overrides` (migration 160), `country_access_rules` / `trade_rules` (migration 247), `admin_regions` (119), `jobs.location_country` (180) |
| Team roles under Business Owner | migration 245, `server/services/permissionsService.js` |
| i18n machinery | `client/src/i18n.js` + `locales/{en,es,fr,ht}.json`; iOS `*.lproj` + `LocalizationManager` |
