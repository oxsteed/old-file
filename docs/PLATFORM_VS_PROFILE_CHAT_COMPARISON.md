# OxSteed Platform Support Chat vs Helper/Business Profile Chat

Branch: `old-files-claude` · Investigation from code only · Generated 2026-09-21

---

## Executive summary

These are **two largely separate product systems** that share branding (“OxSteed Support”) and AI chat patterns but **do not share** the same persistence, realtime namespace, or agent tooling.

| Aspect | Platform support | Profile messenger |
|---|---|---|
| Purpose | Platform customer support (tickets / live agents) | Talk to a helper/business (or OxSteed AI on that page) |
| Primary entry | Global `SupportWidget` → `/support` | Dock on `/helpers/:id`, `/business/:id` |
| Live humans | Yes (`support_agents` + queue) | Yes only for **authenticated** + helper/rep online + `destination=helper` |
| OxSteed destination | Full support stack | **AI-only** on profile (`destination=oxsteed`); CTA hands off to `/support/escalation` with profile context |
| Socket | `/support` | `/chat` via `useSocket` |
| Core tables | `support_conversations` (+ legacy `support_tickets`) | `conversations`/`messages` (+ guest inbound tables) |

**Important wiring note:** Unused `HybridSupportWidget` / `CustomerSupportWidget` were removed (never mounted). The live global widget is `client/src/components/SupportWidget.jsx`. Profile OxSteed AI uses `DestinationContextBanner` → `/support/escalation?from=profile&helperId=…` (see `supportEscalationHandoff.js`).

---

## 1. Purpose / audience

### Platform support
- Audience: anyone needing **OxSteed platform** help (billing, jobs, disputes, account, etc.).
- Product surface: AI assist + escalate to live platform/business-scoped support agents, with ticket/queue fallback.
- Evidence: `SupportEscalationPage` labels OxSteed Support phone/email; authenticated flow auto-connects via `/support-routing/connect`; guest flow is “Talk to OxSteed Support” with email verify (`client/src/pages/SupportEscalationPage.jsx`).

### Helper/business profile chat
- Audience: visitors on a **helper or business public profile** wanting to message that provider (or switch destination to OxSteed AI for platform-ish Q&A without leaving the page).
- Evidence: `PublicProfileMessenger` + `ChatDestinationDropdown` options `helper` | `oxsteed` (`client/src/components/helperProfile/chat/*`); mounted on `HelperBusinessProfilePage` (`/helpers/:id`) and `BusinessProfilePage` (`/business/:id`).

---

## 2. Entry points (URLs / widgets)

### Platform support
| Entry | Path / component | Evidence |
|---|---|---|
| Global floating widget | `App.jsx` mounts `<SupportWidget />` | `client/src/App.jsx` (~545), `client/src/components/SupportWidget.jsx` |
| AI → human CTA | Navigates to `/support/escalation` | `SupportWidget.jsx` `navigate('/support/escalation')` |
| Escalation / live page | `/support`, `/support/escalation` | `App.jsx` routes 372–373 → `SupportEscalationPage` |
| Authenticated ticket detail | `/support/my-tickets/:ticketId` | `App.jsx` 374 |
| Agent portal (apply/hire) | `/support/agent` | `SupportAgentPortalPage` |
| Agent workspace | `/support/agent/workspace?business=` | `SupportAgentWorkspacePage` wraps `SupportConversationWorkspace` |
| Admin ops | AdminApp `support/*` | tickets, agents, chat, SLA, escalations, etc. (`client/src/admin/AdminApp.jsx` 191–223) |
| Retired unused widgets | *(deleted)* `HybridSupportWidget` / `CustomerSupportWidget` | Were never mounted; live path is `SupportWidget` |

Widget intentionally **hidden** on `/helpers/:uuid` so profile chat wins (`isHelperPublicProfilePath` in `SupportWidget.jsx`).

### Profile messenger
| Entry | Path / component | Evidence |
|---|---|---|
| Helper profile dock | `/helpers/:id` → `HelperBusinessProfilePage` → `PublicProfileMessenger` | App route 339; page ~521 |
| Business profile dock | `/business/:id` → `BusinessProfilePage` → `PublicProfileMessenger` | App route 349; page ~1168 |
| Simpler public cards | `/helpers/public/:helperId`, `/businesses/public/:businessId` | **No** `PublicProfileMessenger` wired |
| Inbox (post-chat) | `/messages`, `/helper/messages`, guest inquiry routes | `App.jsx` 434–441 |

