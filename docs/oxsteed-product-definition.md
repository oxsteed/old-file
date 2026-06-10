# OxSteed — Product Definition

**Last updated:** 2026-06-10
**Scope:** Defines OxSteed in its simplest form, the four modes, the full experience for all nine OxPersonas, the low-friction operating rules, and the organic-growth language system. The website and the iOS app share one backend; this document describes the product they both express.

---

## 1. OxSteed in one sentence

**OxSteed is a local economy in your pocket: it watches over your life (Life), connects you to people who can help or be helped (Home), teaches you skills that become income (Learn), and gives you a ladder to climb economically (Growth).**

The simplest mental model:

> **Life tells you what needs doing. Home gets it done. Learn makes you capable of more. Growth turns capability into a livelihood.**

Everything in the product is one of those four verbs. If a feature doesn't fit one of them, it doesn't belong.

### What OxSteed is NOT

- Not a gig app that treats people as interchangeable labor.
- Not a feed designed to maximize time-in-app. The app succeeds when the user's *life* improves, not when sessions get longer.
- Not a funnel. Personas are lenses, not tiers — nobody is upsold from one persona to another. People move when their life moves.

### The core loop

```
Life detects a need → Home matches it to a neighbor → money changes hands fairly
→ Learn levels someone up → Growth gives them capital/customers
→ they serve more needs → the local economy compounds
```

Every user is on both sides of this loop eventually. A customer who learns a skill becomes a helper. A helper who wins repeat work becomes a business. A business that systematizes becomes a franchise. The product's job is to make each transition feel natural, never forced.

---

## 2. The four modes

The app shell is four tabs (`RootShellView.swift`: home, life, growth, learn). Each mode has one job and one question it answers.

| Mode | Question it answers | Job | Posture |
|---|---|---|---|
| **Home** | "What's happening with my work right now?" | Operate. Persona-specific dashboard: jobs, bids, bookings, messages, payments, inventory, pipeline. | Reactive — surfaces what needs action, then gets out of the way. |
| **Life** | "How am I doing?" | Watch over the user's personal world via the 6-pillar Pulse (Money, Home Care, Car Care, Personal Care, Goals, Sinking Funds), urgency queue, checklists, planned needs. | Calm — a weather report, not an alarm. |
| **Growth** | "How do I move up?" | Economic mobility: the 4-step Growth Ladder, opportunities nearby, programs, financing, grants, community wholesale. | Aspirational — always available, never nagging. |
| **Learn** | "What can I become capable of?" | 57+ guides across 9 categories, persona-tailored tips, XP, skill badges, and user-submitted guides. "Skill → kit → income." | Generous — knowledge is free; it's the platform's gift and its best recruiter. |

### How the modes relate

- **Home is the only persona-switched mode.** Tapping the persona chip opens the switcher (`PersonaSwitcherSheet`); Home re-renders entirely for the active persona. Life, Growth, and Learn are persona-*aware* (content adapts) but structurally the same for everyone — this keeps the app learnable.
- **Life feeds Home.** A planned need with a due date can auto-publish as a job. A failing pillar surfaces a "get help" path. Life is the demand engine.
- **Learn feeds Growth.** Completed guides and badges advance the ladder. Badges land on public profiles as trust signals.
- **Growth feeds Home.** Financing, wholesale equipment, and programs make a user able to take bigger jobs — which they execute in Home.
- **Deep links and notifications always land in Home** — operational events (messages, bids, jobs, appointments) belong to the operating surface.

---

## 3. The OxPersonas

A persona is a *hat the user is currently wearing*, not an account type. One account can wear every hat over time. Seven personas live in the app switcher (`Persona.swift`); two more (Facilities Manager, Support Agent) currently exist as web roles with tailored Learn experiences and are defined here so the app can adopt them.

