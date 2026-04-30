# OxSteed Legal Risk Register
**Last Updated:** April 30, 2026  
**Status:** Pre-Launch (5 Critical Risks)

---

## Quick Reference: Risk Scores

| Risk | Score | Level | Owner | Status | Due Date |
|---|---|---|---|---|---|
| PAY-001: Payment & Escrow | 16 | 🔴 CRITICAL | You | ⏳ In Progress | May 8 |
| DATA-001: Data Privacy (GDPR/CCPA) | 20 | 🔴 CRITICAL | Counsel | ⏳ Counsel Engaged | May 20 |
| EMP-001: Helper Classification | 20 | 🔴 CRITICAL | Counsel | ⏳ Counsel Engaged | May 20 |
| OPS-001: Operational Readiness | 20 | 🔴 CRITICAL | Engineering | ⏳ In Progress | May 20 |
| COMP-001: Background Checks (FCRA) | 12 | 🟠 HIGH | Counsel | ⏳ Counsel Engaged | May 12 |
| LEGAL-001: ToS & Marketplace | 12 | 🟠 HIGH | Counsel | ⏳ Counsel Engaged | May 20 |
| VENDOR-001: Third-Party Vendors | 12 | 🟠 HIGH | You | ⏳ In Progress | May 12 |
| LEGAL-002: Helper Agreement | 9 | 🟡 MEDIUM | Counsel | ⏳ Queued | May 20 |
| LEGAL-003: Seller Agreement | 9 | 🟡 MEDIUM | Counsel | ⏳ Queued | May 20 |
| COMP-002: Accessibility (WCAG AA) | 6 | 🟡 MEDIUM | TBD | ⏳ Post-Launch | June 30 |

---

## Action Items by Owner

### YOU (Solo Legal) – THIS WEEK

**[CRITICAL]** ENGAGE OUTSIDE COUNSEL
- [ ] **May 1:** Contact privacy counsel; request DPIA + Privacy Policy + DPA engagement proposal
- [ ] **May 1:** Contact employment counsel; request helper classification + ICA engagement proposal
- [ ] **May 1:** Contact marketplace/IP counsel; request ToS + agreements engagement proposal
- [ ] **May 1:** Collect engagement letters; sign and return to counsel
- [ ] **May 2:** Send counsel: CLAUDE.md, current ToS, codebase overview, data inventory

**[CRITICAL]** DATA PROTECTION
- [ ] **May 2:** Create vendor inventory (Stripe, Didit, Checkr, AWS, Twilio, Resend, Socket.IO)
- [ ] **May 2:** Email each vendor requesting Data Processing Addendum (DPA)
- [ ] **May 2:** Email each vendor requesting SOC 2 Type II report

**[CRITICAL]** PAYMENT & ESCROW
- [ ] **May 2:** Draft escrow release SLA ("Job complete when customer marks complete + 24-48h dispute window")
- [ ] **May 3:** Draft chargeback defense playbook
- [ ] **May 2:** Brief engineering on escrow + chargeback priorities

**[HIGH]** COMPLIANCE AUDIT
- [ ] **May 2:** Audit current ToS for completeness (is dispute resolution process documented?)
- [ ] **May 3:** Audit Privacy Policy for GDPR/CCPA compliance gaps
- [ ] **May 3:** Audit Didit/Checkr integration (when are background checks initiated? Is there FCRA authorization?)

**[HIGH]** OPERATIONAL READINESS
- [ ] **May 1:** Define RTO/RPO targets with engineering (e.g., RTO 1 hour, RPO 15 minutes)
- [ ] **May 2:** Brief engineering on monitoring/backup/incident response priorities

**[MEDIUM]** DOCUMENTATION
- [ ] **May 8:** Document background check decision criteria (which offenses disqualify?)
- [ ] **May 8:** Create vendor management register (DPA status, SLA, breach notification process)
- [ ] **May 10:** Draft vendor breach response procedure

---

### ENGINEERING & OPERATIONS

