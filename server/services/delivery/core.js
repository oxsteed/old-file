"use strict";
// Shared primitives keep platform campaigns independent of business ownership.
const crypto = require("crypto");
function retrySeconds(attempt, baseSeconds = 30) {
  return Math.min(3600, baseSeconds * 2 ** Math.max(0, attempt - 1));
}
async function claimOffers(conn, limit = 100) {
  const { rows } = await conn.query(
    `UPDATE offer_campaign_deliveries d SET status='sending',lease_token=$1,
    lease_expires_at=NOW()+interval '5 minutes',attempts=d.attempts+1
    WHERE d.id IN(SELECT x.id FROM offer_campaign_deliveries x JOIN offer_campaigns c ON c.id=x.campaign_id
      WHERE c.status IN ('queued','sending') AND x.attempts<5
      AND ((x.status='pending' AND x.next_attempt_at<=NOW()) OR (x.status='sending' AND x.lease_expires_at<NOW()))
      ORDER BY x.next_attempt_at,x.id LIMIT $2 FOR UPDATE OF x SKIP LOCKED) RETURNING d.*`,
    [crypto.randomUUID(), limit],
  );
  return rows;
}
async function finishOffer(
  conn,
  d,
  { status, reason = null, notificationId = null, deferSeconds = 0 },
) {
  const { rowCount } = await conn.query(
    `UPDATE offer_campaign_deliveries SET status=$3,skip_reason=$4,notification_id=COALESCE($5,notification_id),
    lease_token=NULL,lease_expires_at=NULL,sent_at=CASE WHEN $3='sent' THEN NOW() ELSE sent_at END,
    next_attempt_at=NOW()+make_interval(secs=>$6),attempts=CASE WHEN $6>3600 THEN GREATEST(0,attempts-1) ELSE attempts END
    WHERE id=$1 AND lease_token=$2 AND lease_expires_at>NOW()`,
    [d.id, d.lease_token, status, reason, notificationId, deferSeconds],
  );
  return rowCount > 0;
}
function quietHours(timezone, now = new Date()) {
  if (!timezone) return true;
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en", {
        timeZone: timezone,
        hour: "2-digit",
        hourCycle: "h23",
      }).format(now),
    );
    return hour >= 21 || hour < 8;
  } catch {
    return true;
  }
}
// Main IANA zone per country, used only when the user has not set a profile
// time zone (spec 16.2 fallback chain: profile tz -> city/postal zone ->
// country main zone -> 12:00-18:00 UTC window).
const COUNTRY_MAIN_TZ = {
  US: "America/New_York",
  CA: "America/Toronto",
  MX: "America/Mexico_City",
  DO: "America/Santo_Domingo",
  HT: "America/Port-au-Prince",
  BR: "America/Sao_Paulo",
  GB: "Europe/London",
  IE: "Europe/Dublin",
  FR: "Europe/Paris",
  ES: "Europe/Madrid",
  DE: "Europe/Berlin",
  IT: "Europe/Rome",
  NL: "Europe/Amsterdam",
  PT: "Europe/Lisbon",
  EG: "Africa/Cairo",
  MA: "Africa/Casablanca",
  SN: "Africa/Dakar",
  CI: "Africa/Abidjan",
  NG: "Africa/Lagos",
  KE: "Africa/Nairobi",
  ZA: "Africa/Johannesburg",
  AE: "Asia/Dubai",
  IN: "Asia/Kolkata",
  AU: "Australia/Sydney",
  NZ: "Pacific/Auckland",
};
function resolveTimezone({ timezone, country } = {}) {
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
      return timezone;
    } catch {
      /* fall through to the country zone */
    }
  }
  return COUNTRY_MAIN_TZ[String(country || "").toUpperCase()] || null;
}
function zonedParts(timezone, now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}
// UTC instant for a wall-clock time in a zone, resolved by offset iteration.
function zonedTimeToUtc(timezone, year, month, day, hour, minute) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(timezone, new Date(guess));
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const want = Date.UTC(year, month - 1, day, hour, minute, 0);
    if (seen === want) break;
    guess += want - seen;
  }
  return new Date(guess);
}
// Precise quiet-hours decision (spec 16.2): quiet is 21:00-08:00 recipient
// local; a held push is rescheduled to 08:00 local plus jitter. With no
// resolvable zone, only the 12:00-18:00 UTC window may send.
function quietWindow(timezone, now = new Date(), jitterMinutes = 0) {
  const jitterMs = Math.min(30, Math.max(0, jitterMinutes)) * 60000;
  if (!timezone) {
    const hour = now.getUTCHours();
    if (hour >= 12 && hour < 18) return { quiet: false, nextAttemptAt: null };
    const next = new Date(now);
    next.setUTCHours(12, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return { quiet: true, nextAttemptAt: new Date(next.getTime() + jitterMs) };
  }
  const p = zonedParts(timezone, now);
  const quiet = p.hour >= 21 || p.hour < 8;
  if (!quiet) return { quiet: false, nextAttemptAt: null };
  const dayShift = p.hour >= 21 ? 1 : 0;
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayShift));
  const next = zonedTimeToUtc(
    timezone,
    base.getUTCFullYear(),
    base.getUTCMonth() + 1,
    base.getUTCDate(),
    8,
    0,
  );
  return { quiet: true, nextAttemptAt: new Date(next.getTime() + jitterMs) };
}
async function sendInApp(
  conn,
  { userId, type, title, body, data, url, deliveryKey },
) {
  const {
    rows: [n],
  } = await conn.query(
    `INSERT INTO notifications(user_id,type,title,body,data,action_url,delivery_key,is_promotional)
    VALUES($1,$2,$3,$4,$5,$6,$7,TRUE) ON CONFLICT(delivery_key) WHERE delivery_key IS NOT NULL
    DO NOTHING RETURNING id`,
    [userId, type, title, body, JSON.stringify(data), url, deliveryKey],
  );
  if (n) return n.id;
  const {
    rows: [existing],
  } = await conn.query("SELECT id FROM notifications WHERE delivery_key=$1", [
    deliveryKey,
  ]);
  return existing?.id || null;
}
async function sendPush(userId, payload, deps = {}) {
  const web = deps.webPush || require("../webPushService");
  const mobile = deps.mobilePush || require("../mobilePushService");
  const results = await Promise.allSettled([
    web.sendToUser(userId, payload),
    mobile.sendToUser(userId, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
    }),
  ]);
  return results.reduce(
    (out, result) => {
      if (result.status === "rejected") out.failed++;
      else {
        out.sent += Number(result.value?.sent || 0);
        out.failed += Number(result.value?.failed || 0);
      }
      return out;
    },
    { sent: 0, failed: 0 },
  );
}
module.exports = {
  retrySeconds,
  claimOffers,
  finishOffer,
  quietHours,
  quietWindow,
  resolveTimezone,
  COUNTRY_MAIN_TZ,
  sendInApp,
  sendPush,
};
