'use strict';

/**
 * Server-side notification copy in the five supported languages
 * (en, es, fr, ht, ar). With FEATURE_LOCALIZED_NOTIFICATIONS off every user
 * gets English, which is byte-identical to the copy used before.
 * Placeholders: {name}. Amounts are pre-formatted with formatMoney in the
 * recipient's locale.
 */

const flags = require('./paymentLayerFlags');
const { formatMoney } = require('../validation/money');

const LANGS = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);
const LANG_ALIASES = Object.freeze({ english: 'en', spanish: 'es', french: 'fr', haitian_creole: 'ht', kreyol: 'ht', arabic: 'ar' });
const INTL_LOCALE = Object.freeze({ en: 'en-US', es: 'es', fr: 'fr', ht: 'fr-HT', ar: 'ar' });

const RAIL_NAMES = Object.freeze({
  stripe: { en: 'card payment', es: 'pago con tarjeta', fr: 'paiement par carte', ht: 'peman ak kat', ar: 'الدفع بالبطاقة' },
  credit: { en: 'OxSteed Credit', es: 'Crédito OxSteed', fr: 'Crédit OxSteed', ht: 'Kredi OxSteed', ar: 'رصيد OxSteed' },
  offline: { en: 'direct payment', es: 'pago directo', fr: 'paiement direct', ht: 'peman dirèk', ar: 'الدفع المباشر' },
});

