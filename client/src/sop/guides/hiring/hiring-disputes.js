// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-disputes",
  "area": "hiring",
  "slug": "open-dispute",
  "title": "Open and manage a dispute",
  "audiences": [
    "customer",
    "helper"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Open a dispute on a job, preserve evidence, and message the other party until it resolves.",
  "intendedRoles": [
    "Customer",
    "Helper"
  ],
  "prerequisites": [
    {
      "text": "Be signed in to your OxSteed account.",
      "guideId": "account-signin",
      "href": "/login"
    },
    {
      "text": "Try to clarify the scope in messages first; disputes work best with a written record.",
      "guideId": "hiring-message",
      "href": "/messages"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the disputes center",
        "type": "terminal"
      },
      {
        "id": "job",
        "label": "Open a dispute from the job",
        "type": "step"
      },
      {
        "id": "evidence",
        "label": "Submit evidence",
        "type": "step"
      },
      {
        "id": "talk",
        "label": "Message the other party in the thread",
        "type": "step"
      },
      {
        "id": "review",
        "label": "Admin reviews the dispute",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Dispute resolved",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "job"
      },
      {
        "from": "job",
        "to": "evidence"
      },
      {
        "from": "evidence",
        "to": "talk"
      },
      {
        "from": "talk",
        "to": "review"
      },
      {
        "from": "review",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open /disputes (\"Trust and resolution center\") and choose \"Open a dispute from a job\". 2. Pick the job and describe the issue. 3. Add evidence on the dispute detail page: the \"Evidence ({{count}})\" section with \"Submit Evidence\" and \"Attach files (images, videos, documents - max 5)\". 4. Use the \"Messages\" thread (\"Type a message...\") to discuss with the other party so support can follow the record. 5. When the evidence window closes (\"Evidence window closed. Awaiting admin review.\"), an admin reviews and the dispute resolves.",
  "steps": [
    {
      "id": "hiring-disputes-s1",
      "title": "Open a dispute from the job",
      "body": "Open /disputes, the \"Trust and resolution center\". Your disputes are listed with Open and In review stats. Choose \"Open a dispute from a job\" (or \"Open a dispute\" on the job detail page), pick the job, and describe the issue. Before opening, the empty state reminds you to clarify scope in messages and to save photos, receipts, and time details.",
      "expectedResult": "The dispute is created and opens on its detail page.",
      "screenshots": [
        {
          "id": "hiring-disputes-s1-desktop",
          "viewport": "desktop",
          "screen": "/disputes",
          "state": "Dispute center with disputes listed, signed in, light mode",
          "alt": "Dispute center with the Open a dispute from a job button",
          "caption": "The dispute center, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-disputes-s1-mobile",
          "viewport": "mobile",
          "screen": "/disputes",
          "state": "Dispute center with disputes listed, signed in, light mode",
          "alt": "Dispute center on a phone screen",
          "caption": "The dispute center, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-disputes-s2",
      "title": "Submit evidence while the window is open",
      "body": "On the dispute detail page (/disputes/:id), find the \"Evidence ({{count}})\" section. Describe what happened in the evidence box (\"Describe what happened, provide context, links, or any relevant information...\") and add up to 5 files with \"Attach files (images, videos, documents - max 5)\". Choose \"Submit Evidence\". You must provide text or files; empty submissions are rejected.",
      "expectedResult": "Your evidence appears in the Evidence section with a count.",
      "screenshots": [
        {
          "id": "hiring-disputes-s2-desktop",
          "viewport": "desktop",
          "screen": "/disputes/:id",
          "state": "Dispute detail, evidence section open, signed in, light mode",
          "alt": "Evidence section with the submit form",
          "caption": "The Evidence section, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-disputes-s2-mobile",
          "viewport": "mobile",
          "screen": "/disputes/:id",
          "state": "Dispute detail, evidence section open, signed in, light mode",
          "alt": "Evidence form on a phone screen",
          "caption": "The evidence form, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-disputes-s3",
      "title": "Keep the discussion in the dispute thread",
      "body": "Use the \"Messages\" section on the dispute detail page (\"Type a message...\") for all discussion with the other party. Keeping the discussion focused here (not in scattered chats) lets support follow the record. \"Open messages\" jumps to the thread from the center.",
      "expectedResult": "Messages appear in the dispute thread for both parties and support to see.",
      "screenshots": [
        {
          "id": "hiring-disputes-s3-desktop",
          "viewport": "desktop",
          "screen": "/disputes/:id",
          "state": "Dispute detail, messages thread, signed in, light mode",
          "alt": "Dispute messages thread with the message box",
          "caption": "The dispute Messages thread.",
          "annotations": []
        },
        {
          "id": "hiring-disputes-s3-mobile",
          "viewport": "mobile",
          "screen": "/disputes/:id",
          "state": "Dispute detail, messages thread, signed in, light mode",
          "alt": "Dispute messages on a phone screen",
          "caption": "The messages thread, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The dispute shows its status in the center (Open, then In review). When resolved, the outcome, refunds, and release decisions stay attached to the job.",
  "recovery": [
    {
      "problem": "You cannot add more evidence.",
      "solution": "The evidence window may be closed (\"Evidence window closed. Awaiting admin review.\"). Add new facts as messages instead."
    },
    {
      "problem": "The other party will not engage.",
      "solution": "Admin review proceeds on the record you built. For urgent safety or payment issues, also use support escalation at /support/escalation."
    }
  ],
  "supportContact": "For urgent safety or payment issues, use the support escalation page at /support/escalation alongside the dispute.",
  "relatedGuides": [
    "hiring-message",
    "hiring-cancellations",
    "account-support",
    "hiring-work-agreements"
  ],
  "siteLinks": [
    {
      "label": "Disputes",
      "href": "/disputes"
    },
    {
      "label": "My jobs",
      "href": "/my-jobs"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/disputes"
    },
    {
      "type": "route",
      "ref": "/disputes/:id"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/disputes/DisputeCenter.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/disputes/DisputeDetail.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/disputes, POST /api/disputes/jobs/:jobId, POST /api/disputes/:disputeId/evidence, /messages"
    },
    {
      "type": "permission",
      "ref": "Authenticated."
    }
  ]
};
