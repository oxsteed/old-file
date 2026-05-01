#!/usr/bin/env python3
"""Build client/src/locales/privacy/en.content.json from the canonical English privacy policy."""
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src/locales/privacy/en.content.json"

S = {}

S["1"] = [
    {"type": "h2", "text": "1. Introduction"},
    {
        "type": "p",
        "text": (
            'OxSteed LLC ("OxSteed," "we," "us," or "our") operates the OxSteed platform at oxsteed.com. This Privacy Policy explains what personal information we collect, how we use it, how we share it, and your rights regarding your data.'
        ),
    },
    {
        "type": "p",
        "text": "By creating an account or using OxSteed, you consent to the collection and use of your information as described in this Privacy Policy. If you do not agree, do not use the platform.",
    },
]

S["2"] = [
    {"type": "h2", "text": "2. Information We Collect"},
    {"type": "h3", "text": "2.1 Information You Provide"},
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Account registration:"},
                " Name, email address, phone number, password, role (Customer or Helper), and location (city, state, zip code).",
            ],
            [
                {"strong": "Profile information:"},
                " Profile photo, bio, skills, service categories, hourly rates, and availability.",
            ],
            [
                {"strong": "Payment information:"},
                " Stripe processes all payments. OxSteed does not store credit card numbers. We store Stripe customer IDs and connected account IDs.",
            ],
            [
                {"strong": "Background check data:"},
                " If you elect a background check, Checkr, Inc. collects and processes your personal data under its own privacy policy. OxSteed receives only pass/fail status and badge eligibility.",
            ],
            [
                {"strong": "Communications:"},
                " Messages sent through the platform, support requests, and feedback.",
            ],
            [
                {"strong": "Job and bid data:"},
                " Job descriptions, bid amounts, completion status, and reviews.",
            ],
            [
                {"strong": "Tax information:"},
                " IRS Form W-9 data (name, address, SSN/EIN) for Helpers earning $600+ annually through Tier 3.",
            ],
        ],
    },
    {"type": "h3", "text": "2.2 Information Collected Automatically"},
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Device and browser data:"},
                " IP address, browser type, operating system, device identifiers, and screen resolution.",
            ],
            [
                {"strong": "Usage data:"},
                " Pages viewed, features used, search queries, click patterns, and session duration.",
            ],
            [
                {"strong": "Location data:"},
                " Approximate location derived from IP address and zip code provided during registration.",
            ],
            [
                {"strong": "Cookies and tracking:"},
                " We use essential cookies for authentication and session management. See Section 8 for details.",
            ],
        ],
    },
    {"type": "h3", "text": "2.3 Information from Third Parties"},
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Stripe:"},
                " Payment status, transaction IDs, and connected account status.",
            ],
            [
                {"strong": "Checkr:"},
                " Background check completion status and badge eligibility (not the underlying report details).",
            ],
        ],
    },
]

S["3"] = [
    {"type": "h2", "text": "3. How We Use Your Information"},
    {"type": "p", "text": "We use the information we collect for the following purposes:"},
    {
        "type": "ul",
        "items": [
            ["To create, maintain, and secure your account;"],
            ["To connect Customers with Helpers and facilitate service transactions;"],
            ["To process payments through Stripe (Tier 3 escrow);"],
            ["To facilitate background checks through Checkr;"],
            ["To send transactional emails (job alerts, payment confirmations, account notifications);"],
            ["To comply with tax reporting obligations (IRS Form 1099-NEC);"],
            ["To enforce our Terms of Service and prevent fraud;"],
            ["To improve and develop the platform;"],
            ["To respond to legal requests and prevent harm;"],
            ["To send service-related communications (you may not opt out of these while your account is active)."],
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "We do not sell your personal information."},
            " We do not use your data for targeted advertising. We do not share your data with data brokers.",
        ],
    },
]

