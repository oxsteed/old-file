'use strict';

/**
 * Business broadcast delivery (analytics decision 1).
 *
 * queueBroadcast expands the audience into one recipient row per business
 * client and one delivery row per recipient and channel (UNIQUE, so a replay
 * never duplicates). A fenced worker claims due deliveries with
 * FOR UPDATE SKIP LOCKED and a fresh lease token; every completion write is
 * conditioned on that token, so a worker whose lease expired can never
 * overwrite a newer attempt. Retries back off exponentially up to
 * MAX_ATTEMPTS. Preferences and per-business unsubscribes are checked at
 * send time, so an opt-out after queueing still wins.
 *
 * Delivery semantics per channel:
 *  - in_app: a notifications row keyed by delivery (idempotent); "read"
 *    comes from notifications.read_at.
 *  - push: web push + native push to the user's enabled devices; "sent"
 *    means at least one device accepted; opens are reported by the
 *    notification click (service worker / app) to the tracking endpoint.
 *  - email: Resend with a per-delivery idempotency key (so a crash between
 *    send and record cannot double-send); opens via a 1x1 pixel, clicks via
 *    redirects limited to the links in the broadcast; RFC 8058 one-click
 *    unsubscribe.
 */

const crypto = require('crypto');
const logger = require('../utils/logger');
const escapeHtml = require('../utils/escapeHtml');
const { getPublicSiteUrl } = require('../utils/publicSiteUrl');

const CHANNEL_SETS = Object.freeze({
  email: Object.freeze(['email']),
  push: Object.freeze(['push']),
  in_app: Object.freeze(['in_app']),
  all: Object.freeze(['in_app', 'push', 'email']),
});
const CHANNELS = Object.freeze(['in_app', 'push', 'email']);
const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 300;
const MAX_LINKS = 20;
const LANGS = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);

const COPY = Object.freeze({
  en: { footer: 'You are receiving this because you are a customer of {{business}}.', unsubscribe: 'Unsubscribe from {{business}}',
    confirmTitle: 'Unsubscribe from {{business}}?', confirmBody: 'You will stop receiving broadcasts from {{business}}. Messages about your bookings and payments are not affected.',
    confirmButton: 'Unsubscribe', doneTitle: 'You are unsubscribed', doneBody: 'You will no longer receive broadcasts from {{business}}.',
    invalidTitle: 'This link is no longer valid', invalidBody: 'Manage your email preferences from your OxSteed account settings.', eyebrow: 'MESSAGE FROM {{business}}' },
  es: { footer: 'Recibes esto porque eres cliente de {{business}}.', unsubscribe: 'Cancelar suscripción a {{business}}',
    confirmTitle: '¿Cancelar la suscripción a {{business}}?', confirmBody: 'Dejarás de recibir anuncios de {{business}}. Los mensajes sobre tus reservas y pagos no cambian.',
    confirmButton: 'Cancelar suscripción', doneTitle: 'Suscripción cancelada', doneBody: 'Ya no recibirás anuncios de {{business}}.',
    invalidTitle: 'Este enlace ya no es válido', invalidBody: 'Administra tus preferencias de correo en la configuración de tu cuenta de OxSteed.', eyebrow: 'MENSAJE DE {{business}}' },
  fr: { footer: 'Vous recevez ce message parce que vous êtes client de {{business}}.', unsubscribe: 'Se désabonner de {{business}}',
    confirmTitle: 'Se désabonner de {{business}} ?', confirmBody: 'Vous ne recevrez plus les annonces de {{business}}. Les messages concernant vos réservations et paiements ne changent pas.',
    confirmButton: 'Se désabonner', doneTitle: 'Vous êtes désabonné', doneBody: 'Vous ne recevrez plus les annonces de {{business}}.',
    invalidTitle: 'Ce lien n’est plus valide', invalidBody: 'Gérez vos préférences e-mail dans les paramètres de votre compte OxSteed.', eyebrow: 'MESSAGE DE {{business}}' },
  ht: { footer: 'Ou resevwa sa paske ou se kliyan {{business}}.', unsubscribe: 'Dezabòne nan {{business}}',
    confirmTitle: 'Dezabòne nan {{business}}?', confirmBody: 'Ou p ap resevwa anons {{business}} ankò. Mesaj sou rezèvasyon ak peman ou yo pa chanje.',
    confirmButton: 'Dezabòne', doneTitle: 'Ou dezabòne', doneBody: 'Ou p ap resevwa anons {{business}} ankò.',
    invalidTitle: 'Lyen sa a pa valab ankò', invalidBody: 'Jere preferans imèl ou nan paramèt kont OxSteed ou.', eyebrow: 'MESAJ {{business}}' },
  ar: { footer: 'تتلقى هذه الرسالة لأنك عميل لدى {{business}}.', unsubscribe: 'إلغاء الاشتراك من {{business}}',
    confirmTitle: 'إلغاء الاشتراك من {{business}}؟', confirmBody: 'لن تتلقى بعد الآن إعلانات {{business}}. لا تتأثر الرسائل المتعلقة بحجوزاتك ومدفوعاتك.',
    confirmButton: 'إلغاء الاشتراك', doneTitle: 'تم إلغاء اشتراكك', doneBody: 'لن تتلقى بعد الآن إعلانات {{business}}.',
    invalidTitle: 'هذا الرابط لم يعد صالحًا', invalidBody: 'أدر تفضيلات البريد الإلكتروني من إعدادات حسابك في OxSteed.', eyebrow: 'رسالة من {{business}}' },
});