| Persona | Tagline (in product) | Primary verb |
|---|---|---|
| Customer | "Get help when you need it" | Hire |
| Helper | "Turn skills into local work" | Earn |
| Business Owner | "Run and scale your operation" | Operate |
| Consultant | "Onboard and serve clients" | Advise |
| Tool Owner | "Rent out your tool inventory" | Lend |
| Franchise Owner | "Manage your territory" | Multiply |
| Investor | "Track your portfolio" | Back |
| Facilities Manager *(web)* | "Own every system in your building" | Maintain |
| Support Agent *(web)* | "Resolve faster. Escalate smarter." | Resolve |

For each persona below: who they are, what a functioning experience looks like in each mode, what we never push, and how they grow the platform.

---

### 3.1 Customer

**Who:** A person with a household, a car, goals, and not enough time or skill for everything. The default persona — guests and new signups land here.

**Success looks like:** "I posted a need, got fair quotes from real neighbors, the work got done, and I'd trust the same person again."

**Home:** A "today" card and two metrics (Active Jobs, Open Quotes). Their jobs are sorted by *next action*, not date — "Review 3 quotes" outranks "Waiting for quotes." Each job row tells them the one thing to do: review quotes → confirm schedule → track work → review job. Below: grouped tools (Get work done / Money and trust / Supplies and account) and a recommendation feed. Guests see real nearby jobs immediately — the app proves it's alive before asking for anything.

**Life:** The fullest Life experience. The 6-segment Pulse ring, urgency queue, money summary, checklist, home/car tasks, **saved helpers** (the only persona with this card — their trusted bench), and planned needs that can auto-publish as jobs when due. Ask Pulse gives an AI read on their situation.

**Growth:** Customer-specific ladder: ① get your Pulse going → ② plan 3 needs ahead → ③ post 2 jobs → ④ learn a skill yourself. The quiet message: planning ahead saves money, and you might become a helper someday.

**Learn:** Hero: *"Learn before you hire."* Guides teach scoping jobs, comparing bids, spotting bad work — making them better customers, which makes the marketplace better for everyone.

**Never push:** Upsells to other personas. Subscription prompts inside a job flow. Notifications that aren't about *their* jobs.

**How they grow the platform:** They are the demand. Every well-scoped job posted is a paycheck for a neighbor. They also share helper profiles, leave reviews, and invite helpers they already know offline.

**Growth language moments:**
- After posting a job: *"Your job is live. Somewhere nearby, this is someone's next opportunity."*
- After completing a job + review: *"Your review just made [Helper]'s profile stronger. Know someone else who needs them? Share their profile."*
- After saving a helper: *"Good helpers stay busy because neighbors like you pass their name along."*
- Empty nearby-jobs state (guest): *"Quiet around here so far — you could be the first. Post a need and put your neighborhood to work."*

---

### 3.2 Helper

**Who:** Someone with hands, skills, and hustle — wants local work on their own schedule.

**Success looks like:** "I can see real jobs near me, bid in under a minute, get paid reliably, and watch my reputation compound."

**Home:** List/Map toggle of nearby jobs with distance and budget visible on every row; **one-tap Bid** straight from the row. Four stats: Earned This Month, Jobs Nearby, Active Bids, Rating. Quick access to Schedule and Availability. A "Rate your customers" queue (reviews are two-way — helpers have reputational power too). Recommendation feed of matched work.

**Life:** Same pulse — helpers are people first. Their Money pillar reflects earnings; the app treats their income and their life as one picture, which no gig app does.

**Growth:** The default ladder: ① complete a Learn guide → ② finish 5 jobs → ③ earn 3 skill badges → ④ scale (financing, wholesale, business formation). Opportunities show jobs, tools, and businesses. Community Wholesale lets them pool with other helpers to buy equipment at trade prices. Financing applications live here for when a job needs gear they don't own yet.

**Learn:** Hero: *"Skills that turn into income."* The core promise: watch a short guide, see the tool kit, list it as a service. Completing a guide fires the prompt: *"Add [skill] to your Helper profile?"* — one tap from learning to earning. Category badges land on their public profile.

