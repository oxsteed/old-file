export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-300">
      <div className="max-w-4xl mx-auto px-4 py-12 text-sm leading-relaxed">
        <h1 className="text-3xl font-bold text-white mb-2">
          Terms of Service
        </h1>
        <p className="text-gray-500 text-xs mb-10">
          Last updated: March 22, 2026 - Effective immediately upon account creation
        </p>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            1. What OxSteed Is - And Is Not
          </h2>
          <p className="mb-3">
            OxSteed LLC ("OxSteed," "we," "us," or "our") operates an online
            introduction platform that connects individuals seeking local
            assistance ("Customers") with independent individuals who offer
            their skills and labor ("Helpers"). OxSteed is a neutral
            third-party platform - a broker and directory service - not an
            employer, staffing agency, or general contractor.
          </p>
          <p className="mb-3">
            OxSteed does not employ Helpers, does not control how Helpers
            perform their work, does not set the prices Helpers charge, and
            does not dispatch Helpers to any job. All agreements for services
            are made directly between Customers and Helpers.
          </p>
          <p className="mb-3">
            OxSteed is a platform, not a party to any service agreement
            between a Customer and a Helper. By using OxSteed, you
            acknowledge and agree that OxSteed has no control over,
            and bears no responsibility for, the quality, safety, legality,
            or outcome of any service performed.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>Important:</strong> OxSteed operates under the
            Communications Decency Act, 47 U.S.C. § 230. OxSteed is not
            the publisher or speaker of any content created by its users
            and is immune from liability for such content to the extent
            provided by federal law.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            2. Eligibility
          </h2>
          <p className="mb-3">
            You must be at least 18 years old and a legal resident of the
            United States to create an account or use OxSteed. By creating
            an account, you represent and warrant that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>You are at least 18 years of age;</li>
            <li>You are a legal resident of the United States;</li>
            <li>You have the legal capacity to enter into a binding agreement;</li>
            <li>You are not prohibited by law from using the platform;</li>
            <li>All information you provide during registration is accurate, current, and complete;</li>
            <li>You will maintain the accuracy of your account information.</li>
          </ul>
          <p className="mb-3">
            OxSteed reserves the right to request proof of age or identity at
            any time. Accounts created by anyone under 18 will be immediately
            terminated.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>Important:</strong> OxSteed is currently available only
            within the United States. Users outside the U.S. are not
            permitted to create accounts or use the platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            3. Platform Tiers and Services
          </h2>
          <p className="mb-3">
            OxSteed operates three distinct service tiers. Each tier has
            different features, fees, and legal implications.
          </p>
          <div className="space-y-4">
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 1 - Free Directory Listing</h3>
              <p>
                Helpers may create a free profile. Customers may browse
                profiles and post job listings. OxSteed facilitates
                introductions only. <strong>No money passes through
                OxSteed.</strong> Customers and Helpers transact entirely
                outside the platform. OxSteed holds zero liability for
                any transaction, outcome, injury, or dispute arising from
                Tier 1 connections.
              </p>
            </div>
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 2 - Verified Subscription (Pro, $29/month)</h3>
              <p className="mb-2">
                Helpers who subscribe to Tier 2 gain access to: priority
                placement in search results, a verified profile badge,
                optional background check certification, bid submission on
                posted jobs, and push notification alerts for matching jobs.
              </p>
              <p>
                Tier 2 subscriptions are billed monthly via Stripe.
                Subscriptions renew automatically until cancelled. No money
                from customer-to-helper transactions passes through OxSteed
                at this tier unless the parties elect Tier 3 payment
                protection.
              </p>
            </div>
            <div className="border border-gray-700 rounded-xl p-4">
              <h3 className="font-bold text-white mb-1">Tier 3 - Protected Payment (Broker, $79/month)</h3>
              <p className="mb-2">
                Tier 3 is an optional, voluntary payment protection service
                that both the Customer and the Helper must affirmatively
                elect. When elected, OxSteed facilitates payment through
                Stripe Connect, holds funds in escrow until job completion
                is confirmed, and provides a structured dispute resolution
                process.
              </p>
              <p className="mb-2"><strong>Platform fees for Tier 3 transactions:</strong></p>
              <ul className="list-disc ml-5 space-y-1 mb-2">
                <li>Platform service fee: 10% of the agreed job value, minimum $5.00</li>
                <li>Payment protection fee: 2% of the agreed job value (covers Stripe processing and escrow administration)</li>
                <li>Broker mediation fee (if applicable): 5% of job value, applied only when a Tier 3 Broker Helper mediates the transaction</li>
                <li>Total maximum platform take: up to 17% of agreed job value for brokered Tier 3 transactions</li>
              </ul>
              <p>
                Tier 3 does not make OxSteed a party to the service
                agreement. OxSteed acts solely as a payment intermediary
                and neutral escrow agent. Stripe, Inc. processes all
                payments as a licensed money transmitter.
              </p>
            </div>
          </div>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            4. Tool Rental Addendum
          </h2>
          <p className="mb-3">
            OxSteed allows Helpers to list tools and equipment for rent
            through the platform. The following additional terms apply
            to all tool rental transactions:
          </p>
          <p className="mb-3">
            <strong>Tool Owner Responsibilities.</strong> Helpers who list
            tools for rent represent and warrant that: (a) they are the
            legal owner of the tool or have authorization to rent it;
            (b) the tool is in safe, working condition; (c) the listing
            accurately describes the tool's condition, capabilities, and
            any known defects; and (d) they maintain any required insurance
            for the equipment.
          </p>
          <p className="mb-3">
            <strong>Renter Responsibilities.</strong> Customers who rent
            tools agree to: (a) use the tool only for its intended purpose;
            (b) return the tool in the same condition as received, normal
            wear and tear excepted; (c) not sublease, lend, or transfer
            the tool to any third party; (d) immediately notify the
            tool owner and OxSteed of any damage, malfunction, or loss;
            and (e) assume full liability for damage to or loss of the
            tool while in their possession.
          </p>
          <p className="mb-3">
            <strong>Damage and Loss.</strong> The renter is financially
            responsible for the full replacement value of any tool that
            is lost, stolen, or damaged beyond normal wear and tear while
            in the renter's possession. Disputes over tool condition will
            follow the dispute resolution process in Section 16.
          </p>
          <p className="mb-3">
            <strong>OxSteed's Role.</strong> OxSteed does not inspect,
            certify, or guarantee the condition, safety, or fitness of
            any tool listed on the platform. OxSteed is not liable for
            any injury, property damage, or loss arising from the use
            of rented tools. Tool rental transactions between users are
            governed by the same tier structure described in Section 3.
          </p>
          <p className="text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400">
            <strong>Safety Warning:</strong> Always inspect any rented
            tool before use. Do not use any tool that appears damaged,
            modified, or unsafe. OxSteed is not responsible for injuries
            caused by defective or improperly maintained equipment.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            5. User Roles and Definitions
          </h2>
          <ul className="space-y-3">
            <li><strong>Customer:</strong> Any individual or entity that creates an OxSteed account for the purpose of posting job listings or contacting Helpers to arrange services.</li>
            <li><strong>Helper (Tier 1 - Free):</strong> An independent individual who creates a free OxSteed profile to advertise their skills and availability. Helpers are not employees, agents, or contractors of OxSteed.</li>
            <li><strong>Helper (Tier 2 - Pro Subscriber):</strong> A Helper who maintains an active Pro subscription, has completed optional identity and background verification, and may submit bids on posted jobs.</li>
            <li><strong>Helper (Tier 3 - Broker):</strong> A Helper with an active Broker subscription who has connected a Stripe Express account, enabling protected payment transactions.</li>
            <li><strong>Independent Contractor Status:</strong> All Helpers, regardless of tier, are independent contractors. OxSteed does not set their work hours, require minimum availability, control their methods or tools, provide equipment, mandate specific rates, or guarantee any volume of work.</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            6. Fees and Payment Terms
          </h2>
          <p className="mb-3">
            <strong>Subscription Fees.</strong> Tier 2 (Pro) and Tier 3
            (Broker) subscriptions are billed monthly. Subscription fees
            are non-refundable except as required by applicable law.
            You may cancel at any time through your account dashboard.
          </p>
          <p className="mb-3">
            <strong>Transaction Fees (Tier 3 only).</strong> When both
            parties elect Tier 3 payment protection, OxSteed deducts its
            platform service fee (10% of job value, minimum $5.00) plus a
            2% payment protection fee before releasing the remaining
            balance to the Helper. No fees are charged for Tier 1 connections.
          </p>
          <p className="mb-3">
            <strong>Tax Compliance.</strong> Helpers earning $600 or more
            through the platform in a calendar year are required to provide
            a completed IRS Form W-9. OxSteed will issue IRS Form 1099-NEC
            to qualifying Helpers as required by law.
          </p>
          <p className="mb-3">
            <strong>Refunds (Tier 3 escrow).</strong> Disputed funds held
            in escrow will be released according to the dispute
            resolution process described in Section 16.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            Background Checks, Verification, and FCRA Compliance </h2>
          <h2 className="mb-3">7.1 Optional Background Screening</h2>
          <p className="mb-3">
            Tier 2 and Tier 3 Helpers may elect to complete a background check through <strong>Checkr, Inc.</strong>, OxSteed's third-party consumer reporting agency. Background checks are entirely voluntary. Completion of a background check does not guarantee employment, job awards, or continued platform access.
          </p>
          <h2 className="mb-3">7.2 Fair Credit Reporting Act (FCRA) Disclosure</h2>
          <p className="mb-3">
            OxSteed complies with the Fair Credit Reporting Act, 15 U.S.C. § 1681 et seq. ("FCRA"). Before initiating a background check, OxSteed will provide you with:
          </p>
          <ul>
            <li>A <strong>standalone written FCRA disclosure</strong> informing you that a consumer report may be obtained for platform access purposes; and</li>
            <li>A request for your <strong>written authorization</strong> to obtain the report.</li>
          </ul>
          <p className="mb-3">
            You must affirmatively consent before any background check is initiated. Your consent is separate from acceptance of these Terms.
          </p>
          <h2>7.3 Adverse Action Procedure</h2>
          <p className="mb-3">
            If OxSteed takes an adverse action based in whole or in part on information in a consumer report — for example, denying or revoking your verified badge — OxSteed will:
          </p>
          <ol>
            <li>Provide you with a <strong>pre-adverse action notice</strong> and a copy of the consumer report and a summary of your FCRA rights before the action is finalized;</li>
            <li>Allow you a reasonable period (typically 5 business days) to dispute any inaccuracies directly with Checkr;</li>
            <li>Provide a final <strong>adverse action notice</strong> if the decision is upheld, including contact information for Checkr and information on your right to obtain a free copy of the report.</li>
          </ol>
          <h2>7.4 Accuracy Disclaimer</h2>
          <p className="mb-3">
            Background check results are provided solely by <strong>Checkr, Inc.</strong>, which is subject to its own Terms of Service and Privacy Policy. <strong>OxSteed makes no representation or warranty that any background check result is complete, accurate, or current.</strong> OxSteed is not responsible for errors or omissions in Checkr's reports. Customers are solely responsible for conducting their own independent due diligence before engaging any Helper, regardless of badge status.
          </p>
          <h2>7.5 Badge Expiration and Renewal</h2>
          <p className="mb-3">
            Background check badges expire 12 months after the date of the underlying report and must be renewed to maintain verified status. OxSteed will notify you at least 30 days before your badge expires.
          </p>
          <h2>7.6 Verified Badge Limitations</h2>
          <p className="mb-3">
            The verified badge indicates only that a background check was completed at a specific point in time through Checkr. It does not:
          </p>
          <ul>
            <li>Constitute OxSteed's endorsement of any Helper's skills, quality of work, or character;</li>
            <li>Guarantee that a Helper holds any required professional license or insurance;</li>
            <li>Reflect criminal activity, license changes, or other events occurring after the check date;</li>
            <li>Create any warranty or guarantee by OxSteed regarding the Helper's fitness for any particular job.</li>
          </ul>
          <p className="mb-3">
            <strong>Do not rely solely on the verified badge when hiring a Helper.</strong> Always independently verify licenses, insurance, and references for any regulated trade or high-value job.
          </p></section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            8. Independent Contractor Status
          </h2>
          <p className="mb-3">
            Nothing in these Terms creates an employment relationship,
            partnership, joint venture, agency, franchise, or
            employer-employee relationship between OxSteed and any Helper.
          </p>
          <p className="mb-3">Helpers expressly acknowledge that:</p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>They are operating an independent business</li>
            <li>They are solely responsible for all federal, state, and local taxes on income earned through the platform</li>
            <li>They must carry any insurance required by law for their services</li>
            <li>They are solely responsible for obtaining any licenses or permits required by law</li>
            <li>OxSteed does not provide workers' compensation, unemployment insurance, health benefits, or any other employment benefits</li>
            <li>They may work for any other platform, client, or employer at any time without restriction</li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            9. Intellectual Property and DMCA
          </h2>
          <p className="mb-3">
            <strong>OxSteed Content.</strong> All content, design, logos,
            trademarks, code, and materials on the OxSteed platform
            ("OxSteed Content") are owned by or licensed to OxSteed LLC
            and are protected by U.S. and international copyright,
            trademark, and other intellectual property laws. You may not
            copy, reproduce, distribute, modify, create derivative works
            of, publicly display, or otherwise exploit any OxSteed Content
            without prior written consent from OxSteed.
          </p>
          <p className="mb-3">
            <strong>User Content License.</strong> By posting content on
            OxSteed (including but not limited to profile information,
            photos, reviews, job descriptions, and messages), you grant
            OxSteed a non-exclusive, worldwide, royalty-free, transferable,
            sublicensable license to use, display, reproduce, and distribute
            your content solely in connection with operating and promoting
            the platform. You retain ownership of your content. This license
            terminates when you delete your content or your account, except
            for content that has been shared with other users or that OxSteed
            is required to retain for legal or compliance purposes.
          </p>
          <p className="mb-3">
            <strong>DMCA Notice and Takedown.</strong> OxSteed respects
            intellectual property rights and complies with the Digital
            Millennium Copyright Act ("DMCA"), 17 U.S.C. § 512. If you
            believe that content on OxSteed infringes your copyright, you
            may submit a DMCA takedown notice to our designated agent:
          </p>
          <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 mb-3">
            <p className="mb-1"><strong className="text-white">DMCA Designated Agent:</strong></p>
            <p>OxSteed LLC</p>
            <p>Attn: DMCA Agent</p>
            <p>Springfield, Ohio</p>
            <p>Email: <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">legal@oxsteed.com</a></p>
          </div>
          <p className="mb-3">
            Your DMCA notice must include: (1) identification of the
            copyrighted work; (2) identification of the infringing material
            and its location on the platform; (3) your contact information;
            (4) a statement of good faith belief that the use is not
            authorized; (5) a statement under penalty of perjury that the
            information is accurate and you are the copyright owner or
            authorized agent; and (6) your physical or electronic signature.
          </p>
          <p className="mb-3">
            <strong>Counter-Notice.</strong> If you believe your content was
            removed in error, you may submit a counter-notice containing:
            (1) identification of the removed material; (2) a statement
            under penalty of perjury that the removal was a mistake;
            (3) your name, address, and phone number; (4) consent to
            jurisdiction of the federal court in your district; and
            (5) your physical or electronic signature.
          </p>
          <p className="text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400">
            <strong>Warning:</strong> Submitting a false DMCA notice or
            counter-notice may result in legal liability under 17 U.S.C. § 512(f),
            including damages and attorney's fees.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            10. Termination and Suspension
          </h2>
          <p className="mb-3">
            <strong>By OxSteed.</strong> OxSteed may suspend or terminate
            your account at any time, with or without cause, and with or
            without notice. Grounds for termination include, but are not
            limited to: violation of these Terms, fraudulent or illegal
            activity, non-payment of fees, receiving multiple complaints
            from other users, or any conduct that OxSteed determines is
            harmful to the platform, other users, or third parties.
          </p>
          <p className="mb-3">
            <strong>By You.</strong> You may deactivate your account at
            any time through your account settings. Deactivation does not
            release you from any obligations incurred prior to deactivation,
            including pending Tier 3 escrow transactions or outstanding fees.
          </p>
          <p className="mb-3">
            <strong>Effect of Termination.</strong> Upon termination:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Your right to access and use OxSteed ceases immediately;</li>
            <li>Any pending Tier 3 escrow funds will be handled according to the dispute resolution process in Section 16;</li>
            <li>OxSteed may retain your data as required by law or for legitimate business purposes (e.g., tax records, dispute evidence);</li>
            <li>Provisions that by their nature should survive termination will survive, including Sections 8, 9, 11, 12, 13, 16, and 20.</li>
          </ul>
          <p className="mb-3">
            <strong>Appeal.</strong> If your account is suspended or
            terminated, you may appeal by contacting{' '}
            <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
              legal@oxsteed.com
            </a>{' '}
            within 30 days. OxSteed will review your appeal and respond
            within 10 business days. OxSteed's decision on appeal is final.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            11. Disclaimer of Warranties
          </h2>
          <p className="mb-3 uppercase">
            THE OXSTEED PLATFORM, INCLUDING ALL CONTENT, FEATURES, AND
            SERVICES, IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS
            WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.
            TO THE FULLEST EXTENT PERMITTED BY LAW, OXSTEED DISCLAIMS ALL
            WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF
            MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE,
            NON-INFRINGEMENT, AND TITLE.
          </p>
          <p className="mb-3">
            Without limiting the foregoing, OxSteed does not warrant that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>The platform will be uninterrupted, timely, secure, or error-free;</li>
            <li>The results obtained from the platform will be accurate or reliable;</li>
            <li>Any Helper or Customer will perform their obligations;</li>
            <li>Any content on the platform is accurate, complete, or current;</li>
            <li>The platform will meet your specific requirements or expectations.</li>
          </ul>
          <p className="mb-3">
            You use the platform at your own risk. No advice or information,
            whether oral or written, obtained from OxSteed or through the
            platform creates any warranty not expressly stated in these Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            12. Liability Limitations and Insurance
          </h2>
          <p className="mb-3">
            <strong>No Insurance Provided.</strong> OxSteed does not
            provide any insurance coverage for any Helper, Customer, or third party.
          </p>
          <p className="mb-3">
            <strong>Limitation of Liability.</strong> TO THE MAXIMUM
            EXTENT PERMITTED BY APPLICABLE LAW, OXSTEED'S TOTAL LIABILITY
            FOR ANY CLAIM ARISING FROM OR RELATING TO THESE TERMS OR THE
            PLATFORM SHALL NOT EXCEED THE GREATER OF: (A) $100 USD, OR
            (B) THE TOTAL FEES PAID BY YOU TO OXSTEED IN THE 12 MONTHS
            PRECEDING THE CLAIM.
          </p>
          <p className="mb-3">
            OXSTEED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
            SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES.
          </p>
          <p className="mb-3">
            <strong>Property Damage.</strong> OxSteed is not liable for
            any property damage caused by a Helper during the performance
            of services.
          </p>
          <p className="mb-3">
            <strong>Personal Injury.</strong> OxSteed is not liable for any
            personal injury, death, or bodily harm arising from services
            arranged through the platform.
          </p>
          <p className="text-xs bg-red-900/30 border border-red-700/50 rounded-lg p-3 text-red-400">
            <strong>Ohio-Specific Notice:</strong> Ohio Revised Code
            § 4113.15 et seq. governs wage payment disputes between
            independent contractors and engaging parties. OxSteed is
            not an "employer" as defined under Ohio law.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            13. Indemnification
          </h2>
          <p className="mb-3">
            You agree to indemnify, defend, and hold harmless OxSteed LLC,
            its officers, directors, employees, agents, and affiliates
            from and against any and all claims, damages, losses,
            liabilities, costs, and expenses (including reasonable
            attorney's fees) arising out of or related to:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Your use of or access to the OxSteed platform;</li>
            <li>Your violation of these Terms of Service;</li>
            <li>Your violation of any applicable law, rule, or regulation;</li>
            <li>Any content you post, upload, or transmit through the platform;</li>
            <li>Any service you perform or receive through the platform;</li>
            <li>Any dispute between you and another user;</li>
            <li>Your negligence or willful misconduct;</li>
            <li>Any third-party claim arising from your use of rented tools or equipment listed on the platform.</li>
          </ul>
          <p className="mb-3">
            This indemnification obligation survives termination of your
            account and these Terms.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            14. Licensing Disclaimer
          </h2>
          <p className="mb-3">
            <strong>No License Verification.</strong> OxSteed does not
            verify, validate, or guarantee that any Helper holds any
            professional license, permit, certification, or insurance
            required by federal, state, or local law to perform the
            services they advertise on the platform.
          </p>
          <p className="mb-3">
            <strong>Customer Responsibility.</strong> Customers are solely
            responsible for independently verifying that any Helper they
            engage holds all licenses, permits, certifications, and
            insurance required by applicable law for the specific services
            to be performed. This includes, but is not limited to:
            electricians, plumbers, HVAC technicians, general contractors,
            roofers, and any other trade requiring state or local licensure.
          </p>
          <p className="mb-3">
            <strong>Helper Responsibility.</strong> Helpers represent and
            warrant that they hold all licenses, permits, and certifications
            required by applicable law for the services they advertise.
            Listing services that require licensure without holding the
            appropriate license is a violation of these Terms and may
            result in immediate account termination.
          </p>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400">
            <strong>Important:</strong> A verified badge on OxSteed
            indicates only that a background check was completed. It does
            NOT indicate that a Helper is licensed, insured, or bonded
            for any particular trade.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            15. Tool Rental Listings — Special Terms
          </h2>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            15.1 Nature of Tool Rental Listings
          </h3>
          <p className="mb-3">
            OxSteed permits users to post listings offering tools and
            equipment for temporary use by other users ("Tool Rental").
            Tool Rental listings are a distinct category from labor service
            listings. When a Tool Rental transaction occurs, the listing
            owner ("Tool Owner") and the renting user ("Renter") enter
            into a direct bailment agreement governed by applicable state
            law.
          </p>
          <p className="mb-3">
            <strong>OxSteed is not a party to any Tool Rental agreement.</strong>{' '}
            OxSteed does not own, inspect, certify, maintain, or insure
            any tool or equipment listed on the platform. OxSteed
            facilitates the introduction only.
          </p>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            15.2 Tool Owner Responsibilities
          </h3>
          <p className="mb-3">
            As a Tool Owner listing equipment on OxSteed, you represent,
            warrant, and agree that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>You are the lawful owner of, or are authorized to rent out, all listed tools;</li>
            <li>All tools listed are in safe, functional working condition and are free from defects that could cause injury or property damage;</li>
            <li>You will disclose any known limitations, safety hazards, or operating requirements to the Renter before the rental begins;</li>
            <li>You are solely responsible for complying with any applicable local ordinances or regulations governing the rental of tools or equipment;</li>
            <li>Your homeowner's, renter's, or business insurance may not cover commercial tool lending and you should consult your insurer before listing tools;</li>
            <li>You are solely responsible for determining the rental price, deposit requirements, and return conditions;</li>
            <li>Any damage assessment, deposit dispute, or loss claim is entirely between you and the Renter.</li>
          </ul>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            15.3 Renter Responsibilities
          </h3>
          <p className="mb-3">
            As a Renter of tools or equipment listed on OxSteed, you agree that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>You will use all rented tools only for their intended, lawful purpose and in accordance with all manufacturer instructions and safety guidelines;</li>
            <li>You assume all risk of personal injury, property damage, and third-party harm arising from your use of any rented tool;</li>
            <li>You are responsible for returning tools in the same condition as received, normal wear and tear excepted;</li>
            <li>You are liable to the Tool Owner for any damage, loss, or theft of rented tools occurring while in your possession;</li>
            <li>You will not sub-rent, lend, or otherwise transfer possession of any rented tool to a third party without the Tool Owner's written consent.</li>
          </ul>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            15.4 OxSteed's Limitation of Liability for Tool Rentals
          </h3>
          <p className="mb-3">
            <strong>OxSteed expressly disclaims all liability</strong> arising
            from or related to Tool Rental transactions, including but not
            limited to: personal injury or death caused by a defective or
            improperly used tool; property damage caused during tool use;
            loss, theft, or damage to rented tools; disputes between Tool
            Owners and Renters regarding condition, deposits, or return;
            and any claim by a third party injured by a rented tool.
          </p>
          <p className="mb-3">
            OxSteed does not inspect, certify, or warrant the safety or
            condition of any tool listed on the platform.{' '}
            <strong>Renters and Tool Owners use the Tool Rental feature
            entirely at their own risk.</strong>
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            15.5 Tier 3 Escrow for Tool Rentals
          </h3>
          <p className="mb-3">
            Tool Rental transactions may use Tier 3 payment protection for
            the rental fee. However, Tier 3 escrow covers only the agreed
            rental payment amount. Deposit disputes, damage claims, and
            loss recovery fall entirely outside the Tier 3 dispute process
            and must be resolved directly between Tool Owner and Renter or
            through applicable legal channels.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            16. OxSteed Pay — Tier 3 Escrow Payment Terms
          </h2>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.1 Mutual Opt-In Requirement
          </h3>
          <p className="mb-3">
            OxSteed Pay (Tier 3 Payment Protection) is{' '}
            <strong>never automatic</strong>. It activates only when both
            the Customer and the Helper independently and affirmatively
            elect Tier 3 for a specific, identified job. Neither party may
            unilaterally activate Tier 3 on behalf of the other. Tier 3
            election is job-specific and does not apply to future jobs
            between the same parties.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.2 Nature of Escrow
          </h3>
          <p className="mb-3">
            When Tier 3 is elected, the Customer submits payment to OxSteed
            via Stripe Connect. These funds are held in escrow and{' '}
            <strong>remain the Customer's property until released.</strong>{' '}
            Escrowed funds are not OxSteed's assets and are not commingled
            with OxSteed's operating funds.
          </p>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.3 Fund Release Triggers
          </h3>
          <p className="mb-3">
            Escrowed funds will be released to the Helper when:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Both the Customer <strong>and</strong> the Helper confirm job completion through the platform; or</li>
            <li>OxSteed issues a resolution decision in the Helper's favor following a dispute process; or</li>
            <li>The Customer fails to respond to a completion confirmation request within 48 hours of the Helper marking the job complete (funds auto-release after this window).</li>
          </ul>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.4 Refund Triggers
          </h3>
          <p className="mb-3">
            Escrowed funds will be refunded to the Customer when:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>Both parties mutually agree to cancel the job before work begins;</li>
            <li>The Helper fails to appear or abandons the job, as documented by the Customer;</li>
            <li>OxSteed issues a resolution decision in the Customer's favor following a dispute process;</li>
            <li>The job is cancelled by either party at least 24 hours before the scheduled start time.</li>
          </ul>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.5 Platform Fees Deducted from Escrow
          </h3>
          <p className="mb-3">
            OxSteed deducts the following fees from escrowed funds before
            releasing the net amount to the Helper:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Platform service fee:</strong> 10% of the agreed job value (minimum $5.00)</li>
            <li><strong>Payment protection fee:</strong> 2% of the agreed job value (covers Stripe processing and escrow administration)</li>
            <li><strong>Broker mediation fee (if applicable):</strong> 5% of job value, applied only when a Tier 3 Broker Helper is involved</li>
            <li><strong>Maximum total platform deduction:</strong> 17% of agreed job value</li>
          </ul>
          <p className="text-xs bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-400 mb-3">
            <strong>All fees are disclosed to both parties before Tier 3
            election is confirmed. No hidden fees will be charged.</strong>
          </p>
                            <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.6 No Interest on Escrow Funds
          </h3>
          <p className="mb-3">
            OxSteed does not pay interest on escrowed funds to either party.
            Any interest or float accruing on escrow balances due to
            Stripe's payment processing timelines is retained by OxSteed
            as an administrative fee.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.7 Stripe Connected Account Agreement
          </h3>
          <p className="mb-3">
            Tier 3 Helpers (Brokers) must connect a Stripe Express account
            as a condition of Tier 3 eligibility. By connecting a Stripe
            Express account, you agree to Stripe's{' '}
            <a href="https://stripe.com/legal/connect-account" className="text-orange-500 underline" target="_blank" rel="noopener noreferrer">
              Connected Account Agreement
            </a>
            , which includes Stripe's own terms, privacy policy, and
            compliance obligations. OxSteed is not a party to your
            agreement with Stripe and is not responsible for Stripe's
            actions, errors, or service interruptions.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.8 Tier 3 Does Not Create an Agency or Partnership
          </h3>
          <p className="mb-3">
            OxSteed's role as escrow agent in Tier 3 transactions does not
            make OxSteed a party to the underlying service agreement, an
            employer of the Helper, an agent of either party, or a
            guarantor of any outcome. OxSteed acts solely as a neutral
            payment intermediary.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            16.9 Platform Continuity
          </h3>
          <p className="mb-3">
            In the event OxSteed ceases operations, is acquired, or
            undergoes a change of control while Tier 3 escrow funds are
            held, OxSteed will make commercially reasonable efforts to
            either release funds to the appropriate party, transfer escrow
            obligations to a successor entity, or refund all held amounts
            within 30 days of the triggering event. Users will be notified
            by email.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            17. Job Postings and Bid System
          </h2>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            17.1 Customer Job Postings
          </h3>
          <p className="mb-3">
            Customers may post job listings describing work they need
            performed. By posting a job listing, you represent that the
            work described is lawful, that you have authority to engage
            someone to perform it, and that the listing is accurate and
            not misleading. OxSteed reserves the right to remove any job
            listing for any reason without notice or liability.
          </p>
          <p className="mb-3">
            Posting a job listing creates no obligation to accept any bid
            or engage any Helper. Customers may close a listing, modify
            it, or decline all bids at their sole discretion.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            17.2 Helper Bids (Tier 2 and Tier 3)
          </h3>
          <p className="mb-3">
            Tier 2 and Tier 3 Helpers may submit bids on posted job
            listings. By submitting a bid, you represent that:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li>You are genuinely available and qualified to perform the described work;</li>
            <li>Your bid price is accurate and reflects your all-in cost to the Customer;</li>
            <li>You hold any licenses, permits, or certifications required to legally perform the work in the applicable jurisdiction.</li>
          </ul>
          <p className="mb-3">
            Submitting a bid is an offer, not a contract. A contract for
            services is formed only when a Customer accepts a bid and, if
            Tier 3 is elected, when both parties complete the escrow setup
            for that specific job.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            17.3 Cancellation of Active Bids
          </h3>
          <p className="mb-3">
            If a Customer removes a job listing or cancels it after bids
            have been submitted but before a bid is accepted, all pending
            bids are automatically voided. Helpers have no claim against
            OxSteed or the Customer for bid cancellations.
          </p>
          <h3 className="text-md font-semibold text-orange-300 mb-2">
            17.4 No Guarantee of Job Volume
          </h3>
          <p className="mb-3">
            OxSteed makes no representation, warranty, or guarantee that
            any Helper at any tier will receive bids, leads, job offers,
            or income of any amount. Subscription fees are for platform
            access and features, not for guaranteed work volume.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            18. Third-Party Services
          </h2>
          <p className="mb-3">
            OxSteed integrates with or relies on the following third-party
            services, each of which is subject to its own terms and
            privacy policies:
          </p>
          <ul className="list-disc ml-5 space-y-2 mb-3">
            <li><strong>Stripe, Inc.</strong> — Payment processing and connected accounts (Tier 3 escrow)</li>
            <li><strong>Checkr, Inc.</strong> — Background check and consumer reporting services</li>
            <li><strong>Resend</strong> — Transactional email delivery</li>
          </ul>
          <p className="mb-3">
            OxSteed is not responsible for the availability, accuracy,
            security, or performance of any third-party service. Your use
            of third-party services through OxSteed is subject to the
            applicable third-party terms. OxSteed shall not be liable for
            any loss or damage caused by a third-party service provider's
            acts, omissions, or service interruptions.
          </p>
        </section>

                <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            19. Consent and Acceptance
          </h2>
          <p className="mb-3">
            By creating an OxSteed account, you confirm that you have read,
            understood, and agree to be bound by these Terms of Service.
            Your click of "Create Account" or "Continue" constitutes a
            legally binding electronic signature under the E-SIGN Act,
            15 U.S.C. § 7001 et seq.
          </p>
          <p className="mb-3">
            If you do not agree to these Terms, do not create an account
            or use the OxSteed platform.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-lg font-bold text-orange-400 mb-3">
            20. Modifications to These Terms
          </h2>
          <p className="mb-3">
            OxSteed may update these Terms at any time. We will notify
            users of material changes by email at least 14 days before
            the changes take effect. Continued use of the platform after
            the effective date of updated Terms constitutes acceptance of
            the new Terms. If you do not agree to the updated Terms, you
            must stop using the platform and deactivate your account.
          </p>
        </section>

        <p className="text-gray-500 text-xs mt-8 border-t border-gray-700 pt-4">
          For questions about these Terms, contact us at:{' '}
          <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
            legal@oxsteed.com
          </a>
        </p>
        <p className="text-gray-500 text-xs mt-2 mb-8">
          OxSteed LLC — Springfield, Ohio —{' '}
          <a href="mailto:legal@oxsteed.com" className="text-orange-500 underline">
            legal@oxsteed.com
          </a>
        </p>
      </div>
    </div>
  );
}
