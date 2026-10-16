// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "logistics-accept-quotes",
  "area": "logistics",
  "slug": "accept-logistics-quotes",
  "title": "Publish and accept quotes",
  "audiences": [
    "logistics"
  ],
  "revision": 2,
  "availability": "conditional",
  "conditions": [
    "Requires LOGISTICS_PAYMENTS_ENABLED=true (default off). While disabled, the quote lifecycle routes answer 503 and the checkout shows a disabled state."
  ],
  "goal": "Review a published quote version and accept it so payment can proceed.",
  "intendedRoles": [
    "Logistics participant (buyer)"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    },
    {
      "text": "A sourcing request or order with a published quote.",
      "guideId": "logistics-sourcing",
      "href": "/logistics/sourcing"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "payments-flag",
        "label": "Is logistics payments enabled?",
        "type": "decision"
      },
      {
        "id": "blocked",
        "label": "Payments disabled: quote routes answer 503",
        "type": "blocked"
      },
      {
        "id": "published",
        "label": "Supplier publishes a new quote version",
        "type": "step"
      },
      {
        "id": "notify",
        "label": "You are notified: New quote needs your acceptance",
        "type": "step"
      },
      {
        "id": "open-checkout",
        "label": "Open checkout",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Review What changed",
        "type": "step"
      },
      {
        "id": "accept",
        "label": "Choose Accept quote version N",
        "type": "step"
      },
      {
        "id": "paid",
        "label": "Quote accepted: you can now pay",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "payments-flag",
        "to": "blocked",
        "label": "No"
      },
      {
        "from": "payments-flag",
        "to": "published",
        "label": "Yes"
      },
      {
        "from": "published",
        "to": "notify"
      },
      {
        "from": "notify",
        "to": "open-checkout"
      },
      {
        "from": "open-checkout",
        "to": "review"
      },
      {
        "from": "review",
        "to": "accept"
      },
      {
        "from": "accept",
        "to": "paid"
      }
    ]
  },
  "processMapText": "1. First check the condition: logistics payments must be enabled, otherwise the quote routes answer 503 and checkout is disabled. 2. The supplier publishes a new quote version against your request. 3. You receive the notification \"New quote needs your acceptance\". 4. Open checkout. 5. The acceptance gate shows \"A new quote needs your acceptance\" with a \"What changed\" comparison table. 6. Review the changes, then choose \"Accept quote version N\". 7. The quote is accepted and you can now pay. Payment is paused until you accept the current quote, and you cannot pay against an older version.",
  "steps": [
    {
      "id": "logistics-accept-quotes-s1",
      "title": "Confirm payments are enabled",
      "body": "This flow only works when logistics payments are enabled (LOGISTICS_PAYMENTS_ENABLED=true, default off). While disabled, the quote lifecycle routes answer 503 and the checkout shows the disabled state \"Online payments are not enabled yet. Please try again later.\" If you see that message, stop here and contact support; the steps below do not apply.",
      "expectedResult": "Checkout loads normally instead of showing the payments-disabled message.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/checkout",
          "state": "Checkout page with payments-disabled message, light mode",
          "alt": "Checkout showing the online payments not enabled message",
          "caption": "The disabled checkout state, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Payments disabled message",
              "locator": "main [role=\"alert\"]"
            }
          ]
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/checkout",
          "state": "Checkout page with payments-disabled message, light mode",
          "alt": "Payments disabled message on a phone screen",
          "caption": "The disabled checkout state, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-accept-quotes-s2",
      "title": "Open checkout when a new quote needs your acceptance",
      "body": "When the supplier publishes a new quote version, you receive the notification \"New quote needs your acceptance\". Open /logistics/checkout. The acceptance gate appears with the heading \"A new quote needs your acceptance\" and the text \"Version N replaces version M. Review what changed, then accept it to continue to payment. You cannot pay against the older version.\"",
      "expectedResult": "The quote acceptance gate is visible at the top of checkout.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/checkout",
          "state": "Checkout with the quote acceptance gate open, light mode",
          "alt": "Checkout page showing the new quote acceptance gate",
          "caption": "The quote acceptance gate, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/checkout",
          "state": "Checkout with the quote acceptance gate, light mode",
          "alt": "Acceptance gate on a phone screen",
          "caption": "The acceptance gate, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-accept-quotes-s3",
      "title": "Review what changed between versions",
      "body": "Read the \"What changed\" table. Each row shows the item, whether it was Added, Removed, or Changed, and the \"Total changed by {{amount}}\". If nothing changed at the line level, the table shows \"No line-item changes in this version.\"",
      "expectedResult": "You understand exactly what is different in the new quote version.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/checkout",
          "state": "What changed comparison table expanded, light mode",
          "alt": "Quote version comparison table",
          "caption": "Reviewing what changed, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/checkout",
          "state": "What changed table, light mode",
          "alt": "Version comparison on a phone screen",
          "caption": "Reviewing what changed, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "logistics-accept-quotes-s4",
      "title": "Accept the quote version",
      "body": "Choose \"Accept quote version N\" to accept, or \"Not now\" to decline and decide later. After accepting, the message reads \"Quote version N accepted. You can now pay.\" Until you accept, the notice stays: \"Payment is paused until you accept the current quote.\" Continue to the payment confirmation step next.",
      "expectedResult": "The quote is accepted and checkout continues to the payment method step.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/logistics/checkout",
          "state": "Quote accepted confirmation, light mode",
          "alt": "Quote accepted message with payment continuing",
          "caption": "After accepting the quote, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/logistics/checkout",
          "state": "Quote accepted confirmation, light mode",
          "alt": "Acceptance confirmation on a phone screen",
          "caption": "After accepting, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Checkout shows \"Quote version N accepted. You can now pay.\" and the payment step is no longer paused.",
  "recovery": [
    {
      "problem": "The quote routes answer 503 or checkout shows the payments-disabled message.",
      "solution": "Logistics payments are not enabled in this environment. Contact support at /support to confirm when the feature is on."
    },
    {
      "problem": "A newer quote version arrived while you were reviewing.",
      "solution": "The gate refreshes to the latest version. Review the new \"What changed\" table before accepting again."
    }
  ],
  "supportContact": "Quote or payment issues: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "logistics-sourcing",
    "logistics-confirm-payments"
  ],
  "siteLinks": [
    {
      "label": "Checkout",
      "href": "/logistics/checkout"
    },
    {
      "label": "Finance",
      "href": "/logistics/finance"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/logistics/checkout"
    },
    {
      "type": "route",
      "ref": "/logistics/finance"
    },
    {
      "type": "screen",
      "ref": "client/src/components/logistics/QuoteAcceptanceGate.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/logistics/CheckoutPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/logistics/finance/quotes/:id/accept"
    },
    {
      "type": "flag",
      "ref": "LOGISTICS_PAYMENTS_ENABLED (default off; server/middleware/requireLogisticsPayments.js)"
    }
  ]
};
