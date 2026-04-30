#!/usr/bin/env python3
"""Build client/src/locales/terms/en.content.json from the canonical English terms."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src/locales/terms/en.content.json"

S = {}

S["1"] = [
    {"type": "h2", "text": "1. What OxSteed Is - And Is Not"},
    {
        "type": "p",
        "text": (
            'OxSteed LLC ("OxSteed," "we," "us," or "our") operates an online introduction platform that connects individuals seeking local assistance ("Customers") with independent individuals who offer their skills and labor ("Helpers"). OxSteed is a neutral third-party platform that provide a directory service. OxSteed is not an employer, a staffing agency, or a general contractor.'
        ),
    },
    {
        "type": "p",
        "text": "OxSteed does not employ Helpers, does not control how Helpers perform their work, does not set the prices Helpers charge, and does not dispatch Helpers to any job. All agreements for services are made directly between Customers and Helpers.",
    },
    {
        "type": "p",
        "text": "OxSteed is a platform, not a party to any service agreement between a Customer and a Helper. By using OxSteed, you acknowledge and agree that OxSteed has no control over, and bears no responsibility for, the quality, safety, legality, or outcome of any service performed.",
    },
    {
        "type": "note",
        "variant": "yellow",
        "strong": "Important:",
        "text": " OxSteed operates under the Communications Decency Act, 47 U.S.C. § 230. OxSteed is not the publisher or speaker of any content created by its users and is immune from liability for such content to the extent provided by federal law.",
    },
]

S["2"] = [
    {"type": "h2", "text": "2. Eligibility"},
    {
        "type": "p",
        "text": "You must be at least 18 years old to create an account or use OxSteed. By creating an account, you represent and warrant that:",
    },
    {
        "type": "ul",
        "items": [
            ["You are at least 18 years of age;"],
            ["You have the legal capacity to enter into a binding agreement;"],
            ["You are not prohibited by law from using the platform;"],
            ["All information you provide during registration is accurate, current, and complete;"],
            ["You will maintain the accuracy of your account information."],
        ],
    },
    {
        "type": "p",
        "text": "OxSteed reserves the right to request proof of age or identity at any time. Accounts created by anyone under 18 will be immediately terminated.",
    },
    {
        "type": "note",
        "variant": "yellow",
        "strong": "Important:",
        "text": " OxSteed is currently available within the United States.",
    },
]

S["3"] = [
    {"type": "h2", "text": "3. Platform Tiers and Services"},
    {
        "type": "p",
        "text": "OxSteed operates 2 distinct service tiers. Each tier has different features, fees, and legal implications.",
    },
    {
        "type": "tier",
        "title": "Tier 1 - Free Directory Listing",
        "paragraphs": [
            {
                "segments": [
                    "Helpers may create a free profile. Customers may browse profiles and post job listings. OxSteed facilitates introductions only. ",
                    {"strong": "No money passes through OxSteed."},
                    " Customers and Helpers transact entirely outside the platform. OxSteed holds zero liability for any transaction, outcome, injury, or dispute arising from Tier 1 connections.",
                ]
            },
        ],
    },
    {
        "type": "tier",
        "title": "Tier 2 - Verified Subscription (Pro, $14.99/month)",
        "paragraphs": [
            "Helpers who subscribe to Tier 2 gain access to: priority placement in search results, a verified pro-member badge, optional background check certification, bid submission on posted jobs, and push notification alerts for matching jobs.",
            "Tier 2 subscriptions are billed monthly through Stripe and renew automatically until cancelled. At this tier, customer-to-helper payments normally occur directly between the parties, and OxSteed does not route or control those funds.",
            "If both parties choose to use our optional payment service, OxSteed uses Stripe Connect to place a temporary authorization or charge on the customer's payment method and to coordinate release of funds to the helper, who remains the merchant of record. Both the customer and the helper must confirm that the job is complete before funds are released, and OxSteed will process that release within 12 hours of confirmation, deducting a 7.1% platform fee from the job amount plus the helpers pay the stripe payment processing fees.",
            "Paying via does not make OxSteed a party to the service agreement. OxSteed acts solely as a payment intermediary and a neutral agent. Stripe, Inc. processes all payments as a licensed money transmitter.",
        ],
    },
]

S["4"] = [
    {"type": "h2", "text": "4. Tool Rental Addendum"},
    {
        "type": "p",
        "text": "OxSteed allows Helpers to list tools and equipment for rent through the platform. The following additional terms apply to all tool rental transactions:",
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Tool Owner Responsibilities."},
            " Helpers who list tools for rent represent and warrant that: (a) they are the legal owner of the tool or have authorization to rent it; (b) the tool is in safe, working condition; (c) the listing accurately describes the tool's condition, capabilities, and any known defects; and (d) they maintain any required insurance for the equipment.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Renter Responsibilities."},
            " Customers who rent tools agree to: (a) use the tool only for its intended purpose; (b) return the tool in the same condition as received, normal wear and tear excepted; (c) not sublease, lend, or transfer the tool to any third party; (d) immediately notify the tool owner and OxSteed of any damage, malfunction, or loss; and (e) assume full liability for damage to or loss of the tool while in their possession.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Damage and Loss."},
            " The renter is financially responsible for the full replacement value of any tool that is lost, stolen, or damaged beyond normal wear and tear while in the renter's possession. Disputes over tool condition will follow the dispute resolution process in Section 16.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "OxSteed's Role."},
            " OxSteed does not inspect, certify, or guarantee the condition, safety, or fitness of any tool listed on the platform. OxSteed is not liable for any injury, property damage, or loss arising from the use of rented tools. Tool rental transactions between users are governed by the same tier structure described in Section 3.",
        ],
    },
    {
        "type": "note",
        "variant": "red",
        "strong": "Safety Warning:",
        "text": " Always inspect any rented tool before use. Do not use any tool that appears damaged, modified, or unsafe. OxSteed is not responsible for injuries caused by defective or improperly maintained equipment.",
    },
]

S["5"] = [
    {"type": "h2", "text": "5. User Roles and Definitions"},
    {
        "type": "ul",
        "className": "space-y-3",
        "items": [
            [
                {"strong": "Customer:"},
                " Any individual or entity that creates an OxSteed account for the purpose of posting job listings or contacting Helpers to arrange services.",
            ],
            [
                {"strong": "Helper (Tier 1 - Free):"},
                " An independent individual who creates a free OxSteed profile to advertise their skills and availability. Helpers are not employees, agents, or contractors of OxSteed.",
            ],
            [
                {"strong": "Helper (Tier 2 - Pro Subscriber):"},
                " A Helper who maintains an active Pro subscription, has completed identity and optional background verification, and may submit bids on posted jobs.",
            ],
            [
                {"strong": "Independent Contractor Status:"},
                " All Helpers, regardless of tier, are independent contractors. OxSteed does not set their work hours, require minimum availability, control their methods or tools, provide equipment, mandate specific rates, or guarantee any volume of work.",
            ],
        ],
    },
]

S["6"] = [
    {"type": "h2", "text": "6. Fees and Payment Terms"},
    {
        "type": "p",
        "segments": [
            {"strong": "Subscription Fees."},
            " Tier 2 (Pro) is billed monthly. Subscription fees are non-refundable except as required by applicable law. You may cancel at any time through your account dashboard.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Tax Compliance."},
            " Helpers earning $600 or more through the platform in a calendar year are required to provide a completed IRS Form W-9. OxSteed will issue IRS Form 1099-NEC to qualifying Helpers as required by law.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Refunds ."},
            " Disputed funds held will be released according to the dispute resolution process described in Section 16.",
        ],
    },
]

S["7"] = [
    {
        "type": "h2",
        "text": "Background Checks, Verification, and FCRA Compliance",
    },
    {"type": "h2", "text": "7.1 Optional Background Screening", "sub": True},
    {
        "type": "p",
        "segments": [
            "Tier 2 Helpers may elect to complete a background check through ",
            {"strong": "Checkr, Inc."},
            ", OxSteed's third-party consumer reporting agency. Background checks are entirely voluntary. Completion of a background check does not guarantee employment, job awards, or continued platform access.",
        ],
    },
    {"type": "h2", "text": "7.2 Fair Credit Reporting Act (FCRA) Disclosure", "sub": True},
    {
        "type": "p",
        "text": 'OxSteed complies with the Fair Credit Reporting Act, 15 U.S.C. § 1681 et seq. ("FCRA"). Before initiating a background check, OxSteed will provide you with:',
    },
    {
        "type": "ul",
        "items": [
            [
                "A ",
                {"strong": "standalone written FCRA disclosure"},
                " informing you that a consumer report may be obtained for platform access purposes; and",
            ],
            [
                "A request for your ",
                {"strong": "written authorization"},
                " to obtain the report.",
            ],
        ],
    },
    {
        "type": "p",
        "text": "You must affirmatively consent before any background check is initiated. Your consent is separate from acceptance of these Terms.",
    },
    {"type": "h2", "text": "7.3 Adverse Action Procedure", "sub": True},
    {
        "type": "p",
        "text": "If OxSteed takes an adverse action based in whole or in part on information in a consumer report — for example, denying or revoking your verified badge — OxSteed will:",
    },
    {
        "type": "ol",
        "items": [
            [
                "Provide you with a ",
                {"strong": "pre-adverse action notice"},
                " and a copy of the consumer report and a summary of your FCRA rights before the action is finalized;",
            ],
            [
                "Allow you a reasonable period (typically 5 business days) to dispute any inaccuracies directly with Checkr;",
            ],
            [
                "Provide a final ",
                {"strong": "adverse action notice"},
                " if the decision is upheld, including contact information for Checkr and information on your right to obtain a free copy of the report.",
            ],
        ],
    },
    {"type": "h2", "text": "7.4 Accuracy Disclaimer", "sub": True},
    {
        "type": "p",
        "segments": [
            "Background check results are provided solely by ",
            {"strong": "Checkr, Inc."},
            ", which is subject to its own Terms of Service and Privacy Policy. ",
            {"strong": "OxSteed makes no representation or warranty that any background check result is complete, accurate, or current."},
            " OxSteed is not responsible for errors or omissions in Checkr's reports. Customers are solely responsible for conducting their own independent due diligence before engaging any Helper, regardless of badge status.",
        ],
    },
    {"type": "h2", "text": "7.5 Background check Expiration and Renewal", "sub": True},
    {
        "type": "p",
        "text": "Background check badges expire 12 months after the date of the underlying report and must be renewed to maintain verified status. OxSteed will notify you at least 30 days before your badge expires.",
    },
    {
        "type": "ul",
        "items": [
            [
                "A backgroung check doesn't constitute OxSteed's endorsement of any Helper's skills, quality of work, or character;",
            ],
            [
                "A backgroung check doesn't guarantee that a Helper holds any required professional license or insurance;",
            ],
            [
                "A backgroung check doesn't reflect criminal activity, license changes, or other events occurring after the check date;",
            ],
            [
                "A backgroung check doesn't create any warranty or guarantee by OxSteed regarding the Helper's fitness for any particular job.",
            ],
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Do not rely solely on the verified badge when hiring a Helper."},
            " Always independently verify licenses, insurance, and references for any regulated trade or high-value job.",
        ],
    },
]

S["8"] = [
    {"type": "h2", "text": "8. Independent Contractor Status"},
    {
        "type": "p",
        "text": "Nothing in these Terms creates an employment relationship, partnership, joint venture, agency, franchise, or employer-employee relationship between OxSteed and any Helper.",
    },
    {"type": "p", "text": "Helpers expressly acknowledge that:"},
    {
        "type": "ul",
        "items": [
            ["They are operating an independent business"],
            ["They are solely responsible for all federal, state, and local taxes on income earned through the platform"],
            ["They must carry any insurance required by law for their services"],
            ["They are solely responsible for obtaining any licenses or permits required by law"],
            ["OxSteed does not provide workers' compensation, unemployment insurance, health benefits, or any other employment benefits"],
            ["They may work for any other platform, client, or employer at any time without restriction"],
        ],
    },
]

S["9"] = [
    {"type": "h2", "text": "9. Intellectual Property and DMCA"},
    {
        "type": "p",
        "segments": [
            {"strong": "OxSteed Content."},
            ' All content, design, logos, trademarks, code, and materials on the OxSteed platform ("OxSteed Content") are owned by or licensed to OxSteed LLC and are protected by U.S. and international copyright, trademark, and other intellectual property laws. You may not copy, reproduce, distribute, modify, create derivative works of, publicly display, or otherwise exploit any OxSteed Content without prior written consent from OxSteed.',
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "User Content License."},
            " By posting content on OxSteed (including but not limited to profile information, photos, reviews, job descriptions, and messages), you grant OxSteed a non-exclusive, worldwide, royalty-free, transferable, sublicensable license to use, display, reproduce, and distribute your content solely in connection with operating and promoting the platform. You retain ownership of your content. This license terminates when you delete your content or your account, except for content that has been shared with other users or that OxSteed is required to retain for legal or compliance purposes.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "DMCA Notice and Takedown."},
            ' OxSteed respects intellectual property rights and complies with the Digital Millennium Copyright Act ("DMCA"), 17 U.S.C. § 512. If you believe that content on OxSteed infringes your copyright, you may submit a DMCA takedown notice to our designated agent:',
        ],
    },
    {
        "type": "dmcaBox",
        "title": "DMCA Designated Agent:",
        "lines": ["OxSteed LLC", "Attn: DMCA Agent", "Springfield, Ohio"],
        "email": "legal@oxsteed.com",
    },
    {
        "type": "p",
        "text": "Your DMCA notice must include: (1) identification of the copyrighted work; (2) identification of the infringing material and its location on the platform; (3) your contact information; (4) a statement of good faith belief that the use is not authorized; (5) a statement under penalty of perjury that the information is accurate and you are the copyright owner or authorized agent; and (6) your physical or electronic signature.",
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Counter-Notice."},
            " If you believe your content was removed in error, you may submit a counter-notice containing: (1) identification of the removed material; (2) a statement under penalty of perjury that the removal was a mistake; (3) your name, address, and phone number; (4) consent to jurisdiction of the federal court in your district; and (5) your physical or electronic signature.",
        ],
    },
    {
        "type": "note",
        "variant": "red",
        "strong": "Warning:",
        "text": " Submitting a false DMCA notice or counter-notice may result in legal liability under 17 U.S.C. § 512(f), including damages and attorney's fees.",
    },
]

S["10"] = [
    {"type": "h2", "text": "10. Termination and Suspension"},
    {
        "type": "p",
        "segments": [
            {"strong": "By OxSteed."},
            " OxSteed may suspend or terminate your account at any time, with or without cause, and with or without notice. Grounds for termination include, but are not limited to: violation of these Terms, fraudulent or illegal activity, non-payment of fees, receiving multiple complaints from other users, or any conduct that OxSteed determines is harmful to the platform, other users, or third parties.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "By You."},
            " You may deactivate your account at any time through your account settings. Deactivation does not release you from any obligations incurred prior to deactivation, including pending Tier 3 escrow transactions or outstanding fees.",
        ],
    },
    {
        "type": "p",
        "segments": [{"strong": "Effect of Termination."}, " Upon termination:"],
    },
    {
        "type": "ul",
        "items": [
            ["Your right to access and use OxSteed ceases immediately;"],
            ["Any pending held funds will be handled according to the dispute resolution process in Section 16;"],
            ["OxSteed may retain your data as required by law or for legitimate business purposes (e.g., tax records, dispute evidence);"],
            ["Provisions that by their nature should survive termination will survive, including Sections 8, 9, 11, 12, 13, 16, and 20."],
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Appeal."},
            " If your account is suspended or terminated, you may appeal by contacting ",
            {"mailto": "legal@oxsteed.com"},
            " within 30 days. OxSteed will review your appeal and respond within 10 business days. OxSteed's decision on appeal is final.",
        ],
    },
]

S["11"] = [
    {"type": "h2", "text": "11. Disclaimer of Warranties"},
    {
        "type": "p",
        "uppercase": True,
        "text": (
            'THE OXSTEED PLATFORM, INCLUDING ALL CONTENT, FEATURES, AND SERVICES, IS PROVIDED ON AN "AS IS" AND "AS AVAILABLE" BASIS WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. TO THE FULLEST EXTENT PERMITTED BY LAW, OXSTEED DISCLAIMS ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, AND TITLE.'
        ),
    },
    {"type": "p", "text": "Without limiting the foregoing, OxSteed does not warrant that:"},
    {
        "type": "ul",
        "items": [
            ["The platform will be uninterrupted, timely, secure, or error-free;"],
            ["The results obtained from the platform will be accurate or reliable;"],
            ["Any Helper or Customer will perform their obligations;"],
            ["Any content on the platform is accurate, complete, or current;"],
            ["The platform will meet your specific requirements or expectations."],
        ],
    },
    {
        "type": "p",
        "text": "You use the platform at your own risk. No advice or information, whether oral or written, obtained from OxSteed or through the platform creates any warranty not expressly stated in these Terms.",
    },
]

S["12"] = [
    {"type": "h2", "text": "12. Liability Limitations and Insurance"},
    {
        "type": "p",
        "segments": [
            {"strong": "No Insurance Provided."},
            " OxSteed does not provide any insurance coverage for any Helper, Customer, or third party.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Limitation of Liability."},
            " TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, OXSTEED'S TOTAL LIABILITY FOR ANY CLAIM ARISING FROM OR RELATING TO THESE TERMS OR THE PLATFORM SHALL NOT EXCEED THE GREATER OF: (A) $100 USD, OR (B) THE TOTAL FEES PAID BY YOU TO OXSTEED IN THE 12 MONTHS PRECEDING THE CLAIM.",
        ],
    },
    {
        "type": "p",
        "text": "OXSTEED SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, PUNITIVE, OR EXEMPLARY DAMAGES.",
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Property Damage."},
            " OxSteed is not liable for any property damage caused by a Helper during the performance of services.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Personal Injury."},
            " OxSteed is not liable for any personal injury, death, or bodily harm arising from services arranged through the platform.",
        ],
    },
    {
        "type": "note",
        "variant": "red",
        "strong": "Ohio-Specific Notice:",
        "text": ' Ohio Revised Code § 4113.15 et seq. governs wage payment disputes between independent contractors and engaging parties. OxSteed is not an "employer" as defined under Ohio law.',
    },
]

S["13"] = [
    {"type": "h2", "text": "13. Indemnification"},
    {
        "type": "p",
        "text": "You agree to indemnify, defend, and hold harmless OxSteed LLC, its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorney's fees) arising out of or related to:",
    },
    {
        "type": "ul",
        "items": [
            ["Your use of or access to the OxSteed platform;"],
            ["Your violation of these Terms of Service;"],
            ["Your violation of any applicable law, rule, or regulation;"],
            ["Any content you post, upload, or transmit through the platform;"],
            ["Any service you perform or receive through the platform;"],
            ["Any dispute between you and another user;"],
            ["Your negligence or willful misconduct;"],
            ["Any third-party claim arising from your use of rented tools or equipment listed on the platform."],
        ],
    },
    {
        "type": "p",
        "text": "This indemnification obligation survives termination of your account and these Terms.",
    },
]

S["14"] = [
    {"type": "h2", "text": "14. Licensing Disclaimer"},
    {
        "type": "p",
        "segments": [
            {"strong": "No License Verification."},
            " OxSteed does not verify, validate, or guarantee that any Helper holds any professional license, permit, certification, or insurance required by federal, state, or local law to perform the services they advertise on the platform.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Customer Responsibility."},
            " Customers are solely responsible for independently verifying that any Helper they engage holds all licenses, permits, certifications, and insurance required by applicable law for the specific services to be performed. This includes, but is not limited to: electricians, plumbers, HVAC technicians, general contractors, roofers, and any other trade requiring state or local licensure.",
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Helper Responsibility."},
            " Helpers represent and warrant that they hold all licenses, permits, and certifications required by applicable law for the services they advertise. Listing services that require licensure without holding the appropriate license is a violation of these Terms and may result in immediate account termination.",
        ],
    },
    {
        "type": "note",
        "variant": "yellow",
        "strong": "Important:",
        "text": " A verified badge on OxSteed indicates only that a background check was completed. It does NOT indicate that a Helper is licensed, insured, or bonded for any particular trade.",
    },
]

S["15"] = [
    {"type": "h2", "text": "15. Tool Rental Listings — Special Terms"},
    {"type": "h3", "text": "15.1 Nature of Tool Rental Listings"},
    {
        "type": "p",
        "text": 'OxSteed permits users to post listings offering tools and equipment for temporary use by other users ("Tool Rental"). Tool Rental listings are a distinct category from labor service listings. When a Tool Rental transaction occurs, the listing owner ("Tool Owner") and the renting user ("Renter") enter into a direct bailment agreement governed by applicable state law.',
    },
    {
        "type": "p",
        "segments": [
            {"strong": "OxSteed is not a party to any Tool Rental agreement."},
            " OxSteed does not own, inspect, certify, maintain, or insure any tool or equipment listed on the platform. OxSteed facilitates the introduction only.",
        ],
    },
    {"type": "h3", "text": "15.2 Tool Owner Responsibilities"},
    {
        "type": "p",
        "text": "As a Tool Owner listing equipment on OxSteed, you represent, warrant, and agree that:",
    },
    {
        "type": "ul",
        "items": [
            ["You are the lawful owner of, or are authorized to rent out, all listed tools;"],
            ["All tools listed are in safe, functional working condition and are free from defects that could cause injury or property damage;"],
            ["You will disclose any known limitations, safety hazards, or operating requirements to the Renter before the rental begins;"],
            ["You are solely responsible for complying with any applicable local ordinances or regulations governing the rental of tools or equipment;"],
            ["Your homeowner's, renter's, or business insurance may not cover commercial tool lending and you should consult your insurer before listing tools;"],
            ["You are solely responsible for determining the rental price, deposit requirements, and return conditions;"],
            ["Any damage assessment, deposit dispute, or loss claim is entirely between you and the Renter."],
        ],
    },
    {"type": "h3", "text": "15.3 Renter Responsibilities"},
    {"type": "p", "text": "As a Renter of tools or equipment listed on OxSteed, you agree that:"},
    {
        "type": "ul",
        "items": [
            ["You will use all rented tools only for their intended, lawful purpose and in accordance with all manufacturer instructions and safety guidelines;"],
            ["You assume all risk of personal injury, property damage, and third-party harm arising from your use of any rented tool;"],
            ["You are responsible for returning tools in the same condition as received, normal wear and tear excepted;"],
            ["You are liable to the Tool Owner for any damage, loss, or theft of rented tools occurring while in your possession;"],
            ["You will not sub-rent, lend, or otherwise transfer possession of any rented tool to a third party without the Tool Owner's written consent."],
        ],
    },
    {"type": "h3", "text": "15.4 OxSteed's Limitation of Liability for Tool Rentals"},
    {
        "type": "p",
        "segments": [
            {"strong": "OxSteed expressly disclaims all liability"},
            " arising from or related to Tool Rental transactions, including but not limited to: personal injury or death caused by a defective or improperly used tool; property damage caused during tool use; loss, theft, or damage to rented tools; disputes between Tool Owners and Renters regarding condition, deposits, or return; and any claim by a third party injured by a rented tool.",
        ],
    },
    {
        "type": "p",
        "segments": [
            "OxSteed does not inspect, certify, or warrant the safety or condition of any tool listed on the platform. ",
            {"strong": "Renters and Tool Owners use the Tool Rental feature entirely at their own risk."},
        ],
    },
    {"type": "h3", "text": "15.5 Tier 3 Escrow for Tool Rentals"},
    {
        "type": "p",
        "text": "Tool Rental transactions may use Tier 3 payment protection for the rental fee. However, Tier 3 escrow covers only the agreed rental payment amount. Deposit disputes, damage claims, and loss recovery fall entirely outside the Tier 3 dispute process and must be resolved directly between Tool Owner and Renter or through applicable legal channels.",
    },
]

S["16"] = [
    {"type": "h2", "text": "16. OxSteed Pay — Payment Terms"},
    {"type": "h3", "text": "16.1 Mutual Opt-In Requirement"},
    {
        "type": "p",
        "segments": [
            "OxSteed Pay is ",
            {"strong": "never automatic"},
            ". It activates only when both the Customer and the Helper independently and affirmatively elect to use it for a specific, identified job. Neither party may unilaterally activate it on behalf of the other. OxSteed pay election is job-specific and does not apply to future jobs between the same parties.",
        ],
    },
    {"type": "h3", "text": "16.2 Nature of Held Funds"},
    {
        "type": "p",
        "segments": [
            "When the Customer submits payment to the helpers via OxSteed through Stripe Connect for the limited purpose of holding those funds pending completion of the job. These funds are held in a dedicated balance and ",
            {"strong": "remain the Customer's property until they are released in accordance with these Terms."},
            " Held funds are not OxSteed's assets and are not commingled with OxSteed's operating funds.",
        ],
    },
    {"type": "h3", "text": "16.3 Fund Release Triggers"},
    {"type": "p", "text": "Held funds will be released to the Helper when:"},
    {
        "type": "ul",
        "items": [
            [
                "Both the Customer ",
                {"strong": "and"},
                " the Helper confirm job completion through the platform within 12 hours; or",
            ],
            ["OxSteed issues a resolution decision in the Helper's favor following a dispute process; or"],
            [
                "The Customer fails to respond to a completion confirmation request within 48 hours of the Helper marking the job complete (funds auto-release after this window)."
            ],
        ],
    },
    {"type": "h3", "text": "16.4 Refund Triggers"},
    {"type": "p", "text": "Held funds will be refunded to the Customer when:"},
    {
        "type": "ul",
        "items": [
            ["Both parties mutually agree to cancel the job before work begins;"],
            ["The Helper fails to appear or abandons the job, as documented by the Customer;"],
            ["OxSteed issues a resolution decision in the Customer's favor following a dispute process;"],
            ["The job is cancelled by either party at least 24 hours before the scheduled start time."],
        ],
    },
    {"type": "h3", "text": "16.5 Platform Fees Deducted from Escrow"},
    {
        "type": "p",
        "text": "OxSteed deducts the following fees from escrowed funds before releasing the net amount to the Helper:",
    },
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Platform service fee:"},
                " 7.1% of the agreed job value (minimum $5.00)",
            ],
        ],
    },
    {"type": "feesNote", "strong": "All fees are disclosed to both parties.", "text": "No hidden fees will be charged."},
    {"type": "h3", "text": "16.6 No Interest on Held Funds"},
    {
        "type": "p",
        "text": "OxSteed does not pay interest on held funds to either party. Any interest or float accruing on escrow balances due to Stripe's payment processing timelines is retained by OxSteed as an administrative fee.",
    },
    {"type": "h3", "text": "16.7 Stripe Connected Account Agreement"},
    {
        "type": "stripeLinkP",
        "before": "Helpers must connect a Stripe Express account as a condition of eligibility to receive payment. By connecting a Stripe Express account, you agree to Stripe's ",
        "linkLabel": "Connected Account Agreement",
        "href": "https://stripe.com/legal/connect-account",
        "after": ", which includes Stripe's own terms, privacy policy, and compliance obligations. OxSteed is not a party to your agreement with Stripe and is not responsible for Stripe's actions, errors, or service interruptions.",
    },
    {"type": "h3", "text": "16.9 Platform Continuity"},
    {
        "type": "p",
        "text": "In the event OxSteed ceases operations, is acquired, or undergoes a change of control , OxSteed will make commercially reasonable efforts to either release held funds to the appropriate party, transfer escrow obligations to a successor entity, or refund all held amounts within 30 days of the triggering event. Users will be notified by email.",
    },
]

S["17"] = [
    {"type": "h2", "text": "17. Job Postings and Bid System"},
    {"type": "h3", "text": "17.1 Customer Job Postings"},
    {
        "type": "p",
        "text": "Customers may post job listings describing work they need performed. By posting a job listing, you represent that the work described is lawful, that you have authority to engage someone to perform it, and that the listing is accurate and not misleading. OxSteed reserves the right to remove any job listing for any reason without notice or liability.",
    },
    {
        "type": "p",
        "text": "Posting a job listing creates no obligation to accept any bid or engage any Helper. Customers may close a listing, modify it, or decline all bids at their sole discretion.",
    },
    {"type": "h3", "text": "17.2 Helper Bids"},
    {
        "type": "p",
        "text": "Helpers may submit bids on posted job listings. By submitting a bid, you represent that:",
    },
    {
        "type": "ul",
        "items": [
            ["You are genuinely available and qualified to perform the described work;"],
            ["Your bid price is accurate and reflects your all-in cost to the Customer;"],
            ["You hold any licenses, permits, or certifications required to legally perform the work in the applicable jurisdiction."],
        ],
    },
    {"type": "p", "text": "Submitting a bid is an offer, not a contract."},
    {"type": "h3", "text": "17.3 Cancellation of Active Bids"},
    {
        "type": "p",
        "text": "If a Customer removes a job listing or cancels it after bids have been submitted but before a bid is accepted, all pending bids are automatically voided. Helpers have no claim against OxSteed or the Customer for bid cancellations.",
    },
    {"type": "h3", "text": "17.4 No Guarantee of Job Volume"},
    {
        "type": "p",
        "text": "OxSteed makes no representation, warranty, or guarantee that any Helper at any tier will receive bids, leads, job offers, or income of any amount. Subscription fees are for platform access and features, not for guaranteed work volume.",
    },
]

S["18"] = [
    {"type": "h2", "text": "18. Third-Party Services"},
    {
        "type": "p",
        "text": "OxSteed integrates with or relies on the following third-party services, each of which is subject to its own terms and privacy policies:",
    },
    {
        "type": "ul",
        "items": [
            [{"strong": "Stripe, Inc."}, " — Payment processing and connected accounts "],
            [{"strong": "Checkr, Inc."}, " — Background check and consumer reporting services"],
            [{"strong": "Resend"}, " — Transactional email delivery"],
        ],
    },
    {
        "type": "p",
        "text": "OxSteed is not responsible for the availability, accuracy, security, or performance of any third-party service. Your use of third-party services through OxSteed is subject to the applicable third-party terms. OxSteed shall not be liable for any loss or damage caused by a third-party service provider's acts, omissions, or service interruptions.",
    },
]

S["19"] = [
    {"type": "h2", "text": "19. Consent and Acceptance"},
    {
        "type": "p",
        "text": 'By creating an OxSteed account, you confirm that you have read, understood, and agree to be bound by these Terms of Service. Your click of "Create Account" or "Continue" constitutes a legally binding electronic signature under the E-SIGN Act, 15 U.S.C. § 7001 et seq.',
    },
    {
        "type": "p",
        "text": "If you do not agree to these Terms, do not create an account or use the OxSteed platform.",
    },
]

S["20"] = [
    {"type": "h2", "text": "20. Modifications to These Terms"},
    {
        "type": "p",
        "text": "OxSteed may update these Terms at any time. We will notify users of material changes by email at least 14 days before the changes take effect. Continued use of the platform after the effective date of updated Terms constitutes acceptance of the new Terms. If you do not agree to the updated Terms, you must stop using the platform and deactivate your account.",
    },
]

SEARCH_META = {
    "1": "1 what oxsteed is not customers helpers directory cda 230",
    "2": "2 eligibility 18 account united states",
    "3": "3 platform tiers tier 1 tier 2 stripe pro subscription",
    "4": "4 tool rental addendum owner renter damage safety",
    "5": "5 user roles customer helper independent contractor",
    "6": "6 fees payment subscription w-9 1099 refunds dispute 16",
    "7": "7 background check fcra checkr adverse action badge verified",
    "8": "8 independent contractor employment taxes insurance",
    "9": "9 intellectual property dmca copyright trademark legal@oxsteed.com",
    "10": "10 termination suspension deactivate appeal escrow legal",
    "11": "11 disclaimer warranties as is available merchantability",
    "12": "12 liability insurance limitation damages ohio 4113",
    "13": "13 indemnification claims attorney fees tools",
    "14": "14 licensing disclaimer license verified badge electrician",
    "15": "15 tool rental listings bailment tier 3 escrow renter owner",
    "16": "16 oxsteed pay stripe connect escrow held funds refund stripe express dispute",
    "17": "17 job postings bids cancellation volume subscription",
    "18": "18 third-party stripe checkr resend services",
    "19": "19 consent acceptance e-sign create account continue",
    "20": "20 modifications terms update email notice deactivate",
}

assert set(S.keys()) == {str(i) for i in range(1, 21)}
sections_out = {
    k: {"search": SEARCH_META[k], "blocks": v} for k, v in S.items()
}
OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", encoding="utf-8") as f:
    json.dump({"sections": sections_out}, f, ensure_ascii=False, indent=2)
print("Wrote", OUT, "chars", OUT.stat().st_size)
