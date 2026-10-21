#!/usr/bin/env node

import bridge from '../services/restaurantPrintBridge.js';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const config = bridge.normalizeConfig({
  baseUrl: required('OXSTEED_API_URL'),
  restaurantId: required('OXSTEED_RESTAURANT_ID'),
  deviceId: required('OXSTEED_DEVICE_ID'),
  deviceToken: required('OXSTEED_DEVICE_TOKEN'),
  printerHost: required('OXSTEED_PRINTER_HOST'),
  printerPort: process.env.OXSTEED_PRINTER_PORT || 9100,
  pollMs: process.env.OXSTEED_PRINTER_POLL_MS,
  timeoutMs: process.env.OXSTEED_PRINTER_TIMEOUT_MS,
  maxJobs: process.env.OXSTEED_PRINTER_MAX_JOBS,
});

let stopping = false;
const stop = () => { stopping = true; };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

console.log(JSON.stringify({ event: 'restaurant_print_bridge_started', restaurantId: config.restaurantId, deviceId: config.deviceId, printerHost: config.printerHost, printerPort: config.printerPort }));
while (!stopping) {
  try {
    const summary = await bridge.runBridgeOnce(config, {
      logger: (event) => console.error(JSON.stringify(event)),
    });
    if (summary.claimed || summary.failed) console.log(JSON.stringify({ event: 'restaurant_print_bridge_cycle', ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'restaurant_print_bridge_error', error: String(error?.message || 'bridge_cycle_failed').slice(0, 200) }));
  }
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, config.pollMs));
}

