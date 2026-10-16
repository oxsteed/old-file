// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "restaurant-refund-requests",
  "area": "restaurants",
  "slug": "restaurant-refund-requests",
  "title": "Request refunds on restaurant credit and orders",
  "audiences": [
    "customer",
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Get money back the right way: dispute restaurant credit, refund a customer wallet as a restaurant, or refund an order.",
  "intendedRoles": [
    "Customer",
    "Restaurant owner",
    "Restaurant manager"
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
        "id": "start",
        "label": "Identify what to refund",
        "type": "terminal"
      },
      {
        "id": "which",
        "label": "Credit, order, or escalation?",
        "type": "decision"
      },
      {
        "id": "credit",
        "label": "Customer: dispute the restaurant credit request",
        "type": "step"
      },
      {
        "id": "merchantcredit",
        "label": "Restaurant: refund restaurant credit",
        "type": "step"
      },
      {
        "id": "order",
        "label": "Restaurant: issue an order refund",
        "type": "step"
      },
      {
        "id": "escalate",
        "label": "Escalate through a support case",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Refund resolved",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "which"
      },
      {
        "from": "which",
        "to": "credit",
        "label": "Customer credit dispute"
      },
      {
        "from": "which",
        "to": "merchantcredit",
        "label": "Restaurant credit refund"
      },
      {
        "from": "which",
        "to": "order",
        "label": "Order refund"
      },
      {
        "from": "which",
        "to": "escalate",
        "label": "Stuck or disputed"
      },
      {
        "from": "credit",
        "to": "done"
      },
      {
        "from": "merchantcredit",
        "to": "done"
      },
      {
        "from": "order",
        "to": "done"
      },
      {
        "from": "escalate",
        "to": "done"
      }
    ]
  },
  "processMapText": "Identify whether the money is restaurant credit or an order payment. Customers dispute restaurant credit requests from the \"Activity\" section at /restaurant-credit. Restaurants refund customer credit from the \"Restaurant credit\" manager with \"Refund credit\". Restaurants refund orders from the order center with \"Refund\" (card orders refund through \"Cancel\"). Escalate through a support case at /restaurants/support/cases/:caseId when the refund is disputed.",
  "steps": [
    {
      "id": "restaurant-refund-requests-s1",
      "title": "Dispute a restaurant credit request as a customer",
      "body": "At /restaurant-credit (\"Restaurant credit\"), open \"Activity\" and find the credit request. Choose \"Dispute\" to open \"Dispute this credit request\", explain in the \"Reason\" field (for example \"you paid the restaurant, but the credit was never issued\"), and choose \"Submit dispute\". You see \"Dispute submitted\".",
      "expectedResult": "The dispute is recorded and the restaurant can see it for review.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit activity with Dispute button, light mode",
          "alt": "Activity list with a Dispute button on a credit request",
          "caption": "Disputing a credit request, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurant-credit",
          "state": "Restaurant credit activity with Dispute button, light mode",
          "alt": "Dispute button on a phone screen",
          "caption": "Disputing a credit request, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-refund-requests-s2",
      "title": "Refund customer restaurant credit as a restaurant",
      "body": "On the restaurant dashboard, open the \"Restaurant credit\" manager (\"Customer balances\"; \"Approve credit only after matching the customer's receipt or confirmation number.\"). Choose \"Refund credit\", enter the \"Customer email\" and \"Amount\", add a \"Reason\" (\"Why is this credit being refunded?\"), then choose \"Review refund\" and \"Yes, refund\". Note: this deducts credit from the customer wallet and sends the money back to their card; only credit issued in the last 30 days can be refunded.",
      "expectedResult": "You see \"Refunded X to customer.\" and the wallet balance drops.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Restaurant credit manager refund form, light mode",
          "alt": "Refund credit form with email, amount, and reason",
          "caption": "Refunding restaurant credit, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Restaurant credit manager refund form, light mode",
          "alt": "Refund form on a phone screen",
          "caption": "Refunding restaurant credit, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-refund-requests-s3",
      "title": "Issue an order refund as a restaurant",
      "body": "In the order center, open the order and choose \"Refund\". In the \"Issue Refund\" dialog (\"Order total: $X\"), enter the amount (\"Amount in cents (blank = full)\") and a \"Reason (required)\", then choose \"Issue Refund\". For online card orders, use \"Cancel\" instead: \"Card orders are refunded by cancelling the order. The card refund happens automatically.\" Partial refunds are not available for online card orders.",
      "expectedResult": "You see \"Refund issued\" and the order shows \"Payment refunded\".",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Issue Refund dialog, light mode",
          "alt": "Issue refund dialog with amount and reason",
          "caption": "Issuing an order refund, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Issue Refund dialog, light mode",
          "alt": "Issue refund on a phone screen",
          "caption": "Issuing an order refund, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-refund-requests-s4",
      "title": "Escalate through a support case",
      "body": "If the refund is disputed or stuck, open the support case at /restaurants/support/cases/:caseId (\"Support case\"). Review \"Case details\" (\"Issue type\", \"Status\", \"Created\", \"Related order\"), then use \"Message or proof link\" (\"Write your reply...\", \"Paste a receipt / proof link (optional)\") and choose \"Save update\". \"Reply sent.\" confirms the update.",
      "expectedResult": "The case timeline records your message and the support team can act on it.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/support/cases/:caseId",
          "state": "Support case detail with reply box, light mode",
          "alt": "Support case with message and proof link fields",
          "caption": "Escalating through a support case, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/support/cases/:caseId",
          "state": "Support case detail with reply box, light mode",
          "alt": "Support case on a phone screen",
          "caption": "Escalating through a support case, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The refund shows as issued, the credit returns to the customer wallet or card, or the support case timeline records the resolution.",
  "recovery": [
    {
      "problem": "The credit refund failed.",
      "solution": "You see \"Unable to process this refund.\" Only credit issued in the last 30 days can be refunded, and if the card refund fails the wallet balance is left untouched. Retry with an eligible amount."
    },
    {
      "problem": "You cannot partially refund an online card order.",
      "solution": "That is by design: \"Partial refunds are not available for online card orders. Refund the full order or ask support for help.\""
    },
    {
      "problem": "A direct or pay-at-restaurant order was cancelled but shows no refund.",
      "solution": "Those are marked refunded with no automatic money movement. Record the refund with the customer outside OxSteed and note it on the support case."
    }
  ],
  "supportContact": "For refund help, use the in-app support page at /support.",
  "relatedGuides": [
    "restaurant-cancellations",
    "restaurant-ordering",
    "financial-restaurant-credit"
  ],
  "siteLinks": [
    {
      "label": "Restaurant credit",
      "href": "/restaurant-credit"
    },
    {
      "label": "Restaurant dashboard",
      "href": "/restaurants/merchant"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurant-credit"
    },
    {
      "type": "route",
      "ref": "/restaurants/support/cases/:caseId"
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
      "ref": "client/src/pages/food/FoodMerchantPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/RestaurantSupportCasePage.jsx"
    }
  ]
};
