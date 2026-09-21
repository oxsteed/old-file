# Security note: Telegram cloud-chat model (not secret-chat E2EE)

Date: 2026-09-21  
Related: `2026-09-21-pop-agreements-admin-chat-design.md`

## Choice

OxSteed live helper/business chat stores messages and artifacts server-side with
**conversation membership** checks on every fetch (quotes, POP, agreements,
attachments). Admin support access uses **break-glass** (role + non-empty reason
→ `admin_conversation_access_log` + `admin_audit_log`).

This mirrors **Telegram cloud chats**, not **Telegram secret chats**.

## Why not E2EE

Product requirement: admins must access thread content and linked POP/agreements
when needed. True E2EE (secret chat) blocks server and admin reads by design, so
it is incompatible with audited break-glass support.

## Residuals

- Compromised admin with break-glass privilege (audit + super-admin review).
- Compromised DB / object-store credentials (infra controls).
- Client device compromise after authorized download.
