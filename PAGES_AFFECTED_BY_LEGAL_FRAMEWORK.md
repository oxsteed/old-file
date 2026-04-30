# Pages Affected by Legal Framework & Terms/Conditions Management System

**Date:** April 30, 2026  
**Purpose:** Identify all pages (existing + missing) that will be affected by:
1. New Terms & Conditions management system (searchable, category-based, version history)
2. Legal framework implementation from cost reduction strategy
3. Legal compliance pages identified in risk assessment

---

## OVERVIEW

| Category | Count | Status |
|---|---|---|
| **Existing Pages - Will Need Updates** | 28 | ✅ Needs modification |
| **Existing Pages - New Integration Points** | 12 | ✅ Needs modification |
| **Missing Pages - Need to Create** | 15 | ❌ Needs creation |
| **Admin Pages - New/Modified** | 8 | ❌ Needs creation |
| **TOTAL AFFECTED** | **63 pages** | - |

---

## SECTION 1: EXISTING PAGES THAT NEED UPDATES

### A. USER ONBOARDING & SIGNUP FLOWS

**Why affected:** Users must accept Terms & Conditions and agreements before using platform

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **RegisterPage.jsx** | Exists | Add T&C acceptance checkbox + link to /terms; add Helper/Seller agreement acceptance flows | 🔴 CRITICAL |
| **LoginPage.jsx** | Exists | May need T&C update notification if user hasn't accepted latest version | 🟡 MEDIUM |
| **HelperOnboardingPage.jsx** | Exists (implied) | Must show Helper ICA; require signature; version tracking | 🔴 CRITICAL |
| **SellerOnboardingPage.jsx** | Exists (implied) | Must show Seller Agreement; require signature; version tracking | 🔴 CRITICAL |
| **EmailVerificationPage.jsx** | Exists | Add T&C acceptance verification step | 🟡 MEDIUM |
| **PhoneVerificationPage.jsx** | Exists | Add T&C acceptance verification step | 🟡 MEDIUM |

---

### B. LEGAL & COMPLIANCE PAGES (Public)

**Why affected:** Foundational pages for legal documents that now need searchable, version-history, category-based UI

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **TermsOfServicePage.jsx** | Exists but unreviewed | Complete rebuild: All-sections-open-by-default, sidebar nav, search, version history, scroll-to-agree | 🔴 CRITICAL |
| **PrivacyPolicyPage.jsx** | Exists but unreviewed | Update for GDPR/CCPA compliance, add category view, search functionality, version history | 🔴 CRITICAL |
| **HomePage.jsx** | Exists | Add footer links to /terms, /privacy, /legal-documents, /dispute-resolution | 🟡 MEDIUM |
| **FooterComponent.jsx** | Exists | Links to all legal documents, T&C version badge, "Last updated" info | 🟡 MEDIUM |

---

### C. HELP & SUPPORT PAGES

**Why affected:** Must link to relevant T&C sections and dispute resolution process

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **HelpCenter.jsx / FAQPage.jsx** | Exists | Link to relevant T&C sections; search across T&C + FAQ | 🟡 MEDIUM |
| **SupportWidget.jsx** | Exists (built) | Add FAQ links to T&C sections; show relevant T&C in dispute resolution flows | 🟡 MEDIUM |
| **TicketCreationModal.jsx** | Exists (built) | Auto-populate relevant T&C section in support ticket; link to dispute policy | 🟡 MEDIUM |
| **SupportAgentChat.jsx** | Exists (built) | Add T&C search toolbar for agents to quickly find and share relevant clauses | 🟡 MEDIUM |

---

### D. PAYMENT & CHECKOUT FLOWS

