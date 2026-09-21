# Public Profile Messenger Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a modern Messenger Dock + launcher for public helper and business profiles per `docs/superpowers/specs/2026-09-21-public-profile-messenger-dock-design.md`.

**Architecture:** New shell components (`MessengerLauncher`, `MessengerDock`) wrap existing `ChatPanel` / composer. Lift open state so header CTA and FAB open the same dock. Guest gate is an in-dock step when unauthenticated. Restyle for dock context; no backend changes.

**Tech Stack:** React, existing helperProfile chat components, CSS (logical properties for RTL), i18next (en/es/fr/ht/ar).

## Global Constraints

- Spec is source of truth; no new chat APIs/websockets
- i18n: any new keys in all five locales same commit
- Prefer extending `client/src/components/helperProfile/chat/`
- Branch: `design/public-messenger-dock` → PR into `old-files-claude`
- Keep profile-studio tests green; add messenger-dock unit tests

## File map

| File | Role |
|---|---|
| `chat/messengerDockState.js` | Pure open/guest-phase helpers (testable) |
| `chat/MessengerLauncher.jsx` + css | Floating launcher |
| `chat/MessengerDock.jsx` + css | Desktop dock / mobile sheet chrome + guest gate slot |
| `chat/ChatPanel.tsx` | Dock mode className / layout tweaks |
| `chat/MessageBubble.tsx` / `MessageComposer.tsx` | Visual polish for dock context |
| Profile pages + BusinessHeader | Wire shared open state; remove redundant shells |
| locales en/es/fr/ht/ar | New chrome strings |
| `client/scripts/messengerDock.test.mjs` | Unit tests for state helpers + gate |

---

## Task 1: State helpers + tests

- [ ] Add `messengerDockState.js`: `shouldShowGuestGate(isAuthenticated)`, phase helpers, launcher visibility when open/closed
- [ ] TDD: write failing tests in `messengerDock.test.mjs`, then implement
- [ ] Commit: `feat(messenger-dock): add dock open/guest phase helpers`

## Task 2: Launcher + Dock shell

- [ ] Build `MessengerLauncher` (avatar, label, badge slot, RTL-safe position)
- [ ] Build `MessengerDock` (header, body slot, footer slot, mobile sheet vs desktop panel, Escape to close)
- [ ] CSS tokens aligned with public profile / Profile Studio
- [ ] Commit: `feat(messenger-dock): add launcher and dock shell`

## Task 3: Guest gate UI

- [ ] In-dock gate: name, email, Continue as guest, Sign in instead
- [ ] Wire to existing guest continue / auth entry points already used by ChatPanel
- [ ] i18n all 5 locales
- [ ] Commit: `feat(messenger-dock): in-dock guest gate`

## Task 4: Integrate ChatPanel + pages

- [ ] Embed ChatPanel in dock body with dock styling
- [ ] Lift open state on HelperBusinessProfilePage + BusinessProfilePage
- [ ] Header Message CTA + FAB open same dock; remove duplicate mobile sheet shells where safe
- [ ] Empty-thread copy per spec
- [ ] Commit: `feat(messenger-dock): wire dock on public helper and business profiles`

## Task 5: Polish bubbles/composer + PR

- [ ] Restyle bubbles/composer for dock; visitor accent / host neutral
- [ ] Run messenger dock + profile-studio tests
- [ ] Push + `gh pr create` against `old-files-claude` linking the design spec
- [ ] Commit: `feat(messenger-dock): visual polish and PR`

## Done when

- Public helper + business profiles use the new dock/launcher
- Guests get in-dock gate; logged-in go to thread
- Desktop dock + mobile sheet work; RTL launcher position correct
- New strings in all five locales; tests pass; PR open
