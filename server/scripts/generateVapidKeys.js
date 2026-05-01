#!/usr/bin/env node
/**
 * One-shot VAPID key generator for Web Push.
 *
 *   node server/scripts/generateVapidKeys.js
 *
 * Copy the output into your environment as:
 *   VAPID_PUBLIC_KEY=...
 *   VAPID_PRIVATE_KEY=...
 *   VAPID_SUBJECT=mailto:ops@oxsteed.com
 *
 * Keys persist forever - only generate once per environment.
 * Rotating them invalidates every existing browser subscription.
 */
const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

process.stdout.write(
  '\n# ───── VAPID keys (paste into .env / Coolify secrets) ─────\n' +
  `VAPID_PUBLIC_KEY=${keys.publicKey}\n` +
  `VAPID_PRIVATE_KEY=${keys.privateKey}\n` +
  'VAPID_SUBJECT=mailto:ops@oxsteed.com\n\n'
);
