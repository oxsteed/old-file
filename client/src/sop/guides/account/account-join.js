// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-join",
  "area": "account",
  "slug": "join-oxsteed",
  "title": "Create an account",
  "audiences": [
    "customer",
    "helper",
    "business"
  ],
  "revision": 2,
  "availability": "supported",
  "conditions": [],
  "goal": "Create your OxSteed account so you can hire helpers, offer services, or run a business.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner"
  ],
  "prerequisites": [
    {
      "text": "Have an email address you can open right away; you will receive a 6-digit verification code.",
      "href": null
    },
    {
      "text": "Know your ZIP code; it is used to match you with nearby helpers and jobs.",
      "href": null
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the join page",
        "type": "terminal"
      },
      {
        "id": "mode",
        "label": "Choose how you are joining",
        "type": "step"
      },
      {
        "id": "details",
        "label": "Enter personal details and password",
        "type": "step"
      },
      {
        "id": "terms",
        "label": "Accept the terms",
        "type": "decision"
      },
      {
        "id": "code",
        "label": "Enter the 6-digit email code",
        "type": "step"
      },
      {
        "id": "verified",
        "label": "Account created and email verified",
        "type": "terminal"
      },
      {
        "id": "resend",
        "label": "Resend the code or edit details",
        "type": "blocked"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "mode"
      },
      {
        "from": "mode",
        "to": "details"
      },
      {
        "from": "details",
        "to": "terms"
      },
      {
        "from": "terms",
        "to": "code",
        "label": "Accepted"
      },
      {
        "from": "terms",
        "to": "details",
        "label": "Not accepted"
      },
      {
        "from": "code",
        "to": "verified",
        "label": "Code correct"
      },
      {
        "from": "code",
        "to": "resend",
        "label": "No code received"
      },
      {
        "from": "resend",
        "to": "code"
      }
    ]
  },
  "processMapText": "1. Open the Join OxSteed page. 2. Under \"I'm joining as\", pick Customer, Helper, or Business Owner. 3. Enter your personal details and a password. 4. Accept the terms to continue. 5. Open the email OxSteed sent you and enter the 6-digit code. If the code never arrives, use \"Resend code\" or \"Wrong email or phone? Edit details\". 6. Your account is created and your email is verified.",
  "steps": [
    {
      "id": "account-join-s1",
      "title": "Open the join page and choose how you are joining",
      "body": "Choose Join in the top navigation, or open /join directly. The page heading is \"Join OxSteed\" with the subtitle \"One account. Pick how you want to show up.\" Under \"I'm joining as\", select one of the mode cards: Customer (\"Post jobs, hire helpers, shop the marketplace.\"), Helper (\"Offer services, bid on jobs, build your reputation.\"), or Business Owner (\"Run a service business with clients, invoices, and a team.\").",
      "expectedResult": "The mode card you picked shows a check mark as the selected mode.",
      "screenshots": [
        {
          "id": "account-join-s1-desktop",
          "viewport": "desktop",
          "screen": "/join",
          "state": "Blank join form, guest, light mode",
          "alt": "Join OxSteed page with the three mode cards visible",
          "caption": "Choose how you are joining before you fill in the form.",
          "annotations": [
            {
              "n": 2,
              "label": "Customer card",
              "locator": "input[name=\"defaultMode\"][value=\"customer\"]"
            },
            {
              "n": 3,
              "label": "Helper card",
              "locator": "input[name=\"defaultMode\"][value=\"helper\"]"
            },
            {
              "n": 4,
              "label": "Business Owner card",
              "locator": "input[name=\"defaultMode\"][value=\"business_owner\"]"
            }
          ]
        },
        {
          "id": "account-join-s1-mobile",
          "viewport": "mobile",
          "screen": "/join",
          "state": "Blank join form, guest, light mode",
          "alt": "Join OxSteed page with mode cards stacked on a phone screen",
          "caption": "The mode cards, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Mode cards",
              "locator": ".signup-mode-card"
            }
          ]
        }
      ]
    },
    {
      "id": "account-join-s2",
      "title": "Enter your personal details and a password",
      "body": "Fill in First name, Last name, Email address, and Phone number. Then complete the address section: Country, Street address, City, State, and ZIP code. Choose a password in the password field (a show-password toggle is available). Email availability is checked as you type.",
      "expectedResult": "Every field shows an entered value and no red validation errors.",
      "screenshots": [
        {
          "id": "account-join-s2-desktop",
          "viewport": "desktop",
          "screen": "/join",
          "state": "Join form with details filled in, guest, light mode",
          "alt": "Join form with personal details and address fields filled in",
          "caption": "The personal details section of the join form.",
          "annotations": [
            {
              "n": 1,
              "label": "First name and Last name",
              "locator": "input[name=\"firstName\"]"
            },
            {
              "n": 2,
              "label": "Email address",
              "locator": "input[type=\"email\"]"
            },
            {
              "n": 3,
              "label": "Address fields",
              "locator": "input[name=\"addressLine1\"]"
            }
          ]
        },
        {
          "id": "account-join-s2-mobile",
          "viewport": "mobile",
          "screen": "/join",
          "state": "Join form with details filled in, guest, light mode",
          "alt": "Join form fields on a phone screen",
          "caption": "The join form fields, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Email field",
              "locator": "input[name=\"email\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-join-s3",
      "title": "Accept the terms and continue",
      "body": "Tick the checkbox next to \"I agree to OxSteed's\" terms and privacy links, then choose Continue. Without the checkbox ticked, the form will not submit.",
      "expectedResult": "The form submits and the \"Check your email\" step appears.",
      "screenshots": [
        {
          "id": "account-join-s3-desktop",
          "viewport": "desktop",
          "screen": "/join",
          "state": "Terms checkbox ticked, guest, light mode",
          "alt": "Terms acceptance checkbox and Continue button on the join form",
          "caption": "Accept the terms, then choose Continue.",
          "annotations": [
            {
              "n": 2,
              "label": "Continue button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        },
        {
          "id": "account-join-s3-mobile",
          "viewport": "mobile",
          "screen": "/join",
          "state": "Terms checkbox ticked, guest, light mode",
          "alt": "Terms checkbox and Continue button on a phone screen",
          "caption": "The terms checkbox, mobile view.",
          "annotations": []
        }
      ]
    },
    {
      "id": "account-join-s4",
      "title": "Verify your email with the 6-digit code",
      "body": "The page now shows \"Check your email\" with the hint \"We sent a 6-digit code to\" your address. Open the email and type the code into the code boxes, then choose \"Verify Email & Continue\". If nothing arrives, choose \"Resend code\". If you typed the wrong address, choose \"Wrong email or phone? Edit details\" to go back and fix it.",
      "expectedResult": "The code is accepted and you are signed in to your new account.",
      "screenshots": [
        {
          "id": "account-join-s4-desktop",
          "viewport": "desktop",
          "screen": "/join",
          "state": "Email verification code entry, guest, light mode",
          "alt": "Check your email step with code boxes and verify button",
          "caption": "Enter the 6-digit code from your email.",
          "annotations": [
            {
              "n": 3,
              "label": "Resend code link",
              "locator": "button[type=\"button\"]"
            }
          ]
        },
        {
          "id": "account-join-s4-mobile",
          "viewport": "mobile",
          "screen": "/join",
          "state": "Email verification code entry, guest, light mode",
          "alt": "Email verification step on a phone screen",
          "caption": "The code entry step, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "You land on your dashboard, signed in, and your email shows as verified. Your selected mode (Customer, Helper, or Business Owner) is active.",
  "recovery": [
    {
      "problem": "The email address is reported as already taken.",
      "solution": "That address already has an OxSteed account. Use the sign-in guide instead, or choose \"Forgot password?\" if you cannot get in."
    },
    {
      "problem": "The 6-digit code never arrives.",
      "solution": "Check your spam folder, confirm the address is spelled correctly with \"Wrong email or phone? Edit details\", then choose \"Resend code\". Wait a few minutes before requesting again."
    },
    {
      "problem": "The Continue button does nothing.",
      "solution": "Look for a highlighted field: the terms checkbox must be ticked, and every required field must be filled. The ZIP code must be valid."
    }
  ],
  "supportContact": "If you cannot create an account after retrying, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-signin",
    "account-onboarding",
    "account-identity-verification"
  ],
  "siteLinks": [
    {
      "label": "Join OxSteed",
      "href": "/join"
    },
    {
      "label": "Sign in",
      "href": "/login"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/join"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/JoinPage.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/auth/register/start, /verify-otp, /resend-otp"
    }
  ]
};
