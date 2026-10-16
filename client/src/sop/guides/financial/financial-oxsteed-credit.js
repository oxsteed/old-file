// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-oxsteed-credit",
  "area": "financial",
  "slug": "financial-oxsteed-credit",
  "title": "Use OxSteed Credit (top-ups, transfers, withdrawals, cards)",
  "audiences": [
    "customer"
  ],
  "revision": 2,
  "availability": "conditional",
  "conditions": [
    "OxSteed Credit requires the oxsteed_credit_enabled feature flag. It is ON in production as of 2026-10-11. If the rail is off, the page shows \"OxSteed Credit is temporarily paused\" and spending, top-ups, and withdrawals stay paused while balances and history remain visible."
  ],
  "goal": "Use your OxSteed Credit account: top up, withdraw, convert, authorize in-store payments, move value with restaurants, and manage cards.",
  "intendedRoles": [
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "Sign in to your OxSteed account.",
      "href": "/login"
    },
    {
      "text": "Check the wallet overview to see your current balance.",
      "guideId": "financial-wallet",
      "href": "/wallet"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open OxSteed Credit",
        "type": "terminal"
      },
      {
        "id": "rail",
        "label": "Rail enabled?",
        "type": "decision"
      },
      {
        "id": "paused",
        "label": "Paused: read-only balances and history",
        "type": "blocked"
      },
      {
        "id": "limits",
        "label": "Check spending guardrails",
        "type": "step"
      },
      {
        "id": "move",
        "label": "Top up, withdraw, convert, or authorize",
        "type": "step"
      },
      {
        "id": "cards",
        "label": "Manage cards",
        "type": "step"
      },
      {
        "id": "activity",
        "label": "Review activity and report problems",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Credit managed",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "rail"
      },
      {
        "from": "rail",
        "to": "limits",
        "label": "Yes"
      },
      {
        "from": "rail",
        "to": "paused",
        "label": "No"
      },
      {
        "from": "limits",
        "to": "move"
      },
      {
        "from": "move",
        "to": "cards"
      },
      {
        "from": "cards",
        "to": "activity"
      },
      {
        "from": "activity",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open /oxsteed-credit. If the rail is enabled, check \"Your spending guardrails\" for the daily limits. Then move money: top up from /wallet with \"Add money\", withdraw to your bank with \"Request withdrawal\", convert currencies with an approved quote in \"Convert Credit\", or create an in-store authorization and give the hold ID to the cashier. Manage virtual and physical cards at /oxsteed-credit/cards. Review \"Recent activity\" and use \"Report a problem\" on any transaction. If the rail is paused, the page shows the pause banner and balances stay read-only.",
  "steps": [
    {
      "id": "financial-oxsteed-credit-s1",
      "title": "Open OxSteed Credit and check the guardrails",
      "body": "Open /oxsteed-credit (\"OxSteed Credit\": \"Your OxSteed Credit balance, top-ups, withdrawals, conversions, and where to spend it.\"). Review \"Your spending guardrails\" (\"Daily controls\"): \"Spend amount remaining\", \"Spend movements remaining\", \"Transfer amount remaining\", and \"Transfers remaining\", with the reset date.",
      "expectedResult": "You know today's remaining spend and transfer limits before moving money.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "OxSteed Credit page with guardrails, light mode",
          "alt": "OxSteed Credit page showing spending guardrails",
          "caption": "OxSteed Credit with guardrails, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "OxSteed Credit page with guardrails, light mode",
          "alt": "OxSteed Credit on a phone screen",
          "caption": "OxSteed Credit with guardrails, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s2",
      "title": "Top up OxSteed Credit from the wallet",
      "body": "On /wallet, use the \"Add money\" panel (\"Add money to OxSteed Credit with a card. It is credited once the payment clears.\"): enter the \"Amount\", optionally pick \"Quick amounts\", choose \"Continue\", and complete the secure card payment step. For larger top-ups, enter the \"Verification code\" emailed to you and choose \"Verify and continue\". Your wallet updates when the payment confirms.",
      "expectedResult": "You see \"Money added to your OxSteed Credit\" and the balance increases.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Wallet Add money panel, light mode",
          "alt": "Add money panel on the wallet page",
          "caption": "Topping up from the wallet, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Wallet Add money panel, light mode",
          "alt": "Add money on a phone screen",
          "caption": "Topping up from the wallet, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s3",
      "title": "Withdraw to your bank",
      "body": "In \"Money out\" > \"Withdraw to your bank\" (\"Move OxSteed Credit to your connected bank account. A withdrawal locks the amount plus the quoted fee right away, an admin approves it, and the payout completes when the bank transfer confirms.\"), enter the \"Amount\" and choose \"Request withdrawal\". The fee quote shows \"Fee X · You receive Y\". Then complete \"Verify it is you\" (\"Verification code\") and choose \"Confirm withdrawal\". Track it under \"Withdrawal history\" (\"Status: ...\"); you can \"Cancel\" a requested withdrawal.",
      "expectedResult": "You see \"Withdrawal requested.\" and the history row shows its status.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "Withdraw to your bank panel, light mode",
          "alt": "Withdrawal panel with amount field",
          "caption": "Withdrawing to a bank, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "Withdraw to your bank panel, light mode",
          "alt": "Withdrawal on a phone screen",
          "caption": "Withdrawing to a bank, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s4",
      "title": "Convert credit between currencies",
      "body": "In \"Currency tools\" > \"Convert Credit\" (\"Use an approved, unexpired quote. OxSteed never estimates exchange rates or combines currencies automatically.\"), paste the \"Quote ID\" and the \"Source amount\", then convert. You see \"Conversion completed.\" and \"Moved X into Y.\"",
      "expectedResult": "The converted amount appears in the target currency account.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "Convert Credit panel, light mode",
          "alt": "Convert Credit panel with quote fields",
          "caption": "Converting credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "Convert Credit panel, light mode",
          "alt": "Convert Credit on a phone screen",
          "caption": "Converting credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s5",
      "title": "Authorize an in-store payment",
      "body": "In \"Customer authorization\" > \"Authorize an in-store payment\" (\"Choose a participating restaurant and reserve the exact amount. The cashier can capture it once, and the hold expires automatically if it is not used.\"), pick the \"Restaurant\", \"Order type\", and amount, then choose \"Create authorization\". You see \"Authorization created. Give the hold ID to the cashier.\" Use \"Copy hold ID\" and give it to the cashier; release it with \"Release hold\" if you will not use it.",
      "expectedResult": "The cashier captures the hold at the POS and the reserved amount returns if it expires unused.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "In-store authorization panel with hold ID, light mode",
          "alt": "Authorization panel with the hold ID",
          "caption": "Authorizing an in-store payment, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "In-store authorization panel with hold ID, light mode",
          "alt": "Authorization on a phone screen",
          "caption": "Authorizing an in-store payment, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s6",
      "title": "Move value with Restaurant credit",
      "body": "In \"Restaurant credit\" > \"Convert restaurant credit\" (\"Move value between your OxSteed Credit and a restaurant food wallet. Conversions settle atomically in one currency; any rate difference is shown as an explicit fee.\"), choose the \"Direction\" (\"OxSteed Credit to restaurant credit\" or \"Restaurant credit to OxSteed Credit\"), the \"Restaurant\", and the amount.",
      "expectedResult": "The converted value lands in the target wallet.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "Convert restaurant credit panel, light mode",
          "alt": "Restaurant credit conversion panel",
          "caption": "Moving value with Restaurant credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "Convert restaurant credit panel, light mode",
          "alt": "Conversion on a phone screen",
          "caption": "Moving value with Restaurant credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s7",
      "title": "Manage your cards",
      "body": "Open /oxsteed-credit/cards (\"My Cards\": \"Issue a virtual card for instant use, or request a physical card. A card is a way to spend the same balance shown on your OxSteed Credit account - it never creates a second balance.\"). Choose \"Issue a new card\", pick \"Virtual (use it right away)\" or \"Physical (ships to me)\" (with \"Shipping address\"), then \"Issue virtual card\" or \"Request physical card\". On a card you can \"Freeze\"/\"Unfreeze\", \"Set PIN\" (\"4-8 digit PIN\"), \"Report lost\", \"Report stolen\", \"Found this card\", or \"Request replacement\".",
      "expectedResult": "The card lists under \"Your cards\" and is ready to spend with.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit/cards",
          "state": "My Cards page with issue panel, light mode",
          "alt": "Cards page with the issue panel and card list",
          "caption": "Managing cards, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit/cards",
          "state": "My Cards page with issue panel, light mode",
          "alt": "Cards page on a phone screen",
          "caption": "Managing cards, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-oxsteed-credit-s8",
      "title": "Review activity and report a problem",
      "body": "In \"Recent activity\", open any transaction with \"View details\" to reach the \"Transaction receipt\" (/oxsteed-credit/transactions/:transactionId) with \"Posted\", \"Balance after\", and \"Print / save PDF\". To dispute one, choose \"Report a problem\", pick a reason (\"Incorrect amount\", \"I do not recognize this\", \"Duplicate transaction\", \"Restaurant or order issue\", \"Other\"), describe what happened, and choose \"Submit dispute\" (\"Your dispute was submitted for review.\"). Track disputes under \"Your Credit disputes\".",
      "expectedResult": "The transaction detail is clear and any dispute is recorded for review.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/oxsteed-credit",
          "state": "Recent activity list with transaction actions, light mode",
          "alt": "Recent activity with view and report actions",
          "caption": "Reviewing activity, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/oxsteed-credit",
          "state": "Recent activity list with transaction actions, light mode",
          "alt": "Activity on a phone screen",
          "caption": "Reviewing activity, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The intended movement posts to your balance or cards, or the dispute is recorded, and the guardrails and activity reflect it.",
  "recovery": [
    {
      "problem": "You see \"OxSteed Credit is temporarily paused\".",
      "solution": "The rail is off. Balances and history stay visible, but spending, top-ups, conversions, and withdrawals stay paused until the platform re-enables the flag."
    },
    {
      "problem": "A top-up says \"Still processing\".",
      "solution": "Your wallet updates when the payment confirms. Do not submit the same top-up again right away; the flow is safe to retry only after the pending one resolves."
    },
    {
      "problem": "Conversion says \"The quote is expired, unavailable, or does not match this currency and amount.\"",
      "solution": "Get a fresh quote ID and re-enter the exact source amount and currency."
    },
    {
      "problem": "The withdrawal verification code does not arrive.",
      "solution": "You see \"Verification code sent. Check your email.\" Check spam, wait a minute, and request a new code."
    }
  ],
  "supportContact": "For OxSteed Credit issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-wallet",
    "financial-restaurant-credit",
    "financial-statements",
    "financial-qr-payments"
  ],
  "siteLinks": [
    {
      "label": "OxSteed Credit",
      "href": "/oxsteed-credit"
    },
    {
      "label": "My Cards",
      "href": "/oxsteed-credit/cards"
    },
    {
      "label": "Wallet",
      "href": "/wallet"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/oxsteed-credit"
    },
    {
      "type": "route",
      "ref": "/oxsteed-credit/cards"
    },
    {
      "type": "route",
      "ref": "/oxsteed-credit/transactions/:transactionId"
    },
    {
      "type": "route",
      "ref": "/credit/apply"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/OxsteedCreditPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/OxsteedCreditCardsPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/OxsteedCreditTransactionPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/CreditApplyPage.jsx"
    }
  ]
};
