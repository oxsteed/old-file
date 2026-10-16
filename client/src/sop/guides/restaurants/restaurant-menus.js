// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "restaurant-menus",
  "area": "restaurants",
  "slug": "restaurant-menus",
  "title": "Manage menus and items",
  "audiences": [
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Keep the restaurant menu accurate: add items and categories, set prices, manage options, and publish what customers can order.",
  "intendedRoles": [
    "Restaurant owner",
    "Restaurant manager"
  ],
  "prerequisites": [
    {
      "text": "Sign in and open the restaurant dashboard.",
      "href": "/restaurants/merchant"
    },
    {
      "text": "Finish restaurant setup so you can open the dashboard.",
      "guideId": "restaurant-setup"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open the Menu tab",
        "type": "terminal"
      },
      {
        "id": "category",
        "label": "Add categories",
        "type": "step"
      },
      {
        "id": "item",
        "label": "Add or edit an item",
        "type": "step"
      },
      {
        "id": "options",
        "label": "Add option groups (sizes, add-ons)",
        "type": "step"
      },
      {
        "id": "bulk",
        "label": "Duplicate, bulk publish, or import CSV",
        "type": "step"
      },
      {
        "id": "availability",
        "label": "Mark sold out or back available",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Menu accurate and published",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "category"
      },
      {
        "from": "category",
        "to": "item"
      },
      {
        "from": "item",
        "to": "options"
      },
      {
        "from": "options",
        "to": "bulk"
      },
      {
        "from": "bulk",
        "to": "availability"
      },
      {
        "from": "availability",
        "to": "done"
      }
    ]
  },
  "processMapText": "Open the Menu tab on the restaurant dashboard. Add categories first, then add items with names, prices, descriptions, and categories. Attach option groups for sizes or add-ons, then duplicate or bulk-publish items, or import a CSV. Mark items sold out or available as stock changes so the menu always matches what the kitchen can make.",
  "steps": [
    {
      "id": "restaurant-menus-s1",
      "title": "Open the Menu tab",
      "body": "On the restaurant dashboard at /restaurants/merchant, choose the \"Menu\" tab. The menu manager opens with the \"Menu\" heading and the \"Add item\" and \"Import CSV\" buttons.",
      "expectedResult": "The menu manager lists your current items and categories.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Menu manager with items listed, light mode",
          "alt": "Menu manager tab with the item list",
          "caption": "The Menu tab, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Menu manager with items listed, light mode",
          "alt": "Menu manager on a phone screen",
          "caption": "The Menu tab, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-menus-s2",
      "title": "Add categories",
      "body": "Use the \"Add category\" field and enter a name like \"Burgers\" (\"New category name (e.g. Burgers)\"). Adding categories first keeps items organized for customers.",
      "expectedResult": "The new category appears in the item list and in the \"Category\" dropdown.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Menu manager with category field highlighted, light mode",
          "alt": "Add category field in the menu manager",
          "caption": "Adding a category, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Menu manager with category field highlighted, light mode",
          "alt": "Add category on a phone screen",
          "caption": "Adding a category, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-menus-s3",
      "title": "Add a menu item",
      "body": "Choose \"Add item\". In the \"New item\" editor, enter the \"Item name\", \"Price\", \"Description\", and \"Category\" (\"No category\" keeps it uncategorized). Choose \"Save\". A $0 price shows the warning \"This item is priced at $0. Customers can order it for free.\" and an unusually high price shows \"That price looks like a typo\" with \"The price is correct\" to confirm.",
      "expectedResult": "The item appears in the list with its price and category.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "New item editor with fields filled, light mode",
          "alt": "New item editor with name, price, description, and category",
          "caption": "Adding a menu item, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "New item editor with fields filled, light mode",
          "alt": "New item editor on a phone screen",
          "caption": "Adding a menu item, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-menus-s4",
      "title": "Add option groups for sizes and add-ons",
      "body": "On an item, choose \"Options\". Enter the \"Option group name (e.g. Size)\", the \"Max choices\", and the \"Choices (Name:price in cents, comma separated)\" (for example \"Small:0, Medium:50, Large:100\"). Choose \"Save\". If an item has no option groups yet you see \"No option groups yet. Add sizes, add-ons, or choices before saving.\"",
      "expectedResult": "Customers can pick the options when they add the item to their order.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Option group editor, light mode",
          "alt": "Option group editor with choices",
          "caption": "Adding an option group, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Option group editor, light mode",
          "alt": "Option group editor on a phone screen",
          "caption": "Adding an option group, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-menus-s5",
      "title": "Duplicate, bulk publish, or import from CSV",
      "body": "Use \"Duplicate\" on an item to create a draft copy you can rename. Use \"Publish\" to bulk-publish selected items. For a large menu, choose \"Import CSV\" and fix any rows flagged with reasons like \"missing name\", \"invalid price\", or \"price is $0\" until you see the import summary.",
      "expectedResult": "Items move from draft to published so customers can order them.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Item actions and bulk publish controls, light mode",
          "alt": "Item actions including Duplicate and Publish",
          "caption": "Duplicating and publishing items, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Item actions and bulk publish controls, light mode",
          "alt": "Item actions on a phone screen",
          "caption": "Duplicating and publishing items, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "restaurant-menus-s6",
      "title": "Mark items sold out or available",
      "body": "On an item, use \"Sold out\" when the kitchen cannot make it, and \"Available\" when it returns. Customers see the \"Sold out\" badge on the menu and cannot order it while it is marked.",
      "expectedResult": "The item badge updates immediately on the customer menu.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/restaurants/merchant",
          "state": "Item marked sold out, light mode",
          "alt": "Sold out toggle on a menu item",
          "caption": "Marking an item sold out, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/restaurants/merchant",
          "state": "Item marked sold out, light mode",
          "alt": "Sold out toggle on a phone screen",
          "caption": "Marking an item sold out, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The customer menu shows the current items, options, and availability, with no drafts you meant to publish.",
  "recovery": [
    {
      "problem": "An item does not appear on the customer menu.",
      "solution": "Check that it is published (not a draft) and not marked \"Sold out\". The Home tab also alerts when \"{{count}} draft items are not published\"."
    },
    {
      "problem": "Saving an item fails.",
      "solution": "You see \"Could not save. Please try again.\" Retry after checking your connection; the price fields must be valid numbers."
    },
    {
      "problem": "CSV rows were skipped.",
      "solution": "The import lists the reason per row (\"missing name\", \"invalid price\", \"price over $500 looks like a typo\"). Fix the CSV and import again."
    }
  ],
  "supportContact": "For menu help, use the in-app support page at /support.",
  "relatedGuides": [
    "restaurant-setup",
    "restaurant-store-settings",
    "restaurant-ordering"
  ],
  "siteLinks": [
    {
      "label": "Restaurant dashboard",
      "href": "/restaurants/merchant"
    },
    {
      "label": "Food directory",
      "href": "/food"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/restaurants/merchant"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/food/RestaurantMenuManager.jsx"
    }
  ]
};
