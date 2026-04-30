# Counsel Engagement Letter Template
**Date:** May 1, 2026  
**Prepared By:** [Your Name], General Counsel  
**Recipient:** [Counsel Firm Name]

---

## [COUNSEL TYPE #1] – DATA PRIVACY & COMPLIANCE ATTORNEY

### Engagement Request

OxSteed (a gig marketplace platform) is launching to production on June 1, 2026. We are seeking legal counsel to advise on GDPR and CCPA compliance, data protection, and vendor data processing agreements.

### Scope of Work

1. **Data Protection Impact Assessment (DPIA)**
   - Analyze data flows (what data, where stored, purpose, legal basis)
   - Identify risks (data breach, unauthorized processing, international transfers)
   - Recommend mitigations
   - Deliverable: 20-30 page DPIA memo

2. **Privacy Policy Audit & Redraft**
   - Review existing Privacy Policy for GDPR/CCPA compliance gaps
   - Update disclosures: data collection, processing purposes, legal basis, retention periods, GDPR/CCPA rights, third-party sharing
   - Ensure GDPR-compliant consent mechanism for optional processing
   - Deliverable: Updated Privacy Policy (counsel-reviewed)

3. **Data Processing Addendum (DPA) Drafting**
   - Prepare template DPA for vendors (Stripe, Didit, Checkr, AWS, Twilio, Resend)
   - Include Standard Contractual Clauses (SCCs) for EU data transfers
   - Ensure GDPR Article 28 compliance (processor obligations)
   - Deliverable: Template DPA + guidance on negotiation

4. **Data Retention & Deletion Policy**
   - Define retention periods for each data category
   - Implement GDPR "right to be forgotten" (RTBF) procedures
   - Deliverable: Data retention schedule + deletion procedures

5. **Data Subject Rights Procedures**
   - Establish workflow for handling GDPR/CCPA requests (access, deletion, portability, opt-out)
   - Document SLAs (GDPR requires 30-day response)
   - Deliverable: DSAR handling procedures + templates

### Timeline

- **Week 1 (May 1-3):** Engagement letter signed; client provides data inventory
- **Week 2 (May 5-12):** DPIA draft + Privacy Policy redraft
- **Week 3 (May 15-19):** DPIA final + Privacy Policy final + DPA draft
- **Week 4 (May 20-30):** DPA final + retention policy + DSAR procedures; counsel available for closing questions

### Budget

**Estimated Hours:** 50-80 hours  
**Rate:** [Your standard rate]  
**Estimated Fee:** $[XXX] (fixed fee preferred; hourly if needed)  
**Payment Terms:** Net 30; [50% upfront, 50% upon completion or weekly invoicing]

### Background Information

- **Platform Model:** Gig marketplace (customers post jobs, helpers bid; also product marketplace with sellers)
- **Current Status:** 49% production-ready; GDPR/CCPA compliance is critical blocker
- **User Base:** Primarily US, but may serve EU/CA users; helpers and sellers are global
- **Data Categories:** User profiles, job descriptions, identity verification (Didit), background checks (Checkr), payment info (Stripe), messages, photos, location data
- **Vendors:** Stripe (payment), Didit (identity), Checkr (background), AWS (storage), Twilio (SMS), Resend (email), Socket.IO (messaging)
- **Regulatory Triggers:** GDPR applies if processing EU residents' data; CCPA applies if processing CA residents' data

### Key Questions for Discussion

1. Is Standard Contractual Clauses (SCCs) sufficient for EU data transfers, or should we consider other mechanisms (e.g., Binding Corporate Rules, adequacy determinations)?
2. What's the minimum viable DPIA to satisfy GDPR requirements for launch?
3. Do we need to conduct Data Protection Impact Assessments (DPIAs) for each third-party vendor separately, or can one comprehensive DPIA cover all processing?
4. How should we handle background check data (sensitive personal data) under GDPR? Special handling required?
5. What are the CCPA requirements for us (OxSteed) vs. our vendors? Who is "controller" vs. "processor" under CCPA?

---

## [COUNSEL TYPE #2] – EMPLOYMENT LAW ATTORNEY

### Engagement Request

OxSteed is launching a gig marketplace where helpers provide services as independent contractors (1099). We need legal counsel to advise on helper classification under FLSA, state wage laws, and to draft Independent Contractor Agreement.

### Scope of Work

1. **Helper Classification Legal Memo**
   - Analyze helper relationship under ABC test (California), FLSA economic realities test (federal), and state tests (NY, MA, IL if applicable)
   - Document actual practices vs. intended classification
   - Assess misclassification risk
   - Provide recommendations and contingency plan
   - Deliverable: 15-25 page memo with risk assessment

