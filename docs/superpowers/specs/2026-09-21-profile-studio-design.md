# Profile Studio — Edit Profile redesign

Date: 2026-09-21  
Repo: oxsteed/old-file  
Surfaces: Business Hub Edit Profile (`BusinessProfileEditor`) and Helper Edit Profile (`EditProfileTab`)

## Problem

Both Edit Profile UIs dump too many fields into one long form. They are hard to scan and feel unfinished compared to the rest of OxSteed.

## Goals

- Break each editor into clear sections with a side nav (one page, not separate routes).
- Always show a live preview of the public profile card while editing.
- Share one Profile Studio shell so Business and Helper stay visually aligned.
- Keep existing APIs and fields; this is presentation and information architecture.

## Non-goals

- New backend fields or endpoints
- Redesigning other Business Hub or Helper dashboard tabs
- Re-enabling launch-hidden Hub mega-tabs
- Full public-page WYSIWYG (preview is a compact public card, not the entire public page)

## Approach

**Shared Profile Studio shell** wrapping both editors.

### Layout

| Breakpoint | Arrangement |
|---|---|
| Desktop (≥1024px) | Three columns: left section nav (~220px), center form (flex), right live preview (~340px, sticky) |
| Tablet / mobile | Section picker on top (chips or select); form; preview below (or Edit / Preview toggle). Sticky bottom save bar |

**Header:** title (“Edit profile”), short subtitle, readiness/completion pill when checks already exist.  
**Footer:** sticky save bar — Discard (when dirty) + Save; disabled while saving; clear unsaved state.

Section nav jumps within the page (show one section at a time in the center). Active section highlighted; optional checkmarks when that section’s required fields pass.

### Business Hub sections

1. Photos — cover + logo  
2. Identity — name, category, tagline, about  
3. Contact — phone, email, website  
4. Location — address / service area fields already on the form  
5. Readiness — existing completion checklist with jump-to-section

Business save remains one save for the whole profile (existing behavior).

### Helper sections

1. Cover — cover image  
2. Basics — headline, bio, rates, city/state, radius, available-now  
3. Hours — weekly availability  
4. Services — list CRUD  
5. FAQs — list CRUD  
6. Policies — list CRUD  
7. Gallery — photos  
8. Visibility — which blocks show on the public profile  

Helper APIs stay split per area. The sticky bar triggers the **active section’s** save and is labeled clearly (e.g. “Save basics”). List CRUD (services/FAQs/policies/gallery) keeps today’s add/edit/delete flows inside those sections.

### Live preview

- Compact public-card preview: cover, avatar/logo, name, tagline, key meta.
- Business: type, place, contact snippets, about excerpt.
- Helper: cover, headline, rates/area, availability cue.
- Updates from in-memory form as the user types; photos update when a new file/URL is chosen.
- Empty fields show muted placeholders (“Add a tagline”).
- Keep “View public profile” when a public URL exists.

### Visual language

- Match OxSteed Hub: calm surfaces, clear hierarchy, generous spacing, rounded cards.
- One primary section card in the center with short title + one-line hint.
- Label → control → hint/count; 2-column grids only for short paired fields.
- Large photo dropzones with obvious empty states; overlay actions when filled.
- Side nav: quiet list, accent active state; optional completion checks.
- Sticky save bar: subtle top border, primary Save, secondary Discard when dirty.

## Implementation sketch

1. Add shared shell: e.g. `client/src/components/profileStudio/ProfileStudioShell.jsx` (+ CSS).
2. Add preview primitives: `ProfilePreviewCard` variants or props for `business` | `helper`.
3. Refactor `BusinessProfileEditor` to render sections inside the shell (preserve form state, validation, uploads, save).
4. Refactor `EditProfileTab` the same way (map existing `section` state to shell nav).
5. Mobile: collapse nav to chips/select; stack preview; keep sticky save.
6. i18n: reuse existing keys where possible; add only keys needed for shell chrome.
7. Smoke-test both surfaces (dirty/save, section switch, preview updates, uploads).

## Success criteria

- Neither editor is a single endless form; sections are reachable from a side nav (or mobile equivalent).
- Live preview is visible while editing on desktop; available without leaving the tab on mobile.
- Existing save/upload/list CRUD still works.
- Business and Helper share the same chrome and feel like one product.

## Decisions log

- 2026-09-21: Redesign both Edit Profile tabs.
- Pain: too many fields in one long form.
- Structure: side nav with sections on one page.
- Preview: form + always-on live public preview.
- Approach A: shared Profile Studio shell.
- Layout, section maps, and polish approved by Emile.

## Follow-ups (2026-09-21)

### Shared public preview
Studio preview, compact public pages (`/helpers/public/:id`, `/businesses/public/:id`), and full guarded profiles (`/helpers/:id`, `/business/:id`) share `PublicProfileSummaryCard` + `buildPublicProfileSummaryModel` / `buildFullProfileHeaderSummaryModel`. Full pages compose the card through `PublicProfileHero` (identity band) while keeping page-only chrome (CTA, QR, share, badges, stats, section tabs) as slots/children around it. `BusinessHeader` is the thin adapter that maps `HelperProfile` → summary model + those slots.

### Helper save → draft-friendly status
Sticky bar uses a single client save-status model (`createHelperSaveStatus` / `resolveHelperSaveBar` / `serializeHelperCore` in `profileStudio.js`): real dirty/save for Basics+Hours; Cover and list CRUD sections keep the bar visible with “Saved automatically” (no fake sticky Save). **No whole-profile draft API exists on the server today** (searched helper/business profile routes — only unrelated quote/product draft/publish). Keep the client seam; do not invent a fake draft API.

### Whole-profile draft + publish (intended contract)
When we add a real backend, prefer one draft document per helper (and later business) rather than inventing parallel client stores:

| Concern | Shape |
|---|---|
| Draft resource | `GET/PUT /api/helpers/me/profile/draft` — full editable snapshot (basics, hours, services, faqs, policies, gallery refs, visibility, cover) |
| Publish | `POST /api/helpers/me/profile/publish` — validates completeness, copies draft → live public profile, returns `{ publishedAt, publicPath }` |
| Status | `GET /api/helpers/me/profile/status` — `{ hasDraft, draftUpdatedAt, publishedAt, dirtySections[] }` |
| Migration | Today’s per-section saves become “write through to draft”; publish is explicit. Until then, `createHelperSaveStatus` mirrors dirty/saving/lastSavedAt only in memory |
| Client seam | `createHelperSaveStatus` + `resolveHelperSaveBar` stay the sticky-bar API; wire `lastSavedAt` / dirty flags from draft status when the endpoints land |

Business Hub can follow the same pattern later (`/api/businesses/:id/profile/draft` + publish) once Helper proves the flow.

