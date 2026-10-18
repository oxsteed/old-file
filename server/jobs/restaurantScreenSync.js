"use strict";
const { publishBatch } = require("../services/restaurantScreenSync");
const logger = require("../utils/logger");
function startRestaurantScreenSync() {
  let stopped = false,
    running = null,
    lastWarning = 0,
    lastCleanup = 0;
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
  const timer = setInterval(run, 500);
  timer.unref?.();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      return running;
    },
  };
}
module.exports = { startRestaurantScreenSync };
