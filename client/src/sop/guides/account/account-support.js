// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-support",
  "area": "account",
  "slug": "get-support",
  "title": "Get help and track support tickets",
  "audiences": [
    "customer",
    "helper",
    "business",
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Start a support conversation, escalate it to a tracked ticket, and follow it to resolution.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner",
    "Restaurant"
  ],
  "prerequisites": [
    {
      "text": "Know the job, booking, or order the issue is about, and have photos or receipts ready.",
      "href": null
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the support page",
        "type": "terminal"
      },
      {
        "id": "start chat",
        "label": "Start a support conversation",
        "type": "step"
      },
      {
        "id": "verify",
        "label": "Guests verify with an email code",
        "type": "decision"
      },
      {
        "id": "escalate",
        "label": "Escalate to a tracked ticket",
        "type": "step"
      },
      {
        "id": "track",
        "label": "Track the ticket and reply",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Issue resolved",
        "type": "terminal"
      },
      {
        "id": "guest",
        "label": "Enter name and email to continue",
        "type": "blocked"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "start chat"
      },
      {
        "from": "start chat",
        "to": "verify"
      },
      {
        "from": "verify",
        "to": "escalate",
        "label": "Signed in"
      },
      {
        "from": "verify",
        "to": "guest",
        "label": "Guest"
      },
      {
        "from": "guest",
        "to": "escalate"
      },
      {
        "from": "escalate",
        "to": "track"
      },
      {
        "from": "track",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open /support. 2. Start a support conversation and describe the issue; guests verify with an email code first. 3. If the issue needs human follow-up, it is escalated into a tracked ticket and you get a ticket identifier. 4. Track the ticket on /support/my-tickets/:ticketId: read replies under Messages, answer with the Reply box (\"Write your reply...\"), and reopen it if needed. 5. The ticket closes when the issue is resolved.",
  "steps": [
    {
      "id": "account-support-s1",
      "title": "Open the support page and start a conversation",
      "body": "Open /support (the Help menu links here). Start a new support conversation and describe what went wrong. The page tells you when escalation is best: \"Urgent booking or support failures where normal chat was not enough.\" Attach an image with \"Attach image\" when the issue is visible.",
      "expectedResult": "A support conversation opens and your first message is sent.",
      "screenshots": [
        {
          "id": "account-support-s1-desktop",
          "viewport": "desktop",
          "screen": "/support",
          "state": "New support conversation, light mode",
          "alt": "Support page with a new conversation composer",
          "caption": "Starting a support conversation, desktop view.",
          "annotations": []
        },
        {
          "id": "account-support-s1-mobile",
          "viewport": "mobile",
          "screen": "/support",
          "state": "New support conversation, light mode",
          "alt": "Support conversation on a phone screen",
          "caption": "The support page, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-support-s2",
      "title": "Escalate to a tracked ticket when needed",
      "body": "For issues that need a human decision (payment or refund problems, safety or trust issues), escalate the conversation. The page explains \"What happens after you submit\": the escalation becomes a tracked ticket, the team can follow up by email, and \"You get a ticket identifier to reference if the issue continues.\" Save that identifier.",
      "expectedResult": "You receive a ticket identifier for the tracked ticket.",
      "screenshots": [
        {
          "id": "account-support-s2-desktop",
          "viewport": "desktop",
          "screen": "/support/escalation",
          "state": "Escalation submitted, ticket identifier shown, light mode",
          "alt": "Escalation confirmation with the ticket identifier",
          "caption": "The escalation confirmation with your ticket identifier.",
          "annotations": []
        },
        {
          "id": "account-support-s2-mobile",
          "viewport": "mobile",
          "screen": "/support/escalation",
          "state": "Escalation submitted, ticket identifier shown, light mode",
          "alt": "Escalation confirmation on a phone screen",
          "caption": "The escalation confirmation, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-support-s3",
      "title": "Track the ticket and reply to the team",
      "body": "Open your ticket (signed-in users: your tickets list; guests: the ticket link from email). The ticket page shows Category, Priority, and Created, with the \"Messages\" thread. Write in the Reply box (placeholder \"Write your reply...\") and choose Reply. If the ticket was closed but the issue continues, reopen it from the support center.",
      "expectedResult": "Your reply appears in the Messages thread and the team is notified.",
      "screenshots": [
        {
          "id": "account-support-s3-desktop",
          "viewport": "desktop",
          "screen": "/support/my-tickets/:ticketId",
          "state": "Ticket detail with messages thread, signed in, light mode",
          "alt": "Ticket detail page with the messages thread and reply box",
          "caption": "The ticket detail page, desktop view.",
          "annotations": []
        },
        {
          "id": "account-support-s3-mobile",
          "viewport": "mobile",
          "screen": "/support/my-tickets/:ticketId",
          "state": "Ticket detail with messages thread, signed in, light mode",
          "alt": "Ticket detail on a phone screen",
          "caption": "The ticket detail page, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Messages thread",
              "locator": ".messages"
            }
          ]
        }
      ]
    }
  ],
  "confirmOutcome": "The ticket page shows your messages and the team's replies; closed tickets say so and can be reopened.",
  "recovery": [
    {
      "problem": "The conversation will not verify (guest).",
      "solution": "Use the exact email you started the conversation with and enter the code before it expires. Choose the resend option if nothing arrives."
    },
    {
      "problem": "The ticket page fails to load.",
      "solution": "Reload and check you opened the current ticket link. If the error persists, start a fresh conversation and reference your ticket identifier."
    }
  ],
  "supportContact": "For urgent safety issues, use the direct contact option on the escalation page (\"Need a faster response?\").",
  "relatedGuides": [
    "account-signin",
    "hiring-disputes"
  ],
  "siteLinks": [
    {
      "label": "Support",
      "href": "/support"
    },
    {
      "label": "Escalation",
      "href": "/support/escalation"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/support"
    },
    {
      "type": "route",
      "ref": "/support/escalation"
    },
    {
      "type": "route",
      "ref": "/support/my-tickets/:ticketId"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/SupportEscalationPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/SupportTicketDetailPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/support/public/conversations, POST /api/support/request, GET /api/support/my-tickets"
    },
    {
      "type": "permission",
      "ref": "Guest for public conversations (code-verified); authenticated for tickets."
    }
  ]
};
