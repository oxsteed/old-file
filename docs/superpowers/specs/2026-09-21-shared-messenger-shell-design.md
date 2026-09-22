# Shared Messenger Shell — Design

Date: 2026-09-21  
Repo: oxsteed/old-file  
Branch: old-files-claude  
Surfaces: global `/messages` (+ `/helper/messages`) and `/business/:id/workspace/messages`

## Problem

Two messenger surfaces share deal APIs and `ConversationThread`, but the chrome diverges and both look broken in production screenshots:

1. **Business Hub Deals** (`BusinessMessagingTab`): empty/select states are weak; open thread shows smashed `CopyEditDelete` (actions concatenate because thread styles from `MessagesPage.css` are not loaded on this surface); Quote / POP / Agreement chips appear **twice** (header buttons + `ProviderMessengerToolbar`); header jams “Translating on” + “AI Finance Calculator” as full labels next to deal chips.
2. **Global `/messages`** (`MessagingWorkspace`): bubbles are better, but the page is top-heavy — large stats row, dense filter row, and four primary-looking action buttons — plus redundant hero + thread headers.

Provider deal tools (quotes, POP, agreements, Request $, schedule, credit pay/refund) already work via `ConversationThread` panels; this slice is a **shared shell and visual hierarchy**, not a new backend.

## Goals

1. One **Shared Messenger Shell** used by both surfaces (extract/refactor; do not add a third parallel inbox).
2. **Thread-first** hierarchy: demote stats and secondary CTAs; keep unread/search reachable without dominating the canvas.
3. **Message actions** Copy | Edit | Delete as real spaced controls (never concatenated text).
4. **Single** non-duplicated provider tools toolbar (Quote, POP, Agreement, Request $, Schedule, Contact; Refund when applicable) reusing existing panels/APIs.
5. **Header**: peer name once; Translate + AI Finance as icon / overflow secondary controls, not jammed labels.
6. Clear empty states; mobile/responsive; a11y; i18n en/es/fr/ht/ar for new UI strings.

## Non-goals / out of scope

- E2EE messenger.
- Replacing Team API / `business_conversations` with deal threads (Team tab stays as-is).
- New chat transport, ledger, or quote/POP/agreement APIs.
- Redesigning public-profile Messenger Dock (already separate).

## Surfaces

| Surface | Role | Inbox source | Thread |
|---|---|---|---|
| `/messages`, `/helper/messages` | customer / helper / dual | `/messages/conversations` (+ guest inquiries) | `ConversationThread` |
| Business Hub **Deals** | provider (`role="helper"`) | `/messages/conversations?business_id=` | same `ConversationThread` |
| Business Hub **Team** | internal | `/businesses/:id/messages` | legacy team UI (unchanged API) |

## Shared components

### `ConversationList`

Reusable conversation row list: avatar initial, peer name, preview, time, unread badge, optional guest/side chips. Props: `items`, `selectedId`, `onSelect`, `loading`, `empty`, `filterSlot` (search / all|unread). Used by `MessagingWorkspace` and Business Hub Deals.

### `ConversationThread` (refactor in place)

Keep existing hook (`useConversationChat`), cards, and share panels. Changes:

- Import shared shell CSS so styles apply on **every** host (fixes smashed actions on Business Hub).
- Remove duplicate Quote / POP / Agreement / Request $ buttons from the thread header when `ProviderMessengerToolbar` is shown.
- Header secondary: Translate + AI as icon buttons (aria-label + title); optional overflow menu on narrow widths.
- Message meta uses `MessageBubbleActions` (spaced Copy | Edit | Delete with separators / gap ≥ 8px, never bare adjacent text nodes).

### `MessageBubbleActions`

Small presentational control group: Copy always; Edit/Delete when own message. Explicit `display: inline-flex; gap`; middle-dot or pipe separators optional for resilience if CSS fails to load.

### `ConversationComposer`

Already shared (`ConversationComposer.jsx`); no behavioral change required beyond shell layout.

### `ProviderToolsToolbar` (`ProviderMessengerToolbar`)

Single toolbar under the header for provider role. Intents only; parent owns panels (QuoteShare, PopShare, AgreementShare, PaymentRequestShare, schedule picker, CreditRefund, ContactDrawer). Style: horizontal wrap with gap; one chip per tool; never also mirrored in the header.

### `SharedMessengerShell` layout tokens

CSS module/file (`SharedMessengerShell.css`) owning:

- `.messages-thread`, head, scroll, bubble, bubble-actions, composer
- `.provider-messenger-toolbar`
- Compact list chrome helpers shared with Business Hub deals pane

`ConversationThread` **must** import this CSS (not only `MessagingWorkspace`), so Business Hub embeds get correct spacing.

## Visual hierarchy

1. **Primary**: conversation list + open thread (bubbles + composer).
2. **Secondary**: search, All/Unread (and side filter when dual-role).
3. **Tertiary / collapsed**: conversation count / unread / guest stats — compact chips or a single summary line; hide the large hero stats block when a thread is open; demote Find helpers / Post job / Improve profile into a “More” menu or footer links.
4. Thread header shows **peer name once** (+ optional business/job subtitle). No second title strip that repeats the page hero.

## Empty states

- No conversations: existing helper/customer empty copy (keep CTAs).
- Filtered empty: compact “no matches” in the list pane.
- Thread deselected (desktop): “Select a conversation” in the thread pane (Business Hub: deals-specific copy).
- Thread not found: back affordance.

## Mobile / responsive

- Existing workspace pattern: list XOR thread below ~980px (`has-thread` toggles panes).
- Provider toolbar wraps; labels hide via `.hide-sm`, icons remain.
- Bubble actions stay tappable (≥ 32px hit targets via padding).

## Accessibility

- Toolbar `role="toolbar"` + aria-label (existing).
- Icon-only header buttons have `aria-label` and `title`.
- Translate toggle keeps `aria-pressed`.
- Message actions use `aria-label` on Copy; Edit/Delete use visible text or aria-label.
- Focus order: back → peer → secondary icons → provider toolbar → thread → composer.

## i18n

New / adjusted UI strings under `messages.shell.*` (and any new aria labels) in **en, es, fr, ht, ar** with key parity (`npm run verify:i18n`). Reuse existing keys for Copy/Edit/Delete, provider tools, translate where possible.

## Implementation approach

Prefer extract/refactor:

1. Spec (this doc).
2. `SharedMessengerShell.css` + `MessageBubbleActions` + optional `ConversationList` + small `messengerShellState.js` helpers for tests.
3. Refactor `ConversationThread` (dedupe tools, header overflow, import CSS, bubble actions).
4. Slim `MessagingWorkspace` chrome; wire `ConversationList`.
5. Slim Business Hub Deals list to shared list patterns; keep Team tab.
6. Tests (`messenger-dock` / new shell unit tests) + `verify:i18n`.

## Success criteria

- Business Hub open deal: Copy | Edit | Delete visibly spaced; one Quote/POP/Agreement/Request$/Schedule/Contact row; Translate/AI not jammed as long labels beside chips.
- `/messages`: thread-first; stats/secondary CTAs demoted; no redundant double header noise when a thread is open.
- Provider deal tools still open existing panels and call existing APIs.
- Team inbox unchanged in API.
- `verify:i18n` green; messenger shell / dock tests green.

## Residuals (intentional)

- Team tab UX polish beyond keeping it working.
- Full redesign of MessageBubble.tsx (profile dock) — only inbox `ConversationThread` actions in this slice.
- E2EE; replacing Team API.
