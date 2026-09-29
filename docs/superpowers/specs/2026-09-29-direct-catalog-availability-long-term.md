# OxSteed Direct catalog availability — long-term design

Date: 2026-09-29  
Repo: oxsteed/old-file (`/workspace/old-file`)  
Branch context: old-files-claude  
Surfaces: Admin Direct Catalog (incl. assignee pools), Direct Admin Settings, public Home embed (`DirectCatalogPanels`), `/direct` (`DirectCatalogLanding`), `/direct/request-quote`, `/direct/book/:id` / book-slot, admin Dispatch calendar (`direct_calendar_blocks`, `assigned_to`)

Status: **implemented on `old-files-claude` (2026-09-29)** — capability triad, Live/operational parity + backfill migration 589, dual Settings kill, browse honesty, catalog-driven request form, assignee pools, slots engine, Book UI + POST book, retire/category/concurrency guards, i18n en/es/fr/ht/ar

---

## Problem

Direct catalog availability is split across several half-connected concepts that disagree under real admin workflows:

| Layer today | What it means (claimed) | What it actually does |
|---|---|---|
| `lifecycle_status` | Publish pipeline (`planned → coming_soon → live → paused → retired`) | Controls most public SQL filters; single-save does **not** enforce the same transitions as bulk |
| `is_operationally_available` | Day-to-day deliverability | Required for `requestable` and quote submit; **bulk Move to Live never sets it** (DB default `FALSE`) |
| `is_bookable` | Instant book | Stored + returned on public API; **unused in every public UI** |
| `availability_days` / `available_days` | When service runs | Display-only chips; **not** tied to dispatch calendar |
| `direct_calendar_blocks` | Admin dispatch availability / blackouts | Real windows exist; **no public slot picker** |
| Settings `profile.tools` / `profile.service_areas` | Legacy offer lists | Still editable in Direct Admin Settings while public UI reads **catalog tools** + **`direct_service_areas`** |
| Request form `service_category` | Work type | Hardcoded Home/Restaurant/… dropdown **plus** catalog multi-select |

Net result: admins can Move to Live and still get non-requestable services; customers see “unavailable” with no path to book; Settings edits can look like they updated the catalog when they did not.

---

## Locked product decisions (this design)

1. **Three customer-facing capability states:** **Visible / Requestable / Bookable** — not “lifecycle alone equals availability.”
2. **Wire Bookable now** — Bookable means the customer can start a real booking flow from Direct public UI (not deferred, not “after quote only”).
3. **Bookable scheduling = slot booking from calendar + capacity** — Bookable items use real admin calendar / availability windows (`direct_calendar_blocks` + existing scheduled jobs) **and** free members of the service’s **assignee pool** so customers pick a concrete slot on Direct.
4. **Kill dual source** — remove legacy Settings tools/areas editors; **`direct_catalog_*` + `direct_service_areas` are the only sources**. Migrate useful legacy profile JSON once, then stop writing those fields for public offer data.
5. **Crew capacity gates Bookable** — OxSteed may have employees who can do certain jobs. Bookable slots must respect **who can do this service** and whether they are free. Locked representation: **per-service assignee pool** (see Capacity section).
6. **Auto-fall to Requestable when capacity is exhausted** — If the assignee pool has **no free person** for a time (or no offerable slots remain in horizon), **hide the Book CTA** / return empty bookable slots, and **still offer Request quote**. Do not error the browse page; do not clear admin `is_bookable` preference. Derived: `bookable=false`, `requestable=true` (when otherwise Requestable).

---

## Goals

1. One durable mental model for admins and one durable contract for public UI/API.
2. Lifecycle remains inventory workflow; capability (Visible / Requestable / Bookable) is computed and enforced separately.
3. Bulk and single-save produce the same public outcomes for the same intent (especially Live).
4. Request form is catalog-driven (no hardcoded work-type list as the source of truth).
5. Bookable services expose a calendar slot picker backed by admin availability blocks **and crew capacity** (per-service assignee pool).
6. Coverage chips and tools panels never diverge from admin editors again.
7. Home embed and `/direct` stay behavior-parity for catalog capability.
8. Expand scope enough to close leftovers the user would otherwise hit next week (parent/child lifecycle, tools without category, pagination honesty, concurrent edit soft-guard, naming honesty for days vs calendar).

## Non-goals

- Rewriting the entire Direct quote case lifecycle, payments, or proof flow.
- Replacing helper/marketplace booking (`booking_requests`) with Direct slots.
- Multi-crew routing optimization / full GIS coverage engine (basic **capacity counting** is in scope; optimal route assignment is not).
- Building a full HR / employee-calendar product; reuse `users` + `quote_requests.assigned_to` and optional lightweight skill/pool tables only as needed for Direct booking capacity.
- Deleting historical `quote_requests` rows or re-keying past references.
- (Superseded) Spec-only pass — implementation landed on `old-files-claude`.

---

## Current-state audit (verified in code)

### Lifecycle & filters

- Admin lifecycle enum: `planned | coming_soon | live | paused | retired` on categories, services, tools (`directCatalogService.js`, migration `414`).
- Public categories: `coming_soon | live | paused` (plus empty-live categories rewritten to `coming_soon` when `liveServiceCount === 0`).
- Public services/tools SQL: `lifecycle_status = 'live'` and `is_active`.
- `requestable` (services): `lifecycle === 'live' && isOperationallyAvailable`.
- Quote create validates catalog IDs/slugs against live + operational + live parent category.