Destination state: profile messenger defaults destination to **helper** where configured; OxSteed destination remains AI-only with an explicit “Talk to a human” handoff to platform support.

---

## 3. Auth & guest verification

### Platform support
**Authenticated** (`SupportEscalationPage` → `AuthenticatedSupportEscalationPage`):
- Requires login; uses JWT on `/support` socket and `/support-routing/*` (routes use `requireAuth`).
- Auto `POST /api/support-routing/connect` then live chat or ticket fallback.

**Guest public** (`PublicGuestSupport`):
1. `POST /api/support/public/conversations` (name, email, message)
2. Email 6-digit code (`support_guest_verifications`)
3. `POST .../verify` → guest token (24h)
4. Subsequent calls use `Authorization: Guest <token>`
5. Socket auth: `guestToken` + `conversationId` on `/support`

Evidence: `server/routes/support.js` 48–56; `server/controllers/publicSupportController.js`; migration `378_public_support_guest_chat.sql`; `server/bootstrap/realtime.js` guest token hash check.

**Legacy/alternate:**
- `POST /api/support/request` → `support_tickets` (`supportController.submitSupportRequest`)
- `POST /api/support-chat/initiate` → live admin via **DM `conversations`** or `support_tickets` (`supportChatController.js`) — older path; client escalation page does **not** use it.

### Profile messenger
**Logged-in:** optionalAuth on `/api/chat/profile-message`; live DM only if authenticated.
**Guest:**
- `MessengerGuestGate` collects name/email into sessionStorage (`messengerDockState.js`) — **no email verification code**.
- Sends via `POST /api/chat/profile-message` with `guestName`/`guestEmail`.
- Guests **cannot** enter live mode (server requires `userId` for live).
- Claim after signup: `POST /api/chat/sessions/guest/claim` (ChatPanel).
- Dedicated create endpoint `POST /api/chat/sessions/guest` writes `guest_profile_chat_inbound` — **no client caller found** from messenger send path (only claim is used). Parallel `/api/guest-chat` also unused by current messenger UI.

---

## 4. Routing & assignment (who receives messages)

### Platform support
- Conversations scoped by `business_id` on `support_conversations` (guest create currently inserts `business_id = null` — `publicSupportController.js` L75).
- Authenticated routing resolves “customer support business” as first active primary business (`supportRouting.js` `resolveCustomerSupportBusinessId`).
- Agents from `support_agents` joined to `support_employers` where employer is **business-scoped OR `kind='platform'`** (`supportRoutingService.js` L66–67; `supportEmployerService.js`).
- Auto-route: AI triage → skill → availability + **socket presence**; outcomes `agent` | `queue` | (ticket/wait).
- Assignment tables: `conversation_assignments`, `support_queue`; events `ticket:assigned`, `ticket:new-assignment`.
- Who operates:
  - **Platform:** OxSteed admins / platform employer agents (admin `SupportAgentChat`, availability heartbeat).
  - **Business-scoped:** business support settings, hiring profiles, `/:businessId/*` support APIs; agent workspace can pass `?business=`.
  - Agent portal lets users apply to platform / business / helper employers (`SupportAgentPortalPage` kinds).

### Profile messenger
| Condition | Recipient |
|---|---|
| `destination=helper`, auth, helper or business rep online | Live → `conversations`/`messages`; notify owner + online reps (`profile_chat:new_message`) |
| `destination=helper`, guest or offline | AI with helper/business context (Redis thread); booking side-effects possible |
| `destination=oxsteed` | OxSteed **AI only** — no agent assignment, no `support_*` write |

Business profiles still use destination key `'helper'` (talk to business owner/reps); `entityKind='business'` is UI only (`ChatDestination = 'oxsteed' | 'helper'`).

---

## 5. AI involvement

### Platform
- Global widget: `POST /api/chat/message` (`chatController.chatMessage`) — platform FAQ AI; escalate CTA to `/support/escalation`.
- Routing layer: `supportTriageAI` confidence &lt; 0.70 → escalate (`supportRoutingService.analyzeWithAI`).
- Agent workspace: AI draft helpers inside `SupportConversationWorkspace` (ops-side).
- `HybridSupportWidget` (unused) also posts `/chat/message` then escalates via `/support-routing/conversations`.

### Profile
- Same LLM stack via `profileChatMessage`:
  - Helper/business AI: cached profile/business system prompt.
  - OxSteed destination: fixed platform-support system prompt; authorType `oxsteed_ai`.
