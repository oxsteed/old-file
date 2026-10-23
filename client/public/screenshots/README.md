# Install screenshots

These PNGs show the actual local React app with synthetic intercepted data, not real customers, live restaurant listings or financial balances. Home and wallet are 1280 x 720 wide; post-job and food-order are 750 x 1334 narrow. Credit remains visibly paused according to the current launch controls.

To refresh them, run the client Vite server on an unused loopback port, then run from `client/`:

```sh
PWA_CAPTURE_URL=http://127.0.0.1:4187 node scripts/capturePwaScreenshots.cjs
```

The capture script accepts loopback origins only, supplies synthetic API fixtures, blocks external requests and also verifies that a shared image reaches the actual job form. It never posts a real job, uploads media, contacts a provider or changes a wallet.