2. **Independent Contractor Agreement (ICA) Drafting**
   - Draft 10-15 page Helper ICA covering:
     - Independent contractor status (no employee-employer relationship)
     - Pricing and payment terms (no wage guarantee, no benefits)
     - Scheduling flexibility (helpers accept/reject jobs at will)
     - Right to profit/loss (variable earnings, no minimum)
     - Use of tools/equipment (helper-provided)
     - Termination at-will, no notice required
     - No exclusivity (can work for competitors)
     - Tax obligations (1099, estimated taxes, self-employment taxes)
     - Indemnification (helper indemnifies OxSteed for job-related injuries, property damage)
     - Limitation of liability
     - Dispute resolution
     - Confidentiality (if needed)
   - Ensure enforceability in CA, NY, MA, federal
   - Deliverable: Final ICA (ready for execution)

3. **Helper Onboarding Documentation**
   - Create explainer document for helpers (what does independent contractor mean? tax obligations? no benefits?)
   - Create FAQ addressing common helper questions
   - Deliverable: Helper onboarding materials

4. **Contingency Plan**
   - If helpers are reclassified as employees, what are the financial and operational implications?
   - Model costs: payroll taxes, workers' comp, unemployment insurance, benefits (if required)
   - Model timeline: how long to transition to W-2 model?
   - Provide recommendations for minimizing exposure
   - Deliverable: Contingency plan memo

### Timeline

- **Week 1 (May 1-3):** Engagement letter signed; client provides helper documentation
- **Week 2 (May 5-12):** Classification memo draft
- **Week 3 (May 15-19):** Classification memo final + ICA draft + contingency plan
- **Week 4 (May 20-30):** ICA final + onboarding materials; counsel available for closing questions

### Budget

**Estimated Hours:** 50-100 hours  
**Rate:** [Your standard rate]  
**Estimated Fee:** $[XXX] (fixed fee preferred)  
**Payment Terms:** Net 30; [50% upfront, 50% upon completion]

### Background Information

- **Helper Model:** Independent contractors (1099); helpers set own rates, accept/reject jobs, use own equipment
- **Helper Count:** ~[XXX] active helpers (or estimate at launch)
- **Services:** Local trades (plumbing, electrical, handyman, etc.)
- **Exclusivity:** Helpers are not exclusive to OxSteed; can work for competitors
- **Scheduling:** Flexible; helpers accept jobs as available
- **Compensation:** Variable; based on job rates (set by customer bid)
- **Verification:** Identity verification (Didit) + background check (Checkr)
- **Current Status:** No written ICA; ToS covers some terms but not comprehensive

### Key Questions for Discussion

1. Under federal FLSA and state laws (CA, NY, MA), does OxSteed's helper model support independent contractor classification? Any red flags?
2. If OxSteed were required to reclassify helpers as W-2 employees in a jurisdiction, what would be the approximate cost increase and timeline?
3. Should the Helper ICA include non-compete or non-solicitation clauses? (We want to allow helpers to work for competitors, but prevent customer poaching)
4. What's the enforceability of our ICA in California vs. other states? Any jurisdiction-specific issues?
5. What documentation should OxSteed maintain to support independent contractor classification (in case of audit or litigation)?

---

## [COUNSEL TYPE #3] – MARKETPLACE & IP ATTORNEY

### Engagement Request

OxSteed is launching a two-sided marketplace (customers, helpers, sellers). We need legal counsel to advise on platform liability, marketplace agreements, and to redraft Terms of Service.

### Scope of Work

1. **Terms of Service (ToS) Audit & Redraft**
   - Review existing ToS for legal compliance and enforceability
   - Redraft sections covering:
     - Platform role clarification (marketplace facilitator, not service provider)
     - Payment terms and refund policy
     - Dispute resolution (arbitration vs. litigation)
     - Indemnification (customers/helpers/sellers indemnify OxSteed)
     - Limitation of liability (liability capped at transaction amount)
     - IP ownership and user content licensing
     - Acceptable use policy (prohibited conduct, content removal)
     - Warranty disclaimers
     - Accessibility statement
     - GDPR/CCPA integration
   - Ensure enforceability in key jurisdictions (CA, NY, federal)
   - Deliverable: Updated ToS (counsel-reviewed, ready for publication)

2. **Dispute Resolution Process**
   - Define escalation path (self-resolution → platform mediation → arbitration → small claims court)
   - Create dispute resolution procedures document
   - Define refund policy (when customers can request refunds, platform review process)
   - Define helper response procedures (if customer disputes job quality, helper can provide evidence)
   - Define SLAs (30-day resolution target)
   - Deliverable: Dispute resolution procedures document + flowchart

3. **Seller Agreement Drafting**
   - Draft 10-15 page Seller Agreement covering:
     - Seller representations and warranties (owns products, has rights, quality guarantees)
     - Product liability indemnification
     - IP warranty (seller owns/has rights to products listed)
     - Refund/return policy
     - Commission terms and payment
     - Prohibited items (counterfeits, dangerous goods, etc.)
     - Listing removal rights (OxSteed can remove non-compliant listings)
     - Dispute resolution
     - Confidentiality (if needed)
   - Deliverable: Final Seller Agreement (ready for execution)

