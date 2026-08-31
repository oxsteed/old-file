# OxSteed Direct 60-Mile Service Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OxSteed Direct’s city-list framing with the approved 60-mile service-area message.

**Architecture:** Keep the change inside the existing Direct profile defaults and Direct customer page. Preserve stored profile compatibility and existing quote behavior.

**Tech Stack:** React, Vite, Node.js

## Global Constraints

- Approved copy: “Need help within 60 miles of Springfield, Ohio? Request a quote.”
- Change OxSteed Direct only.
- Do not alter request eligibility, scheduling, pricing, or schema.

---

### Task 1: Direct service-area copy

**Files:**
- Create: `client/scripts/verify-direct-service-area.mjs`
- Modify: `client/src/pages/DirectPortalPage.jsx`
- Modify: `server/controllers/directController.js`
- Modify: `AGENTS.md`

- [ ] Add a source-level regression check requiring the approved copy on the Direct customer page and in the backend fallback profile.
- [ ] Run `node --test client/scripts/verify-direct-service-area.mjs` and confirm it fails because the approved copy is absent.
- [ ] Replace Direct city-list presentation with the approved radius message and update the fallback profile.
- [ ] Run the focused check and `npm --prefix client run build:ci`.
- [ ] Verify `/direct/services` and `/direct/request-quote` manually and capture walkthrough evidence.
- [ ] Commit and push the implementation.