### Critical bugs / traps

1. **Bulk Move to Live** updates `lifecycle_status`, `is_active`, `is_published` only — **does not set `is_operationally_available`** → Live + non-requestable by default.
2. **Single save** accepts explicit `isOperationallyAvailable: false` from admin checkbox defaults; parse fallback to `true` only when the field is omitted (admin always sends boolean).
3. **`assertTransition` only on bulk**; single-save can jump arbitrary statuses.
4. **`is_bookable` unused** on Home/`/direct`/request form.
5. **Paused services under live categories** are filtered out of public SQL entirely (not shown as “paused”).
6. **Retired parent + live child**: child disappears from public join; quote validation rejects; orphan live children remain in admin inventory.
7. **Tools with null `category_slug`**: allowed by FK (`ON DELETE SET NULL`); UI filters tools to selected category → unassigned tools are effectively invisible.
8. **Dual Settings**: `updateSettings` still writes `tools` + `service_areas` JSON; public coverage uses `direct_service_areas`; tools panel uses catalog tools.
9. **Request form** requires hardcoded `service_category` even when catalog services are selected.
10. **Pagination**: paged `getCatalog` replaces whole catalog state in panels; `availableServiceCount` uses `COALESCE(is_operationally_available, TRUE)` while schema default is `FALSE`.
11. **`availability_days` named like booking truth**; admin calendar is separate (`direct_calendar_blocks`).
12. **No optimistic concurrency** on catalog rows (last write wins).
13. **No per-service assignee pool / skill tags for Direct crew** — dispatch assignees are any active `users` with role ∈ {`helper`,`helper_pro`,`broker`,`admin`,`super_admin`} (`getAdminDispatchAssignees`); services do not declare who can perform them.
14. **Schedule overlap is per-assignee only** — migration `420_direct_schedule_conflict_guard` + `scheduleRequest` / quote update reject overlapping `scheduled_*` for the same `assigned_to` (NULL unassigned pool shares **one** provisional concurrent slot). This does **not** yet count “how many electricians are free.”
15. **`direct_calendar_blocks` are org-wide windows** — no `user_id` / employee FK; availability vs blackout only (`416`). Not per-employee calendars.
16. **No Direct employee calendar table** — restaurant crew shifts (`restaurant_crew_*`) and marketplace helper availability are separate products; do not reuse as Direct booking truth without an explicit bridge.
17. **Business booking engine exists separately** (`bookingSlotEngine.js` over `business_service_staff` / appointments) — useful **pattern** reference for capacity-aware slots; not wired to Direct catalog.

### Dual sources map

| Concern | Legacy | Canonical (after this design) |
|---|---|---|
| Services | (none in profile) | `direct_catalog_services` |
| Tools | `direct_service_profiles.tools` JSON | `direct_catalog_tools` |
| Coverage areas | `direct_service_profiles.service_areas` JSON | `direct_service_areas` |
| Marketing copy / minimum / support | profile row | profile row (kept) |
| Travel days marketing string | `travel_days` JSON | Keep as marketing text only, or derive from calendar later — **not** slot truth |
| Slot availability | (none public) | `direct_calendar_blocks` (`availability` minus `unavailable|holiday|blackout`) − scheduled Direct jobs − **crew capacity** (per-service assignee pool) |
| Who can do a service | (none — any dispatch role user) | **Per-service assignee pool** (roles and/or user IDs on the catalog service); Bookable needs ≥1 free pool member for the slot |

---

## Product model — one durable model

### A. Inventory lifecycle (admin workflow — keep)

Applies to category / service / tool records:

```
planned → coming_soon → live ⇄ paused → retired
                ↘______________↗     ↗
retired → planned (reopen only)
```

Meaning:

| Status | Admin meaning | Public presence |
|---|---|---|
| `planned` | Draft / incomplete | Hidden |
| `coming_soon` | Announced, not sellable | Category may show as Coming soon; no request/book CTAs for children |
| `live` | In the active catalog set | Eligible for capability computation |
| `paused` | Temporarily off sell path | May remain **Visible** (with Pausing copy) but not Requestable/Bookable |
| `retired` | Archived | Hidden; children should not stay sellable |

Lifecycle is **not** the customer CTA. It is inventory phase.

### B. Capability triad (customer contract — new primary model)

Computed per **service** (and mirrored for tools where applicable):

| Capability | Customer meaning | Required ingredients |
|---|---|---|
| **Visible** | Appears in browse UI (Home panels and `/direct`) | Parent category public-visible; item not retired/planned; public filter rules below |
| **Requestable** | Can open quote request with this catalog item selected | Visible + `lifecycle=live` + `is_operationally_available=true` + parent category `live` + coverage rules (ZIP check at submit). Remains true when Bookable is blocked solely by **no open slots** or **capacity exhausted** (auto fallback: show Request, not Book). |
| **Bookable** | Can start **slot booking from calendar** on Direct | Lifecycle allows sell path + operational + `is_bookable=true` + priced or explicit bookable-quote policy + **at least one future open slot** where the calendar window is open **and** **≥1 free person in the service’s assignee pool** for that interval |

Invariants:

- `Bookable ⇒ Requestable ⇒ Visible`
- Clearing operational clears Requestable and Bookable.
- Clearing bookable flag leaves Requestable intact.
- Pausing / retiring clears Requestable and Bookable even if flags remain in DB (flags are preferences; capability is gated).
- **Capacity exhaustion does not clear Requestable** — only clears derived Bookable (and omits exhausted slots). Admin `is_bookable` preference may stay true.
- Bookable requires **all** of: lifecycle sellable + operational + `is_bookable` + open calendar slot + **free pool capacity**.

Admin stores:

- `lifecycle_status` (workflow)
- `is_operationally_available` (ops preference / gate)
- `is_bookable` (booking preference / gate)

Public API exposes **derived** booleans + reasons:

```json
{
  "visible": true,
  "requestable": true,
  "bookable": true,
  "capabilityReasons": [],
  "lifecycleStatus": "live",
  "isOperationallyAvailable": true,
  "isBookable": true,
  "nextSlotStartsAt": "2026-10-02T14:00:00.000Z",
  "slotsAvailable": true,
  "capacityExhausted": false,
  "assigneePoolSize": 1
}
```

Keep legacy `requestable` field as alias of derived Requestable during one release for clients already filtering on it.

### C. Days vs calendar — naming honesty

| Field | Honest name / role |
|---|---|
| `availability_days` / `available_days` | **Typical workdays (marketing)** — display only; rename UI label to “Typical workdays” |
| Profile `availability_text` / `travel_days` | Marketing copy only |
| `direct_calendar_blocks` | **Slot truth** for Bookable |
| Scheduled `quote_requests.scheduled_*` | Occupied time that subtracts from open slots (and from a pool member’s free window when `assigned_to` is set) |
| Per-service assignee pool | **Who may take this Bookable job** — roles and/or user IDs; free matching people = Bookable capacity |
| `quote_requests.assigned_to` | Dispatch assignment; overlap already guarded per assignee (`420`) |
| Employee calendars | **None for Direct today** — do not invent; optional future per-user busy blocks can layer on later |

Do not use typical workdays to invent slots.
Do not offer a Bookable slot unless **calendar open ∧ ≥1 free pool member**.

---

## Scenario matrix (durable behavior)

| # | Scenario | Expected durable behavior |
|---|---|---|
| 1 | Single save → Live | Enforce transition rules; **default operational = true** unless admin explicitly opts out; refresh derived capabilities |
| 2 | Bulk Move to Live | Same as single: set operational **true** by default; require reason; same transition matrix |
| 3 | Bulk Pause / Coming soon / Retire | Clear Requestable/Bookable in derived sense; Pause keeps Visible with paused copy; Retire hides; Coming soon hides sell CTAs |
| 4 | Flip operational off while Live | Stays Visible (Live list) but `requestable=false`, `bookable=false`; quote API rejects; CTA “Currently unavailable” |
| 5 | Flip bookable on while Requestable | Public shows **Book** CTA; opens slot picker; requires open slots or shows “No slots this week” with Request fallback |
| 6 | Flip bookable off | Book CTA gone; Request remains if Requestable |
| 7 | Empty live category | Public effective category state `coming_soon` (or empty paused messaging); no fake service counts |
| 8 | Paused service under live category | **Visible** in category with paused badge; not Requestable/Bookable (change from today’s hard SQL omit) |
| 9 | Retired parent, live child | Block retire of parent while live/requestable children exist **or** cascade pause children; never leave sellable orphans |
| 10 | Tool without category | Admin review flag + require category before Live/Coming soon; public “Unassigned” bucket only in admin, not customer |
| 11 | Service area inactive | Coverage chip omitted; ZIP check fails gracefully; Requestable still true at catalog level but submit blocked with area message |
| 12 | Catalog API failure | Profile may load; panels show retry empty state (no silent legacy tools/areas fallback) |
| 13 | Home vs `/direct` | Same capability rules via shared `DirectCatalogPanels` + same catalog endpoints |
| 14 | Guest vs signed-in quote | Same catalog selection; auth only where booking account is required for Bookable hold |
| 15 | Legacy Settings edit while catalog exists | **Removed** — editors gone; API rejects writes to legacy tools/areas |
| 16 | Concurrent admin edits | `updated_at` / optional `version` check → 409 conflict with reload prompt |
| 17 | Pagination edges | Counts = total matching Visible (and separate requestable/bookable counts); load-more must not clobber other categories’ cached pages |
| 18 | Bookable with zero open slots | Derived `bookable=false`; CTA falls back to **Request** if Requestable; reason `no_open_slots` |
| 19 | Slot taken between view and submit | 409; refresh slots; do not create overlapping schedule; prefer brief **hold/reserve** or transactional capacity check (see Capacity) |
| 20 | Category Coming soon with live children | Prefer configured lifecycle, but sell CTAs still follow child capability; don’t advertise Request on coming_soon-only shells |
| 21 | One electrician in pool; two electric jobs same time | Second overlapping slot **not offered**; first book succeeds; concurrent second book → 409 / hold miss; **auto-fall**: hide Book if no other free slots, **keep Request** |
| 22 | Pool empty / no members configured while `is_bookable` | Derived `bookable=false`; review flag `bookable_without_pool`; Request still available if Requestable |
| 23 | Pool has 2 plumbers; one busy on overlapping job | Slots still offered while ≥1 free plumber remains for the interval |
| 24 | Job assigned to pool member A | Occupies A for that interval; other services that also list A lose A’s capacity for the overlap |
| 25 | Unassigned scheduled Direct job | Today’s guard treats NULL `assigned_to` as one shared provisional slot — for Bookable capacity, **prefer assigning a pool member at book time** (or decrement a chosen free member) so capacity accounting stays real |
| 26 | Calendar window open but all pool members busy | Do not list Bookable slots for those times; if none remain in horizon → Requestable only |