**Why affected:** Payment terms & escrow procedures are now version-controlled; users must accept payment T&C

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **CheckoutPage.jsx** | Exists | Show "Payment Terms" section (category from T&C); require acceptance before payment | 🔴 CRITICAL |
| **OrderDetailsPage.jsx** | Exists | Show which version of "Payment Terms" was accepted with this order; link to that version | 🟡 MEDIUM |
| **PaymentMethodSetupPage.jsx** | Exists (implied) | Show "Payment Terms" and "Privacy Policy" (payment data handling); require acceptance | 🟡 MEDIUM |
| **RefundPolicyPage.jsx** | Should exist | New page or section in T&C; show refund terms, dispute procedures | 🟠 HIGH |

---

### E. HELPER/SELLER MANAGEMENT PAGES

**Why affected:** Helpers and sellers must accept and can reference their agreements

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **HelperProfilePage.jsx** | Exists | Add "View your agreement" link; show ICA version & acceptance date | 🟡 MEDIUM |
| **HelperSettingsPage.jsx** | Exists | Add "View/Accept Agreement" section; show if updated version available | 🟡 MEDIUM |
| **SellerProfilePage.jsx** | Exists (implied) | Add "View your agreement" link; show Seller Agreement version & acceptance date | 🟡 MEDIUM |
| **SellerDashboard.jsx** | Exists (implied) | Add "Seller Agreement" section; notify if new version available | 🟡 MEDIUM |

---

### F. DISPUTE RESOLUTION & CONFLICT PAGES

**Why affected:** Dispute process references T&C sections on resolution procedures

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **DisputePage.jsx / DisputeForm.jsx** | Likely exists | Link to "Dispute Resolution" section of T&C; show relevant policy | 🔴 CRITICAL |
| **CustomerDisputeFlow.jsx** | Likely exists | Reference T&C "Dispute Resolution" section during flow | 🟡 MEDIUM |
| **HelperDisputeFlow.jsx** | Likely exists | Reference T&C "Helper Terms" dispute section during flow | 🟡 MEDIUM |

---

### G. BACKGROUND CHECK & VERIFICATION PAGES

**Why affected:** FCRA compliance page references background check procedures & user rights

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **BackgroundCheckStatusPage.jsx** | Exists | Add FCRA disclosure; link to "Background Check Procedures" in T&C | 🔴 CRITICAL |
| **FCRADisclosurePage.jsx** | Does NOT exist | NEW: Show FCRA consumer rights before running check; require consent | 🔴 CRITICAL |
| **AdverseActionNoticePage.jsx** | Does NOT exist | NEW: Show if helper denied for background check; provide FCRA rights & dispute info | 🔴 CRITICAL |

---

### H. ACCOUNT & PRIVACY SETTINGS PAGES

**Why affected:** GDPR/CCPA rights implementation (data access, deletion, portability)

| Page | Current Status | What Needs to Change | Priority |
|---|---|---|---|
| **PrivacySettingsPage.jsx** | Exists (implied) | Add "View my data", "Download my data", "Delete my account" links | 🔴 CRITICAL |
| **DataAccessRequestPage.jsx** | Does NOT exist | NEW: Process GDPR/CCPA data access requests | 🔴 CRITICAL |
| **DataDeletionPage.jsx** | Does NOT exist | NEW: Process GDPR/CCPA deletion requests; show legal holds | 🟠 HIGH |
| **EmailPreferencesPage.jsx** | Exists (built) | Link to Privacy Policy "Email" section; show unsubscribe compliance | 🟡 MEDIUM |
| **SMSPreferencesPage.jsx** | Exists (built) | Link to Privacy Policy "SMS" section; show opt-out compliance | 🟡 MEDIUM |

---

## SECTION 2: ADMIN PAGES THAT NEED CREATION OR UPDATE

### A. LEGAL DOCUMENT MANAGEMENT (NEW ADMIN SECTION)

**Purpose:** Super-admin can edit T&C sections without coding

