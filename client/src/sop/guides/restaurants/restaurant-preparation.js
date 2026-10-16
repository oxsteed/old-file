// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "restaurant-preparation",
  "area": "restaurants",
  "slug": "restaurant-preparation",
  "title": "Prepare orders (kitchen)",
  "audiences": [
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Run the kitchen display: acknowledge incoming tickets, work items, and hand orders off to guests or runners.",
  "intendedRoles": [
    "Restaurant owner",
    "Restaurant manager",
    "Kitchen staff"
  ],
  "prerequisites": [
    {
      "text": "Sign in with a restaurant role and open the kitchen display.",
      "href": "/restaurants/merchant"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the Kitchen display",
        "type": "terminal"
      },
      {
        "id": "ack",
        "label": "Acknowledge new tickets",
        "type": "step"
      },
      {
        "id": "work",
        "label": "Work items (Start, Done, Recall, Delay)",
        "type": "step"
      },
      {
        "id": "qc",
        "label": "Quality check (if enabled)",
        "type": "decision"
      },
      {
        "id": "ready",
        "label": "Mark ready",
        "type": "step"
      },
      {
        "id": "handoff",
        "label": "Confirm handoff or wait for runner",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Order handed off",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "ack"
      },
      {
        "from": "ack",
        "to": "work"
      },
      {
        "from": "work",
        "to": "qc"
      },
      {
        "from": "qc",
        "to": "ready",
        "label": "No quality check"
      },
      {
        "from": "qc",
        "to": "ready",
        "label": "Quality check passed"
      },
      {
        "from": "ready",
        "to": "handoff"
      },
      {
        "from": "handoff",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open the Kitchen display at /restaurants/kitchen/:restaurantId. Acknowledge tickets in the \"New\" column, then work them in \"Preparing\" with the item buttons \"Start\", \"Done\", \"Recall\", and \"Delay\". Send finished orders to \"Quality check\" if the store uses it, then \"Mark ready\". For non-delivery orders, choose \"Confirm handoff\"; delivery orders wait for the runner. The public queue board at /food/queue/:restaurantId shows \"Preparing\" and \"Now ready\" to guests.",
  "steps": [
    {
      "id": "restaurant-preparation-s1",
      "title": "Open the Kitchen display",
      "body": "Open /restaurants/kitchen/:restaurantId (\"Kitchen display\"). Tickets are grouped in columns: \"New\", \"Preparing\", \"Quality check\", and \"Ready\". The hint reads \"Update each ticket with the action buttons\".",
      "expectedResult": "Tickets appear in the column matching their current status.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Kitchen display with ticket columns, light mode",
          "alt": "Kitchen display with tickets in status columns",
          "caption": "The Kitchen display, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Kitchen display with ticket columns, light mode",
          "alt": "Kitchen display on a phone screen",
          "caption": "The Kitchen display, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-preparation-s2",
      "title": "Acknowledge and start tickets",
      "body": "On a new ticket, choose \"Acknowledge\", then \"Start preparing\" to move it to \"Preparing\". The fulfillment type (\"Takeout\", \"Dine in\", \"Delivery\", \"Kiosk\") and table label show on the ticket.",
      "expectedResult": "The ticket moves to the \"Preparing\" column.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "New ticket with Acknowledge button, light mode",
          "alt": "A new ticket with the Acknowledge button",
          "caption": "Acknowledging a ticket, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "New ticket with Acknowledge button, light mode",
          "alt": "A new ticket on a phone screen",
          "caption": "Acknowledging a ticket, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-preparation-s3",
      "title": "Work each item",
      "body": "Use the item buttons: \"Start\" when an item goes on, \"Done\" when it is finished, \"Recall\" to send it back, and \"Delay\" to pause it. Splitting a ticket across cooks is also supported from the kitchen actions.",
      "expectedResult": "Items advance to done and the ticket reflects real kitchen progress.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Preparing ticket with item buttons, light mode",
          "alt": "Ticket in Preparing with Start, Done, Recall, and Delay buttons",
          "caption": "Working ticket items, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Preparing ticket with item buttons, light mode",
          "alt": "Ticket items on a phone screen",
          "caption": "Working ticket items, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-preparation-s4",
      "title": "Pass quality check and mark ready",
      "body": "When all items are finished and the store uses quality checks, choose \"Ready for check\". After the check (or when no check is needed), choose \"Mark ready\" to move the order to the \"Ready\" column.",
      "expectedResult": "The order sits in \"Ready\" and shows on the guest queue board under \"Now ready\".",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Ready ticket with Mark ready button, light mode",
          "alt": "Ticket with the Mark ready button",
          "caption": "Marking an order ready, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Ready ticket with Mark ready button, light mode",
          "alt": "Mark ready on a phone screen",
          "caption": "Marking an order ready, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-preparation-s5",
      "title": "Confirm handoff or hand to the runner",
      "body": "For non-delivery orders, choose \"Confirm handoff\" (you confirm \"Confirm that this order was handed to the guest?\"). For delivery orders, the ticket shows \"Waiting for runner handoff\" until the runner completes the delivery. If an order needs rework, use \"Reopen\".",
      "expectedResult": "The order leaves the board as completed, or moves to the runner flow for delivery.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Ready ticket with Confirm handoff button, light mode",
          "alt": "Ready ticket with handoff options",
          "caption": "Handing off an order, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/kitchen/:restaurantId",
          "state": "Ready ticket with Confirm handoff button, light mode",
          "alt": "Handoff on a phone screen",
          "caption": "Handing off an order, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-preparation-s6",
      "title": "Check the guest queue board",
      "body": "Open /food/queue/:restaurantId (\"Now ready\", \"Preparing\", \"None yet\"). Guests see order numbers without staff controls; the board can announce \"Pay at the counter\" and play the ready sound (\"Enable ready sound\").",
      "expectedResult": "Guests can see when their order is ready without asking staff.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/food/queue/:restaurantId",
          "state": "Queue board with ready orders, light mode",
          "alt": "Public queue board showing ready order numbers",
          "caption": "The queue board, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/food/queue/:restaurantId",
          "state": "Queue board with ready orders, light mode",
          "alt": "Queue board on a phone screen",
          "caption": "The queue board, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Tickets move New to Preparing to Ready and off the board, and the queue board mirrors the ready state for guests.",
  "recovery": [
    {
      "problem": "Actions taken offline have not synced.",
      "solution": "The board shows \"{{count}} kitchen update waiting to sync\" with \"Saved on this device. It will sync when the connection returns.\" Choose \"Sync now\" once online."
    },
    {
      "problem": "An order was marked ready by mistake.",
      "solution": "Use \"Reopen\" on the ticket and add the reason when prompted; the ticket returns to an earlier stage."
    }
  ],
  "supportContact": "For kitchen display issues, use the in-app support page at /support.",
  "relatedGuides": [
    "restaurant-store-settings",
    "restaurant-pickup-delivery-handoff",
    "restaurant-cancellations",
    "restaurant-staff-tools"
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
      "ref": "/restaurants/kitchen/:restaurantId"
    },
    {
      "type": "route",
      "ref": "/food/queue/:restaurantId"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/FoodKitchenPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/FoodQueueBoardPage.jsx"
    }
  ]
};