- Thread memory: Redis `chat:{threadId}` (not support DB).
- Can create appointment/booking requests when destination ≠ oxsteed.

**Connection gap:** Choosing “OxSteed Support” in the profile dropdown does **not** open platform live support or create a support ticket; it only flips AI persona.

---

## 6. Realtime transport

| System | Namespace | Client | Auth | Key events |
|---|---|---|---|---|
| Platform | `/support` | Direct `io(realtimeNamespaceUrl('support'))` | JWT or guestToken | `customer:join`, `ticket:join`, `message:new`, `ticket:assigned`, typing, status |
| Profile / DMs | `/chat` | `useSocket()` singleton | JWT (`auth.token`); **no socket if logged out** | `message:new`, `message:edited`, `message:deleted`, `messages:read`; server also emits `profile_chat:new_message` to helpers |

Bootstrap: `server/bootstrap/realtime.js` — namespaces `['/chat','/support','/restaurant-display']`. Support handshake documented to allow polling for guests; chat client prefers websocket-only.

Guests on profile chat have **no** `/chat` socket (useSocket skips when `!user`); they rely on HTTP AI responses only.

---

## 7. Persistence model (tickets vs DMs)

### Platform (support)
| Store | Role |
|---|---|
| `support_conversations` + `support_conversation_messages` | Canonical live support threads (guest + auth) |
| `support_queue`, `conversation_assignments` | Queue / claim |
| `support_agents`, `support_employers`, shifts, SLA, metrics, KB, templates | Ops |
| `support_guest_verifications` | Guest email codes |
| `support_tickets` + `support_messages` | **Older/parallel** ticket API (`/support/request`, admin SupportTickets, support-chat escalation) |
| Channel/email outbox & webhooks | Omnichannel (`supportChannelWebhooks`, deliveries) |

Guest insert allows `business_id` NULL (`378_public_support_guest_chat.sql`).

### Profile (messenger / DMs)
| Store | Role |
|---|---|
| `conversations` + `messages` | Authenticated customer↔helper(/business) DMs |
| `business_conversations` / `business_messages` | Mirror for business inbox |
| Redis thread memory | AI turns (guest + oxsteed + offline helper) |
| `guest_profile_chat_inbound` (+ messages) | Guest inquiry inbox — **create API exists; messenger send path does not call it** |
| `/api/guest-chat` tables/flow | Separate guest-to-helper system; not wired to PublicProfileMessenger |

---

## 8. Admin / ops tooling

### Platform — rich
- Admin: SupportTickets, AgentDashboard/Management/Onboarding, AgentChat workspace, KB, templates, metrics, SLA, CSAT, QA, escalations rules, team hierarchy, settings, audit (`AdminApp.jsx`).
- Non-admin agents: `/support/agent`, `/support/agent/workspace`.
- Shared UI: `SupportConversationWorkspace.jsx` (large ops console).

### Profile — inbox-oriented
- Helper/customer: `/messages`, `/helper/messages`, guest inquiry pages.
- `MessagingWorkspace` listens for `profile_chat:new_message` including guestInquiry payloads.
- **No** SLA/queue/CSAT admin for profile threads.
- Business Hub messaging templates exist separately (`businessMessageTemplates`).

---

## 9. Where they CONNECT (handoff)

### Documented UI “handoff”
- `ChatDestinationDropdown` switches helper ↔ OxSteed.
- `DestinationContextBanner` when destination is oxsteed.
- `HandoffBanner` renders if timeline has `itemType === 'handoff'`.

### Actual code connection
- **No producer** of `itemType: 'handoff'` found in client or server — banner appears **dead UI**.
- OxSteed destination ≠ call into `/support` or `/support-routing`.
- Platform widget **avoids** overlapping UI on helper profile paths by hiding itself.
- Shared AI endpoint family (`/api/chat/message` vs `/api/chat/profile-message`) but different prompts and persistence.
- Employer model allows platform agents to staff business-keyed support conversations — that is **inside** the support system, not a bridge from profile chat.

**Honest conclusion:** Product metaphor suggests handoff from profile → OxSteed live support; **implementation is destination-switched AI only**, plus a separate full support product entered via `/support` / global widget.

---

## 10. Gaps, overlaps, risks

