"use strict";
const { publishBatch } = require("../services/restaurantScreenSync");
const logger = require("../utils/logger");
// Cost audit 2026-11-04 item 7: wake on insert via LISTEN/NOTIFY instead
// of polling every 2s (about 43,200 guard SELECTs a day when idle). The
// interval below is only a slow safety sweep for a missed notification.
const SWEEP_MS = 60000;
function startRestaurantScreenSync() {
  let stopped = false,
    running = null,
    lastWarning = 0,
    lastCleanup = 0,
    unsubscribe = null;
  const run = () => {
    if (stopped || running) return;
    running = publishBatch()
      .then(async () => {
        if (Date.now() - lastCleanup > 60000) {
          lastCleanup = Date.now();
          await require("../db").query(
            "DELETE FROM restaurant_screen_events WHERE (restaurant_id,revision) IN (SELECT restaurant_id,revision FROM restaurant_screen_events WHERE published_at IS NOT NULL AND created_at<NOW()-INTERVAL '7 days' LIMIT 2000)",
          );
        }
      })
      .catch((error) => {
        if (Date.now() - lastWarning > 60000) {
          lastWarning = Date.now();
          logger.warn("Restaurant screen outbox will retry", {
            error: error.message,
          });
        }
      })
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, SWEEP_MS);
  timer.unref?.();
  try {
    unsubscribe = require("../utils/notifyWakeup").subscribe("oxsteed_screen_events", run);
  } catch (error) {
    logger.warn("Restaurant screen notify wakeup unavailable, sweep only", { message: error.message });
  }
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      if (unsubscribe) unsubscribe();
      return running;
    },
  };
}
module.exports = { startRestaurantScreenSync };