---

## Public contract

### Browse (`GET /direct/profile`, `GET /direct/catalog`)

- Categories: Visible when lifecycle ∈ {`coming_soon`,`live`,`paused`} and active.
- Services in browse:
  - Include `live` always (Requestable or not).
  - Include `paused` as Visible non-sellable (new).
  - Exclude `planned` / `retired`.
- Tools: same capability triad; tools are not Bookable in v1 unless explicitly added later (default Bookable=false for tools).
- Coverage: **only** active `direct_service_areas` labels.
- Do **not** return legacy `profile.tools` as customer offer inventory (may omit or return empty for compat).

### Quote request (`POST /direct/requests`)

- Catalog selections must be **Requestable** at submit time (existing live+operational+live parent checks, plus paused exclusion).
- `service_category` becomes **derived** from primary selected catalog service category name (or “General Direct” if free-text-only path remains for non-catalog edge).
- Hardcoded select removed from UI.

### Bookable slot booking (new public surface)

**Customer path**

1. From catalog card with `bookable=true` → **Book** CTA.
2. Opens `/direct/book-slot?serviceId=…` (or modal) — guest allowed to browse slots; account required to confirm hold if product requires identity (prefer: collect same contact fields as quote, create Direct request in `scheduled`/`accepted` path).
3. UI loads `GET /direct/catalog/services/:id/slots?from=&to=`.
4. Customer picks slot → `POST /direct/catalog/services/:id/book` with slot start/end + contact + address/ZIP.
5. Server re-validates Bookable + slot still open + **≥1 free pool member**; in a transaction (and/or after converting a hold), creates `quote_requests` with `scheduled_start_at`/`scheduled_end_at`, **`assigned_to` = chosen free pool member**, catalog metadata, status appropriate for booked work (recommend `scheduled` or `accepted`→`scheduled` with event `slot_booked`); relies on `420` overlap guard as backstop. On capacity miss → 409; UI refreshes slots or **auto-falls to Request**.

**Slot engine (reuse admin calendar + crew capacity)**

A candidate interval is an **open Bookable slot** only if **both** calendar and capacity pass:

1. **Calendar window**
   - Inside union of `direct_calendar_blocks` where `block_type = 'availability'`
   - Not overlapping blocks where `block_type ∈ {unavailable, holiday, blackout}`
   - Default: do **not** invent slots from typical workdays (marketing only)
2. **Crew capacity (per-service assignee pool)**
   - Resolve the service’s assignee pool → set of eligible `user_id`s (expand role tags to active dispatch-capable users)
   - A pool member is **free** for `[start,end)` if they have no overlapping non-terminal Direct job (`quote_requests` with `assigned_to = member`, `scheduled_*` overlap, status ∉ cancelled/closed/completed)
   - Slot is offerable iff **count(free pool members) ≥ 1** (default jobs need one person)
   - Optional later: `required_crew_size` on service (default 1)
3. **Slot shaping**
   - Slot length: `booking_slot_minutes` (default 120) or global Direct setting
   - Horizon: e.g. next 28 days; max page 50 slots
   - Response may include `availableCapacity` / `freeAssigneeCount` per slot (do not leak employee PII publicly — counts only)

No offerable slot in horizon ⇒ derived `bookable=false` → customer sees **Requestable** (if otherwise Requestable), not Book.

**Admin path**

- Existing Dispatch calendar block CRUD remains the way ops open/close **windows**.
- Catalog admin adds **Assignee pool** editor on each bookable service (roles and/or people).
- Catalog admin Bookable checkbox copy: “Customers can pick a calendar slot on Direct when someone in this service’s pool is free.”
- Guards / review issues: `bookable_without_slots`, `bookable_without_pool`, `bookable_pool_all_busy` (informational).


---

## Capacity & crew (mandatory)

### Product requirement

OxSteed may have employees who can do certain jobs. When deciding **Bookable vs Requestable**, account for **their** availability:

- Example: admin says they have **one electrician** → customers must not be able to Book **two electric jobs at the same time**.
- Bookable slots must respect crew capacity; if no free qualified person for a slot, **do not offer Book** for that slot (omit it from the slots list).
- **Locked UX when pool has no free person:** **auto-fall to Requestable** — hide Book CTA / empty bookable slots; **still offer Request quote**. Same fallback when the calendar has no open windows. Never strand the customer with neither Book nor Request while the service remains Visible+Live+operational+Requestable ingredients.

### Locked representation (recommended default): per-service assignee pool

**Each catalog service (and tool if ever Bookable) lists which roles and/or people can perform it.** Bookable capacity for a slot = number of **free** people in that set for the interval.