**Never push:** Quotas, streaks, "you're falling behind" messaging. Availability is theirs; the app never guilt-trips an offline helper.

**How they grow the platform:** They are the supply and the storefront. Every helper has a shareable public profile with QR code (`/helpers/:id/profile-qr.png`) — printable on a truck, a card, a flyer. Work they win off-platform through their profile still strengthens the platform.

**Growth language moments:**
- Profile completion: *"Your profile is your storefront. Share it anywhere — every customer it brings you makes your reviews, and this whole marketplace, stronger."*
- QR code surface: *"Stick this on your truck, your invoices, your business card. You bring the customer; we handle the rest."*
- After a 5-star review: *"That review works for you forever. Customers who find you here trust you before they call."*
- After completing a guide: *"You just learned something most people pay for. List it as a service — or teach it back by submitting your own guide."*
- Slow-jobs empty state: *"Fewer jobs nearby this week. Helpers who share their profile link locally are usually the first ones called when work picks up."*

---

### 3.3 Business Owner

**Who:** A helper who graduated, or an existing local business that adopted OxSteed as its operating system.

**Success looks like:** "My team, clients, invoices, services, products, and money live in one place — and my OxSteed profile is my best marketing."

**Home:** Operational signals (health alerts, leads, unread client messages), then the Business Console: Team, Vortex (team join codes), Invoices, Services, Clients, Expenses, Products, Leads. A **Payout QR** so customers can pay on the spot. Workspace stats from the shared business backend (bookings, revenue, conversations).

**Life:** Still personal. The product deliberately keeps the owner's *personal* pulse separate from business finance — burnout shows up in Life before it shows up in revenue.

**Growth:** Opportunities filter toward businesses, tools, and contracts. Community Wholesale at business volume. Financing for expansion. Consulting intake — when they're stuck, they can hire a consultant from inside Growth. The ladder's step 4 (scale) is their daily reality.

**Learn:** Hero: *"Train your team faster."* Guides become onboarding material — a new hire watches the relevant guides and earns the badges before touching a customer's home. Business owners are also prime guide *submitters*: documenting their playbook into a public guide is marketing.

**Never push:** Feature bloat in their face. The console is grouped and collapsed; a business that only uses Invoices should never wade through nine tools. No "upgrade your plan" interstitials mid-workflow.

**How they grow the platform:** They recruit their whole team via **Vortex codes** (one code, whole crew joins). Their profile templates and share controls make their public page a destination. Their products feed the marketplace. They convert their existing offline client base into platform users one invoice at a time.

**Growth language moments:**
- Vortex code creation: *"One code brings your whole crew on board. Everyone you add can learn, earn badges, and rep your business."*
- Invoice send: *"Every invoice you send introduces another customer to OxSteed — and to your bookable profile."*
- Profile share: *"Your business page works while you sleep. Put the link in your email signature, your van, your receipts."*
- After submitting a guide: *"Your playbook is now public proof of how you work. Businesses that teach are businesses that get hired."*

---

### 3.4 Consultant

**Who:** An expert who advises rather than executes — business formation, operations, trade expertise, coaching.

**Success looks like:** "My referral pipeline, sessions, and client communication run themselves, and my expertise compounds into reputation."

**Home:** Pipeline stats (Active, Won, Pipeline $, Generated $), the Referral Pipeline view, Schedule, Client Inbox, recent activity, and a direct door into Growth ("Grow consulting practice — productize services").

**Life:** Standard personal pulse.

**Growth:** They appear on *both sides*: they consume programs and financing, and they *are* a Growth resource — the consulting intake form in Growth routes struggling businesses to them. Their ladder is about productizing: turning hourly advice into packaged offerings.

**Learn:** Hero: *"Package better services."* On the web, the consultant hero is *"Share what you know"* and its CTA opens the guide-submission modal directly. Consultants are the highest-leverage guide authors on the platform — their submissions seed entire Learn categories.

**Never push:** Lead-gen fees framing. Their pipeline is theirs; OxSteed is infrastructure, not a toll booth on relationships.

