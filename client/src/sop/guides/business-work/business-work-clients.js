// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "business-work-clients",
  "area": "business-work",
  "slug": "manage-business-clients",
  "title": "Manage business clients",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Keep a clean, searchable client list for your business with notes and lifetime value.",
  "intendedRoles": [
    "Business owner",
    "Business manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in and open your business in the business hub.",
      "guideId": "business-work-select",
      "href": "/business-hub"
    },
    {
      "text": "Owner or manager capability to edit the business profile.",
      "href": "/business-hub?tab=clients"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Clients tab",
        "type": "terminal"
      },
      {
        "id": "add",
        "label": "Choose Add client",
        "type": "step"
      },
      {
        "id": "fill",
        "label": "Enter the client details",
        "type": "step"
      },
      {
        "id": "check",
        "label": "Client name entered?",
        "type": "decision"
      },
      {
        "id": "fix",
        "label": "Enter the client name",
        "type": "blocked"
      },
      {
        "id": "save",
        "label": "Save the client",
        "type": "step"
      },
      {
        "id": "manage",
        "label": "Edit, search, or archive later",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Client tracked",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "add"
      },
      {
        "from": "add",
        "to": "fill"
      },
      {
        "from": "fill",
        "to": "check"
      },
      {
        "from": "check",
        "to": "save",
        "label": "Yes"
      },
      {
        "from": "check",
        "to": "fix",
        "label": "No"
      },
      {
        "from": "fix",
        "to": "check"
      },
      {
        "from": "save",
        "to": "manage"
      },
      {
        "from": "manage",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the Clients tab in the business hub. 2. Choose Add client. 3. Enter the client details: name, email, phone, address, status, preferred contact, tags, and internal notes. 4. Check that the client name is entered; if not, enter it and check again. 5. Save the client. 6. Edit, search, or archive clients any time. 7. The client is tracked in your business list.",
  "steps": [
    {
      "id": "business-work-clients-s1",
      "title": "Open the Clients tab",
      "body": "Open /business-hub?tab=clients for your business. The tab shows your client list with search (\"Search by name, email, phone, or tags\") and per-client stats: Jobs, Lifetime value, and Last job.",
      "expectedResult": "Your client list loads.",
      "screenshots": [
        {
          "id": "business-work-clients-s1-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=clients",
          "state": "Clients tab with synthetic clients, light mode",
          "alt": "Clients tab with search box, Add client button, and client cards",
          "caption": "The Clients tab, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Search box",
              "locator": "input[placeholder]"
            }
          ]
        },
        {
          "id": "business-work-clients-s1-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=clients",
          "state": "Clients tab with synthetic clients, light mode",
          "alt": "Clients tab on a phone screen",
          "caption": "The Clients tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-clients-s2",
      "title": "Add a client",
      "body": "Choose Add client. In the dialog, enter the Client name (required), Email, and Phone. Add the address (street, city, state, zip), the client status, the preferred contact method (email, phone, or sms), comma-separated tags, and internal notes for your team.",
      "expectedResult": "The client saves and appears in the list.",
      "screenshots": [
        {
          "id": "business-work-clients-s2-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=clients",
          "state": "Add client dialog filled with synthetic data, light mode",
          "alt": "Add client dialog with name, email, phone, address, tags, and notes fields",
          "caption": "The Add client dialog, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-clients-s2-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=clients",
          "state": "Add client dialog open, light mode",
          "alt": "Add client dialog on a phone screen",
          "caption": "The Add client dialog, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-clients-s3",
      "title": "Edit, search, or archive clients",
      "body": "Edit a client from their card when contact details change. Use the search box to find clients by name, email, phone, or tags. Use Archive on a client card to retire a client (with a confirmation prompt); archived clients leave the active list.",
      "expectedResult": "Edits save; archived clients no longer appear in the active list.",
      "screenshots": [
        {
          "id": "business-work-clients-s3-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=clients",
          "state": "Client card with edit and archive controls, light mode",
          "alt": "Client card with edit and archive controls",
          "caption": "Managing a client, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-clients-s3-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=clients",
          "state": "Client card with edit and archive controls, light mode",
          "alt": "Client controls on a phone screen",
          "caption": "Managing a client, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The client appears in the Clients tab with correct details and lifetime stats.",
  "recovery": [
    {
      "problem": "The client does not save.",
      "solution": "The client name is required. Enter it and save again."
    },
    {
      "problem": "You archived a client by mistake.",
      "solution": "Archiving removes the client from the active list. Re-add the client with their details to restore them."
    }
  ],
  "supportContact": "If clients fail to load or save, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-invoices",
    "business-work-team-access"
  ],
  "siteLinks": [
    {
      "label": "Clients tab",
      "href": "/business-hub?tab=clients"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/business-hub?tab=clients"
    },
    {
      "type": "screen",
      "ref": "client/src/components/businessHub/BusinessClientsTab.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/businesses/:id/clients"
    }
  ]
};
