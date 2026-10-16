// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "business-work-invoices",
  "area": "business-work",
  "slug": "invoice-clients-as-business",
  "title": "Invoice clients as a business",
  "audiences": [
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Bill business clients accurately and track every invoice from draft to paid.",
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
      "text": "Add the client first if they are not in your client list.",
      "guideId": "business-work-clients",
      "href": "/business-hub?tab=clients"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the Invoices tab",
        "type": "terminal"
      },
      {
        "id": "new",
        "label": "Choose New Invoice",
        "type": "step"
      },
      {
        "id": "fill",
        "label": "Enter client, due date, and line items",
        "type": "step"
      },
      {
        "id": "check",
        "label": "Client name, due date, and a line item entered?",
        "type": "decision"
      },
      {
        "id": "fix",
        "label": "Fill the required fields",
        "type": "blocked"
      },
      {
        "id": "create",
        "label": "Choose Create Invoice",
        "type": "step"
      },
      {
        "id": "send",
        "label": "Send the invoice",
        "type": "step"
      },
      {
        "id": "paid",
        "label": "Mark Paid when the money arrives",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Invoice paid and tracked",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "new"
      },
      {
        "from": "new",
        "to": "fill"
      },
      {
        "from": "fill",
        "to": "check"
      },
      {
        "from": "check",
        "to": "create",
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
        "from": "create",
        "to": "send"
      },
      {
        "from": "send",
        "to": "paid"
      },
      {
        "from": "paid",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the Invoices tab in the business hub. 2. Choose New Invoice. 3. Enter the client name, due date, and line items. 4. Check that the client name, due date, and at least one line item are entered; if not, fill them in and check again. 5. Choose Create Invoice. 6. Send the invoice to the client. 7. Mark it Paid when the money arrives. 8. The invoice is tracked to completion.",
  "steps": [
    {
      "id": "business-work-invoices-s1",
      "title": "Open the Invoices tab",
      "body": "Open /business-hub?tab=invoices for your business. The Invoices section shows KPIs for Draft, Sent, Paid, Overdue, and Outstanding totals, plus the invoice table.",
      "expectedResult": "Your invoices load with correct statuses and totals.",
      "screenshots": [
        {
          "id": "business-work-invoices-s1-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=invoices",
          "state": "Invoices tab with synthetic invoices, light mode",
          "alt": "Invoices tab with status KPIs, the New Invoice button, and the invoice table",
          "caption": "The Invoices tab, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-invoices-s1-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=invoices",
          "state": "Invoices tab with synthetic invoices, light mode",
          "alt": "Invoices tab on a phone screen",
          "caption": "The Invoices tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-invoices-s2",
      "title": "Create a new invoice",
      "body": "Choose the + New Invoice button. In the New Invoice dialog, enter the Client Name, Client Email, Company, and Due Date. Set the Tax Rate and the Status (Draft, Sent, Paid, or Cancelled).",
      "expectedResult": "The dialog shows your entries with a running total.",
      "screenshots": [
        {
          "id": "business-work-invoices-s2-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=invoices",
          "state": "New Invoice dialog open, light mode",
          "alt": "New Invoice dialog with client, due date, tax rate, and status fields",
          "caption": "The New Invoice dialog, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Client Name field",
              "locator": "input[name=\"client_name\"]"
            },
            {
              "n": 2,
              "label": "Due Date field",
              "locator": "input[name=\"due_date\"]"
            },
            {
              "n": 3,
              "label": "Status select",
              "locator": "select[name=\"status\"]"
            }
          ]
        },
        {
          "id": "business-work-invoices-s2-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=invoices",
          "state": "New Invoice dialog open, light mode",
          "alt": "New Invoice dialog on a phone screen",
          "caption": "The New Invoice dialog, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-invoices-s3",
      "title": "Add line items and save",
      "body": "In the Line Items section, add each charge: item, discount, or fee with a description, quantity, and unit price. Use Add Line Item for more lines. Check the Subtotal, Tax, and Total, add Notes if needed, then choose Create Invoice.",
      "expectedResult": "\"Invoice created\" appears and the invoice shows in the table as a draft.",
      "screenshots": [
        {
          "id": "business-work-invoices-s3-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=invoices",
          "state": "New Invoice dialog with synthetic line items, light mode",
          "alt": "Line items filled in with the totals and the Create Invoice button",
          "caption": "Adding line items, desktop view.",
          "annotations": [
            {
              "n": 1,
              "label": "Line items",
              "locator": ".bh-line-items"
            },
            {
              "n": 2,
              "label": "Add Line Item",
              "locator": ".bh-line-add"
            }
          ]
        },
        {
          "id": "business-work-invoices-s3-mobile",
          "viewport": "mobile",
          "screen": "/business-hub?tab=invoices",
          "state": "New Invoice dialog with synthetic line items, light mode",
          "alt": "Line items on a phone screen",
          "caption": "Adding line items, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "business-work-invoices-s4",
      "title": "Send and mark paid",
      "body": "On the invoice row, choose Send to email it to the client. When payment arrives, choose Mark Paid and enter the amount. Edit changes a draft; Delete removes it after confirmation.",
      "expectedResult": "The invoice status moves from Draft to Sent to Paid.",
      "screenshots": [
        {
          "id": "business-work-invoices-s4-desktop",
          "viewport": "desktop",
          "screen": "/business-hub?tab=invoices",
          "state": "Invoice rows with action buttons, synthetic data, light mode",
          "alt": "Invoice rows with Send, Mark Paid, Edit, and Delete buttons",
          "caption": "Working an invoice, desktop view.",
          "annotations": []
        },
        {
          "id": "business-work-invoices-s4-mobile",
          "viewport": "mobile",
          "screen": "/invoice/p/:token",
          "state": "Public invoice view, synthetic data, light mode",
          "alt": "Public invoice page as the client sees it",
          "caption": "The public invoice view, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The invoice shows status Paid (or Sent while awaiting payment) and the KPIs update.",
  "recovery": [
    {
      "problem": "The invoice does not save.",
      "solution": "Client Name, Due Date, and at least one line item are required. Fill them and choose Create Invoice again."
    },
    {
      "problem": "The client never got the invoice.",
      "solution": "Open the public invoice link (/invoice/p/:token) and share it directly, or send the invoice again from the row."
    }
  ],
  "supportContact": "If invoices fail to send, contact OxSteed Support from the /support page.",
  "relatedGuides": [
    "business-work-clients",
    "business-work-attention-inbox"
  ],
  "siteLinks": [
    {
      "label": "Invoices tab",
      "href": "/business-hub?tab=invoices"
    },
    {
      "label": "Invoice hub",
      "href": "/invoices"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/business-hub?tab=invoices"
    },
    {
      "type": "route",
      "ref": "/invoice/p/:token"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/BusinessHubPage.jsx (Invoices tab)"
    },
    {
      "type": "handler",
      "ref": "GET /api/invoices"
    }
  ]
};