**How they grow the platform:** Knowledge and referrals. Every guide they publish recruits learners; every client they bring brings that client's network. Their referral pipeline is literally a growth instrument the product hands them.

**Growth language moments:**
- Learn hero CTA: *"Share what you know. One good guide can onboard a hundred future clients."*
- After a won engagement: *"Another business stronger because of you. Their success story is your best ad — and the platform's."*
- Guide approval: *"Your guide is live. Everyone who completes it sees your name first when they need an expert."*

---

### 3.5 Tool Owner

**Who:** Someone whose garage is an unrented warehouse — owns tools and equipment that sit idle.

**Success looks like:** "My tools earn money between my own projects, with clear bookings and no damage drama."

**Home:** Rental launch checklist (the guided zero-to-first-listing path), their tool catalog with add/edit, rental bookings, and Tool Owner actions (pricing, condition records, availability).

**Life:** Standard pulse; the Sinking Funds pillar is especially relevant — rental income mapped against equipment replacement funds is a natural fit.

**Growth:** Opportunities surface demand for tool categories near them ("3 jobs this week needed a pressure washer in your area"). Community Wholesale works in reverse for them: they can buy fleet inventory at pooled prices to expand what they rent.

**Learn:** Hero: *"Rent smarter."* Guides on preparing, pricing, photographing, and maintaining rental tools. Tool-care guides double as renter education — a renter who completed the guide is a safer renter.

**Never push:** Inventory minimums or listing pressure. One drill listed is a fine start.

**How they grow the platform:** Every listed tool makes a job cheaper for some helper, which makes a bid cheaper for some customer. Tool owners physically embed the platform in the neighborhood — their listings are local supply that Amazon can't match on a Saturday morning.

**Growth language moments:**
- First listing: *"That tool just became local infrastructure. Somewhere nearby, a helper can now take a job they'd have turned down."*
- After a completed rental: *"Your ladder helped finish a real job this week. Got more gathering dust?"*
- Idle inventory nudge (gentle, monthly at most): *"Your tile saw hasn't moved in a while. Jobs needing one were posted 4 times nearby last month."*

---

### 3.6 Franchise Owner

**Who:** An operator running an OxSteed-affiliated territory — the multiplication layer of the local model.

**Success looks like:** "I can see my territory's health at a glance — operators, compliance, pipeline — and grow it deliberately."

**Home:** Territory at a Glance (key territory stats), Application Status (their franchise journey), Territory Operations, and Compliance Readiness (the checklist that keeps them in good standing).

**Life:** Standard pulse — franchise operators burn out too.

**Growth:** Their ladder is recruitment and density: more helpers active, more businesses formed, more categories covered in their territory. Financing here is territory-scale.

**Learn:** Hero: *"Operate with consistency."* Playbooks for reliable local service operations. They also use Learn as their territory's training academy — badge completion across their operators is a quality metric.

**Never push:** Corporate-speak quotas. Territory metrics are mirrors, not whips.

**How they grow the platform:** They *are* the growth model — boots-on-ground recruiters of helpers, businesses, and tool owners. The product gives them the same instruments as everyone else (Vortex codes, profile shares, guides) at territory scale.

**Growth language moments:**
- Territory dashboard: *"Your territory grows one trusted helper at a time. Who did good work for you lately that isn't on here yet?"*
- Compliance complete: *"Territory in good standing. Operators in compliant territories win 'X'% more repeat work — consistency is the brand."*

---

### 3.7 Investor

**Who:** Someone backing the local economy — property investors, franchise backers, people evaluating operators and categories.

**Success looks like:** "I see honest signal: revenue trends, platform health, franchise pipeline — enough to make decisions without calling anyone."

**Home:** Revenue Trend chart, Platform Health indicators, Franchise Pipeline, and Investor Actions.

**Life:** Standard pulse. (Property-owning investors get real value from Home Care and Sinking Funds pillars across their units.)

