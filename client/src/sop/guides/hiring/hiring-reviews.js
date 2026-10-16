// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "hiring-reviews",
  "area": "hiring",
  "slug": "leave-review",
  "title": "Leave and respond to reviews",
  "audiences": [
    "customer",
    "helper",
    "restaurant"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Leave a review for a finished job and respond to reviews left for you.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner",
    "Restaurant"
  ],
  "prerequisites": [
    {
      "text": "Be signed in to your OxSteed account.",
      "guideId": "account-signin",
      "href": "/login"
    },
    {
      "text": "The job must be completed before reviews unlock.",
      "guideId": "hiring-completion",
      "href": "/my-jobs"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the completed job",
        "type": "terminal"
      },
      {
        "id": "open",
        "label": "Open the review action",
        "type": "step"
      },
      {
        "id": "write",
        "label": "Set rating and write the review",
        "type": "step"
      },
      {
        "id": "submit",
        "label": "Submit the review",
        "type": "step"
      },
      {
        "id": "respond",
        "label": "Respond to a review left for you",
        "type": "step"
      },
      {
        "id": "done",
        "label": "Review published",
        "type": "terminal"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "open"
      },
      {
        "from": "open",
        "to": "write"
      },
      {
        "from": "write",
        "to": "submit"
      },
      {
        "from": "submit",
        "to": "done"
      },
      {
        "from": "start",
        "to": "respond"
      },
      {
        "from": "respond",
        "to": "done"
      }
    ]
  },
  "processMapText": "1. Open the completed job (/jobs/:id) or order (/orders/:id). 2. Choose the review action to open the review dialog (\"Leave a Review\"). 3. Pick a Rating and write \"Your Review\" (and the testimonial where asked). 4. Choose \"Submit Review\" (\"Submitting...\" while it saves). 5. When someone reviews you, answer with the response action; responses show as the \"Business Response\" on the review.",
  "steps": [
    {
      "id": "hiring-reviews-s1",
      "title": "Open the review action on the finished job",
      "body": "On the completed job detail page, choose the review action to open the review dialog titled \"Leave a Review\". Reviews are eligibility-checked: the action only appears when you are allowed to review that job or order.",
      "expectedResult": "The \"Leave a Review\" dialog opens.",
      "screenshots": [
        {
          "id": "hiring-reviews-s1-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Completed job with review action, signed in, light mode",
          "alt": "Completed job page with the review action available",
          "caption": "The review action on a completed job.",
          "annotations": []
        },
        {
          "id": "hiring-reviews-s1-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Completed job with review action, signed in, light mode",
          "alt": "Review action on a phone screen",
          "caption": "The review action, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-reviews-s2",
      "title": "Set the rating and write your review",
      "body": "Pick the Rating (stars) and write \"Your Review\". Say what was done, how communication went, and whether you would hire again. The dialog counts characters and requires a rating (\"Rating is required\") before you can submit.",
      "expectedResult": "The rating is selected and the review text is complete.",
      "screenshots": [
        {
          "id": "hiring-reviews-s2-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Leave a Review dialog filled in, signed in, light mode",
          "alt": "Leave a Review dialog with rating and review text",
          "caption": "The Leave a Review dialog, desktop view.",
          "annotations": []
        },
        {
          "id": "hiring-reviews-s2-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Leave a Review dialog filled in, signed in, light mode",
          "alt": "Review dialog on a phone screen",
          "caption": "The review dialog, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-reviews-s3",
      "title": "Submit the review",
      "body": "Choose \"Submit Review\". The button shows \"Submitting...\" and then a success confirmation. The review appears on the helper's or business's profile and in the job or order history.",
      "expectedResult": "The review publishes and appears on the profile.",
      "screenshots": [
        {
          "id": "hiring-reviews-s3-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Review submitted confirmation, signed in, light mode",
          "alt": "Review submitted confirmation",
          "caption": "The submitted review confirmation.",
          "annotations": []
        },
        {
          "id": "hiring-reviews-s3-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Review submitted confirmation, signed in, light mode",
          "alt": "Review confirmation on a phone screen",
          "caption": "The confirmation, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "hiring-reviews-s4",
      "title": "Respond to a review left for you",
      "body": "When a customer reviews you, open the review and use the respond action. Your answer shows as the \"Business Response\" under the review. Keep it factual and professional; future customers read both sides.",
      "expectedResult": "Your response appears under the original review.",
      "screenshots": [
        {
          "id": "hiring-reviews-s4-desktop",
          "viewport": "desktop",
          "screen": "/jobs/:id",
          "state": "Review with respond action, signed in, light mode",
          "alt": "Review with the respond action and Business Response area",
          "caption": "Responding to a review.",
          "annotations": []
        },
        {
          "id": "hiring-reviews-s4-mobile",
          "viewport": "mobile",
          "screen": "/jobs/:id",
          "state": "Review with respond action, signed in, light mode",
          "alt": "Responding to a review on a phone screen",
          "caption": "Responding, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "The review appears on the profile with your rating and text; your responses appear as the Business Response. Food order reviews are per order and follow the same pattern.",
  "recovery": [
    {
      "problem": "The review action does not appear.",
      "solution": "Reviews are eligibility-checked and only unlock after completion. Confirm the job is marked complete and that you have not already reviewed it."
    },
    {
      "problem": "The submit fails.",
      "solution": "Make sure a rating is selected and the text meets the length limits, then try again."
    }
  ],
  "supportContact": "If a review is abusive or wrong, report it through support at /support.",
  "relatedGuides": [
    "hiring-completion",
    "hiring-payment-records",
    "account-support"
  ],
  "siteLinks": [
    {
      "label": "My jobs",
      "href": "/my-jobs"
    },
    {
      "label": "Order History",
      "href": "/orders"
    }
  ],
  "sources": [
    {
      "type": "screen",
      "ref": "client/src/pages/JobDetailPage.jsx"
    },
    {
      "type": "screen",
      "ref": "client/src/components/ReviewModal.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/reviews/jobs/:jobId, GET /api/reviews/jobs/:jobId/eligibility, PUT /api/reviews/:id/respond"
    },
    {
      "type": "permission",
      "ref": "Authenticated; eligibility-checked."
    }
  ]
};
