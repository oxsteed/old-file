# Public Profile Messenger Dock — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Surfaces: public helper + business profiles (embedded live chat support)

## Problem

Live chat on public helper and business profiles feels weak end-to-end: the entry point is easy to miss, the open panel looks dated/cluttered, mobile use is awkward, it doesn’t match the redesigned public profile header, and guest vs logged-in flows feel like a dead end.

## Goals

- One modern **Messenger Dock** shared by helper and business public profiles.
- Obvious floating launcher + in-page “Message” CTA that open the same dock.
- Calm, elevated UI aligned with Public Profile hero / Profile Studio tokens.
- Guests can open the dock and complete a short in-panel gate (no page-level block).
- Mobile: bottom sheet; desktop: right dock.
- i18n for new chrome in en, es, fr, ht, ar in the same change.

## Non-goals

- New chat backend, websockets, or AI booking behavior changes.
- Redesigning staff/support inbox or escalation chat pages.
- File-attachment redesign or notification system work.
- Full-page chat takeover as the primary UX.

## Approach

**Modern messenger dock (Approach A)** — floating launcher + slide-over dock (desktop) / bottom sheet (mobile), wrapping existing conversation stream and composer where possible.

## Shell & launcher

### Launcher

- Floating control at bottom-inline-end (logical CSS for RTL), above safe-area inset.
- Shows avatar + “Message {name}”; compact “Message” on narrow screens.
- Optional unread badge; at most one subtle attention pulse per session if never opened.
- In-page profile “Message” / open-chat controls open the **same** dock (single source of open state).

### Dock

- **Desktop/tablet:** right-side panel ~380–420px wide, near full viewport height with margin, rounded elevated surface.
- **Mobile:** bottom sheet ~85–92vh, drag handle + close, focus trap while open.
- **Header:** avatar, display name, subtitle (reply expectation or online/away if already available), close.
- **Body:** existing message stream (restyled).
- **Footer:** sticky composer (restyled).
- Helper vs business: same chrome; avatar shape follows public summary card (helper round, business rounded square).

### States

- Closed → launcher visible.
- Open → dock visible; launcher hidden or minimized.
- Loading / empty / error → calm empty copy, not a blank panel.

## Guest vs logged-in

### Logged-in

- Dock opens directly on the thread with this helper/business (create-or-resume via existing APIs).
- Composer enabled immediately.

### Guest

- Dock opens immediately (no “sign in first” wall on the profile page).
- In-dock gate: name + email required; primary **Continue as guest**; secondary **Sign in instead**.
- After continue, composer unlocks using existing guest send/claim paths.
- Mid-thread sign-in keeps current claim/merge behavior — no backend redesign.

### Trust

- One-line guest disclaimer under composer: messages go to this business/helper on OxSteed.

## Message UX

- Clear visitor vs host bubbles, grouped timestamps, day separators.
- Use existing sending/typing affordances if present; do not invent new realtime transport.
- Failed send: inline retry on the bubble.
- Empty thread: short prompt to ask about availability, pricing, or booking.
- Quick suggestion chips only if hooks already exist; otherwise skip.

## Visual language & motion

- Surfaces, radii, borders, and accent aligned with public profile hero / Profile Studio.
- Visitor bubbles + primary actions use accent; host bubbles use neutral surface.
- Theme follows existing light/dark tokens when present.
- Open/close ~200ms; mobile sheet restrained — no motion that delays first input.

## Implementation sketch

1. Add `MessengerDock` + `MessengerLauncher` under shared public-profile chat components.
2. Lift open state so header / CTA / FAB all call the same opener.
3. Restyle `ChatPanel` / composer / bubbles for dock context.
4. Embed guest gate as first panel step when unauthenticated.
5. Wire helper + business public profile pages; remove redundant parallel chat shells where safe.
6. i18n keys for launcher, gate, empty, disclaimer in all five locales.
7. Unit tests for open/close helpers + guest-gate visibility; manual mobile/desktop pass.

## Success criteria

- From a public helper or business profile, a visitor can discover chat and open a modern dock in one tap.
- Guests complete an in-dock gate and send without leaving the profile for a hard auth wall.
- Logged-in users go straight to the thread.
- Desktop dock + mobile sheet both usable; RTL doesn’t misplace the launcher.
- Visual tone matches the new public header.
- New strings exist in en/es/fr/ht/ar together.

## Decisions log

- 2026-09-21: Improve live chat on public helper + business profiles (“everything” pain: launcher, panel, mobile, header match, guest flow).
- Approach A — modern messenger dock — approved.
- Shell & launcher approved.
- Guest flow + message UX approved.
- Visual polish & scope approved; write spec then implement.
