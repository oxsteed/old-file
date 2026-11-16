'use strict';

/**
 * Delivers committed progressive-access events (access_outbox) after commit
 * (spec: "Realtime and asynchronously executed actions"). Safe to rerun:
 * rows are claimed with FOR UPDATE SKIP LOCKED and the notification service
 * dedupes on `access-outbox:<dedupe_key>`. A failed send is retried with
 * backoff and never re-approves a request or creates a second grant.
 *
 * Messages carry only safe text and an opaque link to the status page;
 * never evidence, reviewer notes or unpublished business names.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');

const MAX_ATTEMPTS = 6;
const BATCH = 100;
const STATUS_URL = '/settings/applications';

const CAPABILITY_LABELS = {
  en: { 'helper.offer_services': 'offering services', 'business.own': 'running a business', 'restaurant.own': 'running a restaurant', 'consultant.accept_paying_clients': 'consulting for paying clients', 'tool_owner.list_equipment': 'listing equipment', 'logistics.ship': 'shipping with OxSteed Logistics', 'investor.reporting': 'investor reporting', 'franchise.operate': 'franchise operations' },
  es: { 'helper.offer_services': 'ofrecer servicios', 'business.own': 'administrar un negocio', 'restaurant.own': 'administrar un restaurante', 'consultant.accept_paying_clients': 'consultoría para clientes de pago', 'tool_owner.list_equipment': 'publicar equipos', 'logistics.ship': 'enviar con OxSteed Logistics', 'investor.reporting': 'informes para inversionistas', 'franchise.operate': 'operaciones de franquicia' },
  fr: { 'helper.offer_services': 'proposer des services', 'business.own': 'gérer une entreprise', 'restaurant.own': 'gérer un restaurant', 'consultant.accept_paying_clients': 'le conseil pour des clients payants', 'tool_owner.list_equipment': 'la mise en location de matériel', 'logistics.ship': 'les envois avec OxSteed Logistics', 'investor.reporting': 'les rapports investisseurs', 'franchise.operate': 'les opérations de franchise' },
  ht: { 'helper.offer_services': 'ofri sèvis', 'business.own': 'jere yon biznis', 'restaurant.own': 'jere yon restoran', 'consultant.accept_paying_clients': 'bay konsèy pou kliyan k ap peye', 'tool_owner.list_equipment': 'mete ekipman pou lwe', 'logistics.ship': 'voye machandiz ak OxSteed Logistics', 'investor.reporting': 'rapò pou envestisè', 'franchise.operate': 'operasyon franchiz' },
  ar: { 'helper.offer_services': 'تقديم الخدمات', 'business.own': 'إدارة نشاط تجاري', 'restaurant.own': 'إدارة مطعم', 'consultant.accept_paying_clients': 'تقديم الاستشارات للعملاء بأجر', 'tool_owner.list_equipment': 'عرض المعدات للتأجير', 'logistics.ship': 'الشحن عبر OxSteed Logistics', 'investor.reporting': 'تقارير المستثمرين', 'franchise.operate': 'عمليات الامتياز' },
};

const COPY = {
  en: {
    'access_request.submitted': ['Application received', (c) => `We received your application for ${c}. You can keep using your account while we review it.`],
    'access_request.needs_information': ['More information needed', (c) => `Your application for ${c} needs more information. Open it to see what to add.`],
    'access_request.approved': ['Application approved', (c) => `You're approved for ${c}. The new actions now appear where you use them.`],
    'access_request.declined': ['Application not approved', (c) => `Your application for ${c} was not approved. Open it to see why and what you can do next.`],
    'access_grant.suspended': ['Access paused', (c) => `Your access for ${c} is paused. Your customer account still works.`],
    'access_grant.revoked': ['Access removed', (c) => `Your access for ${c} was removed. Your customer account still works.`],
    'access_grant.active': ['Access restored', (c) => `Your access for ${c} is active again.`],
  },
  es: {
    'access_request.submitted': ['Solicitud recibida', (c) => `Recibimos tu solicitud para ${c}. Puedes seguir usando tu cuenta mientras la revisamos.`],
    'access_request.needs_information': ['Se necesita más información', (c) => `Tu solicitud para ${c} necesita más información. Ábrela para ver qué agregar.`],
    'access_request.approved': ['Solicitud aprobada', (c) => `Fuiste aprobado para ${c}. Las nuevas acciones ya aparecen donde las usas.`],
    'access_request.declined': ['Solicitud no aprobada', (c) => `Tu solicitud para ${c} no fue aprobada. Ábrela para ver el motivo y qué puedes hacer.`],
    'access_grant.suspended': ['Acceso en pausa', (c) => `Tu acceso para ${c} está en pausa. Tu cuenta de cliente sigue funcionando.`],
    'access_grant.revoked': ['Acceso retirado', (c) => `Se retiró tu acceso para ${c}. Tu cuenta de cliente sigue funcionando.`],
    'access_grant.active': ['Acceso restablecido', (c) => `Tu acceso para ${c} está activo de nuevo.`],
  },
  fr: {
    'access_request.submitted': ['Demande reçue', (c) => `Nous avons reçu votre demande pour ${c}. Vous pouvez continuer à utiliser votre compte pendant l'examen.`],
    'access_request.needs_information': ['Informations requises', (c) => `Votre demande pour ${c} nécessite plus d'informations. Ouvrez-la pour voir quoi ajouter.`],
    'access_request.approved': ['Demande approuvée', (c) => `Vous êtes approuvé pour ${c}. Les nouvelles actions apparaissent là où vous les utilisez.`],
    'access_request.declined': ['Demande non approuvée', (c) => `Votre demande pour ${c} n'a pas été approuvée. Ouvrez-la pour connaître la raison et la suite.`],
    'access_grant.suspended': ['Accès suspendu', (c) => `Votre accès pour ${c} est suspendu. Votre compte client fonctionne toujours.`],
    'access_grant.revoked': ['Accès retiré', (c) => `Votre accès pour ${c} a été retiré. Votre compte client fonctionne toujours.`],
    'access_grant.active': ['Accès rétabli', (c) => `Votre accès pour ${c} est de nouveau actif.`],
  },
  ht: {
    'access_request.submitted': ['Nou resevwa demann ou', (c) => `Nou resevwa demann ou pou ${c}. Ou ka kontinye itilize kont ou pandan n ap revize l.`],
    'access_request.needs_information': ['Nou bezwen plis enfòmasyon', (c) => `Demann ou pou ${c} bezwen plis enfòmasyon. Louvri l pou w wè sa pou w ajoute.`],
    'access_request.approved': ['Demann apwouve', (c) => `Ou apwouve pou ${c}. Nouvo aksyon yo parèt kounye a kote ou itilize yo.`],
    'access_request.declined': ['Demann pa apwouve', (c) => `Demann ou pou ${c} pa apwouve. Louvri l pou w wè poukisa ak sa ou ka fè.`],
    'access_grant.suspended': ['Aksè sispann pou kounye a', (c) => `Aksè ou pou ${c} sispann pou kounye a. Kont kliyan ou toujou mache.`],
    'access_grant.revoked': ['Aksè retire', (c) => `Yo retire aksè ou pou ${c}. Kont kliyan ou toujou mache.`],
    'access_grant.active': ['Aksè retabli', (c) => `Aksè ou pou ${c} aktif ankò.`],
  },
  ar: {
    'access_request.submitted': ['تم استلام الطلب', (c) => `استلمنا طلبك لـ${c}. يمكنك مواصلة استخدام حسابك أثناء المراجعة.`],
    'access_request.needs_information': ['مطلوب معلومات إضافية', (c) => `يحتاج طلبك لـ${c} إلى معلومات إضافية. افتحه لمعرفة ما يجب إضافته.`],
    'access_request.approved': ['تمت الموافقة على الطلب', (c) => `تمت الموافقة لك على ${c}. تظهر الإجراءات الجديدة الآن حيث تستخدمها.`],
    'access_request.declined': ['لم تتم الموافقة على الطلب', (c) => `لم تتم الموافقة على طلبك لـ${c}. افتحه لمعرفة السبب والخطوة التالية.`],
    'access_grant.suspended': ['تم إيقاف الوصول مؤقتًا', (c) => `تم إيقاف وصولك إلى ${c} مؤقتًا. لا يزال حساب العميل يعمل.`],
    'access_grant.revoked': ['تمت إزالة الوصول', (c) => `تمت إزالة وصولك إلى ${c}. لا يزال حساب العميل يعمل.`],
    'access_grant.active': ['تمت استعادة الوصول', (c) => `أصبح وصولك إلى ${c} نشطًا مرة أخرى.`],
  },
};

// WP-020: the remaining shipped locales (pt it de id tr sw vi ru zh ja ko hi ur bn th).
Object.assign(CAPABILITY_LABELS, require('./outboxCopy').LABELS);
Object.assign(COPY, require('./outboxCopy').COPY);

function buildMessage(eventType, capability, language) {
  const lang = COPY[language] ? language : 'en';
  const entry = COPY[lang][eventType] || COPY.en[eventType];
  if (!entry) return null;
  const label = (CAPABILITY_LABELS[lang] || CAPABILITY_LABELS.en)[capability] || CAPABILITY_LABELS.en[capability] || capability;
  return { title: entry[0], body: entry[1](label) };
}

function backoffSeconds(attempts) {
  return Math.min(3600, 30 * 2 ** attempts);
}

async function processAccessOutbox({ notify = null } = {}) {
  const send = notify || require('../notificationService').sendNotification;
  const client = await pool.connect();
  let sent = 0;
  let failed = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT o.*, u.preferred_language
         FROM access_outbox o JOIN users u ON u.id = o.user_id
        WHERE o.status = 'pending' AND o.next_attempt_at <= NOW()
        ORDER BY o.next_attempt_at, o.id
        LIMIT $1
        FOR UPDATE OF o SKIP LOCKED`,
      [BATCH],
    );
    for (const row of rows) {
      const lang = String(row.preferred_language || 'en').slice(0, 2).toLowerCase();
      const msg = buildMessage(row.event_type, row.payload && row.payload.capability, lang);
      try {
        if (!msg) throw new Error('unknown_event_type');
        const result = await send({
          userId: row.user_id,
          type: 'access_request_update',
          title: msg.title,
          body: msg.body,
          data: { event: row.event_type, request_id: row.request_id ? String(row.request_id) : null },
          action_url: row.request_id ? `${STATUS_URL}?request=${row.request_id}` : STATUS_URL,
          idempotencyKey: `access-outbox:${row.dedupe_key}`,
        });
        if (result && result.success === false && result.reason !== 'duplicate') throw new Error(result.reason || 'send_failed');
        await client.query("UPDATE access_outbox SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [row.id]);
        sent += 1;
      } catch (e) {
        const attempts = row.attempts + 1;
        await client.query(
          `UPDATE access_outbox SET attempts = $2::int, last_error = $3,
                  status = CASE WHEN $2::int >= $4::int THEN 'failed' ELSE 'pending' END,
                  next_attempt_at = NOW() + ($5::text || ' seconds')::interval
            WHERE id = $1`,
          [row.id, attempts, String(e.message || 'error').slice(0, 500), MAX_ATTEMPTS, String(backoffSeconds(attempts))],
        );
        failed += 1;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    logger.error('access outbox run failed', { error: e.message });
    throw e;
  } finally {
    client.release();
  }
  return { sent, failed };
}

const CRON_EXPRESSION = '20 * * * * *'; // every minute at :20s

function startAccessOutboxJob() {
  const cron = require('node-cron');
  const { withFencedJobLock } = require('../../jobs/jobLockingService');
  cron.schedule(CRON_EXPRESSION, async () => {
    try {
      await withFencedJobLock('access-outbox', () => processAccessOutbox(), 60);
    } catch (e) {
      logger.error('access outbox cron error', { error: e.message });
    }
  });
  logger.info('Access outbox job scheduled', { cron: CRON_EXPRESSION });
}

module.exports = { startAccessOutboxJob, CRON_EXPRESSION, processAccessOutbox, buildMessage, backoffSeconds, COPY, CAPABILITY_LABELS, STATUS_URL };