| Concept | Design |
|---|---|
| Pool membership | On `direct_catalog_services`: assignee pool = mix of **role tags** (e.g. `helper`, `helper_pro`) and/or explicit **user IDs** |
| Storage (implement-time choice) | Prefer junction tables: `direct_service_assignee_roles(service_id, role)` + `direct_service_assignees(service_id, user_id)` — avoid opaque JSON if queryable capacity matters. Acceptable v1 alternative: jsonb `assignee_pool` with `{ "roles": [...], "userIds": [...] }` if migration speed wins, with a follow-up normalize. |
| Eligible people at runtime | Active `users` (`is_active`, `deleted_at IS NULL`) matching pool roles **∪** explicit user IDs, intersected with today’s dispatch-capable roles (`helper`, `helper_pro`, `broker`, `admin`, `super_admin`) unless product widens later |
| Free for slot `[start,end)` | Eligible person with **no** overlapping non-terminal Direct scheduled job on `quote_requests.assigned_to` |
| Capacity needed | Default **1** person per booking (`required_crew_size` optional later) |
| Book time | Prefer **bind** `assigned_to` to one free pool member (deterministic pick: least-loaded then name) so migration `420` overlap guard and capacity stay aligned; if product insists on unassigned holds, still **reserve** one pool member via a hold row or metadata so a second book cannot steal the same person |
| Tools | Not Bookable in v1; pool editor can exist for future but unused |

Admin UX:

- On service edit: “Who can do this job?” multi-select people + optional role chips.
- Empty pool + `is_bookable` → warn; derived Bookable false until pool has ≥1 eligible active user **or** admin disables bookable.
- Preview: “Pool size N · free next slot M”.

### Alternatives (not primary — note only)

| Alternative | When it might win later | Why not default now |
|---|---|---|
| **Skill-tagged crew** — employees tagged with skills/categories (e.g. `electrical`); Bookable needs ≥1 free matching skill | Many services share the same skill; less per-service editing | User locked **per-service pool**; no Direct skill-tag table today; skill taxonomy would duplicate catalog categories unless carefully unified |
| **Numeric capacity** — service or org has `max_concurrent = N` with no named people | Tiny ops (“we only take 2 jobs at once”) with no named crew | Does not model “one electrician”; cannot assign `assigned_to` meaningfully; weaker fit for existing per-assignee overlap guard |

Skill-tagged crew remains a **compatible evolution**: a skill tag can expand into the same “eligible user set” function the pool uses. Numeric capacity can act as a **ceiling** on top of pool free-count (`min(free_pool, max_concurrent)`).

### Relation to existing codebase (verified)

| Existing piece | Role in this design |
|---|---|
| `direct_calendar_blocks` (`416`) | **When** OxSteed is open for Direct work (org windows / blackouts). No employee FK — stays window truth, not crew truth. |
| `quote_requests.scheduled_start_at` / `scheduled_end_at` | Occupied intervals that remove capacity for the assigned person (and block double-book). |
| `quote_requests.assigned_to` + `417` | Dispatch ownership; Bookable should set this (or an equivalent reservation) to a pool member. |
| `prevent_direct_schedule_overlap` (`420`) | DB trigger: one concurrent job per `assigned_to` (NULL unassigned = one shared provisional slot). **Keep** as safety net under the capacity engine. |
| `getAdminDispatchAssignees` | Candidate people picker source for pool membership (role filter already matches). |
| Admin Dispatch calendar UI | Continues to show jobs + blocks; capacity-aware Bookable feeds the same schedule. |
| Direct **employee calendars** | **Do not exist.** Do not invent per-employee calendar tables in v1. Busy = overlapping Direct scheduled jobs (+ optional future personal blackout if added). |
| Restaurant `restaurant_crew_*` / helper marketplace availability | **Out of scope** for Direct slot truth unless a later bridge is explicitly productized. |
| `bookingSlotEngine.js` (business appointments) | Pattern reference (`business_service_staff` + capacity); **do not** call it from Direct — mirror the idea in a Direct slots module. |

### Auto capability rules (capacity-aware)

```
Visible     ← public browse rules (unchanged)
Requestable ← Visible ∧ live ∧ operational ∧ live parent ∧ …
Bookable    ← Requestable
              ∧ is_bookable
              ∧ ∃ slot in horizon:
                    calendar_open(slot)
                    ∧ free_pool_members(service, slot) ≥ required_crew_size
```

**Auto-fall (locked):** when Bookable’s slot/capacity conjunct fails, capability becomes **Requestable** (not an error state, not hidden):

| Condition | Derived | Public CTA |
|---|---|---|
| Pool has no free person for any slot in horizon (`capacity_exhausted`) | `requestable=true`, `bookable=false` | **Request** only; hide Book |
| Calendar has no open windows (`no_open_slots`) | same | **Request** only; hide Book |
| Pool empty / no eligible users (`bookable_without_pool`) | same | **Request** only; hide Book |
| A specific time has no free pool member | omit that slot from GET slots | other free times may still Book; if none left → row above |
| Operational false / paused / not live | not Requestable, not Bookable | muted / unavailable (unchanged) |

Admin `is_bookable` may remain `true` while derived `bookable` is false — preference vs capability stay separate.
`capabilityReasons` should include `capacity_exhausted` / `no_open_slots` / `bookable_without_pool` for admin preview and optional subtle public copy (“Request a time — instant book full right now”).

### Concurrent booking race

Two customers must not both Book the last electrician for the same window.

**Required (pick one primary; allow the other as belt-and-suspenders):**