| Page | Status | Description | Priority |
|---|---|---|---|
| **AdminLegalDocumentsPage.jsx** | ❌ NEW | Main admin dashboard for T&C management; list all categories | 🔴 CRITICAL |
| **AdminTermsEditor.jsx** | ❌ NEW | Rich text editor for editing T&C sections; one section at a time | 🔴 CRITICAL |
| **AdminVersionHistoryViewer.jsx** | ❌ NEW | View all versions of a T&C section; restore old version | 🔴 CRITICAL |
| **AdminDiffViewer.jsx** | ❌ NEW | Show before/after diff when T&C section changes | 🟠 HIGH |
| **AdminApprovalWorkflow.jsx** | ❌ NEW | Super-admin approves T&C changes before publishing (draft → live) | 🟠 HIGH |
| **AdminCategoryManager.jsx** | ❌ NEW | Create/rename/reorder T&C categories (Helper Terms, Payment, Privacy, etc.) | 🟡 MEDIUM |

---

### B. COMPLIANCE & AUDIT (NEW ADMIN SECTION)

**Purpose:** Track compliance, user acceptances, audit trail

| Page | Status | Description | Priority |
|---|---|---|---|
| **AdminUserAcceptanceTracker.jsx** | ❌ NEW | View which users accepted which T&C versions, when | 🔴 CRITICAL |
| **AdminComplianceAuditLog.jsx** | ❌ NEW | Full audit log of all T&C changes, who made them, when published | 🟠 HIGH |
| **AdminDataSubjectRequests.jsx** | ❌ NEW | Manage GDPR/CCPA requests (access, deletion, portability); track status | 🔴 CRITICAL |
| **AdminIncidentResponseLog.jsx** | ❌ NEW | Log data breaches, incidents; track notification status & dates | 🔴 CRITICAL |

---

### C. MODERATION & ENFORCEMENT (NEW ADMIN SECTION)

**Purpose:** Enforce T&C violations, manage suspensions

| Page | Status | Description | Priority |
|---|---|---|---|
| **AdminToCEnforcementDashboard.jsx** | ❌ NEW | Track T&C violations by user/category; manage suspensions | 🟠 HIGH |
| **AdminContentModerationQueue.jsx** | ❌ NEW | Review reported content against "Acceptable Use" T&C section | 🟠 HIGH |
| **AdminDisputeResolutionQueue.jsx** | ❌ NEW | Manage disputes per "Dispute Resolution" T&C procedures | 🟠 HIGH |

---

## SECTION 3: MISSING PUBLIC PAGES (IDENTIFIED IN LEGAL RISK ASSESSMENT)

### A. LEGAL DOCUMENTS (Public, No Login Required)

| Page | Why Missing | Status | Priority |
|---|---|---|---|
| **/terms** (searchable, all-sections-open) | Core legal document, not properly built | ❌ NEW | 🔴 CRITICAL |
| **/privacy** (searchable, GDPR/CCPA aligned) | Core legal document, not properly built | ❌ NEW | 🔴 CRITICAL |
| **/legal-documents** | Hub page for all legal docs | ❌ NEW | 🟠 HIGH |
| **/helper-agreement** | Helper ICA acceptance page | ❌ NEW | 🔴 CRITICAL |
| **/seller-agreement** | Seller Agreement acceptance page | ❌ NEW | 🔴 CRITICAL |
| **/dispute-resolution** | Public explanation of dispute process | ❌ NEW | 🟠 HIGH |
| **/background-check-policy** | FCRA compliance, consumer rights | ❌ NEW | 🔴 CRITICAL |
| **/data-retention** | Data retention periods, GDPR/CCPA | ❌ NEW | 🟠 HIGH |
| **/incident-response** | Breach notification procedures | ❌ NEW | 🟡 MEDIUM |
| **/accessibility-policy** | WCAG AA compliance statement | ❌ NEW | 🟡 MEDIUM |

---

### B. LEGAL PROCEDURE/REQUEST PAGES (Authenticated)

