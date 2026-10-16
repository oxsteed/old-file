// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "helper-work-quotes",
  "area": "helper-work",
  "slug": "send-customer-quotes",
  "title": "Send quotes to customers",
  "audiences": [
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Send a priced quote to a customer from your conversation so they can accept and book.",
  "intendedRoles": [
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Sign in and switch to helper mode.",
      "href": "/login"
    },
    {
      "text": "Start a conversation with a customer (from a job, booking, or inquiry).",
      "href": "/messages"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the customer conversation",
        "type": "terminal"
      },
      {
        "id": "quote",
        "label": "Choose Quote in the provider toolbar",
        "type": "step"
      },
      {
        "id": "pick",
        "label": "Pick an existing quote or quick-build one",
        "type": "decision"
      },
      {
        "id": "build",
        "label": "Add title, line items, tax, and validity",
        "type": "step"
      },
      {
        "id": "share",
        "label": "Choose Share in chat",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Quote shared in the thread",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "quote"
      },
      {
        "from": "quote",
        "to": "pick"
      },
      {
        "from": "pick",
        "to": "build",
        "label": "Quick build"
      },
      {
        "from": "pick",
        "to": "share",
        "label": "Pick existing"
      },
      {
        "from": "build",
        "to": "share"
      },
      {
        "from": "share",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the customer conversation. 2. Choose Quote in the provider toolbar. 3. Pick an existing quote or quick-build a new one. 4. For a new quote, add a title, line items, tax percentage, and validity date. 5. Choose Share in chat. 6. The quote is shared in the conversation thread and the customer can review it.",
  "steps": [
    {
      "id": "helper-work-quotes-s1",
      "title": "Open the customer conversation",
      "body": "Open /messages and choose the conversation with the customer. Helper quotes are sent from the conversation thread, not from a standalone quotes page. This is the helper quote system; business quotes live in the business hub Quotes tab and Direct quotes live in the Direct portal.",
      "expectedResult": "The conversation thread loads with your provider toolbar visible.",
      "screenshots": [
        {
          "id": "helper-work-quotes-s1-desktop",
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Conversation open, synthetic messages, light mode",
          "alt": "Conversation thread with the provider toolbar above the message list",
          "caption": "A customer conversation, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-quotes-s1-mobile",
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Conversation open, synthetic messages, light mode",
          "alt": "Conversation thread on a phone screen",
          "caption": "A customer conversation, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-quotes-s2",
      "title": "Choose Quote in the provider toolbar",
      "body": "In the provider toolbar above the thread, choose the Quote button (title \"Share a quote\"). The Share a quote panel opens with two tabs: Pick existing and Quick build.",
      "expectedResult": "The Share a quote panel opens with Pick existing and Quick build tabs.",
      "screenshots": [
        {
          "id": "helper-work-quotes-s2-desktop",
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Share a quote panel open, light mode",
          "alt": "Share a quote panel with Pick existing and Quick build tabs",
          "caption": "The Share a quote panel, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-quotes-s2-mobile",
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Share a quote panel open, light mode",
          "alt": "Share a quote panel on a phone screen",
          "caption": "The Share a quote panel, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-quotes-s3",
      "title": "Build the quote",
      "body": "On the Quick build tab, enter a Title, then add line items with Description, Qty, and Price (use Add line for more items). Set the Tax % and the Valid until date so the customer knows how long the price holds.",
      "expectedResult": "At least one line item is entered and the totals preview correctly.",
      "screenshots": [
        {
          "id": "helper-work-quotes-s3-desktop",
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Quick build tab with two synthetic line items, light mode",
          "alt": "Quick build tab with title, two line items, tax, and valid-until date filled in",
          "caption": "Building a quote, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-quotes-s3-mobile",
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Quick build tab with one synthetic line item, light mode",
          "alt": "Quote builder on a phone screen",
          "caption": "Building a quote, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-quotes-s4",
      "title": "Share the quote in chat",
      "body": "Choose Share in chat. The quote posts into the conversation thread where the customer can open and review it. If sharing fails, check your connection and try again.",
      "expectedResult": "The quote appears in the thread as a quote card.",
      "screenshots": [
        {
          "id": "helper-work-quotes-s4-desktop",
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Quote card posted in thread, synthetic data, light mode",
          "alt": "Conversation thread showing the shared quote card with the total price",
          "caption": "A shared quote in the thread, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-quotes-s4-mobile",
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Quote card posted in thread, synthetic data, light mode",
          "alt": "Shared quote card on a phone screen",
          "caption": "A shared quote in the thread, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "helper-work-quotes-s5",
      "title": "Review your sent quotes",
      "body": "Open your dashboard Quotes tab (My Quotes) or choose Quote history in Messages to see every quote you have sent, with their status. Picking an existing quote in the Share a quote panel reuses one of these.",
      "expectedResult": "Your sent quotes list shows the quote with its current status.",
      "screenshots": [
        {
          "id": "helper-work-quotes-s5-desktop",
          "viewport": "desktop",
          "screen": "/dashboard?tab=quotes",
          "state": "Quotes tab with synthetic sent quotes, light mode",
          "alt": "Quotes sent list on the dashboard showing quote titles and statuses",
          "caption": "Quotes sent, desktop view.",
          "annotations": []
        },
        {
          "id": "helper-work-quotes-s5-mobile",
          "viewport": "mobile",
          "screen": "/dashboard?tab=quotes",
          "state": "Quotes tab with synthetic sent quotes, light mode",
          "alt": "Quotes sent list on a phone screen",
          "caption": "Quotes sent, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The quote card appears in the conversation and the quote is listed under Quotes sent with its status.",
  "recovery": [
    {
      "problem": "The Quote button is missing from the thread.",
      "solution": "Only providers (helpers or business staff) see the provider toolbar. Switch to helper mode and confirm the conversation is one where you are the provider."
    },
    {
      "problem": "Share in chat fails.",
      "solution": "Add at least one line item with a description and price, then try again. A lost connection will also fail, so reload and retry."
    }
  ],
  "supportContact": "If quotes do not appear for the customer, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "helper-work-bid",
    "helper-work-clients"
  ],
  "siteLinks": [
    {
      "label": "Messages",
      "href": "/messages"
    },
    {
      "label": "My Quotes",
      "href": "/dashboard?tab=quotes"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/messages/:conversationId"
    },
    {
      "type": "screen",
      "ref": "client/src/components/helperProfile/chat/QuoteSharePanel.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/chat/quotes/share"
    }
  ]
};