1. **Transactional capacity check (minimum)**  
   On `POST .../book`: in one DB transaction, lock eligible free pool members (e.g. `SELECT … FOR UPDATE` on candidate users or advisory locks per user id, same spirit as `420`), re-check free count, insert `quote_requests` with `assigned_to` + `scheduled_*`, commit. On conflict → **409** + refresh slots.

2. **Brief hold/reserve (recommended UX)**  
   `POST .../holds` creates a short-lived reservation (e.g. 3–5 minutes) bound to `service_id`, slot interval, and chosen `user_id` (or opaque hold token). Holds count as occupied for slot listing and book. Expiry job or TTL clears holds. Confirm book converts hold → scheduled request.

Do **not** rely on “check then insert” without locks; the existing `420` trigger alone is insufficient if two books leave `assigned_to` NULL (unassigned pool collapses to one slot, but two different services could still over-commit named capacity if assignment is deferred).

Public API: 409 with `code: slot_conflict | capacity_exhausted` and fresh slot list hint.

---

## Admin UX rules

1. **Lifecycle control** separate from **Operational** and **Bookable** toggles (already mostly true) — add helper text mapping to Visible/Requestable/Bookable preview.
2. **Move to Live** (bulk + single): default `is_operationally_available = true`; show confirmation chip “Will become Requestable”; Bookable stays whatever was set (default false).
3. **Pause**: reason required (already on bulk); Visible paused treatment on public.
4. **Retire category**: block if children Requestable/Bookable/Live unless “retire and pause children” confirmed.
5. **Tools**: category required before Coming soon / Live / Paused.
6. **Remove** Settings editors for tools comma-list and service-areas comma-list; link to Catalog + Service Areas admin instead.
7. Keep Settings for: company name, headline, minimum, availability **marketing** text, base city, public note, support contacts, travel cities marketing.
8. Typical workdays field label honesty; calendar link “Manage bookable slots.”
9. Soft concurrency: send `updatedAt` on PATCH; 409 if stale.
10. Review dashboard flags: `live_not_operational`, `bookable_without_slots`, `bookable_without_pool`, `bookable_not_requestable`, `visibility_mismatch`, `missing_tool_category`, orphan live under non-live parent.
11. **Assignee pool** required (or strongly warned) before Bookable is meaningful; show pool size + “free now” hint; link to Dispatch assignees list.
12. Bookable helper text mentions capacity: “Book only appears when a pool member is free in an open calendar window.”

---

## Single source of truth & deprecations

### Keep writing

- `direct_catalog_categories|services|tools`
- `direct_service_areas`
- `direct_calendar_blocks`
- Per-service assignee pool tables (or jsonb until normalized)
- Profile marketing fields (not tools/areas inventories)

### Stop writing (after migration)

- `direct_service_profiles.tools` as offer inventory
- `direct_service_profiles.service_areas` as coverage inventory

### API / UI deprecation plan

1. Migration backfill (below).
2. `updateSettings`: ignore or 400 if `tools` / `serviceAreas` arrays present with notice `use_catalog_and_service_areas`.
3. Remove textarea editors from `DirectAdminPortalPage` Settings.
4. `serializeProfile`: stop advertising tools/areas as editable inventory; `getProfile` coverage already overwrites areas from `direct_service_areas` — keep that; tools array return `[]` or omit.
5. One release note in admin UI banner: “Tools and coverage are managed in Catalog and Service Areas.”

---

## Data migration / backfill

New migration (number assigned at implement time), conceptual steps:

1. **Operational backfill for Live inventory**
   - `UPDATE direct_catalog_services SET is_operationally_available = TRUE WHERE lifecycle_status = 'live' AND is_operationally_available = FALSE AND <optional: only rows never explicitly paused-ops>`  
   - Safer variant: set TRUE for all `live` rows that were transitioned via bulk without ops flag — product default **yes, Live ⇒ operational true** for existing Live rows so public Request matches admin intent. Document exception list if any must stay non-operational.
   - Same for tools.

2. **Legacy tools JSON → catalog tools**
   - For each distinct string in `direct_service_profiles.tools` not already represented by a catalog tool English name/slug: insert `direct_catalog_tools` as `planned` or `coming_soon` with `en` name only (do not auto-Live without locales).
   - Do not delete JSON yet; stop writing it.

3. **Legacy service_areas JSON → direct_service_areas**
   - For labels in profile JSON with no matching `direct_service_areas.label`: insert inactive placeholder rows **or** skip if no geocode — prefer skip + admin report of unmatched labels (cannot invent lat/lng safely).
   - Active coverage remains only real `direct_service_areas` rows.

4. **Parent/child cleanup report**
   - SQL view/report: live children under non-live parents; tools with null category; bookable true but not operational; live not operational.

5. **Optional / capacity schema**
   - `booking_slot_minutes INT` on services (default 120).
   - `required_crew_size INT` on services (default 1).
   - Assignee pool: `direct_service_assignee_roles` + `direct_service_assignees` (recommended) or `assignee_pool JSONB`.
   - Optional `direct_slot_holds` (`id`, `service_id`, `starts_at`, `ends_at`, `reserved_user_id`, `expires_at`, `created_by`) for brief reservations.
   - `catalog_row_version` / rely on `updated_at` for 409.
   - Check constraint or trigger: `is_bookable = TRUE` implies `is_operationally_available = TRUE` (or enforce in service layer only).
   - Keep / rely on `prevent_direct_schedule_overlap` (`420`) as DB backstop when `assigned_to` is set.

