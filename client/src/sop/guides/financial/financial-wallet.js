// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "financial-wallet",
  "area": "financial",
  "slug": "financial-wallet",
  "title": "View the wallet overview",
  "audiences": [
    "customer"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "See every balance OxSteed holds for you in one place: OxSteed Credit plus your per-restaurant wallets.",
  "intendedRoles": [
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "Sign in to your OxSteed account.",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the wallet",
        "type": "terminal"
      },
      {
        "id": "credit",
        "label": "Read the OxSteed Credit balance card",
        "type": "step"
      },
      {
        "id": "restaurants",
        "label": "Read the Restaurant credit card",
        "type": "step"
      },
      {
        "id": "actions",
        "label": "Use Add money or Verify your identity",
        "type": "step"
      },
      {
        "id": "wallets",
        "label": "Review per-restaurant wallets",
        "type": "step"
      },
      {
        "id": "details",
        "label": "Expand Account details",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Balances understood",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "credit"
      },
      {
        "from": "credit",
        "to": "restaurants"
      },
      {
        "from": "restaurants",
        "to": "actions"
      },
      {
        "from": "actions",
        "to": "wallets"
      },
      {
        "from": "wallets",
        "to": "details"
      },
      {
        "from": "details",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open /wallet (\"Wallet\": \"Your OxSteed Credit balance and restaurant credits in one place, with history and controls.\"). Read the OxSteed Credit balance card (\"OxSteed Credit balance\", \"Available to spend\", \"Reserved\") and use the \"Currency\" picker and \"Refresh\" as needed. Read the \"Restaurant credit\" card (\"Credit held at individual restaurants, each with its own balance and rules.\") and follow \"View restaurant credits\" to the per-restaurant list. Use \"Add money\" to top up OxSteed Credit, or \"Verify your identity\" to raise funding limits. Expand \"Account details\" for deposits, withdrawals, and the last statement.",
  "steps": [
    {
      "id": "financial-wallet-s1",
      "title": "Open the wallet",
      "body": "Open /wallet. The page is titled \"Wallet\" with the description \"Your OxSteed Credit balance and restaurant credits in one place, with history and controls.\" The \"Your balances\" section holds one card for OxSteed Credit and one for restaurant credit.",
      "expectedResult": "Both balance cards load, or a clear error message with \"Retry\" appears.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Wallet overview with balances, light mode",
          "alt": "Wallet page with the balances section",
          "caption": "The wallet overview, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Wallet overview with balances, light mode",
          "alt": "Wallet page on a phone screen",
          "caption": "The wallet overview, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-wallet-s2",
      "title": "Read the OxSteed Credit balance card",
      "body": "The OxSteed Credit card shows the \"OxSteed Credit balance\", \"Available to spend\", and \"Reserved\" amounts plus the account status (\"active\", \"under review\", and so on). Use the \"Currency\" picker when you hold more than one currency, and \"Refresh\" to reload. Choose \"Manage OxSteed Credit\" for the full credit page.",
      "expectedResult": "You know your platform credit balance and how much of it is spendable.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "OxSteed Credit balance card, light mode",
          "alt": "OxSteed Credit balance card with available and reserved amounts",
          "caption": "The OxSteed Credit balance card, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Balance card",
              "locator": "div.ox-credit-balance-card"
            },
            {
              "n": 2,
              "label": "Manage OxSteed Credit link",
              "locator": "a.ox-credit-detail-link"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "OxSteed Credit balance card, light mode",
          "alt": "Balance card on a phone screen",
          "caption": "The OxSteed Credit balance card, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-wallet-s3",
      "title": "Read the Restaurant credit card",
      "body": "The \"Restaurant credit\" card says \"Credit held at individual restaurants, each with its own balance and rules.\" This is Restaurant Credit, a separate system from OxSteed Credit. Follow \"View restaurant credits\" to jump to the per-restaurant wallets below.",
      "expectedResult": "You see how many restaurant wallets you hold.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Restaurant credit summary card, light mode",
          "alt": "Restaurant credit card with the wallet count",
          "caption": "The Restaurant credit card, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Restaurant credit card",
              "locator": "div.ox-credit-balance-card--restaurant"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Restaurant credit summary card, light mode",
          "alt": "Restaurant credit card on a phone screen",
          "caption": "The Restaurant credit card, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-wallet-s4",
      "title": "Use Add money or Verify your identity",
      "body": "To add money to OxSteed Credit, use the \"Add money\" panel (\"Add money to OxSteed Credit with a card. It is credited once the payment clears.\"): enter the \"Amount\", optionally use \"Quick amounts\", choose \"Continue\", complete the card payment step, and for larger top-ups enter the \"Verification code\" emailed to you (\"Verify and continue\"). If funding actions are limited, the \"Identity check\" panel (\"Verify your identity\") shows your \"Current tier\" and lets you \"Request Tier 2\" or \"Submit appeal\".",
      "expectedResult": "You see \"Money added to your OxSteed Credit\" or the verification request status.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Add money panel with amount field, light mode",
          "alt": "Add money panel for OxSteed Credit",
          "caption": "Adding money to OxSteed Credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Add money panel with amount field, light mode",
          "alt": "Add money panel on a phone screen",
          "caption": "Adding money to OxSteed Credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-wallet-s5",
      "title": "Review your per-restaurant wallets",
      "body": "Below, the \"Restaurant credit\" section lists each wallet (\"Balances held with individual restaurants. Each one spends only at its restaurant.\"). If empty you see \"No restaurant wallets yet\" (\"When a restaurant issues you credit, it will appear here.\"). Choose \"View wallet\" to manage one at /restaurant-credit.",
      "expectedResult": "You can see each restaurant balance and open any wallet.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Restaurant wallets list, light mode",
          "alt": "List of per-restaurant wallets",
          "caption": "Per-restaurant wallets, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Restaurant wallets list, light mode",
          "alt": "Restaurant wallets on a phone screen",
          "caption": "Per-restaurant wallets, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "financial-wallet-s6",
      "title": "Expand Account details",
      "body": "Choose \"Account details\" to expand the detail list: last statement balance and date, pending deposits and withdrawals, and the last deposit amount and date.",
      "expectedResult": "The detail list expands with the full account history summary.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/wallet",
          "state": "Expanded account details, light mode",
          "alt": "Expanded account details list",
          "caption": "Account details, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/wallet",
          "state": "Expanded account details, light mode",
          "alt": "Account details on a phone screen",
          "caption": "Account details, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "You can read your OxSteed Credit balance, your restaurant credit wallets, and the account details without leaving /wallet.",
  "recovery": [
    {
      "problem": "The wallet fails to load.",
      "solution": "You see \"Unable to load your restaurant wallets.\" or the account load error. Choose \"Retry\" or \"Refresh\" to reload."
    },
    {
      "problem": "You see \"OxSteed Credit is temporarily paused\".",
      "solution": "The credit rail is paused: \"Your balance and history remain available below. Spending, top-ups, and withdrawals are paused while the network is under review.\" Restaurant credit is a separate system and is unaffected."
    }
  ],
  "supportContact": "For wallet issues, use the in-app support page at /support.",
  "relatedGuides": [
    "financial-oxsteed-credit",
    "financial-restaurant-credit",
    "financial-statements"
  ],
  "siteLinks": [
    {
      "label": "Wallet",
      "href": "/wallet"
    },
    {
      "label": "OxSteed Credit",
      "href": "/oxsteed-credit"
    },
    {
      "label": "Restaurant credit",
      "href": "/restaurant-credit"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/wallet"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/WalletPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/WalletRestaurantWallets.jsx"
    }
  ]
};