**[CRITICAL]** OPERATIONAL READINESS (This is your blocking issue)
- [ ] **May 10:** Implement monitoring & alerting (Sentry + Logtail + CloudWatch)
- [ ] **May 10:** Set up automated database backups + verification
- [ ] **May 15:** Create incident response runbooks (database down, breach, API errors, DDoS)
- [ ] **May 15:** Implement encryption at rest (database + S3)
- [ ] **May 18:** Perform load testing (100 → 500 → 1,000 concurrent users)
- [ ] **May 20:** Conduct backup restoration test
- [ ] **May 20:** Brief team on on-call procedures

**[CRITICAL]** LEGAL IMPLEMENTATION
- [ ] **May 3:** Set up Stripe monitoring dashboard (chargeback rate, disputes)
- [ ] **May 15:** Implement DSAR/deletion workflows (API endpoints for data access/delete)
- [ ] **May 15:** Implement job completion evidence collection (photos, timestamps, customer confirmation)
- [ ] **May 20:** Implement FCRA adverse action notice workflow (when helper is denied)
- [ ] **May 20:** Implement encryption at rest for PII (database, S3, file uploads)
- [ ] **May 25:** Implement e-signature requirement for Helper ICA (before helper can accept jobs)
- [ ] **May 25:** Implement e-signature requirement for Seller Agreement (before seller can list)

---

### OUTSIDE COUNSEL (Engaged This Week)

**[CRITICAL]** DATA PRIVACY
- [ ] **May 10:** Deliver data protection impact assessment (DPIA)
- [ ] **May 15:** Deliver updated Privacy Policy (GDPR/CCPA compliant)
- [ ] **May 20:** Deliver Data Processing Addendum templates for vendors
- [ ] **May 20:** Deliver DSAR/deletion/portability request procedures

**[CRITICAL]** EMPLOYMENT LAW
- [ ] **May 15:** Deliver helper classification legal memo (ABC test, economic realities)
- [ ] **May 20:** Deliver Helper Independent Contractor Agreement (signed version for use)
- [ ] **May 15:** Deliver contingency plan (if reclassification required – costs, timeline, operations impact)

**[HIGH]** MARKETPLACE LIABILITY
- [ ] **May 12:** Deliver ToS legal review + redline recommendations
- [ ] **May 20:** Deliver updated ToS (indemnification, limitation of liability, dispute resolution)
- [ ] **May 20:** Deliver Seller Agreement
- [ ] **May 15:** Deliver dispute resolution procedures documentation

**[HIGH]** FCRA COMPLIANCE
- [ ] **May 12:** Deliver FCRA compliance audit (authorization flow, adverse action procedures, decision criteria)
- [ ] **May 15:** Deliver adverse action notice template
- [ ] **May 20:** Deliver background check decision criteria memo (which offenses disqualify, time limits)

---

## Risk-by-Risk Status

### 🔴 CRITICAL RISKS (Score 16-25)

#### PAY-001: Payment & Escrow | Score 16
- **Status:** ⏳ In Progress
- **Next Milestone:** Draft escrow release SLA (May 2), set up Stripe monitoring (May 3)
- **Responsible:** You (SLA/playbook), Engineering (monitoring)
- **Launch Blocker:** Yes – need clear escrow criteria before going live

#### DATA-001: Data Privacy (GDPR/CCPA) | Score 20
- **Status:** ⏳ Counsel Engaged (pending contract signature)
- **Next Milestone:** DPIA (May 10), Privacy Policy (May 15), DPAs (May 20)
- **Responsible:** Outside Counsel (lead), You (coordination)
- **Launch Blocker:** Yes – cannot launch without GDPR/CCPA compliance

#### EMP-001: Helper Classification | Score 20
- **Status:** ⏳ Counsel Engaged (pending contract signature)
- **Next Milestone:** Legal memo (May 15), ICA (May 20), contingency plan (May 15)
- **Responsible:** Outside Counsel (lead), You (documentation)
- **Launch Blocker:** Yes – fundamental business model risk

#### OPS-001: Operational Readiness | Score 20
- **Status:** ⏳ In Progress
- **Next Milestone:** Monitoring (May 10), backups (May 10), runbooks (May 15), load testing (May 18)
- **Responsible:** Engineering (lead), You (RTO/RPO targets)
- **Launch Blocker:** Yes – cannot launch without monitoring/backup/incident response

---