---

## State machine (implementation-facing)

### Transitions (enforce on **both** single save and bulk)

Same `ALLOWED_TRANSITIONS` as today; single-save must call `assertTransition`.

### Side effects on transition to `live`

```
is_active = true
is_published = true
is_operationally_available = true   # DEFAULT — admin may set false explicitly in same payload
published_at = coalesce(published_at, now())
# is_bookable unchanged unless explicitly set
```

### Side effects on `paused`

```
is_active = true
is_published = true
paused_at = now()
# operational/bookable flags retained as preferences but derived Requestable/Bookable = false
```

### Side effects on `retired`

```
is_active = false
is_published = false
# derived Visible/Requestable/Bookable = false
```

### Derived capability function (single module)

`deriveServiceCapability(row, parentCategory, { slotsAvailable, freeCapacityInHorizon, assigneePoolSize })` used by:

- `publicService`
- quote validation
- slots + book endpoints
- admin preview

`slotsAvailable` means **capacity-aware** offerable slots (calendar ∧ free pool), not calendar-only.

---

## API contract changes (summary)

| Endpoint | Change |
|---|---|
| `GET /direct/catalog` | Add `visible`, `bookable`, `capabilityReasons`, `nextSlotStartsAt`; include paused services as visible; fix counts |
| `GET /direct/profile` | Coverage from areas only; no legacy tools inventory; catalog uses new capability fields |
| `GET /direct/catalog/services/:id/slots` | **New** public (rate-limited); return only capacity-open slots; include `availableCapacity` counts (no employee PII) |
| `POST /direct/catalog/services/:id/holds` | **New** optional brief reserve (TTL); counts toward capacity |
| `POST /direct/catalog/services/:id/book` | **New** public book-with-slot; transactional free-pool check; set `assigned_to` to a free pool member; 409 on race |
| `POST /direct/admin/catalog/bulk-transition` | Set operational true on → live; shared transition helper |
| `PATCH/POST catalog entities` | Enforce transitions; Live default operational true; accept assignee pool payload |
| `PUT/PATCH settings` | Reject legacy tools/areas inventory writes |
| Admin calendar block APIs | Unchanged; become upstream of **windows** (not crew) |
| Admin dispatch assignees | Unchanged list source; also feeds pool people picker |

---

## UI changes

### Public catalog cards (`DirectCatalogPanels`)

- Requestable → **Request** (existing quote deep-link).
- Bookable → primary **Book** + secondary Request.
- Requestable but not Bookable because capacity/slots exhausted → **Request** only (hide Book); optional quiet note that instant book is full.
- Visible but not Requestable → muted + reason (“Temporarily unavailable” / “Coming soon”).
- Show next slot hint when Bookable; omit when auto-fallen to Requestable.

### `/direct/book-slot` (or book view)

- Slot list by day from slots API (capacity-open only).
- If slots empty on load → auto-fall UI: explain no instant times, CTA to **Request quote** (prefill service).
- Contact + ZIP + address.
- Confirm → hold (optional) → book endpoint → thanks / case page; 409 → refresh slots or fall to Request.

### Request form

- Remove hardcoded service category `<Select>`.
- Require ≥1 catalog service **or** explicit “Other / describe” path that sets derived category `Other`.
- Prefill from query params unchanged.

### Admin Catalog

- Live bulk/single defaults operational on.
- Bookable helper + warn without slots / without assignee pool.
- Assignee pool editor (“Who can do this job?”).
- Preview strip: Visible / Requestable / Bookable — show auto-fall reason when Bookable preference on but derived false (`capacity_exhausted`, etc.).
- Link to calendar + dispatch assignees.

### Admin Settings

- Delete tools + service areas textareas.
- CTAs to `/admin/direct-catalog` and `/admin/direct-service-areas`.

### Home

- Same panels; ensure error/retry parity with `/direct` (optional small retry button — leftover closure).

---

## Test plan

### Unit / service

- `deriveServiceCapability` matrix (lifecycle × operational × bookable × parent × slots × pool free-count).
- Auto-fall: pool busy / empty / no calendar → `requestable=true`, `bookable=false`.
- Bulk → live sets operational true.
- Single-save transition enforcement.
- Slot computation: availability − blackout − busy pool members; omit zero-capacity intervals.
- Book race: two concurrent books for last free pool member → one success, one 409.
- Hold expiry restores capacity.
- Settings reject tools/areas writes.
- Quote reject non-requestable / paused / retired parent.

### API / integration

- Public catalog includes paused visible non-requestable.
- Bookable false when no slots **or** capacity exhausted; Request CTA still present.
- GET slots omits times with no free pool member; one electrician → at most one overlapping offerable slot.
- Book success creates scheduled request with `assigned_to` ∈ pool; second book same slot / last capacity → 409.
- Guest book path (if allowed) vs auth.
- Profile coverage ignores legacy JSON when areas table populated.
- Pagination counts stable across pages.

### UI / e2e (smoke)

