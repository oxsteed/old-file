// English instructions. Callouts identify reviewed, visible controls only.
export default {
  "id": "account-signin",
  "area": "account",
  "slug": "sign-in",
  "title": "Sign in",
  "audiences": [
    "customer",
    "helper",
    "business",
    "restaurant",
    "logistics"
  ],
  "revision": 3,
  "availability": "supported",
  "conditions": [],
  "goal": "Sign in to your OxSteed account with your email and password, including two-factor and passkey options.",
  "intendedRoles": [
    "Customer",
    "Helper",
    "Business owner",
    "Restaurant",
    "Logistics"
  ],
  "prerequisites": [
    {
      "text": "Have an OxSteed account.",
      "guideId": "account-join",
      "href": "/join"
    },
    {
      "text": "If you enabled two-factor authentication, have your authenticator app ready.",
      "href": "/settings/2fa"
    }
  ],
  "processMap": {
    "nodes": [
      {
        "id": "start",
        "label": "Open the sign-in page",
        "type": "terminal"
      },
      {
        "id": "enter",
        "label": "Enter email and password",
        "type": "step"
      },
      {
        "id": "check",
        "label": "Details correct?",
        "type": "decision"
      },
      {
        "id": "tfa",
        "label": "2FA enabled?",
        "type": "decision"
      },
      {
        "id": "code",
        "label": "Enter the authenticator code",
        "type": "step"
      },
      {
        "id": "in",
        "label": "Signed in to your dashboard",
        "type": "terminal"
      },
      {
        "id": "reset",
        "label": "Use Forgot password?",
        "type": "blocked"
      }
    ],
    "edges": [
      {
        "from": "start",
        "to": "enter"
      },
      {
        "from": "enter",
        "to": "check"
      },
      {
        "from": "check",
        "to": "tfa",
        "label": "Yes"
      },
      {
        "from": "check",
        "to": "reset",
        "label": "No"
      },
      {
        "from": "tfa",
        "to": "code",
        "label": "Yes"
      },
      {
        "from": "tfa",
        "to": "in",
        "label": "No"
      },
      {
        "from": "code",
        "to": "in",
        "label": "Code accepted"
      },
      {
        "from": "reset",
        "to": "enter",
        "label": "Password reset"
      }
    ]
  },
  "processMapText": "1. Open the sign-in page. 2. Enter your email address and password, then choose \"Sign in\". 3. If the details are wrong, use \"Forgot password?\" to reset. 4. If two-factor authentication is on, the page switches to \"Verify it's you\"; enter your Authentication code. 5. You land on your dashboard. Passkey users can sign in with their device instead of typing a password.",
  "steps": [
    {
      "id": "account-signin-s1",
      "title": "Open the sign-in page",
      "body": "Choose \"Sign In\" in the top navigation, or open /login directly. The page shows the heading \"Welcome back\" and the subtitle \"Sign in to access your local skills marketplace\", with an Email address field, a Password field, and a \"Sign in\" button. New users see a \"Join OxSteed\" link instead.",
      "expectedResult": "The sign-in form is visible with empty Email address and Password fields.",
      "screenshots": [
        {
          "id": "account-signin-s1-desktop",
          "viewport": "desktop",
          "screen": "/login",
          "state": "Blank sign-in form, guest, light mode",
          "alt": "Sign-in page with Welcome back heading and empty email and password fields",
          "caption": "The sign-in page, desktop view.",
          "annotations": [
            {
              "n": 2,
              "label": "Password field",
              "locator": "input[type=\"password\"]"
            },
            {
              "n": 3,
              "label": "Sign in button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        },
        {
          "id": "account-signin-s1-mobile",
          "viewport": "mobile",
          "screen": "/login",
          "state": "Blank sign-in form, guest, light mode",
          "alt": "Sign-in form on a phone screen",
          "caption": "The sign-in form, mobile view.",
          "annotations": [
            {
              "n": 2,
              "label": "Sign in button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-signin-s2",
      "title": "Enter your email and password",
      "body": "Type the email address you registered with into the Email address field (placeholder \"you@example.com\") and your password into the Password field (placeholder \"Enter your password\"). Passwords are case sensitive. Use \"Show password\" if you want to check your typing, then choose \"Sign in\". The \"Forgot password?\" link sits next to the password field.",
      "expectedResult": "The Sign in button shows a loading state, then you are redirected.",
      "screenshots": [
        {
          "id": "account-signin-s2-desktop",
          "viewport": "desktop",
          "screen": "/login",
          "state": "Sign-in form filled in, guest, light mode",
          "alt": "Sign-in form with email and password entered",
          "caption": "The filled sign-in form before choosing Sign in.",
          "annotations": [
            {
              "n": 1,
              "label": "Password field",
              "locator": "input[type=\"password\"]"
            },
            {
              "n": 2,
              "label": "Forgot password? link",
              "locator": "a[href=\"/forgot-password\"]"
            },
            {
              "n": 3,
              "label": "Sign in button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        },
        {
          "id": "account-signin-s2-mobile",
          "viewport": "mobile",
          "screen": "/login",
          "state": "Sign-in form filled in, guest, light mode",
          "alt": "Filled sign-in form on a phone screen",
          "caption": "The filled form, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Sign in button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-signin-s3",
      "title": "Complete the two-factor check if prompted",
      "body": "If you enabled two-factor authentication, the page changes to \"Verify it's you\". Enter the current code from your authenticator app into the Authentication code field and submit. Users with a passkey can choose the passkey option instead of typing a password.",
      "expectedResult": "The code is accepted and you continue to your dashboard.",
      "screenshots": [
        {
          "id": "account-signin-s3-desktop",
          "viewport": "desktop",
          "screen": "/login",
          "state": "Two-factor verification prompt, guest, light mode",
          "alt": "Two-factor page titled Verify it is you with an authentication code field",
          "caption": "The two-factor step, shown only when 2FA is enabled.",
          "annotations": [
            {
              "n": 1,
              "label": "Authentication code field",
              "locator": "input[type=\"text\"]"
            },
            {
              "n": 2,
              "label": "Submit button",
              "locator": "button[type=\"submit\"]"
            }
          ]
        },
        {
          "id": "account-signin-s3-mobile",
          "viewport": "mobile",
          "screen": "/login",
          "state": "Two-factor verification prompt, guest, light mode",
          "alt": "Two-factor code entry on a phone screen",
          "caption": "The two-factor step, mobile view.",
          "annotations": [
            {
              "n": 1,
              "label": "Authentication code field",
              "locator": "input[type=\"text\"]"
            }
          ]
        }
      ]
    },
    {
      "id": "account-signin-s4",
      "title": "Confirm you landed on your dashboard",
      "body": "After sign in, your dashboard loads. Open Account in the navigation to find your account actions. If you expected a different mode (for example Helper instead of Customer), use the mode switcher in the navigation.",
      "expectedResult": "Your dashboard is visible and the Account menu offers your signed-in account actions.",
      "screenshots": [
        {
          "id": "account-signin-s4-desktop",
          "viewport": "desktop",
          "screen": "/dashboard",
          "state": "Dashboard loaded after sign in, signed in, light mode",
          "alt": "Dashboard with the account menu highlighted",
          "caption": "A signed-in dashboard with the account menu.",
          "annotations": []
        },
        {
          "id": "account-signin-s4-mobile",
          "viewport": "mobile",
          "screen": "/dashboard",
          "state": "Dashboard loaded after sign in, signed in, light mode",
          "alt": "Dashboard on a phone screen after sign in",
          "caption": "The signed-in dashboard, mobile view.",
          "annotations": []
        }
      ]
    }
  ],
  "confirmOutcome": "Your dashboard loads and the Account menu offers your signed-in account actions. Review active sessions anytime under Settings, Security.",
  "recovery": [
    {
      "problem": "You see \"Invalid email or password\".",
      "solution": "Check for typos and caps lock, then try again. After several failed attempts the sign-in is rate-limited; wait a few minutes or reset the password."
    },
    {
      "problem": "Your two-factor code is rejected.",
      "solution": "Make sure your phone clock is set automatically; authenticator codes drift when the clock is off. If you lost the authenticator, use your saved recovery code from the Security tab in Settings."
    },
    {
      "problem": "Passkey sign in fails.",
      "solution": "Make sure your browser and device support passkeys and that you use the same device or synced profile where the passkey was created. Fall back to email and password."
    }
  ],
  "supportContact": "If you cannot access your account after a password reset, contact support from the Help menu or visit /support.",
  "relatedGuides": [
    "account-join",
    "account-password-recovery",
    "account-mode-switching",
    "account-settings"
  ],
  "siteLinks": [
    {
      "label": "Sign in",
      "href": "/login"
    },
    {
      "label": "Join OxSteed",
      "href": "/join"
    },
    {
      "label": "Forgot password",
      "href": "/forgot-password"
    }
  ],
  "sources": [
    {
      "type": "route",
      "ref": "/login"
    },
    {
      "type": "screen",
      "ref": "client/src/pages/Login.jsx"
    },
    {
      "type": "handler",
      "ref": "POST /api/auth/login, POST /api/auth/login/2fa, passkey endpoints"
    }
  ]
};
