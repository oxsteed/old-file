# Group 10 Consultant (items 501-550) — Phase 0 survey at 93a1f92d7

Surveyed 2026-11-20. Full record with per-item evidence:
`workspace/goals/enterprise-audit-remediation/hidden_files/group10-consultant-survey-2026-11-20.md`

Base: merged PR #805 tip `93a1f92d7` (Groups 1, 2, 3, 9, foundation gates,
Emile's Group 11 equipment increment and business-team increment included).
Branch: `fix/persona-roadmap-1000-g10`.

## Verdicts: EXISTS 5 / PARTIAL 32 / MISSING 13

EXISTS (verified, not rebuilt): 502 Review status, 503 Specialty declaration,
508 Availability display, 516 Appointment options, 517 Time zone selection.

MISSING (13): 505 readiness checklist, 509 portfolio, 513 conflict
declaration, 521 proposals, 523 scope exclusions, 524 client approval,
525 proposal version history, 526 milestone board, 530 milestone acceptance,
531 scope revision request, 538 confidentiality acknowledgment,
539 file access expiry, 541 final deliverable checklist.

## Per-cluster counts

| Cluster | EXISTS | PARTIAL | MISSING |
|---|---|---|---|
| Qualify for work (501-505) | 2 | 2 | 1 |
| Present services (506-510) | 1 | 3 | 1 |
| Screen inquiries (511-515) | 0 | 4 | 1 |
| Schedule sessions (516-520) | 2 | 3 | 0 |
| Agree on work (521-525) | 0 | 1 | 4 |
| Deliver work (526-530) | 0 | 3 | 2 |
| Handle changes (531-535) | 0 | 4 | 1 |
| Maintain confidentiality (536-540) | 0 | 3 | 2 |
| Close engagement (541-545) | 0 | 4 | 1 |
| Operate the practice (546-550) | 0 | 5 | 0 |

## Build shape

Two overlapping consulting systems already exist: the consulting-sessions flow
(intake to delivery, `server/routes/consulting*.js`, `consulting_sessions` et al.)
and the business-launch contractor network (`consultantNetwork.js`,
`businessLaunch.js`, `consultant_contractor_profiles`). The recurring gap is
admin-only capability: items 504, 518, 519, 520, 522, 524, 530, 532, 540, 542,
545 are admin-side only for the operative action. The build is mostly
consultant/client-facing surfaces and approval flows on existing machinery.
Biggest genuinely new builds: proposals with versions + client approval (521,
524, 525), milestones + acceptance (526, 530), scope exclusions/revisions
(523, 531), confidentiality acknowledgment + file expiry (538, 539), portfolio
(509), readiness checklist (505), conflict declaration (513), final
deliverable checklist (541).

`consulting_audit_log` (migration 102) is dead schema, never read or written;
it is the natural home for 525 (version history) and 534 (change history).

## Slices

- A (501-510): qualify + present services
- B (511-520): screen inquiries + schedule sessions
- C (521-530): agree on work + deliver work
- D (531-540): handle changes + maintain confidentiality
- E (541-550): close engagement + operate the practice

Decisions continue from D-95 in `persona-roadmap-decisions.md`. Audit-fix
items (Nov 20 audit R1-R68) are out of scope. Live investment commitments
stay disabled.