### 🟠 HIGH RISKS (Score 10-15)

#### COMP-001: Background Checks (FCRA) | Score 12
- **Status:** ⏳ Counsel Engaged
- **Next Milestone:** FCRA audit (May 12), adverse action procedures (May 15)
- **Responsible:** Outside Counsel (lead), Engineering (implementation)
- **Launch Blocker:** Yes – non-compliance exposes platform to FCRA litigation

#### LEGAL-001: ToS & Marketplace Liability | Score 12
- **Status:** ⏳ Counsel Engaged
- **Next Milestone:** ToS review (May 12), redraft (May 20), dispute resolution process (May 15)
- **Responsible:** Outside Counsel (lead), You (coordination)
- **Launch Blocker:** Yes – ToS protects platform from customer/seller liability

#### VENDOR-001: Third-Party Vendor Compliance | Score 12
- **Status:** ⏳ In Progress (waiting for vendor responses)
- **Next Milestone:** Vendor inventory (May 2), DPA requests (May 2), audit (May 10)
- **Responsible:** You (lead), Engineering (technical details)
- **Launch Blocker:** No – can do post-launch if vendors unresponsive, but should complete before

---

### 🟡 MEDIUM RISKS (Score 5-9)

#### LEGAL-002: Helper Agreement | Score 9
- **Status:** ⏳ Queued (part of EMP-001 counsel engagement)
- **Next Milestone:** ICA draft (May 20), e-signature implementation (May 25)
- **Responsible:** Outside Counsel (draft), Engineering (implementation)
- **Launch Blocker:** Yes – need signed ICA before helper can accept jobs

#### LEGAL-003: Seller Agreement | Score 9
- **Status:** ⏳ Queued (part of LEGAL-001 counsel engagement)
- **Next Milestone:** Agreement draft (May 20), e-signature implementation (May 25)
- **Responsible:** Outside Counsel (draft), Engineering (implementation)
- **Launch Blocker:** Yes – need signed agreement before seller can list

#### COMP-002: Accessibility (WCAG AA) | Score 6
- **Status:** ⏳ Deferred to post-launch
- **Next Milestone:** Audit (June 30), remediation TBD
- **Responsible:** TBD (post-launch)
- **Launch Blocker:** No – can address post-launch, but should add to product roadmap

---

## Weekly Progress Tracking

### WEEK 1 (May 1-3) – Counsel Engagement & Data Protection

**TARGET:** Counsel engaged, vendor DPA requests sent, operational readiness planned

- [ ] Counsel engagement letters signed
- [ ] Vendor DPA requests sent (7 vendors)
- [ ] RTO/RPO targets defined
- [ ] Escrow release SLA drafted
- [ ] Monitoring/backup plan approved by engineering

**Success Criteria:**
- All 3 counsel firms engaged
- All 7 vendors have DPA requests in flight
- Engineering clear on operational priorities
- Escrow release SLA documented and reviewed

---

### WEEK 2 (May 5-12) – Counsel Work In Progress & Vendor Audit

**TARGET:** DPIA halfway, FCRA audit done, vendor compliance audit done

- [ ] DPIA draft (50% complete)
- [ ] FCRA audit report received
- [ ] ToS legal review received (redline recommendations)
- [ ] Privacy Policy draft received
- [ ] Vendor audit complete (DPA status, SOC 2 reports, SLA review)
- [ ] Monitoring implementation started
- [ ] Backup automation setup started

**Success Criteria:**
- All counsel work on track
- Vendor DPA status known (signed vs. pending vs. not available)
- Operational readiness 50% complete (monitoring + backups)

---

### WEEK 3 (May 15-19) – Counsel Deliverables & Legal Implementation

**TARGET:** Counsel delivers all documents, engineering implements legal requirements

- [ ] DPIA final
- [ ] Privacy Policy final (GDPR/CCPA compliant)
- [ ] DPA addendums ready for signature
- [ ] Helper classification memo final
- [ ] ICA draft for review
- [ ] ToS redraft final
- [ ] Adverse action notice template received
- [ ] Monitoring & alerting live
- [ ] Backups verified
- [ ] Incident response runbooks drafted
- [ ] Encryption at rest partially implemented