4. **Marketplace Liability & Insurance**
   - Advise on platform liability exposure (job-related injuries, fraud, payment disputes, IP infringement)
   - Recommend insurance coverage (Errors & Omissions, General Liability, Cyber Liability)
   - Advise on indemnification language (who indemnifies whom)
   - Deliverable: Liability analysis memo + insurance recommendations

5. **Job Safety Disclaimers**
   - Draft disclaimers explaining that customers assume risk of injury during jobs
   - Explain that helpers are responsible for safety, licensing, OSHA compliance
   - Advise on effectiveness of disclaimers (may not eliminate liability in all cases)
   - Deliverable: Job safety disclaimer language for ToS and help center

### Timeline

- **Week 1 (May 1-3):** Engagement letter signed; client provides current ToS, business model documentation
- **Week 2 (May 5-12):** ToS legal review + redline recommendations; liability analysis memo
- **Week 3 (May 15-19):** ToS redraft final + Seller Agreement draft + dispute resolution procedures
- **Week 4 (May 20-30):** Seller Agreement final + job safety disclaimers; counsel available for closing questions

### Budget

**Estimated Hours:** 40-60 hours  
**Rate:** [Your standard rate]  
**Estimated Fee:** $[XXX] (fixed fee preferred)  
**Payment Terms:** Net 30; [50% upfront, 50% upon completion]

### Background Information

- **Platform Model:** Two-sided marketplace (customers post jobs, helpers bid; sellers list products, customers purchase)
- **Customer Base:** Primarily US (launch phase)
- **Current ToS:** Exists but legal review "unknown" (per internal notes); needs comprehensive refresh
- **Liability Exposure:** Job-related injuries (falls, equipment damage, etc.); payment fraud; dispute resolution; IP infringement (product listings)
- **Dispute Volume:** Expected low at launch (<10 disputes/month); need scalable process
- **Key Vendors:** Stripe (payment processing); no third-party liability currently

### Key Questions for Discussion

1. For a marketplace like ours, how do we structure ToS to minimize OxSteed's platform liability? What's the right balance between protecting customers and limiting platform liability?
2. Is mandatory arbitration clause enforceable for consumer disputes in CA, NY? Recommendations?
3. If OxSteed doesn't verify seller credentials (e.g., seller claims "plumbing expert" but isn't licensed), can we be liable for customer damages? How do we disclaim this?
4. For job-related injuries (customer injured while helper working), is OxSteed liable? How do we limit exposure?
5. What insurance coverage do we need? E&O, General Liability, Cyber Liability, Product Liability?

---

## HOW TO USE THIS TEMPLATE

1. **Customize for your firm's situation:** Update placeholders ([Your Name], [XXX], [Counsel Firm Name], rates, timeline if different)
2. **Add specific details:** If you have existing ToS, Privacy Policy, or documentation, attach or reference
3. **Send to prospective counsel:** Email with subject "OxSteed – Legal Counsel Engagement Request – Data Privacy / Employment / Marketplace"
4. **Follow up:** If no response within 3 business days, follow up by phone
5. **Compare proposals:** Request fee estimate, timeline, team composition from 2-3 firms per specialty
6. **Negotiate:** Don't accept first quote; ask if fixed-fee is possible; negotiate payment terms (50% upfront + 50% completion vs. weekly billing)

---

## Red Flags When Selecting Counsel

- **Firm has no relevant experience** (e.g., employment attorney with no gig economy experience)
- **Firm quotes extremely low or high** (suspect quality or opportunism)
- **Firm cannot meet timeline** (needs for 10+ weeks; you have 4 weeks)
- **Firm wants $X retainer** (be cautious; fixed-fee is better for this scoped work)
- **Firm seems dismissive of your risks** (good counsel should take GDPR/CCPA seriously)

---

## Budget Negotiation Tips

1. **Ask for fixed-fee:** Most counsel will do fixed-fee for scoped work like this (DPIA, Privacy Policy, DPA, ICA)
2. **Bundle work:** If one firm can do data privacy + employment + marketplace, ask for bundled discount
3. **Phased timeline:** Request split payment (50% upfront, 50% upon completion) or weekly invoicing
4. **Ask about junior associates:** Experienced lawyer + junior associate = lower cost than senior lawyer solo
5. **Suggest hybrid:** Some work done by you/team (e.g., data inventory, documentation gathering) to reduce billable hours

---

**Sent By:** [Your Name], General Counsel  
**Company:** OxSteed  
**Email:** emilejeanphilippe@oxsteed.com  
**Phone:** [Your Phone]  
**Timeline:** Responses expected by May 3, 2026; selection finalized by May 5, 2026; engagement start May 5, 2026
