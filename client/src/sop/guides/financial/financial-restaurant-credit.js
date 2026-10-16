// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-restaurant-credit",
  "area": "financial",
  "slug": "financial-restaurant-credit",
  "title": "Use Restaurant Credit (per-restaurant wallets)",
  "audiences": [
    "customer",
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Use per-restaurant credit balances: top up by card, request credit with proof, pay by QR, and send credit, as a customer or a restaurant.",
  "intendedRoles": [
    "Customer",
    "Restaurant owner",
    "Restaurant manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in to your OxSteed account.",
      "href": "/login"
    },
    {
      "text": "Understand the separation: Restaurant Credit is per-restaurant. OxSteed Credit is the platform wallet. They are different systems.",
      "guideId": "financial-wallet",
      "href": "/wallet"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open Restaurant Credit",
        "type": "terminal"
      },
      {
        "id": "choose",
        "label": "Choose a restaurant",
        "type": "step"
      },
      {
        "id": "fund",
        "label": "Fund it: card top-up, proof request, or grant",
        "type": "step"
      },
      {
        "id": "approved",
        "label": "Credit approved?",
        "type": "decision"
      },
      {
        "id": "use",
        "label": "Use it: QR payment or send to another user",
        "type": "step"
      },
      {
        "id": "manage",
        "label": "Restaurant: approve, grant, and refund",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Credit used and tracked",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "choose"
      },
      {
        "from": "choose",
        "to": "fund"
      },
      {
        "from": "fund",
        "to": "approved"
      },
      {
        "from": "approved",
        "to": "use",
        "label": "Yes"
      },
      {
        "from": "approved",
        "to": "fund",
        "label": "No, correct and retry"
      },
      {
        "from": "use",
        "to": "manage"
      },
      {
        "from": "manage",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open /restaurant-credit (\"Restaurant Credit\": \"Manage restaurant-scoped credit, payments, transfers, and requests.\"). Choose a restaurant; each balance belongs to one restaurant and cannot be spent elsewhere. Fund it three ways: \"Add money\" tops up by card, \"Add credit\" sends payment proof for approval, or the restaurant grants it directly. Once funded, use \"Use credit\" to pay by one-time QR, or \"More credit options\" to \"Send credit to another OxSteed user\". Restaurants approve requests and grant or refund credit from the \"Restaurant credit\" manager.",
  "steps": [
    {
      "id": "financial-restaurant-credit-s1",
      "title": "Open Restaurant Credit and choose a restaurant",
      "body": "Open /restaurant-credit. The page notes the scope: \"Restaurant-scoped wallet\" and \"Each balance belongs to one restaurant. It cannot be spent or transferred at another restaurant.\" Choose the restaurant to see \"Available to spend\" and the \"Restaurant credit actions\".",
      "expectedResult": "You see the wallet for one restaurant with its balance and actions.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit page with restaurant selected, light mode",
          "alt": "Restaurant credit page with balance and actions",
          "caption": "Restaurant Credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit page with restaurant selected, light mode",
          "alt": "Restaurant credit on a phone screen",
          "caption": "Restaurant Credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s2",
      "title": "Top up by card",
      "body": "Choose \"Add money\" (\"Top up with a card\"). In the \"Add money\" dialog, enter the \"Amount\" within the shown range (\"Between X and Y per top-up.\"; typically $5 to $500 per top-up with a $1,000 per day per restaurant cap). Choose \"Continue\", complete the card payment step, and for larger top-ups enter the emailed \"Verification code\" and choose \"Verify and continue\". You see \"Top-up complete. Your wallet has been updated.\"",
      "expectedResult": "The wallet balance increases by the topped-up amount.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Add money card top-up dialog, light mode",
          "alt": "Card top-up dialog with amount field",
          "caption": "Topping up by card, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Add money card top-up dialog, light mode",
          "alt": "Top-up dialog on a phone screen",
          "caption": "Topping up by card, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s3",
      "title": "Request credit with payment proof",
      "body": "Choose \"Add credit\" (\"Send payment proof for approval\"). In \"Add restaurant credit\" (\"Send proof of your payment. The restaurant will add the credit after verifying it.\"), enter the \"Amount you paid\", choose \"Upload receipt\" (\"Choose screenshot, receipt, or PDF\") or \"Enter confirmation\" (\"Confirmation number or sender name\"), add a note if helpful, and choose \"Send for approval\". Track it under \"Add credit requests\"; you can \"Cancel\" a pending request.",
      "expectedResult": "You see \"Credit request sent to the restaurant.\"",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Add credit proof request form, light mode",
          "alt": "Credit request form with proof options",
          "caption": "Requesting credit with proof, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Add credit proof request form, light mode",
          "alt": "Credit request on a phone screen",
          "caption": "Requesting credit with proof, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s4",
      "title": "Pay with a one-time QR",
      "body": "Choose \"Use credit\" (\"Create a one-time payment QR\"). Enter the \"Amount\" (within \"Available: X\") and choose \"Create payment QR\". In \"Pay with restaurant credit\" (\"Show this one-time QR to the restaurant. The reserved amount cannot be spent twice.\"), show the QR to the staff. Use \"Cancel and release credit\" if the payment does not go through.",
      "expectedResult": "The restaurant scans the QR, the hold is captured, and the balance drops by the amount.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "One-time payment QR displayed, light mode",
          "alt": "Payment QR shown to the restaurant",
          "caption": "Paying with a one-time QR, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "One-time payment QR displayed, light mode",
          "alt": "Payment QR on a phone screen",
          "caption": "Paying with a one-time QR, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s5",
      "title": "Send credit to another OxSteed user",
      "body": "Choose \"More credit options\" then \"Send credit to another OxSteed user\" (\"The recipient can only spend this credit at this restaurant.\"). Enter the \"Recipient's OxSteed email\", the amount, and an optional \"Memo\", then choose \"Send credit\". You see \"Restaurant credit sent.\"",
      "expectedResult": "The recipient receives the credit at the same restaurant.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Send restaurant credit dialog, light mode",
          "alt": "Send credit dialog with recipient email",
          "caption": "Sending restaurant credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Send restaurant credit dialog, light mode",
          "alt": "Send credit on a phone screen",
          "caption": "Sending restaurant credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s6",
      "title": "Approve or decline credit requests as a restaurant",
      "body": "On the restaurant dashboard, open the \"Restaurant credit\" manager (\"Customer balances\"; \"Approve credit only after matching the customer's receipt or confirmation number.\"). On a pending request, use \"View receipt\" to check the proof, then \"Approve credit\" (\"Payment matched?\" then \"Yes, add credit\") or \"Decline\" with a reason (\"Reason, for example: receipt amount does not match\").",
      "expectedResult": "Approved credit lands in the customer wallet immediately.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Restaurant credit manager with pending requests, light mode",
          "alt": "Credit manager with request review actions",
          "caption": "Reviewing credit requests, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Restaurant credit manager with pending requests, light mode",
          "alt": "Credit manager on a phone screen",
          "caption": "Reviewing credit requests, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s7",
      "title": "Grant or refund credit as a restaurant",
      "body": "In the manager, choose \"Grant credit\" for a direct grant: enter \"Customer email\", \"Amount\", and a required \"Explanation\" (\"Why is this credit being added? e.g. comp for wrong order\"), then \"Review grant\" and \"Yes, grant credit\". Choose \"Refund credit\" to return money: enter \"Customer email\" and \"Amount\", add a \"Reason\", then \"Review refund\" and \"Yes, refund\". Refunds deduct the wallet and send money back to the card; only credit issued in the last 30 days can be refunded.",
      "expectedResult": "The customer wallet updates and every grant records its explanation on the audit trail.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Grant credit form, light mode",
          "alt": "Grant credit form with explanation",
          "caption": "Granting credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Grant credit form, light mode",
          "alt": "Grant form on a phone screen",
          "caption": "Granting credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-restaurant-credit-s8",
      "title": "Review activity and statements",
      "body": "The \"Activity\" section shows approved credit, purchases, transfers, and refunds; \"Transfer history (X)\" lists sends and receives. Follow \"Statements\" for issued monthly statements, or open /restaurant-credit/statements directly.",
      "expectedResult": "You can reconcile every balance change with its timestamp and type.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit activity list, light mode",
          "alt": "Activity section with credit events",
          "caption": "Reviewing activity, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit activity list, light mode",
          "alt": "Activity on a phone screen",
          "caption": "Reviewing activity, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The restaurant wallet shows the right balance, payments and transfers post to the activity feed, and disputes or refunds resolve.",
  "recovery": [
    {
      "problem": "Card top-up fails.",
      "solution": "You see \"The card payment did not go through. Please check the card details and try again.\" Check the card details and that the amount is within the shown min and max, then retry."
    },
    {
      "problem": "A credit request stays pending.",
      "solution": "The restaurant has not verified your proof yet. Use \"Cancel\" on the request and resubmit with a clearer receipt or the exact confirmation number."
    },
    {
      "problem": "You see \"Amount exceeds the available balance.\"",
      "solution": "Lower the QR amount to the available balance, or top up first."
    },
    {
      "problem": "A refund cannot be processed.",
      "solution": "Only credit issued in the last 30 days can be refunded. If the card refund fails, the wallet balance is left untouched."
    }
  ],
  "supportContact": "For restaurant credit issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-wallet",
    "financial-oxsteed-credit",
    "restaurant-ordering",
    "restaurant-refund-requests",
    "financial-statements"
  ],
  "siteLinks": [
    {
      "label": "Restaurant credit",
      "href": "/restaurant-credit"
    },
    {
      "label": "Wallet",
      "href": "/wallet"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurant-credit"
    },
    {
      "type": "route",
      "ref": "/restaurant-credit/statements"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantCreditPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantCreditManager.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantCreditFundingPanel.jsx"
    }
  ]
};