**Growth:** Opportunities filter to businesses and tools — things to back, not jobs to do. Wholesale and financing data give them market texture.

**Learn:** Hero: *"Understand local service demand."* Web hero: *"Know what you're buying"* → marketplace. Guides like `inspect-investment-property` and `estimate-repair-costs` carry investor-specific tips on ROI, CapEx decisions, and maintenance cost implications. Learn is their due-diligence library.

**Never push:** Hype. Investors get the same honest numbers the platform runs on. Inflated dashboards destroy the persona's entire value.

**How they grow the platform:** Capital and credibility. An investor who funds a helper's van or a franchise territory creates supply directly. Their presence also signals to operators that this is a real economy.

**Growth language moments:**
- After reviewing an operator: *"Operators grow faster when someone believes in them early. The pipeline is full of people one tool-loan away from doubling capacity."*
- Learn completion: *"You now know what good work looks like. The best investments here are the people doing it."*

---

### 3.8 Facilities Manager *(web today; app candidate)*

**Who:** Manages buildings or property portfolios — schedules preventive maintenance, writes work orders, runs inspections.

**Success looks like:** "Every system in my buildings has a maintenance schedule, every issue becomes a clean work order, and I have a trusted helper bench per trade."

**Home (when adopted in app):** Portfolio view of properties → systems → maintenance schedules; work order queue; recurring job templates; vendor (helper/business) bench per trade.

**Life:** Their Home Care pillar generalizes to *portfolio* care — same engine, multiple properties.

**Growth:** Volume relationships: retainer-style arrangements with businesses, pooled purchasing for portfolio supplies.

**Learn:** Hero: *"Own every system in your building."* CTA → post a job. Dedicated management category: `build-preventive-maintenance-schedule`, `write-a-work-order`, `inspect-investment-property`, `estimate-repair-costs`. Manager tips on all 57 guides cover PM scheduling, work-order documentation, and inspection protocols.

**Never push:** Per-seat pricing pressure or forced portfolio import. One building is a fine start.

**How they grow the platform:** Recurring demand at volume — the most valuable demand type. One facilities manager equals fifty customers' worth of steady work, and they onboard every vendor they already use.

**Growth language moments:**
- After a work order completes: *"Clean work order, clean result. Your regular vendors not on OxSteed yet? Invite them — their history with you starts counting."*
- PM schedule built: *"Preventive beats reactive. Every scheduled task here is steady, predictable work for a local pro."*

---

### 3.9 Support Agent *(web today; app candidate)*

**Who:** Works support for OxSteed or for a business on OxSteed (via `support_employers`) — triages customer issues, resolves remotely, dispatches when needed.

**Success looks like:** "I diagnose remotely when possible, dispatch only when necessary, and every interaction makes the knowledge base smarter."

**Home (when adopted in app):** Conversation queue with claim/release, availability toggle (go online/offline per employer), templates, KB search, escalation paths.

**Life:** Standard pulse — agents are workers with shifts and lives.

**Growth:** Their ladder is craft: resolution rate, CSAT, and the agent → helper path (an agent who remote-diagnoses plumbing for a year is half-trained for the field).

**Learn:** Hero: *"Resolve faster. Escalate smarter."* CTA → Learn itself. Dedicated diagnosis guides (`diagnose-plumbing-remotely`, `diagnose-electrical-remotely`); support-agent tips on all guides cover triage scripts, escalation criteria, and dispatch-vs-self-serve judgment.

**Never push:** Surveillance framing. Metrics serve the agent's growth, not just their employer's dashboard.

**How they grow the platform:** Trust is retention, and retention is the cheapest growth there is. Every well-resolved issue keeps a customer and a helper. Their triage notes become KB articles become Learn guides.

**Growth language moments:**
- After a resolved ticket: *"Solved without a truck roll. That answer could help the next thousand customers — add it to the knowledge base?"*
- Guide completion: *"You can now triage this remotely. Customers you help self-serve trust the platform more, not less."*

---