| Page | Why Missing | Status | Priority |
|---|---|---|---|
| **/account/data-access-request** | GDPR/CCPA data access right | ❌ NEW | 🔴 CRITICAL |
| **/account/data-deletion-request** | GDPR/CCPA deletion right | ❌ NEW | 🔴 CRITICAL |
| **/account/data-portability** | GDPR/CCPA portability right | ❌ NEW | 🟠 HIGH |
| **/account/fcra-rights** | Show FCRA consumer rights | ❌ NEW | 🔴 CRITICAL |
| **/agreement/view** | Show current accepted agreement version | ❌ NEW | 🟡 MEDIUM |

---

## SECTION 4: ROUTE/ENDPOINT UPDATES

### New Routes Needed

| Route | Method | Purpose | Page |
|---|---|---|---|
| `GET /api/legal-documents` | API | Fetch all T&C categories and sections | AdminLegalDocumentsPage |
| `POST /api/legal-documents` | API | Create new T&C section | AdminTermsEditor |
| `PUT /api/legal-documents/:id` | API | Update T&C section | AdminTermsEditor |
| `GET /api/legal-documents/:id/versions` | API | Fetch version history | AdminVersionHistoryViewer |
| `POST /api/legal-documents/:id/versions/restore` | API | Restore old version | AdminVersionHistoryViewer |
| `GET /api/legal-documents/:id/diff` | API | Compare two versions | AdminDiffViewer |
| `POST /api/legal-documents/approve` | API | Approve T&C change for publishing | AdminApprovalWorkflow |
| `GET /api/users/:id/acceptances` | API | Track user T&C acceptances | AdminUserAcceptanceTracker |
| `POST /api/data-subject-requests` | API | Submit GDPR/CCPA request | DataAccessRequestPage |
| `GET /api/data-subject-requests/:id` | API | Check request status | DataAccessRequestPage |
| `POST /api/incidents/breach-notification` | API | Log data breach | AdminIncidentResponseLog |
| `GET /legal-documents/search` | API | Search T&C content | TermsOfServicePage |

---

## SECTION 5: COMPONENT UPDATES

### Shared Components Affected

| Component | Current Status | Changes Needed |
|---|---|---|
| **Navbar.jsx** | Exists | Add link to /legal-documents, T&C version badge |
| **FooterComponent.jsx** | Exists | Update with all legal doc links |
| **ModalComponent.jsx** | Exists | T&C acceptance modal variant |
| **RichTextEditor.jsx** | May exist | Used in AdminTermsEditor |
| **VersionHistoryPanel.jsx** | ❌ NEW | Show version history in admin |
| **DiffViewer.jsx** | ❌ NEW | Show before/after comparison |
| **SearchHighlight.jsx** | ❌ NEW | Highlight search matches in T&C |
| **TCAcceptanceCheckbox.jsx** | ❌ NEW | Reusable T&C acceptance component |
| **AgreementModal.jsx** | ❌ NEW | Helper/Seller agreement acceptance flow |

---

## SECTION 6: SUMMARY TABLE - PRIORITY ORDER

### 🔴 CRITICAL (Must do before launch)

| # | Page | Type | Reason |
|---|---|---|---|
| 1 | TermsOfServicePage.jsx | Update | Foundation of legal framework |
| 2 | PrivacyPolicyPage.jsx | Update | GDPR/CCPA compliance |
| 3 | RegisterPage.jsx | Update | T&C acceptance at signup |
| 4 | HelperOnboardingPage.jsx | Update | Helper ICA acceptance |
| 5 | SellerOnboardingPage.jsx | Update | Seller Agreement acceptance |
| 6 | CheckoutPage.jsx | Update | Payment terms acceptance |
| 7 | AdminLegalDocumentsPage.jsx | Create | Super-admin T&C management |
| 8 | AdminTermsEditor.jsx | Create | Edit T&C without coding |
| 9 | AdminVersionHistoryViewer.jsx | Create | T&C version tracking |
| 10 | AdminUserAcceptanceTracker.jsx | Create | Audit user acceptances |
| 11 | AdminDataSubjectRequests.jsx | Create | GDPR/CCPA compliance |
| 12 | AdminIncidentResponseLog.jsx | Create | Breach tracking |
| 13 | BackgroundCheckStatusPage.jsx | Update | FCRA compliance |
| 14 | FCRADisclosurePage.jsx | Create | Pre-check disclosure |
| 15 | AdverseActionNoticePage.jsx | Create | Denial notification |
| 16 | PrivacySettingsPage.jsx | Update | Data access/deletion |
| 17 | DataAccessRequestPage.jsx | Create | GDPR/CCPA data access |
| 18 | DisputePage.jsx | Update | Link to dispute policy |
| 19 | /terms (route) | Create | Public searchable T&C |
| 20 | /privacy (route) | Create | Public searchable privacy |

