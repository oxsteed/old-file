# Profile Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign Business Hub and Helper Edit Profile into a shared Profile Studio (side nav + section form + live preview + sticky save) without changing backend APIs.

**Architecture:** Add a reusable `ProfileStudioShell` and `ProfilePreviewCard` under `client/src/components/profileStudio/`. Refactor `BusinessProfileEditor.jsx` and `EditProfileTab.jsx` to feed sections into the shell while preserving existing state, validation, uploads, and save endpoints.

**Tech Stack:** React 18, existing CSS modules/classes patterns in the client, react-i18next, existing business/helper profile APIs.

## Global Constraints

- No new backend fields or endpoints
- Do not re-enable launch-hidden Hub mega-tabs
- Preview is a compact public card, not a full public-page clone
- Prefer reusing existing i18n keys; add only shell chrome keys
- Work on branch from `design/profile-studio` (or `feat/profile-studio` off it); PR into `old-files-claude`
- Commit frequently; keep diffs focused

## File map

| File | Role |
|---|---|
| `client/src/components/profileStudio/ProfileStudioShell.jsx` | Layout: nav, header, active section slot, sticky save, mobile section picker |
| `client/src/components/profileStudio/ProfilePreviewCard.jsx` | Live preview for `variant="business" \| "helper"` |
| `client/src/styles/ProfileStudio.css` | Shell + preview styles |
| `client/src/components/businessHub/BusinessProfileEditor.jsx` | Sectionize existing form; wrap in shell |
| `client/src/styles/BusinessProfileEditor.css` | Trim/adjust so it fits shell (avoid double chrome) |
| `client/src/components/EditProfileTab.jsx` | Map existing section state into shell |
| Locale JSON (en at minimum) | Shell strings: Edit profile, Save, Discard, section hints, placeholders |

---

## Task 1: ProfileStudioShell + CSS

**Deliverable:** Shell renders nav, one active panel, sticky save, responsive collapse.

- [ ] Create `ProfileStudioShell.jsx` with props: `title`, `subtitle`, `sections: {id,label,complete?}[]`, `activeSection`, `onSectionChange`, `dirty`, `saving`, `onSave`, `onDiscard`, `saveLabel?`, `preview`, `headerExtra?`, `children` (active section content)
- [ ] Create `ProfileStudio.css` — 3-column desktop; chips/select + stacked preview on <1024px; sticky save bar
- [ ] Smoke-render via a temporary story or by importing in isolation if easy; otherwise visual check after Task 2
- [ ] Commit: `feat(profile-studio): add shared ProfileStudioShell`

## Task 2: ProfilePreviewCard

**Deliverable:** Compact live card for business and helper.

- [ ] Implement `ProfilePreviewCard` with props for cover, avatar, name, tagline, meta lines, about excerpt, empty placeholders
- [ ] `variant="business"` and `variant="helper"` styling hooks
- [ ] Commit: `feat(profile-studio): add ProfilePreviewCard`

## Task 3: Wire BusinessProfileEditor

**Deliverable:** Business Edit Profile uses Studio with sections Photos, Identity, Contact, Location, Readiness.

- [ ] Split existing JSX into section panels (same state/handlers)
- [ ] Wrap with `ProfileStudioShell`; pass preview derived from form state
- [ ] Sticky save calls existing save; Discard resets to last loaded/saved snapshot
- [ ] Keep readiness checklist; jumps set `activeSection`
- [ ] Manual check: section switch, dirty/save, photo preview updates
- [ ] Commit: `feat(profile-studio): redesign Business Profile Editor`

## Task 4: Wire EditProfileTab (Helper)

**Deliverable:** Helper Edit Profile uses same shell; sections Cover, Basics, Hours, Services, FAQs, Policies, Gallery, Visibility.

- [ ] Map existing `section` state to shell nav
- [ ] Sticky save triggers active section save (label e.g. Save basics); keep per-item CRUD inside list sections
- [ ] Preview from core + cover (+ rates/area)
- [ ] Manual check: each section, list CRUD still works, preview updates
- [ ] Commit: `feat(profile-studio): redesign Helper Edit Profile`

## Task 5: i18n + polish + PR

**Deliverable:** PR ready against `old-files-claude`.

- [ ] Add missing en strings for shell chrome / placeholders
- [ ] Remove obsolete long-form-only layout chrome that fights the shell
- [ ] Quick grep for console errors; run any existing related unit tests
- [ ] Push branch; `gh pr create` summarizing Profile Studio + link to spec
- [ ] Commit as needed: `chore(profile-studio): i18n and polish`

## Done when

- Both editors use Profile Studio (side nav + live preview + sticky save)
- APIs unchanged; uploads and list CRUD still work
- PR opened with clear description