1. **Dual “OxSteed Support” surfaces** — profile dropdown vs `/support` live agents; users may believe they already reached live platform support when they only got `oxsteed_ai`.
2. **Default destination `'oxsteed'`** on helper page contradicts comment and may divert traffic away from the helper.
3. **Dead / parallel clients:** `HybridSupportWidget`, `CustomerSupportWidget` unused; live path is `SupportWidget` + `SupportEscalationPage`.
4. **Dual support persistence:** `support_conversations` (modern) vs `support_tickets` (legacy) vs `support-chat` writing into DM `conversations` — ops risk of looking in the wrong inbox.
5. **Guest profile messages** primarily AI/Redis; dedicated inbound table + `/chat/sessions/guest` underused by ChatPanel send → helpers may not see guest chat history in inbox unless booking/email paths fire.
6. **Second guest stack** `/api/guest-chat` unused by messenger → kept registered with legacy comments (mobile/tests uncertain); do not expand.
7. **HandoffBanner / handoff timeline** implemented but not emitted → false sense of live takeover.
8. **Auth asymmetry for realtime:** profile guests have no `/chat` socket; platform guests do have `/support` socket after verify.
9. **Business_id null** guest support conversations vs routing that often assumes a business id — queue/agent matching for guests depends on platform-employer paths (`supportWaitService` platform agents); verify carefully in ops.
10. **Simpler public profile routes** (`/helpers/public/...`) lack messenger while `/helpers/:id` has it — inconsistent entry.
11. **Capability gate:** if `aiSupport` capability off, floating button only navigates to escalation (no AI widget).

### Uncertainties (not fully proven from static read)
- Whether production DB always has a platform `support_employers` row and which `businesses` row `resolveCustomerSupportBusinessId` picks in real deploys.
- Whether any mobile/iOS client still calls `/api/support-chat` or `/api/guest-chat` (not in this web client tree).
- Runtime behavior of SLA workers against `business_id IS NULL` guest conversations beyond code paths that enqueue with NULL.

---

## File index (high-signal)

### Platform — client
- `client/src/components/SupportWidget.jsx` — mounted AI widget
- `client/src/components/support/HybridSupportWidget.jsx` — unused hybrid
- `client/src/pages/SupportEscalationPage.jsx` — guest verify + auth live/ticket
- `client/src/pages/SupportAgentPortalPage.jsx`, `SupportAgentWorkspacePage.jsx`
- `client/src/components/support/SupportConversationWorkspace.jsx`
- `client/src/admin/pages/Support*.jsx`, `AdminApp.jsx` support routes

### Platform — server
- `server/routes/support.js`, `supportRouting.js`, `supportChat.js`, `supportAgents.js`, `supportChannelWebhooks.js`
- `server/controllers/publicSupportController.js`, `supportRoutingController.js`, `supportConversationsController.js`, `supportChatController.js`, `supportController.js`
- `server/services/supportRoutingService.js`, `websocketService.js`, `supportEmployerService.js`, `supportWaitService.js`
- `server/bootstrap/realtime.js`
- Migrations: `139_support_conversations.sql`, `378_public_support_guest_chat.sql`, `046_support_tickets.sql`, `149_support_employers.sql`

### Profile — client
- `client/src/components/helperProfile/chat/PublicProfileMessenger.jsx`, `MessengerDock.jsx`, `MessengerLauncher.jsx`, `MessengerGuestGate.jsx`, `ChatPanel.tsx`, `ChatDestinationDropdown.tsx`, `HandoffBanner.tsx`
- `client/src/pages/HelperBusinessProfilePage.tsx`, `BusinessProfilePage.jsx`
- `client/src/hooks/useSocket.js` → `/chat`

### Profile — server
- `server/routes/chat.js`, `messages.js`, `guestChat.js`
- `server/controllers/chatController.js` (`profileChatMessage`, guest session/claim)
- `server/controllers/messageController.js`, `guestChatController.js`
- Migrations: `024_create_messaging_tables.sql`, `085_allow_guest_contact_and_guest_chat.sql`, `219_business_messaging.sql`


---

## Profile → platform support handoff (2026-09-21)

When a visitor selects OxSteed on the profile messenger, the dock stays AI-only.
“Talk to a human” navigates to `/support/escalation` with:

- Query: `?from=profile&helperId=&businessId=&helperName=&returnTo=`
- `location.state`: optional `prefillMessage` / recent message summary

`SupportEscalationPage` reads both via `readSupportEscalationHandoff` and prefills
the guest start message or authenticated ticket message. Live agents are only on
the support escalation page — not inside the profile dock.