### 🟠 HIGH (Should do before launch or Phase 1)

| # | Page | Type | Reason |
|---|---|---|---|
| 21 | AdminApprovalWorkflow.jsx | Create | T&C change approval |
| 22 | AdminDiffViewer.jsx | Create | Show what changed |
| 23 | RefundPolicyPage.jsx | Create | Refund procedures |
| 24 | DataDeletionPage.jsx | Create | GDPR/CCPA deletion |
| 25 | AdminToCEnforcementDashboard.jsx | Create | Violation tracking |
| 26 | AdminContentModerationQueue.jsx | Create | Content moderation |
| 27 | AdminDisputeResolutionQueue.jsx | Create | Dispute management |
| 28 | /dispute-resolution | Create | Public dispute info |
| 29 | /background-check-policy | Create | Public FCRA info |
| 30 | /legal-documents (hub) | Create | Links to all docs |

### 🟡 MEDIUM (Phase 1 or can wait)

| # | Page | Type | Reason |
|---|---|---|---|
| 31 | AdminCategoryManager.jsx | Create | Manage T&C categories |
| 32 | AdminComplianceAuditLog.jsx | Create | Audit trail |
| 33 | HelpCenter.jsx | Update | Link to T&C sections |
| 34 | SupportWidget.jsx | Update | T&C search in support |
| 35 | HelperProfilePage.jsx | Update | Show ICA version |
| 36 | SellerProfilePage.jsx | Update | Show seller agreement |
| 37 | PrivacySettingsPage.jsx | Update | Email/SMS compliance |
| 38 | /data-retention | Create | Public data retention info |
| 39 | /accessibility-policy | Create | WCAG AA statement |
| 40 | AgreementModal.jsx | Create | Reusable agreement component |

---

## SECTION 7: IMPLEMENTATION STRATEGY

### Phase 1: Foundation (Weeks 1-2)
- Build T&C management system (admin pages, database, APIs)
- Update critical signup/onboarding pages
- Update Terms & Privacy pages with new UI
- Implement FCRA pages

### Phase 2: Integration (Weeks 2-3)
- Update checkout, payment pages
- Update helper/seller pages
- Implement data access/deletion pages
- Add compliance tracking

### Phase 3: Refinement (Weeks 3-4)
- Add approval workflows
- Add diff viewer
- Add category manager
- Testing and QA

### Phase 4: Post-Launch
- Add advanced admin features
- Add content moderation tools
- Monitor and optimize

---

## NEXT STEPS

1. **Prioritize by criticality:**
   - Start with 20 🔴 CRITICAL pages
   - Then 9 🟠 HIGH pages
   - Then 11 🟡 MEDIUM pages

2. **Group by feature:**
   - T&C management infrastructure (admin pages + APIs)
   - User acceptance tracking (registrations, agreements)
   - Compliance pages (GDPR/CCPA, FCRA, breach response)
   - Support/dispute integration

3. **Estimate scope:**
   - Infrastructure: 60-80 hours
   - Page updates: 40-60 hours
   - New pages: 80-120 hours
   - Components: 30-40 hours
   - Testing: 40-60 hours
   - **Total: ~250-380 hours** (or ~6-9 weeks full-time equivalent)

---

**Prepared By:** Senior Counsel / Development Team Lead  
**Date:** April 30, 2026  
**Next Review:** After prioritization decision