- Admin Move to Live → Home shows Request.
- Enable Bookable + assignee pool (1 person) + availability block → Book CTA → pick slot → confirmation; second overlapping Book hidden / 409; Request still available.
- Exhaust capacity → Book hidden, Request remains (auto-fall).
- Disable operational → Request/Book gone, row still visible if Live.
- Settings page has no tools/areas editors.
- Request form catalog-only category derivation.

### Regression

- Existing Direct quote/lookup/schedule/proof flows.
- Dispatch calendar block CRUD.
- i18n keys for new strings (`verify:i18n`).

---

## Rollout

1. **Spec approval** (this doc) — await any remaining product calls.
2. **Migration + backfill** (Live⇒operational; legacy tools import as planned; areas report).
3. **Server capability module + bulk/single parity** (no UI yet) behind correct derived fields.
4. **Kill dual Settings writes + UI removal**.
5. **Public browse/request form catalog-driven**.
6. **Assignee pools + capacity-aware slots API + Book UI + hold/book endpoints** (Bookable wire-up with auto-fall to Requestable).
7. **Paused-visible behavior + parent retire guards + tool category requirement**.
8. **Concurrency 409 + pagination fixes**.
9. **Monitor**: rate of 409 slot/capacity conflicts; auto-fall (capacity_exhausted) share; live_not_operational; bookable_without_slots / without_pool review queue.

Feature flags (optional): `direct_bookable_slots`, `direct_paused_visible` — prefer shipping derived capability in one train if QA capacity allows.

---

## Recommended defaults (product)

| Question | Recommendation |
|---|---|
| When admin sets Live, should operational default true? | **Yes.** Bulk and single. Explicit opt-out only. Backfill existing Live rows to true unless marked intentionally non-operational in a one-time admin report. |
| Bookable: remove, hide, or wire? | **Wire now** with **calendar slot booking**. |
| Dual Settings tools/areas? | **Kill.** Catalog + `direct_service_areas` only. |
| Tools Bookable in v1? | **No** (Requestable/Visible only) unless later decision. |
| Typical workdays vs slots? | Workdays = marketing; slots = calendar blocks **∧** free assignee-pool capacity. |
| Crew representation? | **Per-service assignee pool** (roles and/or people). Skill-tagged crew and numeric capacity are noted alternatives only. |
| No free pool member / no slots? | **Auto-fall to Requestable** — hide Book, keep Request. |
| Book assigns whom? | Bind `assigned_to` to a free pool member (or equivalent hold) so capacity + `420` guard stay honest. |
| Concurrent book race? | Transactional free-pool check; optional brief hold/reserve. |

---

## Implementation chunks (follow-up executors)

Estimated ordered chunks (each PR-sized):

1. **Capability core** — ✅ `deriveServiceCapability`, public serializer fields, tests for matrix.  
2. **Live/operational parity** — ✅ bulk+single transition side effects, backfill migration `589`, review flags.  
3. **Kill dual source** — ✅ settings API reject + admin UI removal + legacy tools import migration + docs banner.  
4. **Public browse honesty** — ✅ paused visible, counts fix, pagination state fix, Home/Direct parity, days label rename.  
5. **Request form catalog-driven** — ✅ remove hardcoded categories; derive `service_category`; validation alignment.  
6. **Assignee pool schema + admin editor** — ✅ roles/users on service; review flags `bookable_without_pool`.  
7. **Slots engine** — ✅ `direct_calendar_blocks` − blackouts − busy pool members; public GET slots with capacity counts; empty ⇒ auto-fall.  
8. **Bookable UI + holds + POST book** — ✅ Book CTA only when derived bookable; `/direct/book-slot`; transactional assign; 409 race; empty slots → Request CTA.  
9. **Guards & leftovers** — ✅ parent retire rules, tool category required for publish phases, soft 409 concurrency, bookable_without_pool review.  
10. **QA / i18n / rollout notes** — ✅ unit tests + i18n en/es/fr/ht/ar; residual: full e2e smoke against live calendar + deploy migration 589.

---

## Open questions (only if product wants to refine later)

These do **not** block writing or implementing the model above; defaults are already chosen in-doc:

- Guest may complete Bookable slot hold without account vs must sign in before confirm.
- Exact initial status for slot-booked requests (`scheduled` vs `accepted`).
- Default `booking_slot_minutes` (120 proposed).
- Whether paused services appear in Home embed identically to `/direct` (yes, proposed).
- Hold TTL length (3–5 minutes proposed) vs book-only transactional check.
- Pool storage: junction tables now vs jsonb v1 then normalize.
- Whether role-only pools (no named people) are enough for small ops, or admin must always pick people.
- Public copy when auto-fallen (`capacity_exhausted`) — silent hide Book vs short “Instant book full — request a time.”

---

## Success criteria

- Admin Move to Live ⇒ customer can Request without a second “operational” click in the common path.
- Bookable service with availability blocks **and** a free assignee-pool member ⇒ customer picks a real slot on Direct; job lands on dispatch calendar with `assigned_to` set.
- One person in pool ⇒ two overlapping Book attempts cannot both succeed; second sees no slot or 409; **Request remains available** (auto-fall).
- Capacity exhausted / no slots ⇒ Book hidden, Request shown when otherwise Requestable.
- Editing Settings cannot silently diverge tools/coverage from what customers see.
- Request form selections are catalog IDs the server will accept.
- Lifecycle, operational, bookable preference, and **crew capacity** each have one clear job; public CTAs use Visible / Requestable / Bookable only.