function copyFor(language) {
  const lang = String(language || 'en').slice(0, 2).toLowerCase();
  return { lang: LANGS.includes(lang) ? lang : 'en', copy: COPY[LANGS.includes(lang) ? lang : 'en'] };
}
const fill = (text, vars) => String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');

function apiBase() {
  return (process.env.BROADCAST_TRACKING_BASE_URL || process.env.API_PUBLIC_URL || getPublicSiteUrl()).replace(/\/+$/, '');
}
const trackingUrl = (path) => `${apiBase()}/api/broadcast-tracking/${path}`;

function resolveChannels(broadcast) {
  if (Array.isArray(broadcast.channels) && broadcast.channels.length) return broadcast.channels;
  return CHANNEL_SETS[broadcast.channel] || null;
}

/** http(s) links in the message, de-duplicated, in order (click whitelist). */
function extractLinks(message) {
  const links = [];
  for (const match of String(message || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const raw = match[0].replace(/[.,;:!?]+$/, '');
    try {
      const u = new URL(raw);
      if (!['http:', 'https:'].includes(u.protocol)) continue;
      if (!links.includes(u.toString()) && links.length < MAX_LINKS) links.push(u.toString());
    } catch { /* not a URL */ }
  }
  return links;
}

/**
 * Expand and queue a draft/scheduled broadcast. `client` must be in a
 * transaction. Future schedules stay 'scheduled' unless `now` has passed.
 */
async function queueBroadcast(client, { businessId, broadcastId, userId = null }) {
  const { rows: [b] } = await client.query(
    `SELECT *, (scheduled_at IS NOT NULL AND scheduled_at > NOW()) AS in_future
       FROM business_broadcasts WHERE id = $1 AND business_id = $2 FOR UPDATE`, [broadcastId, businessId]);
  if (!b) return { notFound: true };
  if (!['draft', 'scheduled'].includes(b.status)) return { conflict: true, broadcast: b };
  const channels = resolveChannels(b);
  if (!channels) {
    const err = new Error('This broadcast channel cannot be delivered');
    err.status = 400; err.code = 'broadcast_channel_unsupported';
    throw err;
  }
  if (b.in_future) {
    const { rows: [scheduled] } = await client.query(
      `UPDATE business_broadcasts SET status = 'scheduled', channels = $2, queued_by = COALESCE(queued_by, $3), updated_at = NOW()
        WHERE id = $1 RETURNING *`, [b.id, channels, userId]);
    return { scheduled: true, broadcast: scheduled };
  }

  // Audience: active, non-deleted CRM clients of this business, optionally
  // narrowed to a tag; customers the business has blocked are excluded.
  await client.query(
    `INSERT INTO business_broadcast_recipients (broadcast_id, business_id, client_id, user_id, email, tracking_token)
     SELECT $1, bc.business_id, bc.id, bc.customer_id,
            NULLIF(LOWER(TRIM(COALESCE(NULLIF(bc.email, ''), u.email))), ''),
            md5(random()::text || clock_timestamp()::text || bc.id::text) || replace(gen_random_uuid()::text, '-', '')
       FROM business_clients bc
       LEFT JOIN users u ON u.id = bc.customer_id
       LEFT JOIN customer_business_profile cbp ON cbp.business_id = bc.business_id AND cbp.customer_id = bc.customer_id
      WHERE bc.business_id = $2 AND bc.deleted_at IS NULL AND bc.status = 'active'
        AND COALESCE(cbp.is_blocked, FALSE) = FALSE
        AND ($3::TEXT IS NULL OR $3 = 'all' OR $3 = ANY(bc.tags))
     ON CONFLICT (broadcast_id, client_id) DO NOTHING`,
    [b.id, businessId, b.audience || b.audience_tag || 'all']);
  // One delivery per recipient and channel. Recipients a channel cannot reach
  // are recorded as skipped so reach is reported honestly.
  await client.query(
    `INSERT INTO business_broadcast_deliveries (broadcast_id, recipient_id, channel, status, skip_reason)
     SELECT r.broadcast_id, r.id, ch,
            CASE WHEN ch IN ('in_app', 'push') AND r.user_id IS NULL THEN 'skipped'
                 WHEN ch = 'email' AND r.email IS NULL THEN 'skipped' ELSE 'pending' END,
            CASE WHEN ch IN ('in_app', 'push') AND r.user_id IS NULL THEN 'no_platform_account'
                 WHEN ch = 'email' AND r.email IS NULL THEN 'no_email' END
       FROM business_broadcast_recipients r CROSS JOIN unnest($2::TEXT[]) AS ch
      WHERE r.broadcast_id = $1
     ON CONFLICT (broadcast_id, recipient_id, channel) DO NOTHING`, [b.id, channels]);
  const { rows: [queued] } = await client.query(
    `UPDATE business_broadcasts
        SET status = 'sending', channels = $2, tracked_links = $3::jsonb, delivery_tracked = TRUE,
            queued_at = COALESCE(queued_at, NOW()), queued_by = COALESCE(queued_by, $4), updated_at = NOW(),
            recipient_count = (SELECT COUNT(*)::INT FROM business_broadcast_recipients WHERE broadcast_id = $1)
      WHERE id = $1 RETURNING *`, [b.id, channels, JSON.stringify(extractLinks(b.message || b.body)), userId]);
  return { queued: true, broadcast: queued };
}

/** Claim due deliveries (and expired leases) with a fresh lease token. */
async function claimDeliveries(db, { limit = 50, leaseSeconds = LEASE_SECONDS } = {}) {
  const leaseToken = crypto.randomUUID();
  const { rows } = await db.query(
    `UPDATE business_broadcast_deliveries d
        SET status = 'sending', lease_token = $1, lease_expires_at = NOW() + ($3 || ' seconds')::INTERVAL,
            attempts = d.attempts + 1, updated_at = NOW()
      WHERE d.id IN (
        SELECT x.id FROM business_broadcast_deliveries x
          JOIN business_broadcasts b ON b.id = x.broadcast_id AND b.status = 'sending'
         WHERE (x.status = 'pending' AND x.next_attempt_at <= NOW())
            OR (x.status = 'sending' AND x.lease_expires_at < NOW())
         ORDER BY x.id LIMIT $2 FOR UPDATE OF x SKIP LOCKED)
      RETURNING d.*`, [leaseToken, limit, String(leaseSeconds)]);
  return rows;
}

async function complete(db, delivery, fields) {
  const sets = ['lease_token = NULL', 'lease_expires_at = NULL', 'updated_at = NOW()'];
  const values = [delivery.id, delivery.lease_token];
  for (const [col, val] of Object.entries(fields)) {
    if (col === 'sent_at') { sets.push('sent_at = COALESCE(sent_at, NOW())'); continue; }
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  }
  const { rowCount } = await db.query(
    `UPDATE business_broadcast_deliveries SET ${sets.join(', ')}
      WHERE id = $1 AND lease_token = $2 AND status = 'sending'`, values);
  if (!rowCount) logger.warn('[broadcast] stale lease; result not recorded', { deliveryId: delivery.id });
  return rowCount === 1;
}

function retryFields(delivery, error) {
  const message = String(error?.message || error || 'delivery failed').slice(0, 500);
  if (delivery.attempts >= MAX_ATTEMPTS) return { status: 'failed', last_error: message };
  const backoffSeconds = require('./delivery/core').retrySeconds(delivery.attempts,60);
  return { status: 'pending', last_error: message, next_attempt_at: new Date(Date.now() + backoffSeconds * 1000) };
}

async function loadContext(db, delivery) {
  const { rows: [ctx] } = await db.query(
    `SELECT r.id AS recipient_id, r.user_id, r.email, r.tracking_token, r.business_id,
            b.id AS broadcast_id, b.subject, COALESCE(b.message, b.body) AS message, b.tracked_links,
            biz.business_name, u.preferred_language,
            np.unsubscribe_all, np.unsubscribed_from_bulk_emails, np.marketing_emails, np.email_notifications,
            np.push_notifications, np.web_push_enabled,
            EXISTS (SELECT 1 FROM business_broadcast_suppressions s WHERE s.business_id = r.business_id
                     AND ((r.email IS NOT NULL AND s.email = r.email) OR (r.user_id IS NOT NULL AND s.user_id = r.user_id))) AS suppressed
       FROM business_broadcast_recipients r
       JOIN business_broadcasts b ON b.id = r.broadcast_id
       JOIN businesses biz ON biz.id = r.business_id
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN notification_preferences np ON np.user_id = r.user_id
      WHERE r.id = $1`, [delivery.recipient_id]);
  return ctx;
}

function renderEmail(ctx) {
  const { renderOxSteedEmail } = require('../utils/emailTemplate');
  const { lang, copy } = copyFor(ctx.preferred_language);
  const business = ctx.business_name || 'OxSteed';
  const links = Array.isArray(ctx.tracked_links) ? ctx.tracked_links : [];
  const token = encodeURIComponent(ctx.tracking_token);
  // Escape first, then turn whitelisted links into tracked anchors.
  let bodyHtml = escapeHtml(ctx.message).replace(/https?:\/\/[^\s<>"')\]]+/gi, (match) => {
    const trimmed = match.replace(/[.,;:!?]+$/, '');
    const tail = match.slice(trimmed.length);
    let index = -1;
    try { index = links.indexOf(new URL(trimmed.replace(/&amp;/g, '&')).toString()); } catch { /* keep text */ }
    if (index < 0) return match;
    return `<a href="${escapeHtml(trackingUrl(`c/${token}/${index}`))}" style="color:#c2410c;">${trimmed}</a>${tail}`;
  });
  bodyHtml = bodyHtml.split(/\n{2,}/).map(p => `<p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.65;">${p.replace(/\n/g, '<br>')}</p>`).join('');
  const unsubscribeUrl = trackingUrl(`u/${token}`);
  bodyHtml += `<p style="margin:24px 0 0;font-size:12px;color:#64748b;"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#64748b;">${escapeHtml(fill(copy.unsubscribe, { business }))}</a></p>`
    + `<img src="${escapeHtml(trackingUrl(`o/${token}.gif`))}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;">`;
  const rendered = renderOxSteedEmail({
    language: lang,
    eyebrow: fill(copy.eyebrow, { business: business.toUpperCase() }),
    title: ctx.subject,
    bodyHtml,
    bodyText: `${ctx.message}\n\n${fill(copy.unsubscribe, { business })}: ${unsubscribeUrl}`,
    footerText: fill(copy.footer, { business }),
  });
  return { ...rendered, unsubscribeUrl };
}

async function sendInApp(db, ctx, delivery) {
  return require('./delivery/core').sendInApp(db,{userId:ctx.user_id,type:'business_broadcast',
    title:String(ctx.subject).slice(0,255),body:ctx.message,url:null,deliveryKey:`business-broadcast:${delivery.id}`,
    data:{broadcast_id:String(ctx.broadcast_id),business_id:ctx.business_id,business_name:ctx.business_name}});
}

/** Deliver one claimed delivery. Never throws; records the outcome. */
async function deliverOne(db, delivery, deps = {}) {
  const sendEmail = deps.sendEmail || require('../utils/email').sendEmail;
  const webPush = deps.webPush || require('./webPushService');
  const mobilePush = deps.mobilePush || require('./mobilePushService');
  try {
    const ctx = await loadContext(db, delivery);
    if (!ctx) return complete(db, delivery, { status: 'skipped', skip_reason: 'recipient_removed' });
    if (ctx.suppressed) return complete(db, delivery, { status: 'skipped', skip_reason: 'unsubscribed' });

    if (delivery.channel === 'in_app') {
      const notificationId = await sendInApp(db, ctx, delivery);
      return complete(db, delivery, { status: 'sent', notification_id: notificationId, sent_at: true, last_error: null });
    }

    if (delivery.channel === 'push') {
      if (ctx.push_notifications === false || ctx.web_push_enabled === false) {
        return complete(db, delivery, { status: 'skipped', skip_reason: 'push_opted_out' });
      }
      const payload = { title: ctx.subject, body: String(ctx.message).slice(0, 240), type: 'business_broadcast',
        data: { broadcast_id: String(ctx.broadcast_id), track_url: trackingUrl(`p/${encodeURIComponent(ctx.tracking_token)}`) } };
      const {sent,failed}=await require('./delivery/core').sendPush(ctx.user_id,payload,{webPush,mobilePush});
      if (sent > 0) return complete(db, delivery, { status: 'sent', devices_sent: sent, sent_at: true, last_error: null });
      if (failed === 0) return complete(db, delivery, { status: 'skipped', skip_reason: 'no_push_device' });
      return complete(db, delivery, retryFields(delivery, 'push providers rejected every device'));
    }

    // email
    if (ctx.unsubscribe_all === true || ctx.unsubscribed_from_bulk_emails === true
      || ctx.marketing_emails === false || ctx.email_notifications === false) {
      return complete(db, delivery, { status: 'skipped', skip_reason: 'email_opted_out' });
    }
    const rendered = renderEmail(ctx);
    const result = await sendEmail({
      to: ctx.email,
      subject: ctx.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: ctx.business_name ? `${ctx.business_name} via OxSteed` : undefined,
      idempotencyKey: `business-broadcast:${delivery.id}`,
      headers: { 'List-Unsubscribe': `<${rendered.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    });
    if (result?.success) {
      return complete(db, delivery, { status: 'sent', provider_message_id: result.id || null, sent_at: true, last_error: null });
    }
    return complete(db, delivery, retryFields(delivery, result?.code || result?.error || 'email send failed'));
  } catch (err) {
    logger.warn('[broadcast] delivery attempt failed', { deliveryId: delivery.id, channel: delivery.channel, error: err.message });
    return complete(db, delivery, retryFields(delivery, err)).catch(() => false);
  }
}

async function finalizeBroadcasts(db) {
  const { rows } = await db.query(
    `UPDATE business_broadcasts b SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), completed_at = NOW(), updated_at = NOW()
      WHERE b.status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM business_broadcast_deliveries d WHERE d.broadcast_id = b.id AND d.status IN ('pending', 'sending'))
      RETURNING id`);
  return rows.map(r => r.id);
}

async function promoteScheduled(pool) {
  const { rows } = await pool.query(
    `SELECT id, business_id FROM business_broadcasts WHERE status = 'scheduled' AND scheduled_at <= NOW() ORDER BY scheduled_at LIMIT 20`);
  const promoted = [];
  for (const row of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await queueBroadcast(client, { businessId: row.business_id, broadcastId: row.id });
      await client.query('COMMIT');
      if (out.queued) promoted.push(row.id);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.warn('[broadcast] scheduled broadcast could not be queued', { broadcastId: row.id, error: err.message });
    } finally { client.release(); }
  }
  return promoted;
}

// ── Tracking ──────────────────────────────────────────────────────────────
async function recipientByToken(db, token) {
  if (!/^[a-f0-9]{40,128}$/i.test(String(token || ''))) return null;
  const { rows: [r] } = await db.query(
    `SELECT r.*, b.tracked_links, biz.business_name, u.preferred_language
       FROM business_broadcast_recipients r JOIN business_broadcasts b ON b.id = r.broadcast_id
       JOIN businesses biz ON biz.id = r.business_id LEFT JOIN users u ON u.id = r.user_id
      WHERE r.tracking_token = $1`, [token]);
  return r || null;
}

async function recordOpen(db, token, channel) {
  const r = await recipientByToken(db, token);
  if (!r) return false;
  const { rowCount } = await db.query(
    `UPDATE business_broadcast_deliveries SET opened_at = COALESCE(opened_at, NOW()), open_count = open_count + 1, updated_at = NOW()
      WHERE recipient_id = $1 AND channel = $2 AND status = 'sent'`, [r.id, channel]);
  return rowCount > 0;
}

/** Returns the whitelisted target URL, or null. A click implies an open. */
async function recordClick(db, token, index) {
  const r = await recipientByToken(db, token);
  const i = Number(index);
  const links = Array.isArray(r?.tracked_links) ? r.tracked_links : [];
  if (!r || !Number.isInteger(i) || i < 0 || i >= links.length) return null;
  await db.query(
    `UPDATE business_broadcast_deliveries
        SET clicked_at = COALESCE(clicked_at, NOW()), click_count = click_count + 1,
            opened_at = COALESCE(opened_at, NOW()), updated_at = NOW()
      WHERE recipient_id = $1 AND channel = 'email' AND status = 'sent'`, [r.id]);
  const target = String(links[i]);
  return /^https?:\/\//i.test(target) ? target : null;
}

async function unsubscribe(db, token, source) {
  const r = await recipientByToken(db, token);
  if (!r) return null;
  if (r.email) {
    await db.query(`INSERT INTO business_broadcast_suppressions (business_id, email, user_id, broadcast_id, source)
      VALUES ($1, $2, NULL, $3, $4) ON CONFLICT (business_id, email) WHERE email IS NOT NULL DO NOTHING`,
    [r.business_id, r.email, r.broadcast_id, source]);
  }
  if (r.user_id) {
    await db.query(`INSERT INTO business_broadcast_suppressions (business_id, email, user_id, broadcast_id, source)
      VALUES ($1, NULL, $2, $3, $4) ON CONFLICT (business_id, user_id) WHERE user_id IS NOT NULL DO NOTHING`,
    [r.business_id, r.user_id, r.broadcast_id, source]);
  }
  return r;
}

// ── Reporting ─────────────────────────────────────────────────────────────
const STATS_SQL = `
  SELECT d.broadcast_id, d.channel,
         COUNT(*)::INT AS total,
         COUNT(*) FILTER (WHERE d.status = 'sent')::INT AS sent,
         COUNT(*) FILTER (WHERE d.status IN ('pending', 'sending'))::INT AS pending,
         COUNT(*) FILTER (WHERE d.status = 'failed')::INT AS failed,
         COUNT(*) FILTER (WHERE d.status = 'skipped')::INT AS skipped,
         COUNT(*) FILTER (WHERE d.status = 'sent' AND (d.opened_at IS NOT NULL OR n.read_at IS NOT NULL))::INT AS opened,
         COUNT(*) FILTER (WHERE d.status = 'sent' AND d.clicked_at IS NOT NULL)::INT AS clicked,
         COUNT(*) FILTER (WHERE d.delivered_at IS NOT NULL)::INT AS delivered,
         COUNT(*) FILTER (WHERE d.bounced_at IS NOT NULL)::INT AS bounced,
         COUNT(*) FILTER (WHERE d.complained_at IS NOT NULL)::INT AS complained,
         COUNT(*) FILTER (WHERE d.provider_failed_at IS NOT NULL)::INT AS provider_failed,
         COUNT(*) FILTER (WHERE d.provider_event_at IS NOT NULL)::INT AS provider_events
    FROM business_broadcast_deliveries d
    LEFT JOIN notifications n ON n.id = d.notification_id
   WHERE d.broadcast_id = ANY($1::BIGINT[])
   GROUP BY d.broadcast_id, d.channel`;

// Email only: what the provider confirmed through signed webhooks (Resend).
// "sent" stays "accepted by the provider"; providerConfirmed is false until
// any delivery event arrived, so the UI never implies confirmed delivery.
function providerFields(row) {
  if (row.channel !== 'email') return {};
  return {
    delivered: row.delivered || 0,
    bounced: row.bounced || 0,
    complained: row.complained || 0,
    providerFailed: row.provider_failed || 0,
    providerConfirmed: Number(row.provider_events || 0) > 0,
  };
}

const rate = (num, den) => (den > 0 ? Math.round((1000 * num) / den) / 10 : null);

async function getBroadcastStats(db, broadcastIds) {
  const ids = broadcastIds.map(String);
  const out = Object.fromEntries(ids.map(id => [id, { channels: {}, unsubscribes: 0 }]));
  if (!ids.length) return out;
  const { rows } = await db.query(STATS_SQL, [ids]);
  const { rows: reasons } = await db.query(
    `SELECT broadcast_id, channel, skip_reason, COUNT(*)::INT AS n FROM business_broadcast_deliveries
      WHERE broadcast_id = ANY($1::BIGINT[]) AND skip_reason IS NOT NULL GROUP BY 1, 2, 3`, [ids]);
  const { rows: unsubs } = await db.query(
    `SELECT r.broadcast_id, COUNT(*)::INT AS n FROM business_broadcast_recipients r
      WHERE r.broadcast_id = ANY($1::BIGINT[])
        AND EXISTS (SELECT 1 FROM business_broadcast_suppressions s WHERE s.broadcast_id = r.broadcast_id
                     AND ((r.email IS NOT NULL AND s.email = r.email) OR (r.user_id IS NOT NULL AND s.user_id = r.user_id)))
      GROUP BY 1`, [ids]);
  for (const row of rows) {
    out[String(row.broadcast_id)].channels[row.channel] = {
      total: row.total, sent: row.sent, pending: row.pending, failed: row.failed, skipped: row.skipped, skipReasons: {},
      opened: row.opened, clicked: row.clicked,
      openRatePct: rate(row.opened, row.sent), clickRatePct: row.channel === 'email' ? rate(row.clicked, row.sent) : null,
      ...providerFields(row),
    };
  }
  for (const r of reasons) {
    const ch = out[String(r.broadcast_id)].channels[r.channel];
    if (ch) ch.skipReasons[r.skip_reason] = r.n;
  }
  for (const u of unsubs) out[String(u.broadcast_id)].unsubscribes = u.n;
  return out;
}

/** Business-level broadcast reporting over a trailing window. */
async function getBroadcastReport(db, businessId, days = 30) {
  const { rows } = await db.query(
    `SELECT d.channel,
            COUNT(DISTINCT d.broadcast_id)::INT AS broadcasts,
            COUNT(*) FILTER (WHERE d.status = 'sent')::INT AS sent,
            COUNT(*) FILTER (WHERE d.status = 'failed')::INT AS failed,
            COUNT(*) FILTER (WHERE d.status = 'skipped')::INT AS skipped,
            COUNT(*) FILTER (WHERE d.status = 'sent' AND (d.opened_at IS NOT NULL OR n.read_at IS NOT NULL))::INT AS opened,
            COUNT(*) FILTER (WHERE d.status = 'sent' AND d.clicked_at IS NOT NULL)::INT AS clicked,
            COUNT(*) FILTER (WHERE d.delivered_at IS NOT NULL)::INT AS delivered,
            COUNT(*) FILTER (WHERE d.bounced_at IS NOT NULL)::INT AS bounced,
            COUNT(*) FILTER (WHERE d.complained_at IS NOT NULL)::INT AS complained,
            COUNT(*) FILTER (WHERE d.provider_failed_at IS NOT NULL)::INT AS provider_failed,
            COUNT(*) FILTER (WHERE d.provider_event_at IS NOT NULL)::INT AS provider_events
       FROM business_broadcast_deliveries d
       JOIN business_broadcasts b ON b.id = d.broadcast_id
       LEFT JOIN notifications n ON n.id = d.notification_id
      WHERE b.business_id = $1 AND b.queued_at >= NOW() - ($2 || ' days')::INTERVAL AND b.queued_at < NOW()
      GROUP BY d.channel ORDER BY d.channel`, [businessId, String(days)]);
  const { rows: [u] } = await db.query(
    `SELECT COUNT(*)::INT AS n FROM business_broadcast_suppressions
      WHERE business_id = $1 AND created_at >= NOW() - ($2 || ' days')::INTERVAL AND created_at < NOW()`, [businessId, String(days)]);
  return {
    days,
    channels: Object.fromEntries(rows.map(r => {
      const { delivered, bounced, complained, provider_failed, provider_events, ...rest } = r;
      return [r.channel, { ...rest, openRatePct: rate(r.opened, r.sent),
        clickRatePct: r.channel === 'email' ? rate(r.clicked, r.sent) : null, ...providerFields(r) }];
    })),
    unsubscribes: u?.n || 0,
  };
}

function unsubscribePage({ state, language, business, actionUrl }) {
  const { lang, copy } = copyFor(language);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const vars = { business: business || 'OxSteed' };
  const title = state === 'confirm' ? copy.confirmTitle : state === 'done' ? copy.doneTitle : copy.invalidTitle;
  const body = state === 'confirm' ? copy.confirmBody : state === 'done' ? copy.doneBody : copy.invalidBody;
  const form = state === 'confirm'
    ? `<form method="post" action="${escapeHtml(actionUrl)}"><button type="submit" style="min-height:44px;padding:10px 20px;border:0;border-radius:10px;background:#b83f08;color:#fff;font-size:16px;font-weight:700;cursor:pointer;">${escapeHtml(fill(copy.confirmButton, vars))}</button></form>`
    : '';
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(fill(title, vars))}</title></head>`
    + `<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f1ec;color:#0f172a;"><main style="max-width:520px;margin:0 auto;padding:32px 16px;">`
    + `<h1 style="font-size:24px;line-height:1.25;overflow-wrap:anywhere;">${escapeHtml(fill(title, vars))}</h1><p style="font-size:16px;line-height:1.6;color:#334155;overflow-wrap:anywhere;">${escapeHtml(fill(body, vars))}</p>${form}</main></body></html>`;
}

module.exports = {
  CHANNEL_SETS, CHANNELS, MAX_ATTEMPTS, COPY, resolveChannels, extractLinks, queueBroadcast, claimDeliveries,
  deliverOne, finalizeBroadcasts, promoteScheduled, recordOpen, recordClick, unsubscribe, recipientByToken,
  getBroadcastStats, getBroadcastReport, renderEmail, unsubscribePage, trackingUrl,
};