S["4"] = [
    {"type": "h2", "text": "4. How We Share Your Information"},
    {
        "type": "p",
        "text": "We share your personal information only in the following circumstances:",
    },
    {
        "type": "ul",
        "items": [
            [
                {"strong": "With other users:"},
                " Your profile information (name, photo, skills, reviews, badge status) is visible to other users. Your full address is shared only with Helpers who have accepted a job, and only within 12 hours of the job start time.",
            ],
            [
                {"strong": "With Stripe, Inc.:"},
                " Payment and identity data necessary to process transactions and manage connected accounts.",
            ],
            [
                {"strong": "With Checkr, Inc.:"},
                " Personal data necessary to conduct background checks (only with your separate, affirmative consent under FCRA).",
            ],
            [
                {"strong": "With Resend:"},
                " Email address and name for transactional email delivery.",
            ],
            [
                {"strong": "With law enforcement:"},
                " When required by law, subpoena, court order, or to protect the rights, property, or safety of OxSteed, its users, or the public.",
            ],
            [
                {"strong": "In a business transfer:"},
                " If OxSteed is acquired, merged, or sells assets, user data may be transferred to the successor entity. We will notify you by email before your data is subject to a different privacy policy.",
            ],
        ],
    },
]

S["5"] = [
    {"type": "h2", "text": "5. Address Privacy and Data Masking"},
    {
        "type": "p",
        "text": "When a Customer posts a job, their full street address is never displayed publicly. A Helper receives the Customer's full address only after:",
    },
    {
        "type": "ul",
        "items": [
            ["The Helper has been accepted for the job; AND"],
            ["The job is scheduled to begin within 12 hours."],
        ],
    },
    {
        "type": "p",
        "text": "All address reveals are logged with timestamps, user IDs, and IP addresses for security and audit purposes.",
    },
]

S["6"] = [
    {"type": "h2", "text": "6. Data Retention"},
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Active accounts:"},
                " Data is retained for as long as your account is active.",
            ],
            [
                {"strong": "Closed accounts:"},
                " Account data is retained for 3 years after account closure for tax compliance, legal obligations, and dispute resolution purposes.",
            ],
            [
                {"strong": "Tax records (W-9, 1099-NEC):"},
                " Retained for 7 years as required by IRS regulations.",
            ],
            [
                {"strong": "Escrow transaction records:"},
                " Retained for 5 years after the transaction date.",
            ],
            [
                {"strong": "Audit logs:"},
                " Security and access logs are retained for 2 years.",
            ],
            [
                {"strong": "Background check status:"},
                " Badge expiration is 12 months. Underlying check data is held by Checkr under its own retention policy.",
            ],
        ],
    },
]

S["7"] = [
    {"type": "h2", "text": "7. Your Rights"},
    {
        "type": "p",
        "text": "Depending on your state of residence, you may have the following rights regarding your personal information:",
    },
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Right to know:"},
                " Request a copy of the personal information we hold about you.",
            ],
            [
                {"strong": "Right to delete:"},
                " Request deletion of your personal information, subject to legal retention obligations.",
            ],
            [
                {"strong": "Right to correct:"},
                " Request correction of inaccurate personal information.",
            ],
            [
                {"strong": "Right to opt out of sale:"},
                " We do not sell personal information. No action is needed.",
            ],
            [
                {"strong": "Right to non-discrimination:"},
                " We will not discriminate against you for exercising your privacy rights.",
            ],
        ],
    },
    {
        "type": "p",
        "segments": [
            'To exercise any of these rights, email ',
            {"mailto": "legal@oxsteed.com"},
            ' with the subject line "Privacy Rights Request." We will respond within 30 days. We may need to verify your identity before processing your request.',
        ],
    },
    {
        "type": "note",
        "variant": "yellow",
        "strong": "California residents (CCPA/CPRA):",
        "segments": [
            " You have additional rights under the California Consumer Privacy Act and the California Privacy Rights Act. See our ",
            {
                "routeLink": {
                    "to": "/do-not-sell",
                    "label": "Do Not Sell or Share My Personal Information",
                }
            },
            " page for details.",
        ],
    },
]

S["8"] = [
    {"type": "h2", "text": "8. Cookies and Tracking Technologies"},
    {"type": "p", "text": "OxSteed uses the following categories of cookies:"},
    {
        "type": "ul",
        "items": [
            [
                {"strong": "Essential cookies:"},
                " Required for authentication, session management, and security. These cannot be disabled.",
            ],
            [
                {"strong": "Functional cookies:"},
                " Remember your preferences (e.g., dark mode, location). You may disable these in your browser settings.",
            ],
        ],
    },
    {
        "type": "p",
        "segments": [
            "OxSteed does ",
            {"strong": "not"},
            " use advertising cookies, retargeting pixels, or third-party tracking scripts. We do not participate in ad networks or sell data to advertisers.",
        ],
    },
]

