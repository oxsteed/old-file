// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-qr-payments",
  "area": "financial",
  "slug": "financial-qr-payments",
  "title": "Get paid by QR and pay by QR",
  "audiences": [
    "helper",
    "business",
    "customer"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Create reusable QR payment codes as a helper or business, and pay someone by scanning or opening their QR link.",
  "intendedRoles": [
    "Helper",
    "Business owner",
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "Sign in to create or manage payment QR codes.",
      "href": "/login"
    },
    {
      "text": "Payers need no OxSteed account: \"Secure payment powered by Stripe. You do not need an account.\"",
      "href": "/qr-generator"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "setup",
        "label": "Open QR payments",
        "type": "terminal"
      },
      {
        "id": "connect",
        "label": "Connect payouts",
        "type": "step"
      },
      {
        "id": "create",
        "label": "Create a payment QR code",
        "type": "step"
      },
      {
        "id": "share",
        "label": "Share the QR code or link",
        "type": "step"
      },
      {
        "id": "pay",
        "label": "Payer opens the link and pays",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Payment confirmed",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "setup",
        "to": "connect"
      },
      {
        "from": "connect",
        "to": "create"
      },
      {
        "from": "create",
        "to": "share"
      },
      {
        "from": "share",
        "to": "pay"
      },
      {
        "from": "pay",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open /qr-payments (\"Get paid with QR codes\": \"Create QR codes your customers can scan to pay you directly. No app needed on their side.\"). First connect payouts with \"Connect payouts\". Then create a code under \"Create a payment QR code\" with a \"Label\" and either \"Customer enters amount\" or \"Fixed amount\". Manage codes under \"Your payment QR codes\" (Copy link, Download, Print, Activate/Deactivate, Delete). The payer opens /pay/:code, enters the amount if needed, and pays through the secure checkout step.",
  "steps": [
    {
      "id": "financial-qr-payments-s1",
      "title": "Open QR payments and connect payouts",
      "body": "Open /qr-payments. If payouts are not connected, you see \"Connect payouts first\" (\"To receive QR payments, connect your bank account with our secure payment partner. It takes a few minutes.\"). Choose \"Connect payouts\" and finish the partner setup. If the setup is incomplete you see \"Finish Stripe setup\" with \"Continue in Stripe\".",
      "expectedResult": "The create form and your code list unlock once payouts are connected.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/qr-payments",
          "state": "QR payments setup with connect gate, light mode",
          "alt": "QR payments page prompting to connect payouts",
          "caption": "Connecting payouts, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/qr-payments",
          "state": "QR payments setup with connect gate, light mode",
          "alt": "Connect gate on a phone screen",
          "caption": "Connecting payouts, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-qr-payments-s2",
      "title": "Create a payment QR code",
      "body": "Under \"Create a payment QR code\", enter a \"Label\" (\"e.g. Lawn mowing, Bakery pickup\"). Under \"Amount\", pick \"Customer enters amount\" (\"The customer chooses how much to pay when they scan.\") or \"Fixed amount\" (\"Every scan pays the same amount.\") and enter the \"Amount (USD)\". Choose \"Create QR code\".",
      "expectedResult": "The new code appears under \"Your payment QR codes\" with its pay link.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/qr-payments",
          "state": "Create QR code form with amount options, light mode",
          "alt": "Create form with label and amount mode cards",
          "caption": "Creating a payment QR code, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/qr-payments",
          "state": "Create QR code form with amount options, light mode",
          "alt": "Create form on a phone screen",
          "caption": "Creating a payment QR code, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-qr-payments-s3",
      "title": "Manage and share your codes",
      "body": "Under \"Your payment QR codes\", each card shows the label, the \"Active\"/\"Inactive\" badge, the amount (\"Open amount\" for flexible codes), the total received, and the payment count. Use \"Copy link\" to share the pay URL, \"Download\" or \"Print\" for the QR image, the \"Activate\"/\"Deactivate\" toggle to control availability, and \"Delete\" to remove a code.",
      "expectedResult": "The code is shared or printed and ready to scan.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/qr-payments",
          "state": "Payment QR code cards with actions, light mode",
          "alt": "Code cards with copy, download, print, and toggle actions",
          "caption": "Managing QR codes, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/qr-payments",
          "state": "Payment QR code cards with actions, light mode",
          "alt": "Code cards on a phone screen",
          "caption": "Managing QR codes, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-qr-payments-s4",
      "title": "Pay through a QR link as a payer",
      "body": "Open the pay link (/pay/:code) or scan the QR. You see \"Pay\" plus the recipient name and either \"Amount to pay\" (fixed) or \"Amount (USD)\" (\"Enter amount\") for flexible codes. Optionally enter the \"Email for receipt (optional)\" (\"you@example.com\"). Choose the \"Pay\" button (\"Pay X\") to continue to the secure checkout step. If the recipient accepts credit, you may also see \"Pay with OxSteed Credit\".",
      "expectedResult": "You move to the secure checkout step; OxSteed returns you when the payment completes.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/pay/:code",
          "state": "Pay by QR page with amount and email, light mode",
          "alt": "Payer form with amount and pay button",
          "caption": "Paying through a QR link, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/pay/:code",
          "state": "Pay by QR page with amount and email, light mode",
          "alt": "Payer form on a phone screen",
          "caption": "Paying through a QR link, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-qr-payments-s5",
      "title": "Confirm the payment succeeded",
      "body": "After the payment completes you see \"Payment successful\" with the amount and recipient, and \"Back to home\". If the link expired, you see \"Payment link unavailable\" with \"Try again\" on the current link.",
      "expectedResult": "The recipient sees the payment in their code stats and the payer has confirmation.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/pay/:code",
          "state": "Payment successful confirmation, light mode",
          "alt": "Payment successful screen",
          "caption": "Payment confirmed, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/pay/:code",
          "state": "Payment successful confirmation, light mode",
          "alt": "Success on a phone screen",
          "caption": "Payment confirmed, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The code exists under \"Your payment QR codes\", and payments show \"Payment successful\" with updated received totals on the card.",
  "recovery": [
    {
      "problem": "You see \"Could not load your QR codes.\"",
      "solution": "Choose \"Retry\" to reload the list."
    },
    {
      "problem": "A payer sees \"Payment link unavailable\".",
      "solution": "The code was deactivated or deleted. Reactivate it with the \"Activate\" toggle, or share a new link with \"Copy link\"."
    },
    {
      "problem": "The checkout step does not finish.",
      "solution": "Return to /pay/:code and try again. OxSteed only counts the payment once the checkout step completes."
    }
  ],
  "supportContact": "For QR payment issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-oxsteed-credit",
    "financial-receipts"
  ],
  "siteLinks": [
    {
      "label": "QR payments",
      "href": "/qr-payments"
    },
    {
      "label": "QR generator",
      "href": "/qr-generator"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/qr-payments"
    },
    {
      "type": "route",
      "ref": "/pay/:code"
    },
    {
      "type": "route",
      "ref": "/pay/:code/success"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/QrPaySetupPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/PayByQrPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/QRCodeGeneratorPage.jsx"
    }
  ]
};