const T = Object.freeze({
  payment_reauthorized: {
    en: ['New price authorized', 'The new job price from the approved change order is authorized. The job can be completed.'],
    es: ['Nuevo precio autorizado', 'El nuevo precio del trabajo de la orden de cambio aprobada está autorizado. El trabajo se puede completar.'],
    fr: ['Nouveau prix autorisé', 'Le nouveau prix de la mission issu de l’avenant approuvé est autorisé. La mission peut être terminée.'],
    ht: ['Nouvo pri a otorize', 'Nouvo pri travay la ki soti nan chanjman ki apwouve a otorize. Ou ka fini travay la.'],
    ar: ['تم اعتماد السعر الجديد', 'تم اعتماد السعر الجديد للمهمة من أمر التغيير المعتمد. يمكن الآن إكمال المهمة.'],
  },
  payment_reauth_expired: {
    en: ['Payment authorization expired', 'Your authorization request for the new job price expired. Open the job to try again.'],
    es: ['La autorización de pago venció', 'Tu solicitud de autorización para el nuevo precio venció. Abre el trabajo para intentarlo de nuevo.'],
    fr: ['Autorisation de paiement expirée', 'Votre demande d’autorisation pour le nouveau prix a expiré. Ouvrez la mission pour réessayer.'],
    ht: ['Otorizasyon peman an ekspire', 'Demann otorizasyon ou pou nouvo pri a ekspire. Louvri travay la pou eseye ankò.'],
    ar: ['انتهت صلاحية تفويض الدفع', 'انتهت صلاحية طلب التفويض للسعر الجديد. افتح المهمة للمحاولة مرة أخرى.'],
  },
  payment_reauth_declined: {
    en: ['Card was declined', 'Your card was declined for the new job price. Open the job to try another card.'],
    es: ['Tarjeta rechazada', 'Tu tarjeta fue rechazada para el nuevo precio. Abre el trabajo para probar otra tarjeta.'],
    fr: ['Carte refusée', 'Votre carte a été refusée pour le nouveau prix. Ouvrez la mission pour essayer une autre carte.'],
    ht: ['Kat la refize', 'Kat ou a refize pou nouvo pri a. Louvri travay la pou eseye yon lòt kat.'],
    ar: ['تم رفض البطاقة', 'تم رفض بطاقتك للسعر الجديد. افتح المهمة لتجربة بطاقة أخرى.'],
  },
  payment_hold_expiring: {
    en: ['Renew your payment hold', 'The card hold for this job expires soon. Open the job to renew it so your helper can be paid.'],
    es: ['Renueva la retención del pago', 'La retención en tu tarjeta para este trabajo vence pronto. Abre el trabajo para renovarla y que tu ayudante pueda cobrar.'],
    fr: ['Renouvelez l’empreinte bancaire', 'L’empreinte sur votre carte pour cette mission expire bientôt. Ouvrez la mission pour la renouveler afin que votre prestataire soit payé.'],
    ht: ['Renouvle kenbe peman an', 'Kenbe sou kat ou pou travay sa a ap ekspire byento. Louvri travay la pou renouvle l pou èd ou a ka touche.'],
    ar: ['جدّد حجز الدفع', 'ينتهي حجز المبلغ على بطاقتك لهذه المهمة قريبًا. افتح المهمة لتجديده حتى يحصل المساعد على أجره.'],
  },
  rail_switch_requested: {
    en: ['Payment method change requested', 'The other party asked to switch this job to {rail}. Open the job to accept or decline.'],
    es: ['Solicitud de cambio de método de pago', 'La otra parte pidió cambiar este trabajo a {rail}. Abre el trabajo para aceptar o rechazar.'],
    fr: ['Changement de mode de paiement demandé', 'L’autre partie a demandé de passer cette mission en {rail}. Ouvrez la mission pour accepter ou refuser.'],
    ht: ['Yo mande chanje mwayen peman', 'Lòt moun nan mande pou travay sa a pase sou {rail}. Louvri travay la pou aksepte oswa refize.'],
    ar: ['طلب تغيير طريقة الدفع', 'طلب الطرف الآخر تحويل هذه المهمة إلى {rail}. افتح المهمة للقبول أو الرفض.'],
  },
  rail_switched: {
    en: ['Payment method changed', 'This job is now paid with {rail}.'],
    es: ['Método de pago cambiado', 'Este trabajo ahora se paga con {rail}.'],
    fr: ['Mode de paiement modifié', 'Cette mission est désormais payée par {rail}.'],
    ht: ['Mwayen peman an chanje', 'Travay sa a kounye a ap peye ak {rail}.'],
    ar: ['تم تغيير طريقة الدفع', 'يتم الآن دفع هذه المهمة عبر {rail}.'],
  },
  rail_switch_declined: {
    en: ['Payment method change declined', 'The other party kept the current payment method for this job.'],
    es: ['Cambio de método de pago rechazado', 'La otra parte mantuvo el método de pago actual de este trabajo.'],
    fr: ['Changement de mode de paiement refusé', 'L’autre partie a conservé le mode de paiement actuel de cette mission.'],
    ht: ['Chanjman mwayen peman an refize', 'Lòt moun nan kenbe mwayen peman ki la a pou travay sa a.'],
    ar: ['تم رفض تغيير طريقة الدفع', 'أبقى الطرف الآخر على طريقة الدفع الحالية لهذه المهمة.'],
  },
  tip_received: {
    en: ['You received a tip', 'Your customer sent you a tip of {amount}.'],
    es: ['Recibiste una propina', 'Tu cliente te envió una propina de {amount}.'],
    fr: ['Vous avez reçu un pourboire', 'Votre client vous a envoyé un pourboire de {amount}.'],
    ht: ['Ou resevwa yon poubwa', 'Kliyan ou a voye yon poubwa {amount} ba ou.'],
    ar: ['تلقيت إكرامية', 'أرسل لك العميل إكرامية بقيمة {amount}.'],
  },
  cashout_paid: {
    en: ['Cash-out sent', 'Your cash-out of {amount} was sent.'],
    es: ['Retiro enviado', 'Se envió tu retiro de {amount}.'],
    fr: ['Retrait envoyé', 'Votre retrait de {amount} a été envoyé.'],
    ht: ['Retrè a voye', 'Retrè {amount} ou a voye.'],
    ar: ['تم إرسال السحب', 'تم إرسال سحبك بقيمة {amount}.'],
  },
  cashout_failed: {
    en: ['Cash-out failed', 'Your cash-out of {amount} could not be sent. The Credit is back in your balance.'],
    es: ['El retiro falló', 'No se pudo enviar tu retiro de {amount}. El crédito volvió a tu saldo.'],
    fr: ['Échec du retrait', 'Votre retrait de {amount} n’a pas pu être envoyé. Le crédit est revenu sur votre solde.'],
    ht: ['Retrè a echwe', 'Nou pa t ka voye retrè {amount} ou a. Kredi a retounen nan balans ou.'],
    ar: ['فشل السحب', 'تعذر إرسال سحبك بقيمة {amount}. أُعيد الرصيد إلى حسابك.'],
  },
  payment_charged_now: {
    en: ['Payment collected', 'Because this job is more than 5 days away, your payment of {amount} was collected now and is held safely until the job is done.'],
    es: ['Pago cobrado', 'Como este trabajo es dentro de más de 5 días, tu pago de {amount} se cobró ahora y se guarda de forma segura hasta que termine el trabajo.'],
    fr: ['Paiement encaissé', 'Cette mission ayant lieu dans plus de 5 jours, votre paiement de {amount} a été encaissé maintenant et est conservé en sécurité jusqu’à la fin de la mission.'],
    ht: ['Peman an pran', 'Paske travay sa a plis pase 5 jou devan, nou pran peman {amount} ou a kounye a epi n ap kenbe l an sekirite jiskaske travay la fini.'],
    ar: ['تم تحصيل الدفعة', 'لأن موعد هذه المهمة بعد أكثر من 5 أيام، تم تحصيل دفعتك البالغة {amount} الآن وهي محفوظة بأمان حتى إنجاز المهمة.'],
  },
});

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  const short = raw.split(/[-_]/)[0];
  if (LANGS.includes(raw)) return raw;
  if (LANG_ALIASES[raw]) return LANG_ALIASES[raw];
  return LANGS.includes(short) ? short : 'en';
}

function langFor(user) {
  if (!flags.isEnabled('LOCALIZED_NOTIFICATIONS')) return 'en';
  return normalizeLang(user?.preferred_language);
}

/** { title, body, lang } for a template key in the user's language. */
function render(key, user, params = {}) {
  const lang = langFor(user);
  const template = T[key];
  if (!template) throw new Error(`Unknown notification template: ${key}`);
  const [title, body] = template[lang] || template.en;
  const values = { ...params };
  if (values.rail && RAIL_NAMES[values.rail]) values.rail = RAIL_NAMES[values.rail][lang] || RAIL_NAMES[values.rail].en;
  if (values.amount_minor !== undefined) values.amount = formatMoney(Number(values.amount_minor), values.currency || 'USD', INTL_LOCALE[lang]);
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, k) => (values[k] === undefined ? '' : String(values[k])));
  return { title: fill(title), body: fill(body), lang };
}

async function loadRecipient(db, userId) {
  const { rows } = await db.query('SELECT id, preferred_language FROM users WHERE id = $1', [userId]);
  return rows[0] || { id: userId };
}

module.exports = { LANGS, TEMPLATES: T, RAIL_NAMES, normalizeLang, langFor, render, loadRecipient };
