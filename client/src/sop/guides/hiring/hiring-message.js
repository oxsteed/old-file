// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-message",
  "area": "hiring",
  "slug": "message-about-job",
  "title": "Message about a job or booking",
  "audiences": [
    "customer",
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Message helpers and customers about jobs, bookings, and bids from the Messages inbox.",
  "intendedRoles": [
    "Customer",
    "Helper"
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
        "label": "Open Messages",
        "type": "terminal"
      },
      {
        "id": "find",
        "label": "Find the conversation",
        "type": "step"
      },
      {
        "id": "thread",
        "label": "Open the thread",
        "type": "step"
      },
      {
        "id": "send",
        "label": "Write and send your message",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Message delivered",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "find"
      },
      {
        "from": "find",
        "to": "thread"
      },
      {
        "from": "thread",
        "to": "send"
      },
      {
        "from": "send",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open /messages (\"Messages\"). 2. Use the search box (\"Search people, jobs, or messages...\") or the filters (\"Filter conversations\", All / Unread) to find the thread. 3. Open the conversation thread. 4. Type in the message box and choose \"Send\". Job-scoped conversations start from a job or booking; helpers also see guest inquiries here.",
  "steps": [
    {
      "id": "hiring-message-s1",
      "title": "Open Messages and find the conversation",
      "body": "Open /messages. The page title is \"Messages\" with the conversation list, a search box (\"Search people, jobs, or messages...\"), and filters (\"Filter conversations\") including All and Unread. Guest inquiries from customers who have not booked yet also land here.",
      "expectedResult": "Your conversations are listed with unread counts.",
      "screenshots": [
        {
          "id": "hiring-message-s1-desktop",
          "viewport": "desktop",
          "screen": "/messages",
          "state": "Messages inbox with conversations, signed in, light mode",
          "alt": "Messages inbox with search and conversation list",
          "caption": "The Messages inbox, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Search box",
              "locator": "input[type=\"search\"]"
            }
          ]
        },
        {
          "id": "hiring-message-s1-mobile",
          "viewport": "mobile",
          "screen": "/messages",
          "state": "Messages inbox with conversations, signed in, light mode",
          "alt": "Messages inbox on a phone screen",
          "caption": "The Messages inbox, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-message-s2",
      "title": "Open the thread and send your message",
      "body": "Choose a conversation to open the thread. The composer placeholder is \"Type a message...\" (helpers see \"Type a reply\"). Write your message and choose \"Send\". Messages send in real time; failed sends show a retry option.",
      "expectedResult": "Your message appears in the thread.",
      "screenshots": [
        {
          "id": "hiring-message-s2-desktop",
          "viewport": "desktop",
          "screen": "/messages/:conversationId",
          "state": "Conversation thread open, signed in, light mode",
          "alt": "Conversation thread with messages and the composer",
          "caption": "The conversation thread, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-message-s2-mobile",
          "viewport": "mobile",
          "screen": "/messages/:conversationId",
          "state": "Conversation thread open, signed in, light mode",
          "alt": "Conversation thread on a phone screen",
          "caption": "The conversation thread, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Your message appears in the thread and the other party is notified. Job-context threads stay linked to the job for the record.",
  "recovery": [
    {
      "problem": "You cannot find the conversation.",
      "solution": "Use the search box and check the Unread filter; archived threads are under the archived view."
    },
    {
      "problem": "A message fails to send.",
      "solution": "Use the retry option. If it keeps failing, reload the page and try again."
    }
  ],
  "supportContact": "For urgent issues that messaging cannot resolve, escalate from /support.",
  "relatedGuides": [
    "hiring-post-job",
    "hiring-book",
    "hiring-disputes",
    "account-support"
  ],
  "siteLinks": [
    {
      "label": "Messages",
      "href": "/messages"
    },
    {
      "label": "My jobs",
      "href": "/my-jobs"
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
      "type": "screen",
      "ref": "client/src/pages/MessagesPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/messaging/MessagingWorkspace.jsx"
    },
    {
      "type": "handler",
      "ref": "GET/POST /api/messages/conversations, POST /api/messages/jobs/:jobId/conversation"
    },
    {
      "type": "permission",
      "ref": "Authenticated."
    }
  ]
};
