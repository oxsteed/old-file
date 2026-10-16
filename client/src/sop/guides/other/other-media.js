// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "other-media",
  "area": "media",
  "slug": "use-oxsteed-media",
  "title": "Use OxSteed Media (feed, posts, communities)",
  "audiences": [
    "customer",
    "helper",
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Browse the Media feed, publish a post, and follow communities.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "No account needed to browse. Sign in to post, save, or message.",
      "href": "/login"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "open",
        "label": "Open OxSteed Media",
        "type": "terminal"
      },
      {
        "id": "browse",
        "label": "Browse the feed",
        "type": "step"
      },
      {
        "id": "search",
        "label": "Search posts and accounts",
        "type": "step"
      },
      {
        "id": "compose",
        "label": "Sign in and open the composer",
        "type": "step"
      },
      {
        "id": "publish",
        "label": "Write and publish the post",
        "type": "step"
      },
      {
        "id": "communities",
        "label": "Join a community",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Active on Media",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "open",
        "to": "browse"
      },
      {
        "from": "browse",
        "to": "search"
      },
      {
        "from": "search",
        "to": "compose"
      },
      {
        "from": "compose",
        "to": "publish"
      },
      {
        "from": "publish",
        "to": "communities"
      },
      {
        "from": "communities",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open OxSteed Media at /media. 2. Browse the feed, titled \"OxSteed Media\" with the subtitle \"Local voices, useful connections, and updates from the OxSteed network.\" 3. Use Search Media to find posts and accounts. 4. Sign in and open the composer at /media/compose. 5. Write your post (\"New post\", \"What's happening in your local economy?\"), choose where it goes, and publish. 6. Join communities at /media/communities to follow topics you care about.",
  "steps": [
    {
      "id": "other-media-s1",
      "title": "Open OxSteed Media and browse the feed",
      "body": "Open /media. The page is titled \"OxSteed Media\" with the subtitle \"Local voices, useful connections, and updates from the OxSteed network.\" The composer prompt reads \"What's happening nearby?\" The navigation offers Home, Search, Spaces, Notifications, Messages, \"Saved posts\", and Verification. Guests can read; sign-in is required for posting.",
      "expectedResult": "The feed loads with recent posts from the network.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/media",
          "state": "Media feed, guest, light mode",
          "alt": "OxSteed Media feed with posts",
          "caption": "The Media feed, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/media",
          "state": "Media feed, guest, light mode",
          "alt": "Media feed on a phone screen",
          "caption": "The Media feed, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-media-s2",
      "title": "Search posts and accounts",
      "body": "Open /media/search. The page is titled \"Search Media\" with the field \"Search posts and accounts…\" and the \"Search\" button. Results split into \"Accounts\" and \"Posts\" tabs.",
      "expectedResult": "Matching accounts and posts appear under their tabs.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/media/search",
          "state": "Media search with results, light mode",
          "alt": "Media search results for posts and accounts",
          "caption": "Searching Media, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/media/search",
          "state": "Media search, light mode",
          "alt": "Media search on a phone screen",
          "caption": "Searching Media, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-media-s3",
      "title": "Compose a post",
      "body": "Sign in, then open /media/compose. The page is titled \"New post\" with the placeholder \"What's happening in your local economy?\" Choose \"Post as\" to pick your publishing identity (\"My helper profile\" for helper accounts). Use \"Add link\" or \"YouTube or Vimeo video\" to attach media. \"Save draft\" keeps your work; \"Discard draft\" removes it.",
      "expectedResult": "Your draft is ready in the composer with the correct publishing identity.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/media/compose",
          "state": "Media composer with draft text, signed in, light mode",
          "alt": "New post composer with text and attachment options",
          "caption": "Composing a post, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/media/compose",
          "state": "Media composer, signed in, light mode",
          "alt": "Composer on a phone screen",
          "caption": "Composing a post, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "other-media-s4",
      "title": "Publish and explore communities",
      "body": "Publish the post; it appears in the feed and on your profile. Then open /media/communities to browse communities, open a community to read its posts, and follow the ones you care about. Saved posts live under \"Saved posts\" at /media/bookmarks, and notifications under Notifications.",
      "expectedResult": "Your post is live in the feed and you follow at least one community.",
      "screenshots": [
        {
          "viewport": "desktop",
          "screen": "/media/communities",
          "state": "Communities list, signed in, light mode",
          "alt": "Media communities list",
          "caption": "Media communities, desktop view.",
          "annotations": []
        },
        {
          "viewport": "mobile",
          "screen": "/media/communities",
          "state": "Communities list, signed in, light mode",
          "alt": "Communities on a phone screen",
          "caption": "Media communities, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Your post appears in the feed and on your profile, and your followed communities show in your list.",
  "recovery": [
    {
      "problem": "The composer says \"Verification required\" or \"Not verified\".",
      "solution": "Complete verification first at /media/verification, then return to the composer."
    },
    {
      "problem": "A video attachment fails with \"Video posts aren't available right now.\"",
      "solution": "Remove the video and post photos instead, or try again later."
    }
  ],
  "supportContact": "Media issues: contact support from the in-app support page at /support.",
  "relatedGuides": [
    "other-messages"
  ],
  "siteLinks": [
    {
      "label": "Media",
      "href": "/media"
    },
    {
      "label": "Compose",
      "href": "/media/compose"
    },
    {
      "label": "Communities",
      "href": "/media/communities"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/media"
    },
    {
      "type": "route",
      "ref": "/media/compose"
    },
    {
      "type": "route",
      "ref": "/media/search"
    },
    {
      "type": "route",
      "ref": "/media/communities"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/media/MediaFeedPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/media/MediaComposePage.jsx"
    }
  ]
};
