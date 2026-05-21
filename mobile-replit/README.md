## OxSteed Replit Import

This workspace is the normalized local import of the Replit-built OxSteed mobile app recovered from:

- `/Users/oxsteed/Documents/GitHub/4/artifacts/oxsteed-mobile-source.tar.gz`

It remains separate from the other mobile app attempts in this repository:

- `/Users/oxsteed/Documents/GitHub/4/mobile`
- `/Users/oxsteed/Documents/GitHub/4/mobile3`

### What changed from the Replit export

- Removed Replit-only package references like `catalog:` and `workspace:*`.
- Removed the broken TypeScript workspace reference to `../../lib/api-client-react`.
- Replaced the Replit-only `dev` script with normal Expo scripts.
- Removed the Replit-specific `expo-router` origin override.
- Added the `react-native-worklets/plugin` Babel transform for the Reanimated/Worklets stack.

### Run locally

```bash
cd /Users/oxsteed/Documents/GitHub/4/mobile-replit
npm install
npm run typecheck
npm run start
```
