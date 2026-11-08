"use strict";
const { publishBatch } = require("../services/restaurantScreenSync");
const logger = require("../utils/logger");
const { recordIncident, resolveOpenIncidentsByDedupeKeys } = require("../services/incidentStore");
// Cost audit 2026-11-04 item 7: wake on insert via LISTEN/NOTIFY instead
// of polling every 2s (about 43,200 guard SELECTs a day when idle). The
// interval below is only a slow safety sweep for a missed notification.
const SWEEP_MS = 60000;
// Background-jobs audit #46: a single unavailable transport used to
// abort the whole batch with only a throttled log line, so the outbox
// grew unboundedly and nothing surfaced it. publishBatch now skips
// just the failed restaurant, and this job raises an incident when
// the transport fails on consecutive sweeps (deduped on one open
// incident), resolving it when a sweep publishes cleanly again.
const TRANSPORT_FAILURE_INCIDENT_AFTER = 3;
const TRANSPORT_INCIDENT_DEDUPE_KEY = "restaurant-screen-transport-unavailable";
function startRestaurantScreenSync() {
  let stopped = false,
    running = null,
    lastWarning = 0,
    lastCleanup = 0,
    consecutiveTransportFailures = 0,
    unsubscribe = null;
  const run = () => {
    if (stopped || running) return;
    running = publishBatch()
      .then(async (outcome) => {
        const failed = outcome?.failed || [];
        if (failed.length) {
          consecutiveTransportFailures += 1;
          if (consecutiveTransportFailures >= TRANSPORT_FAILURE_INCIDENT_AFTER) {
            try {
              await recordIncident({
                type: "restaurant_screen_transport_unavailable",
                severity: "warning",
                message:
                  "Restaurant display transport has been unavailable for consecutive screen sync sweeps; screen events are accumulating unpublished.",
                details: {
                  consecutiveSweeps: consecutiveTransportFailures,
                  failedRestaurants: failed.map((f) => f.restaurantId),
                },
                dedupeKey: TRANSPORT_INCIDENT_DEDUPE_KEY,
              });
            } catch (error) {
              logger.warn("Restaurant screen transport incident could not be recorded", { error: error.message });
            }
          }
        } else if (consecutiveTransportFailures > 0) {
          consecutiveTransportFailures = 0;
          try {
            await resolveOpenIncidentsByDedupeKeys(
              [TRANSPORT_INCIDENT_DEDUPE_KEY],
              "Restaurant display transport recovered; screen events are publishing again."
            );
          } catch (error) {
            logger.warn("Restaurant screen transport incident could not be resolved", { error: error.message });
          }
        }
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
    run,
  };
}
module.exports = { startRestaurantScreenSync, TRANSPORT_FAILURE_INCIDENT_AFTER, TRANSPORT_INCIDENT_DEDUPE_KEY };