**Success Criteria:**
- All counsel work substantially complete
- Engineering ready to implement legal requirements (e-signatures, workflows, notifications)
- Operational readiness 75% complete

---

### WEEK 4 (May 20-30) – Final Legal Sign-Off & Launch Readiness

**TARGET:** All legal docs final, team trained, systems ready for launch

- [ ] Privacy Policy published
- [ ] ToS published (require acceptance on signup)
- [ ] Helper ICA signatures required (before job acceptance)
- [ ] Seller Agreement signatures required (before listing)
- [ ] DPAs signed + returned by vendors
- [ ] Monitoring fully operational + tested
- [ ] Backups tested + restoration verified
- [ ] Load testing complete
- [ ] On-call procedures live + team trained
- [ ] Insurance obtained (E&O + cyber liability)
- [ ] Final legal sign-off from counsel

**Success Criteria:**
- All legal documents finalized + published
- All legal workflows implemented (e-signatures, adverse action notices, DSAR)
- Operational readiness 100% complete
- Team trained + ready for production support
- Launch approval from legal + leadership

---

## Escalation Matrix

### When to Escalate to General Counsel (You)
- Counsel delivers concerning findings (e.g., "platform may not be viable due to helper classification")
- Engineering hits blocker preventing operational readiness implementation
- Vendor refuses to sign DPA or provide SOC 2 report

### When to Escalate to Leadership
- Counsel estimates >$100K in pre-launch remediation costs
- Operational readiness will delay launch >2 weeks
- Critical business model risk (e.g., helper classification)

### When to Escalate to Outside Counsel for Emergency Support
- Regulatory inquiry or complaint
- Data breach
- Customer injury claim
- Helper misclassification lawsuit threat

---

## Budget Estimate

### External Counsel
- **Data Privacy Attorney:** $15K-25K (50-80 hours @ $200-300/hr)
- **Employment Attorney:** $15K-30K (50-100 hours @ $200-300/hr)
- **Marketplace/IP Attorney:** $12K-20K (40-60 hours @ $200-300/hr)
- **Estimated Total:** $42K-75K

### SaaS & Services
- **Monitoring & Alerting:** $3K-6K/year (Sentry + Logtail + CloudWatch)
- **Backup Service:** $500-1K/year (AWS RDS + WAL archiving)
- **Insurance (E&O + Cyber):** $5K-15K/year
- **Accessibility Audit (Post-Launch):** $2K-5K
- **Estimated Total:** $10.5K-27K/year

### Engineering Time (Internal)
- **Operational Readiness:** 60-100 hours
- **Legal Implementation:** 40-60 hours
- **Estimated Total:** 100-160 hours (2-4 weeks for 1 senior engineer)

**Grand Total: $52.5K-102K (primarily outside counsel + one-time SaaS/insurance costs)**

---

## Production Launch Checklist

**LEGAL SIGN-OFF REQUIRED BEFORE GOING LIVE**

- [ ] Privacy Policy updated and published (counsel approved)
- [ ] Terms of Service updated and published (counsel approved)
- [ ] Helper Independent Contractor Agreement drafted and signed (counsel approved + all helpers must sign)
- [ ] Seller Agreement drafted and signed (counsel approved + all sellers must sign)
- [ ] Data Processing Agreements with vendors signed (Stripe, Didit, Checkr, AWS, Twilio, Resend)
- [ ] GDPR/CCPA compliance audit complete (DPIA, retention policy, DSAR procedures)
- [ ] Background check (FCRA) adverse action procedures implemented
- [ ] Payment & escrow procedures documented (release criteria, chargeback defense)
- [ ] Dispute resolution process documented and implemented
- [ ] E&O + cyber liability insurance obtained
- [ ] Monitoring, alerting, backup, incident response live and tested
- [ ] Load testing complete + breaking points documented
- [ ] Team trained on on-call, incident response, FCRA compliance
- [ ] Final legal counsel sign-off received

**LAUNCH APPROVED BY:** General Counsel (You), Outside Counsel, Engineering Lead, Business Leadership

---

**Last Updated:** April 30, 2026  
**Next Review:** Weekly (May 1-30), then post-launch June 15  
**Prepared By:** Internal Legal Review
