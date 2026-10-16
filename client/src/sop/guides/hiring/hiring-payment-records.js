// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-payment-records",
  "area": "hiring",
  "slug": "payment-records",
  "title": "See payment and order records",
  "audiences": [
    "customer"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Find your bookings, product orders, and food orders, and read the payment and receipt details on each.",
  "intendedRoles": [
    "Customer"
  ],
  "prerequisites": [
    {
      "text": "Be signed in to your OxSteed account.",
      "guideId": "account-signin",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Choose the right records page",
        "type": "terminal"
      },
      {
        "id": "bookings",
        "label": "Check My bookings",
        "type": "step"
      },
      {
        "id": "orders",
        "label": "Check Order History",
        "type": "step"
      },
      {
        "id": "detail",
        "label": "Open the order detail",
        "type": "step"
      },
      {
        "id": "track",
        "label": "Track a food order by link",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Record reviewed",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "bookings"
      },
      {
        "from": "bookings",
        "to": "done"
      },
      {
        "from": "start",
        "to": "orders"
      },
      {
        "from": "orders",
        "to": "detail"
      },
      {
        "from": "detail",
        "to": "done"
      },
      {
        "from": "start",
        "to": "track"
      },
      {
        "from": "track",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Bookings live on /my-bookings; product and food orders live on \"Order History\" (/orders). 2. On Order History, filter by status when needed (\"Nothing matches this filter yet.\" when empty). 3. Open an order (/orders/:id) to see items, payment records, and the \"Cancel Order\" action with the \"Are you sure you want to cancel this order?\" confirm. 4. Food orders can also be tracked by anyone with the link at /food/track/:token.",
  "steps": [
    {
      "id": "hiring-payment-records-s1",
      "title": "Review your bookings on My bookings",
      "body": "Open /my-bookings. Each booking shows its status (Pending, Accepted, Declined, Cancelled, Expired) with actions that match the state, such as Cancel, Complete, or Confirm. This is the payment and scheduling record for helper and business bookings.",
      "expectedResult": "Your bookings are listed with their current statuses.",
      "screenshots": [
        {
          "id": "hiring-payment-records-s1-desktop",
          "viewport": "desktop",
          "screen": "/my-bookings",
          "state": "Bookings list, signed in, light mode",
          "alt": "My bookings page with booking records",
          "caption": "Your booking records, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-payment-records-s1-mobile",
          "viewport": "mobile",
          "screen": "/my-bookings",
          "state": "Bookings list, signed in, light mode",
          "alt": "My bookings on a phone screen",
          "caption": "Your booking records, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-payment-records-s2",
      "title": "Open Order History for product and food orders",
      "body": "Open /orders (\"Order History\", subtitled \"Track restaurant orders, preparation status, payment records, and receipts in one place.\"). Filter by status when you have many orders. Each order shows what was bought, what was paid, and the current state. Before your first purchase the page shows \"Your order history is ready before your first purchase.\"",
      "expectedResult": "Your orders are listed with payment and status details.",
      "screenshots": [
        {
          "id": "hiring-payment-records-s2-desktop",
          "viewport": "desktop",
          "screen": "/orders",
          "state": "Order History with orders, signed in, light mode",
          "alt": "Order History page with order cards",
          "caption": "The Order History page, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-payment-records-s2-mobile",
          "viewport": "mobile",
          "screen": "/orders",
          "state": "Order History with orders, signed in, light mode",
          "alt": "Order History on a phone screen",
          "caption": "The Order History page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-payment-records-s3",
      "title": "Open an order detail for the full record",
      "body": "Choose an order to open /orders/:id. The detail page shows items, the payment record, and receipts; food orders show preparation status. \"Cancel Order\" appears when cancellation is allowed, asking \"Are you sure you want to cancel this order?\" before it runs. \"Get help with this order\" links to support when something is wrong.",
      "expectedResult": "The full order record is visible with its payment history.",
      "screenshots": [
        {
          "id": "hiring-payment-records-s3-desktop",
          "viewport": "desktop",
          "screen": "/orders/:id",
          "state": "Order detail with payment records, signed in, light mode",
          "alt": "Order detail page with payment and receipt sections",
          "caption": "The order detail page, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-payment-records-s3-mobile",
          "viewport": "mobile",
          "screen": "/orders/:id",
          "state": "Order detail with payment records, signed in, light mode",
          "alt": "Order detail on a phone screen",
          "caption": "The order detail page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-payment-records-s4",
      "title": "Track a food order with the tracking link",
      "body": "Food orders come with a tracking link at /food/track/:token. Anyone with the link can open it without signing in to see preparation and delivery status. Keep the link private; it is the guest key to that order.",
      "expectedResult": "The tracking page shows the live order status.",
      "screenshots": [
        {
          "id": "hiring-payment-records-s4-desktop",
          "viewport": "desktop",
          "screen": "/food/track/:token",
          "state": "Food order tracking page, guest, light mode",
          "alt": "Food order tracking page with status timeline",
          "caption": "The food order tracking page, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-payment-records-s4-mobile",
          "viewport": "mobile",
          "screen": "/food/track/:token",
          "state": "Food order tracking page, guest, light mode",
          "alt": "Food tracking on a phone screen",
          "caption": "The tracking page, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Each booking and order shows its status and payment record. Statements for deeper accounting live at /statements.",
  "recovery": [
    {
      "problem": "An order is missing from the list.",
      "solution": "Check the status filters; a filtered view may hide it (\"Nothing matches this filter yet.\"). Also confirm you are signed in to the account that placed the order."
    },
    {
      "problem": "Cancel fails on an order.",
      "solution": "Cancellation is only allowed in certain states; \"Failed to cancel order\" means the order already moved past the cancellable point. Use \"Get help with this order\" for a refund request."
    }
  ],
  "supportContact": "For payment questions on a specific order, use \"Get help with this order\" or visit /support.",
  "relatedGuides": [
    "hiring-book",
    "hiring-cancellations",
    "hiring-reviews"
  ],
  "siteLinks": [
    {
      "label": "Order History",
      "href": "/orders"
    },
    {
      "label": "My bookings",
      "href": "/my-bookings"
    },
    {
      "label": "Statements",
      "href": "/statements"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/my-bookings"
    },
    {
      "type": "route",
      "ref": "/orders"
    },
    {
      "type": "route",
      "ref": "/orders/:id"
    },
    {
      "type": "route",
      "ref": "/food/track/:token"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/MyBookingsPage.tsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/OrderHistoryPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/OrderDetailsPage.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/bookings, /api/orders, GET /api/food/orders/track/:trackingToken"
    },
    {
      "type": "permission",
      "ref": "Authenticated; food tracking token is guest-accessible."
    }
  ]
};
