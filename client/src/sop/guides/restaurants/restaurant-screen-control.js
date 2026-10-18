// Reviewed synthetic browser workflow. Guide body is English by library policy.
export default {
  "id": "restaurant-screen-control",
  "area": "restaurants",
  "slug": "restaurant-screen-control",
  "title": "Connect restaurant screens and recover offline work",
  "audiences": [
    "restaurant"
  ],
  "revision": 1,
  "availability": "conditional",
  "conditions": [
    "Managed screens must be enabled for this restaurant by an authorized manager."
  ],
  "goal": "Coordinate browser POS capture, kiosks, kitchen stations, expediting and pickup through one authoritative store workflow.",
  "intendedRoles": [
    "Restaurant owner",
    "Restaurant manager",
    "Kitchen staff"
  ],
  "prerequisites": [
    {
      "text": "Sign in with permission to manage the restaurant. Store appliances use paired device credentials rather than an owner session.",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "pair",
        "label": "Pair and configure the store screens",
        "type": "step"
      },
      {
        "id": "kitchen",
        "label": "Prepare each station’s items",
        "type": "step"
      },
      {
        "id": "expeditor",
        "label": "Check assembly, publish readiness and hand off",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Recover unpaid work and conflicts",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Confirmed order reaches the customer",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "pair",
        "to": "kitchen"
      },
      {
        "from": "kitchen",
        "to": "expeditor"
      },
      {
        "from": "expeditor",
        "to": "done"
      },
      {
        "from": "pair",
        "to": "review"
      },
      {
        "from": "review",
        "to": "kitchen"
      }
    ]
  },
  "processMapText": "Pair scoped devices and confirm configuration. Prepare individual items at their stations, complete expeditor assembly and quality checks, publish readiness and complete paid pickup. During an outage retain provisional work locally, then review and accept unpaid drafts before preparation.",
  "steps": [
    {
      "id": "restaurant-screen-control-pair",
      "title": "Pair and configure the store screens",
      "body": "From Home or Operations choose Open control center. Enable managed screens for this restaurant, then choose Pair a screen. Name the device, choose POS, Self-order kiosk, Kitchen station, Expeditor, or Pickup board, and assign its location and kitchen station. Choose Generate pairing code, open the displayed address on the store browser, and enter the one-use code within 15 minutes. Use Preview to inspect a role without changing orders. Use Fullscreen on the device; browser fullscreen remains available if the request is blocked.",
      "expectedResult": "The device appears with its role, location, heartbeat, last successful sync, pending operations and configuration acknowledgement. A live connection alone does not mean its data or configuration is current.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed pair screen, light mode",
          "alt": "Synthetic example: Pair and configure the store screens",
          "caption": "Pair and configure the store screens, desktop component fixture; no live account or payment data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed pair screen, light mode",
          "alt": "Synthetic example: Pair and configure the store screens",
          "caption": "Pair and configure the store screens, mobile component fixture; no live account or payment data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-screen-control-kitchen",
      "title": "Prepare each station’s items",
      "body": "Use a paired Kitchen station screen. Start preparation for an item, follow its modifiers and instructions, then choose Item ready when that item is complete. Watch elapsed time and the Overdue indicator. A station cannot publish the entire order as ready. POS payments still require staff sign-in in the established POS page; paired POS capture only creates unpaid drafts for review.",
      "expectedResult": "Item completion reaches the expeditor using the same server order and queue number. Other stations keep their remaining work.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed kitchen screen, light mode",
          "alt": "Synthetic example: Prepare each station’s items",
          "caption": "Prepare each station’s items, desktop component fixture; no live account or payment data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed kitchen screen, light mode",
          "alt": "Synthetic example: Prepare each station’s items",
          "caption": "Prepare each station’s items, mobile component fixture; no live account or payment data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-screen-control-expeditor",
      "title": "Check assembly, publish readiness and hand off",
      "body": "On the Expeditor screen choose Review assembly after the station items are done. Confirm the physical order and choose Complete quality check. The pickup board and customer tracking then reflect readiness. Record payment at POS before Confirm pickup handoff. Delivery handoff continues in the existing runner workflow. On the public pickup board, Enable sound is optional.",
      "expectedResult": "The customer sees the confirmed queue number and readiness. Handoff completes the existing order; it does not create a second order or record an offline payment.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed expeditor screen, light mode",
          "alt": "Synthetic example: Check assembly, publish readiness and hand off",
          "caption": "Check assembly, publish readiness and hand off, desktop component fixture; no live account or payment data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed expeditor screen, light mode",
          "alt": "Synthetic example: Check assembly, publish readiness and hand off",
          "caption": "Check assembly, publish readiness and hand off, mobile component fixture; no live account or payment data.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-screen-control-review",
      "title": "Recover unpaid work and conflicts",
      "body": "If internet fails, keep the browser open. Browser kiosks and the managed POS capture screen save unpaid provisional tickets on this browser. A local reference is never a confirmed queue number. After reconnection paired devices upload drafts into Unpaid orders to review. For unpaired legacy kiosks, authorized staff opens Local recovery on this browser to import the draft. Choose Review current items and total, resolve unavailable items with the customer, and accept the current unpaid order only after explicit review. Payments, credit, refunds and approvals require their normal online confirmation.",
      "expectedResult": "Accepted drafts enter production once. Price or availability conflicts stay unresolved until reviewed; no silent substitutions or financial retries occur.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed review screen, light mode",
          "alt": "Synthetic example: Recover unpaid work and conflicts",
          "caption": "Recover unpaid work and conflicts, desktop component fixture; no live account or payment data.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/screens/:restaurantId/:screenRole",
          "state": "Synthetic managed review screen, light mode",
          "alt": "Synthetic example: Recover unpaid work and conflicts",
          "caption": "Recover unpaid work and conflicts, mobile component fixture; no live account or payment data.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The same confirmed order identity progresses from creation through kitchen, expeditor, pickup and handoff. Unresolved provisional work stays available for authorized review.",
  "recovery": [
    {
      "problem": "The screen is offline or stale.",
      "solution": "Devices cannot exchange new work during a store-wide internet outage. Restore connectivity, refresh, and compare last successful sync with heartbeat and configuration acknowledgement. Do not treat cached state as confirmation."
    },
    {
      "problem": "A device is disabled, authorization expired, or its location changed.",
      "solution": "Authorized staff must pair it again. Use Local recovery on this browser to import unresolved unpaid drafts from older sessions for staff acceptance. Reconcile old kitchen actions and POS financial diagnostics against current server records; they are not replayed as payments."
    },
    {
      "problem": "A menu price or availability changed.",
      "solution": "Review current items and total with the customer. If an item is unavailable, retain or dismiss the provisional ticket deliberately; do not substitute silently."
    },
    {
      "problem": "Rolling back managed screens.",
      "solution": "Disable managed screens in the control center. Legacy screen URLs and unresolved unpaid review remain accessible. Do not clear browser storage while unresolved work remains."
    }
  ],
  "supportContact": "Use /support for device or synchronization problems. Include the device name and local ticket reference; never share its device credential.",
  "relatedGuides": [
    "restaurant-preparation",
    "restaurant-staff-tools",
    "restaurant-pickup-delivery-handoff"
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
      "ref": "/restaurants/screens/:restaurantId/:screenRole"
    },
    {
      "type": "screen",
      "ref": "client/src/restaurantScreens/ControlCenter.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/restaurantScreens/ManagedScreen.jsx"
    },
    {
      "type": "handler",
      "ref": "server/controllers/restaurantScreensController.js"
    }
  ]
};
