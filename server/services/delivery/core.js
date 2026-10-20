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
  sendInApp,
  sendPush,
};
