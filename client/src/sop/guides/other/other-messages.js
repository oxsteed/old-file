// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "other-messages",
  "area": "messages",
  "slug": "send-messages",
  "title": "Message across the platform",
  "audiences": [
    "customer",
    "helper",
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Find a conversation, read messages, and send replies across customer and helper inboxes.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "A signed-in OxSteed account.",
      "href": "/login"
    },
    {
      "text": "A job, booking, or inquiry that created a conversation.",
      "href": "/messages"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open Messages",
        "type": "terminal"
      },
      {
        "id": "find",
        "label": "Find the conversation",
        "type": "step"
      },
      {
        "id": "open-conv",
        "label": "Open the conversation",
        "type": "step"
      },
      {
        "id": "write",
        "label": "Type and send a message",
        "type": "step"
      },
      {
        "id": "helper-inbox",
        "label": "Helpers: check the helper inbox",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Message sent",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "find"
      },
      {
        "from": "find",
        "to": "open-conv"
      },
      {
        "from": "open-conv",
        "to": "write"
      },
      {
        "from": "write",
        "to": "helper-inbox"
      },
      {
        "from": "helper-inbox",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open Messages at /messages. 2. Find the conversation in the list; an empty inbox shows \"No conversations yet\". 3. Open the conversation at /messages/:conversationId. 4. Type in the \"Type a message…\" box and choose \"Send\". 5. Helpers have a separate inbox at /helper/messages with the same flow. 6. Your message is delivered and marked seen when read.",
  "steps": [
    {
      "id": "other-messages-s1",
      "title": "Open the Messages inbox",
      "body": "Open /messages while signed in. The page is titled \"Messages\". The conversation list shows recent threads with unread badges. An empty inbox shows \"No conversations yet\". Helpers also have a dedicated inbox at /helper/messages with the same layout.",
      "expectedResult": "Your conversations are listed, newest first.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/messages",
          "state": "Messages inbox with conversations, signed in, light mode",
          "alt": "Messages inbox with the conversation list",
          "caption": "The Messages inbox, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/messages",
          "state": "Messages inbox, signed in, light mode",
          "alt": "Messages inbox on a phone screen",
          "caption": "The Messages inbox, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-messages-s2",
      "title": "Open a conversation",
      "body": "Choose a conversation to open /messages/:conversationId. The thread shows message history with timestamps (\"Today\", \"Yesterday\") and seen indicators. If the conversation is missing, the page shows a not-found message.",
      "expectedResult": "The full message thread loads.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Conversation thread with history, light mode",
          "alt": "Open conversation with message history",
          "caption": "A conversation, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Conversation thread, light mode",
          "alt": "Conversation on a phone screen",
          "caption": "A conversation, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-messages-s3",
      "title": "Type and send a message",
      "body": "Type in the \"Type a message…\" box at the bottom and choose \"Send\". The other party sees a typing indicator while you write. Your sent message appears in the thread and shows as seen once read.",
      "expectedResult": "Your message appears in the thread immediately.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Message typed in the composer, light mode",
          "alt": "Message composer with the Send button",
          "caption": "Sending a message, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Message composer, light mode",
          "alt": "Composer on a phone screen",
          "caption": "Sending a message, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-messages-s4",
      "title": "Check the helper inbox",
      "body": "Helpers: open /helper/messages for the helper inbox, which mirrors the same flow with helper-context threads (guest inquiries, job conversations). Switch back to /messages for customer-context threads.",
      "expectedResult": "You see helper-context conversations separately from customer ones.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/helper/messages",
          "state": "Helper inbox, signed in as helper, light mode",
          "alt": "Helper messages inbox",
          "caption": "The helper inbox, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/helper/messages",
          "state": "Helper inbox, signed in as helper, light mode",
          "alt": "Helper inbox on a phone screen",
          "caption": "The helper inbox, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Your message appears in the thread and is marked seen when the other party reads it.",
  "recovery": [
    {
      "problem": "A conversation is missing from the list.",
      "solution": "Check the other inbox (customer vs helper). Guest inquiries also appear under their own entry."
    },
    {
      "problem": "Messages fail to send.",
      "solution": "Check your connection and try again. If the thread still fails, contact support at /support."
    }
  ],
  "supportContact": "Messaging issues: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "other-media",
    "other-calendar"
  ],
  "siteLinks": [
    {
      "label": "Messages",
      "href": "/messages"
    },
    {
      "label": "Helper inbox",
      "href": "/helper/messages"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/messages"
    },
    {
      "type": "route",
      "ref": "/messages/:conversationId"
    },
    {
      "type": "route",
      "ref": "/helper/messages"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/MessagesPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/ConversationPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/HelperInboxPage.jsx"
    },
    {
      "type": "handler",
      "ref": "GET /api/messages/conversations"
    }
  ]
};
