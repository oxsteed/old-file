# OxSteed One

`mobile3/` is the clean third mobile app workspace intended to replace the two earlier OxSteed app attempts.

## Intent

- Separate app folder
- Same real OxSteed backend and feature surface
- Clean Expo-managed container without carrying forward the old generated iOS project baggage
- One app with independent `Home`, `Learn`, `Tools`, and `Pro` modes
- Four-language mobile shell: English, Spanish, French, Haitian Creole

## What It Reuses

- Real auth and session logic
- Real API-backed customer, tools, business, helper, messages, trust, and payments screens
- Real OxSteed branding and icon
- The current OxSteed backend contract at `https://oxsteed.com/api`

## Why This Exists

The repository already contains:

- `mobile/`: the current Expo React Native app attempt
- `artifacts/oxsteed-mobile-source.tar.gz`: the archived alternate app attempt

This folder is the replacement path: a new managed app root that can become the only app we continue shipping.

## Local Development

```bash
cd mobile3
npm install
npm run typecheck
npm run start
```

If `npm` is not available on the shell path in this workspace, use the Codex-bundled Node runtime with `/tmp/codex-npm/package/bin/npm-cli.js`.
