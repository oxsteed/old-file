// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "restaurant-staff-tools",
  "area": "restaurants",
  "slug": "restaurant-staff-tools",
  "title": "Use POS, inventory, crew, and runner tools",
  "audiences": [
    "restaurant"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Run in-store operations with the staff tools: take POS orders, track inventory, manage the crew, and run deliveries.",
  "intendedRoles": [
    "Restaurant owner",
    "Restaurant manager",
    "Cashier",
    "Runner"
  ],
  "prerequisites": [
    {
      "text": "Sign in with a restaurant role that has the right permissions (some POS payments are manager-only).",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the staff tool",
        "type": "terminal"
      },
      {
        "id": "pos",
        "label": "POS: open shift and take orders",
        "type": "step"
      },
      {
        "id": "inventory",
        "label": "Inventory: adjust stock and order supplies",
        "type": "step"
      },
      {
        "id": "crew",
        "label": "Crew: shifts, checklists, and SOPs",
        "type": "step"
      },
      {
        "id": "runner",
        "label": "Runner: deliveries and settlements",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Shift operations complete",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "pos"
      },
      {
        "from": "pos",
        "to": "inventory"
      },
      {
        "from": "inventory",
        "to": "crew"
      },
      {
        "from": "crew",
        "to": "runner"
      },
      {
        "from": "runner",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open the staff tool you need. In POS, open a shift and take orders with the ticket, then send them to the kitchen and take payment. In Inventory, adjust stock levels, log waste, create purchase orders, and report supplier issues. In Crew, check today's shifts, run checklists, and keep SOPs current. In Runner, claim and complete deliveries and settle cash.",
  "steps": [
    {
      "id": "restaurant-staff-tools-s1",
      "title": "Open a POS shift and take orders",
      "body": "Open /restaurants/pos/:restaurantId (\"Point of Sale\"). If prompted (\"Open POS shift required\"), choose \"Open shift\" (\"POS shift opened. You can take orders now.\"). Add items with \"Add to ticket\", set the \"Table\" or \"Guest name\", then choose \"Send to kitchen\" (\"Order sent to the kitchen\").",
      "expectedResult": "The ticket shows the items and the kitchen receives the order.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/pos/:restaurantId",
          "state": "POS with items and ticket, light mode",
          "alt": "POS screen with menu items and the ticket",
          "caption": "Taking a POS order, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/pos/:restaurantId",
          "state": "POS with items and ticket, light mode",
          "alt": "POS on a phone screen",
          "caption": "Taking a POS order, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-staff-tools-s2",
      "title": "Take payment at the POS",
      "body": "Choose \"Pay now\" on the ticket. For cash, enter the \"Amount given\" and hand back the \"Change\". For OxSteed Credit, enter the \"Customer authorization code\" (the customer creates an in-store authorization in their OxSteed Credit and gives you the expiring hold ID). Choose \"Confirm payment\". Note: \"Only managers can record POS payments.\"",
      "expectedResult": "You see \"Order complete\" and the payment is recorded.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/pos/:restaurantId",
          "state": "POS payment panel, light mode",
          "alt": "POS payment panel with payment methods",
          "caption": "Taking POS payment, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/pos/:restaurantId",
          "state": "POS payment panel, light mode",
          "alt": "POS payment on a phone screen",
          "caption": "Taking POS payment, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-staff-tools-s3",
      "title": "Adjust inventory",
      "body": "Open /restaurants/inventory/:restaurantId (\"Inventory\"). Search with \"Search items...\". On an item, choose \"Adjust\" and set the \"Type\", \"Quantity\", and \"Note\", then confirm (\"Adjusted\"). Use \"Log waste\" for spoilage (\"Select an item to log spoilage or discard\").",
      "expectedResult": "Stock counts update and the \"Low stock\" count reflects the change.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/inventory/:restaurantId",
          "state": "Inventory list with adjust dialog, light mode",
          "alt": "Inventory items with the adjust dialog",
          "caption": "Adjusting inventory, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/inventory/:restaurantId",
          "state": "Inventory list with adjust dialog, light mode",
          "alt": "Inventory on a phone screen",
          "caption": "Adjusting inventory, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-staff-tools-s4",
      "title": "Order supplies and report supplier issues",
      "body": "In Inventory, choose \"New purchase order\" to send a supply request (\"Request sent\"), or \"Report supplier issue\" with \"Supplier\", \"Description\", and \"Severity\" (\"Issue reported\").",
      "expectedResult": "The request appears under \"Pending requests\" or \"Open issues\".",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/inventory/:restaurantId",
          "state": "Inventory purchase order form, light mode",
          "alt": "New purchase order form",
          "caption": "Ordering supplies, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/inventory/:restaurantId",
          "state": "Inventory purchase order form, light mode",
          "alt": "Purchase order on a phone screen",
          "caption": "Ordering supplies, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-staff-tools-s5",
      "title": "Run the crew board",
      "body": "Open /restaurants/crew/:restaurantId (\"Crew\"). Check \"Shifts today\" and \"Open tasks\". Use \"New checklist\" (\"Title\", \"Type\", \"Create\") for daily routines and \"Mark complete\" when done, and \"New SOP\" (\"Title\", \"Category\", \"Content\") to document procedures (\"SOP created\").",
      "expectedResult": "Shifts, tasks, checklists, and SOPs are current for the day.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/crew/:restaurantId",
          "state": "Crew page with shifts and checklists, light mode",
          "alt": "Crew page with shifts, tasks, and checklists",
          "caption": "Running the crew board, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/crew/:restaurantId",
          "state": "Crew page with shifts and checklists, light mode",
          "alt": "Crew page on a phone screen",
          "caption": "Running the crew board, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-staff-tools-s6",
      "title": "Run deliveries from the runner page",
      "body": "Open /restaurants/runner/:restaurantId (\"Runner\"). Claim offers, \"Start delivery\", \"Share live location\", \"Log proof\" with a \"Note\", \"Mark delivered\", and settle cash through \"Create settlement\" and \"Record remittance\". See the handoff guide for the full runner flow.",
      "expectedResult": "Deliveries complete with proof and settled cash.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/runner/:restaurantId",
          "state": "Runner page with tasks, light mode",
          "alt": "Runner page with delivery tasks",
          "caption": "Running deliveries, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/runner/:restaurantId",
          "state": "Runner page with tasks, light mode",
          "alt": "Runner page on a phone screen",
          "caption": "Running deliveries, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Orders flow through POS to the kitchen, inventory counts stay current, crew tasks are done, and deliveries complete with proof.",
  "recovery": [
    {
      "problem": "POS shows \"Open POS shift required\".",
      "solution": "Choose \"Open shift\". You cannot take orders until a shift is open."
    },
    {
      "problem": "You see \"Only managers can record POS payments.\"",
      "solution": "Ask a manager to record the payment, or have your restaurant grant you the right permission."
    },
    {
      "problem": "Card payment is not offered at the POS.",
      "solution": "Card payments require a connected POS terminal. Use the POS app for card checkout."
    },
    {
      "problem": "POS actions fail to sync.",
      "solution": "You see \"Sync degraded: X failed, Y pending, Z unsent\". The POS reports failed-operation diagnostics after reconnection; it does not automatically retry a payment, refund, credit spend, or financial approval. Compare the current order and payment records before an explicit staff retry. Managed unpaid drafts require review and acceptance in the screen control center."
    }
  ],
  "supportContact": "For staff tool issues, use the in-app support page at /support.",
  "relatedGuides": [
    "restaurant-screen-control",
    "restaurant-pickup-delivery-handoff",
    "restaurant-preparation",
    "restaurant-store-settings"
  ],
  "siteLinks": [
    {
      "label": "Restaurant dashboard",
      "href": "/restaurants/merchant"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurants/pos/:restaurantId"
    },
    {
      "type": "route",
      "ref": "/restaurants/inventory/:restaurantId"
    },
    {
      "type": "route",
      "ref": "/restaurants/crew/:restaurantId"
    },
    {
      "type": "route",
      "ref": "/restaurants/runner/:restaurantId"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantPOSPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantInventoryPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantCrewPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantRunnerPage.jsx"
    }
  ]
};