S["9"] = [
    {"type": "h2", "text": "9. Data Security and Breach Notification"},
    {
        "type": "p",
        "text": "OxSteed implements commercially reasonable security measures to protect your personal information, including:",
    },
    {
        "type": "ul",
        "items": [
            ["Encryption in transit (TLS/HTTPS) and at rest for sensitive data;"],
            ["Bcrypt password hashing with salting;"],
            ["JWT-based authentication with secure, HTTP-only cookies;"],
            ["Rate limiting on authentication endpoints;"],
            ["Role-based access controls;"],
            ["Audit logging of security-sensitive actions."],
        ],
    },
    {
        "type": "p",
        "segments": [
            {"strong": "Breach notification:"},
            " In the event of a data breach that compromises your personal information, OxSteed will notify affected users by email within 72 hours of discovering the breach and will notify applicable state attorneys general as required by law.",
        ],
    },
]

S["10"] = [
    {"type": "h2", "text": "10. Account Deletion"},
    {
        "type": "p",
        "segments": [
            "You may request deletion of your account at any time through your account settings or by emailing ",
            {"mailto": "legal@oxsteed.com"},
            ".",
        ],
    },
    {"type": "p", "text": "Upon deletion:"},
    {
        "type": "ul",
        "items": [
            ["Your profile, messages, and personal data will be permanently removed within 30 days;"],
            ["Reviews you have left for others will be anonymized but not deleted;"],
            ["Tax records (W-9, 1099-NEC) will be retained for the legally required period;"],
            ["Escrow transaction records will be retained for audit purposes;"],
            ["Active Tier 3 escrow transactions must be completed or resolved before deletion can proceed."],
        ],
    },
]

S["11"] = [
    {"type": "h2", "text": "11. Children's Privacy"},
    {
        "type": "p",
        "segments": [
            "OxSteed is not intended for use by anyone under the age of 18. We do not knowingly collect personal information from children under 18. If we discover that we have collected personal information from a child under 18, we will delete it immediately. If you believe a child under 18 has provided us personal information, contact us at ",
            {"mailto": "legal@oxsteed.com"},
            ".",
        ],
    },
]

S["12"] = [
    {"type": "h2", "text": "12. Changes to This Privacy Policy"},
    {
        "type": "p",
        "text": 'OxSteed may update this Privacy Policy at any time. We will notify users of material changes by email at least 14 days before the changes take effect. The "Last updated" date at the top of this page reflects the most recent revision.',
    },
]

S["13"] = [
    {"type": "h2", "text": "13. Contact Us"},
    {
        "type": "p",
        "text": "For questions about this Privacy Policy or to exercise your privacy rights, contact us at:",
    },
    {"type": "p", "text": "OxSteed LLC"},
    {"type": "p", "text": "Springfield, Ohio"},
    {
        "type": "p",
        "segments": [{"mailto": "legal@oxsteed.com"}],
    },
]

SEARCH_META = {
    "1": "1 introduction oxsteed personal information collect",
    "2": "2 information collect registration stripe checkr cookies device",
    "3": "3 how we use information account payments tax advertising sell",
    "4": "4 share information stripe checkr resend law enforcement address",
    "5": "5 address privacy masking street 12 hours helper job",
    "6": "6 data retention w-9 1099 escrow audit logs closed account",
    "7": "7 your rights delete correct california ccpa cpra opt out",
    "8": "8 cookies tracking essential functional advertising",
    "9": "9 security breach notification tls bcrypt jwt 72 hours",
    "10": "10 account deletion profile anonymized escrow tier 3",
    "11": "11 children privacy under 18 minors",
    "12": "12 changes privacy policy email 14 days updated",
    "13": "13 contact us springfield legal@oxsteed.com",
}

assert set(S.keys()) == {str(i) for i in range(1, 14)}
sections_out = {k: {"search": SEARCH_META[k], "blocks": v} for k, v in S.items()}
OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", encoding="utf-8") as f:
    json.dump({"sections": sections_out}, f, ensure_ascii=False, indent=2)
print("Wrote", OUT, "chars", OUT.stat().st_size)