## 4. The low-friction operating rules

"Function properly without pushing too much on the user." These rules are binding across all personas and modes:

1. **Guest-first.** The app demonstrates value before asking for anything. Guests browse real jobs on Home and see the Life pulse shell. Sign-in is requested only at the moment of action (bid, post, message) — never at the door. (Growth's guest wall is the one exception, and even it offers consulting intake without an account.)
2. **One next action per object.** Every job, booking, and ticket displays exactly one "what now" (Review quotes / Confirm schedule / Track work / Review job). The app sorts by actionability so the user never computes priority themselves.
3. **Notifications are events, not marketing.** Push exists for messages, bids, jobs, and appointments — things that happened *to the user*. Growth-language moments live inside the app at natural pauses (post-completion, post-review, empty states), never as push.
4. **Ladders describe, they don't demand.** The Growth Ladder shows progress and lights up the active step. No streaks, no decay, no "you lost your spot." Progress only ever accumulates.
5. **Defaults over decisions.** New users are Customers; persona switching is discovered, not demanded. Life seeds with sensible demo data until the server hydrates real records. Templates auto-trial. Nothing blocks on configuration.
6. **Fail open.** Degraded backends return empty-but-working states (the codebase already does this: support portal degraded mode, badge fetch fail-open, pricing fallback). The user never sees a wall because a table is missing.
7. **Nudges have budgets.** Any recurring suggestion (idle tool, profile completeness) fires at most monthly, is dismissible forever, and must reference a concrete fact ("4 jobs nearby needed a pressure washer"), not generic FOMO.
8. **Money moments are sacred.** No cross-sells, growth prompts, or upsells inside checkout, bidding, payment, or dispute flows. Growth language appears *after* the outcome, in the glow, not in the path.

---

## 5. The organic-growth language system

Users are responsible for the platform's natural growth. The app's job is to make contribution feel like *theirs* — and to say so, in words that respect them.

### 5.1 Principles

1. **Every share serves the sharer first.** A helper shares their QR because it gets *them* customers. A consultant publishes a guide because it builds *their* reputation. The platform benefit is the byproduct, and the copy says so in that order.
2. **Name the network honestly.** Don't hide that user actions grow the platform — celebrate it. "Your review makes this marketplace more trustworthy" is honest and dignifying. Dark-pattern referral spam is neither.
3. **Causality, not commands.** Never "Invite 5 friends!" Always "Helpers who share their profile locally are usually first-called when work picks up." State the mechanism; let the user decide.
4. **Contribution receipts.** Tell users what their action *did*: "Your guide helped 32 people." "Your review is the reason 3 customers booked her." Impact shown beats incentive promised.
5. **The neighborhood is the unit.** Growth copy speaks of "your neighborhood," "nearby," "local" — never "the platform," "our network," "user base." People grow a place they belong to, not a company they use.
6. **Empty states recruit.** Every empty list is an honest invitation: no jobs nearby → "you could be the first"; no guides in a category → "know this trade? Teach it."
7. **Two-sided gratitude.** After every completed transaction, both sides get a contribution receipt. Reviews are framed as gifts to the next person, not ratings of the last one.

### 5.2 The growth instruments already in the product

| Instrument | Where | Who wields it |
|---|---|---|
| Public profile + share controls (copy link / Web Share) | Helper & business profiles | Helper, Business |
| Profile QR code (PNG endpoint, printable) | Profile header, payout screens | Helper, Business |
| Vortex codes (reusable team join codes) | Business workspace | Business, Franchise |
| Guide submission (UGC, reviewed) | Learn | Consultant, Helper, Business |
| Two-way reviews | Job completion | Customer, Helper |
| Skill badges on public profiles | Learn → profile | Helper |
| Community Wholesale pools | Growth | Helper, Business, Tool Owner |
| Planned needs → auto-published jobs | Life | Customer, Facilities Manager |
| Referral pipeline | Consultant home | Consultant |
| Invoices/receipts carrying profile links | Business console | Business |

Every instrument follows the same pattern: **user gets the value, neighborhood gets the growth.** New features should be tested against this pattern before shipping.

### 5.3 Copy guide — do / don't

| Don't write | Write instead |
|---|---|
| "Invite friends and earn rewards!" | "Know someone who'd be good at this? Work finds people faster when a neighbor vouches for them." |
| "Help us grow!" | "Every review you leave makes the next neighbor's decision easier." |
| "Share now" (bare button) | "Your profile is your storefront — put the link where your customers already are." |
| "You haven't posted in a while 😢" | *(nothing — silence is allowed)* |
| "Unlock more by upgrading" | "When you're ready for bigger jobs, financing and wholesale gear are in Growth." |
| "Don't miss out!" | "4 jobs near you needed this skill last month." |
| "Refer a business" | "If a business you trust isn't on here yet, they're missing customers who already trust *you*." |

### 5.4 Moment map — when growth language is allowed to appear

| Moment | Allowed | Example |
|---|---|---|
| After job completion + review | ✅ | Contribution receipt + share prompt |
| After guide completion | ✅ | "List it as a service" / "Teach it back" |
| After first listing/profile publish | ✅ | Storefront framing + QR |
| Empty states | ✅ | Honest recruitment |
| Badge/milestone earned | ✅ | Receipt + public-profile mention |
| Onboarding | ⚠️ One line max | "OxSteed grows because neighbors bring neighbors." |
| Checkout / payment / bid / dispute | ❌ Never | — |
| Push notifications | ❌ Never | — |
| More than once per session | ❌ | One growth moment per session, maximum |

### 5.5 The one-paragraph voice

When in doubt, growth copy should sound like this:

> *You did real work here, and it counts twice — once for you, once for everyone after you. The reviews you leave, the skills you list, the people you bring: that's what this place is made of. OxSteed doesn't grow because we advertise. It grows because you're good at what you do and your neighborhood finds out.*

---

## 6. Appendix — codebase anchors

| Concept | Source of truth |
|---|---|
| 4 modes / tab shell | `ios/build-atom/Shell/RootShellView.swift` (`AppTab`) |
| 7 app personas + taglines | `ios/build-atom/Models/Persona.swift` |
| Persona homes | `ios/build-atom/Home/PersonaHomes.swift` (CustomerHome, HelperHome, BusinessHome, ConsultantHome, ToolOwnerHome, FranchiseHome, InvestorHome) |
| Persona switcher | `ios/build-atom/Home/PersonaSwitcherSheet.swift` |
| Life pillars + pulse | `ios/build-atom/Life/LifeTabView.swift` (`PillarType`), `PillarDrillDowns.swift` |
| Growth ladder + sections | `ios/build-atom/Growth/GrowthTabView.swift` (`growthLadder`, Opportunities / Programs / Financing / Community Wholesale) |
| Learn guides + persona heroes | `ios/build-atom/Learn/LearnTabView.swift`, `LearnGuideCatalog.swift`; web `client/src/pages/LearnModePage.jsx` (57 guides, 9 categories, 7-persona tips) |
| Web-only personas (manager, support_agent, investor heroes) | `client/src/pages/LearnModePage.jsx` (`PERSONA_TIP_META`, `getPersona`, `HERO`) |
| Guide submissions / XP / badges | `server/controllers/learnController.js`, migrations 281/282/284 |
| Profile share + QR | `client/src/components/helperProfile/ProfileShareControls.tsx`, `GET /api/helpers/:id/profile-qr.png` (`server/routes/helpers.js`) |
| Vortex codes | `server/controllers/businessAccessCodesController.js`, `client/src/pages/VortexPage.jsx` |
| Planned needs → auto-publish | `server/jobs/plannedNeedsScheduler.js` |
| Support agent employments | `server/controllers/supportAgentPortalController.js` |
| Consultant pipeline | `ios/build-atom/Growth/ConsultantPipelineView.swift`, `ConsultingStore` |
