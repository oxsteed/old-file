'use strict';

/**
 * Customer notices for OxSteed Credit compliance flows, emailed through
 * Resend (utils/email) in the recipient's language: en, es, fr, ht, ar.
 *
 * Unlike marketing notifications these are legal / security notices, so
 * they are ALWAYS localised (not gated by FEATURE_LOCALIZED_NOTIFICATIONS):
 * a worker must be able to read "a new bank account was added to your
 * wallet" in their own language. Arabic mail is sent with dir="rtl".
 *
 * Placeholders: {amount} (formatted from amount_minor + currency in the
 * recipient's locale), {date} (formatted from an ISO date), {last4},
 * {bank}, {code_hint}, {days}, {reference}, {deadline}.
 *
 * Legal text (dormancy, escheat, wind-down, dispute rights) is placeholder
 * wording until counsel approves it; operators can override any template
 * per language with credit_notice_overrides rows without a deploy.
 */

const pool = require('../../db');
const logger = require('../../utils/logger');
const { formatMoney } = require('../../validation/money');

const LANGS = Object.freeze(['en', 'es', 'fr', 'ht', 'ar']);
const INTL_LOCALE = Object.freeze({ en: 'en-US', es: 'es', fr: 'fr', ht: 'fr-HT', ar: 'ar' });

const T = Object.freeze({
  destination_micro_deposit: {
    en: ['Confirm your new payout account', 'We added a bank account ending in {last4} at {bank} to your OxSteed wallet. Within 1–3 business days you will see two small deposits from OxSteed. Enter both amounts in the app to confirm the account. For your safety, the first cash-out to a new account is sent {days} days after it is confirmed. If you did not add this account, contact OxSteed support right away.'],
    es: ['Confirma tu nueva cuenta de pago', 'Agregamos una cuenta bancaria terminada en {last4} de {bank} a tu billetera OxSteed. En 1 a 3 días hábiles verás dos depósitos pequeños de OxSteed. Ingresa ambos montos en la app para confirmar la cuenta. Por tu seguridad, el primer retiro a una cuenta nueva se envía {days} días después de confirmarla. Si no agregaste esta cuenta, contacta de inmediato al soporte de OxSteed.'],
    fr: ['Confirmez votre nouveau compte de versement', 'Nous avons ajouté un compte bancaire se terminant par {last4} chez {bank} à votre portefeuille OxSteed. Sous 1 à 3 jours ouvrés, vous verrez deux petits dépôts d’OxSteed. Saisissez les deux montants dans l’application pour confirmer le compte. Pour votre sécurité, le premier retrait vers un nouveau compte est envoyé {days} jours après sa confirmation. Si vous n’avez pas ajouté ce compte, contactez immédiatement le support OxSteed.'],
    ht: ['Konfime nouvo kont peman ou', 'Nou ajoute yon kont bank ki fini ak {last4} nan {bank} nan bous OxSteed ou. Nan 1 a 3 jou travay, w ap wè de ti depo OxSteed voye. Antre de montan yo nan aplikasyon an pou konfime kont lan. Pou sekirite ou, premye retrè sou yon nouvo kont ap voye {days} jou apre ou konfime l. Si se pa ou ki te ajoute kont sa a, kontakte sipò OxSteed touswit.'],
    ar: ['أكّد حساب الدفع الجديد', 'أضفنا حسابًا مصرفيًا ينتهي بـ {last4} لدى {bank} إلى محفظتك في OxSteed. خلال يوم إلى 3 أيام عمل سترى إيداعين صغيرين من OxSteed. أدخل المبلغين في التطبيق لتأكيد الحساب. حفاظًا على أمانك، يُرسل أول سحب إلى حساب جديد بعد {days} أيام من تأكيده. إذا لم تضف هذا الحساب، فتواصل مع دعم OxSteed فورًا.'],
  },
  destination_one_time_code: {
    en: ['Confirm your new payout account', 'We added a bank account ending in {last4} at {bank} to your OxSteed wallet. Within 1–3 business days a deposit from OxSteed will arrive with a 6-digit code in its reference. Enter that code in the app to confirm the account. For your safety, the first cash-out to a new account is sent {days} days after it is confirmed. If you did not add this account, contact OxSteed support right away.'],
    es: ['Confirma tu nueva cuenta de pago', 'Agregamos una cuenta bancaria terminada en {last4} de {bank} a tu billetera OxSteed. En 1 a 3 días hábiles llegará un depósito de OxSteed con un código de 6 dígitos en la referencia. Ingresa ese código en la app para confirmar la cuenta. Por tu seguridad, el primer retiro a una cuenta nueva se envía {days} días después de confirmarla. Si no agregaste esta cuenta, contacta de inmediato al soporte de OxSteed.'],
    fr: ['Confirmez votre nouveau compte de versement', 'Nous avons ajouté un compte bancaire se terminant par {last4} chez {bank} à votre portefeuille OxSteed. Sous 1 à 3 jours ouvrés, un dépôt d’OxSteed arrivera avec un code à 6 chiffres dans son libellé. Saisissez ce code dans l’application pour confirmer le compte. Pour votre sécurité, le premier retrait vers un nouveau compte est envoyé {days} jours après sa confirmation. Si vous n’avez pas ajouté ce compte, contactez immédiatement le support OxSteed.'],
    ht: ['Konfime nouvo kont peman ou', 'Nou ajoute yon kont bank ki fini ak {last4} nan {bank} nan bous OxSteed ou. Nan 1 a 3 jou travay, yon depo OxSteed ap rive ak yon kòd 6 chif nan referans li. Antre kòd sa a nan aplikasyon an pou konfime kont lan. Pou sekirite ou, premye retrè sou yon nouvo kont ap voye {days} jou apre ou konfime l. Si se pa ou ki te ajoute kont sa a, kontakte sipò OxSteed touswit.'],
    ar: ['أكّد حساب الدفع الجديد', 'أضفنا حسابًا مصرفيًا ينتهي بـ {last4} لدى {bank} إلى محفظتك في OxSteed. خلال يوم إلى 3 أيام عمل سيصل إيداع من OxSteed يحمل رمزًا من 6 أرقام في المرجع. أدخل هذا الرمز في التطبيق لتأكيد الحساب. حفاظًا على أمانك، يُرسل أول سحب إلى حساب جديد بعد {days} أيام من تأكيده. إذا لم تضف هذا الحساب، فتواصل مع دعم OxSteed فورًا.'],
  },
  destination_verified: {
    en: ['Payout account confirmed', 'Your bank account ending in {last4} is confirmed. Your first cash-out to it can be sent from {date}. If you did not do this, contact OxSteed support right away.'],
    es: ['Cuenta de pago confirmada', 'Tu cuenta bancaria terminada en {last4} está confirmada. Tu primer retiro a esa cuenta se puede enviar a partir del {date}. Si no fuiste tú, contacta de inmediato al soporte de OxSteed.'],
    fr: ['Compte de versement confirmé', 'Votre compte bancaire se terminant par {last4} est confirmé. Votre premier retrait vers ce compte pourra être envoyé à partir du {date}. Si ce n’était pas vous, contactez immédiatement le support OxSteed.'],
    ht: ['Kont peman an konfime', 'Kont bank ou ki fini ak {last4} la konfime. Premye retrè ou sou li ka voye apati {date}. Si se pa ou ki te fè sa, kontakte sipò OxSteed touswit.'],
    ar: ['تم تأكيد حساب الدفع', 'تم تأكيد حسابك المصرفي المنتهي بـ {last4}. يمكن إرسال أول سحب إليه اعتبارًا من {date}. إذا لم تقم بذلك، فتواصل مع دعم OxSteed فورًا.'],
  },
  cashout_held_for_review: {
    en: ['Your cash-out is being reviewed', 'Your cash-out of {amount} needs a short review before it is sent. The money stays reserved in your balance meanwhile. We will email you when it is sent or if we need anything from you.'],
    es: ['Tu retiro está en revisión', 'Tu retiro de {amount} necesita una breve revisión antes de enviarse. Mientras tanto, el dinero queda reservado en tu saldo. Te escribiremos cuando se envíe o si necesitamos algo de ti.'],
    fr: ['Votre retrait est en cours de vérification', 'Votre retrait de {amount} doit être brièvement vérifié avant l’envoi. L’argent reste réservé sur votre solde en attendant. Nous vous écrirons dès l’envoi ou si nous avons besoin d’informations.'],
    ht: ['Y ap revize retrè ou a', 'Retrè {amount} ou a bezwen yon ti revizyon anvan nou voye l. Lajan an rete rezève nan balans ou pandan tan sa a. N ap ekri ou lè nou voye l oswa si nou bezwen kèk bagay nan men ou.'],
    ar: ['سحبك قيد المراجعة', 'يحتاج سحبك بقيمة {amount} إلى مراجعة قصيرة قبل إرساله. يبقى المبلغ محجوزًا في رصيدك خلال ذلك. سنراسلك عند الإرسال أو إذا احتجنا إلى أي شيء منك.'],
  },
  reverification_required: {
    en: ['Please confirm your identity again', 'To keep using cash-out and higher balances, please confirm your identity again in the OxSteed app. Until then, cash-outs are paused. Your balance is safe.'],
    es: ['Confirma tu identidad de nuevo', 'Para seguir usando retiros y saldos más altos, confirma tu identidad de nuevo en la app de OxSteed. Hasta entonces, los retiros están en pausa. Tu saldo está seguro.'],
    fr: ['Veuillez confirmer à nouveau votre identité', 'Pour continuer à utiliser les retraits et des soldes plus élevés, confirmez à nouveau votre identité dans l’application OxSteed. D’ici là, les retraits sont suspendus. Votre solde est en sécurité.'],
    ht: ['Tanpri konfime idantite ou ankò', 'Pou kontinye itilize retrè ak balans ki pi wo, tanpri konfime idantite ou ankò nan aplikasyon OxSteed la. Jiskaske ou fè sa, retrè yo kanpe. Balans ou an sekirite.'],
    ar: ['يرجى تأكيد هويتك مرة أخرى', 'لمواصلة استخدام السحب والأرصدة الأعلى، يرجى تأكيد هويتك مرة أخرى في تطبيق OxSteed. حتى ذلك الحين، تتوقف عمليات السحب مؤقتًا. رصيدك في أمان.'],
  },
  dispute_received: {
    en: ['We received your report', 'We received your report about a Credit transaction ({reference}). We will finish our investigation by {deadline}. If we need longer, we will put the disputed amount back in your balance while we keep investigating.'],
    es: ['Recibimos tu reporte', 'Recibimos tu reporte sobre una transacción de Crédito ({reference}). Terminaremos la investigación a más tardar el {deadline}. Si necesitamos más tiempo, devolveremos el monto en disputa a tu saldo mientras seguimos investigando.'],
    fr: ['Nous avons reçu votre signalement', 'Nous avons reçu votre signalement concernant une opération en Crédit ({reference}). Nous terminerons notre enquête au plus tard le {deadline}. S’il nous faut plus de temps, nous recréditerons le montant contesté sur votre solde pendant la suite de l’enquête.'],
    ht: ['Nou resevwa rapò ou a', 'Nou resevwa rapò ou sou yon tranzaksyon Kredi ({reference}). N ap fini envestigasyon an anvan {deadline}. Si nou bezwen plis tan, n ap remèt montan ki an diskisyon an nan balans ou pandan n ap kontinye envestige.'],
    ar: ['استلمنا بلاغك', 'استلمنا بلاغك بشأن معاملة رصيد ({reference}). سننهي التحقيق بحلول {deadline}. إذا احتجنا وقتًا أطول، فسنعيد المبلغ المتنازع عليه إلى رصيدك أثناء استمرار التحقيق.'],
  },
  dispute_provisional_credit: {
    en: ['Provisional credit added', 'While we finish investigating your report ({reference}), we added {amount} to your balance. You can use it now. We will tell you the final result by {deadline}.'],
    es: ['Crédito provisional agregado', 'Mientras terminamos de investigar tu reporte ({reference}), agregamos {amount} a tu saldo. Puedes usarlo ahora. Te diremos el resultado final a más tardar el {deadline}.'],
    fr: ['Crédit provisoire ajouté', 'Pendant que nous terminons l’enquête sur votre signalement ({reference}), nous avons ajouté {amount} à votre solde. Vous pouvez l’utiliser dès maintenant. Nous vous communiquerons le résultat final au plus tard le {deadline}.'],
    ht: ['Nou ajoute yon kredi pwovizwa', 'Pandan n ap fini envestige rapò ou a ({reference}), nou ajoute {amount} nan balans ou. Ou ka itilize l kounye a. N ap di ou rezilta final la anvan {deadline}.'],
    ar: ['تمت إضافة رصيد مؤقت', 'أثناء إنهاء التحقيق في بلاغك ({reference})، أضفنا {amount} إلى رصيدك. يمكنك استخدامه الآن. سنبلغك بالنتيجة النهائية بحلول {deadline}.'],
  },
  dispute_resolved: {
    en: ['Your report is resolved', 'We finished investigating your report ({reference}). Open the OxSteed app to see the result and an explanation. You can ask for the documents we relied on.'],
    es: ['Tu reporte está resuelto', 'Terminamos de investigar tu reporte ({reference}). Abre la app de OxSteed para ver el resultado y la explicación. Puedes pedir los documentos en los que nos basamos.'],
    fr: ['Votre signalement est traité', 'Nous avons terminé l’enquête sur votre signalement ({reference}). Ouvrez l’application OxSteed pour voir le résultat et son explication. Vous pouvez demander les documents sur lesquels nous nous sommes appuyés.'],
    ht: ['Rapò ou a rezoud', 'Nou fini envestige rapò ou a ({reference}). Louvri aplikasyon OxSteed la pou wè rezilta a ak yon esplikasyon. Ou ka mande dokiman nou te itilize yo.'],
    ar: ['تمت معالجة بلاغك', 'أنهينا التحقيق في بلاغك ({reference}). افتح تطبيق OxSteed لرؤية النتيجة والشرح. يمكنك طلب المستندات التي اعتمدنا عليها.'],
  },
  dormancy_notice: {
    en: ['Your OxSteed Credit balance is inactive', 'Your OxSteed Credit balance of {amount} has had no activity for a long time. To keep it, sign in and use it, or ask to have it paid out, before {deadline}. After that date, the law may require us to send it to the unclaimed property office, where you can still claim it.'],
    es: ['Tu saldo de Crédito OxSteed está inactivo', 'Tu saldo de Crédito OxSteed de {amount} no ha tenido actividad por mucho tiempo. Para conservarlo, inicia sesión y úsalo, o pide que te lo paguemos, antes del {deadline}. Después de esa fecha, la ley puede obligarnos a enviarlo a la oficina de bienes no reclamados, donde aún podrás reclamarlo.'],
    fr: ['Votre solde Crédit OxSteed est inactif', 'Votre solde Crédit OxSteed de {amount} n’a enregistré aucune opération depuis longtemps. Pour le conserver, connectez-vous et utilisez-le, ou demandez son versement, avant le {deadline}. Après cette date, la loi peut nous obliger à le transférer à l’organisme des avoirs non réclamés, auprès duquel vous pourrez encore le réclamer.'],
    ht: ['Balans Kredi OxSteed ou an pa aktif', 'Balans Kredi OxSteed ou a ki se {amount} pa gen okenn aktivite depi lontan. Pou kenbe l, konekte epi itilize l, oswa mande pou nou peye l ba ou, anvan {deadline}. Apre dat sa a, lalwa ka oblije nou voye l bay biwo byen ki pa reklame yo, kote ou ka toujou reklame l.'],
    ar: ['رصيدك في OxSteed غير نشط', 'لم يشهد رصيدك في OxSteed البالغ {amount} أي نشاط منذ مدة طويلة. للاحتفاظ به، سجّل الدخول واستخدمه أو اطلب صرفه قبل {deadline}. بعد هذا التاريخ قد يُلزمنا القانون بتحويله إلى جهة الأموال غير المطالب بها، ويمكنك المطالبة به لديها لاحقًا.'],
  },
  wind_down_notice: {
    en: ['OxSteed Credit is closing — your money will be returned', 'OxSteed Credit is closing. Your balance of {amount} will be paid back to you. Add or confirm a payout bank account in the app before {deadline}. If you do nothing, we will contact you again and keep your money safe until it is claimed.'],
    es: ['OxSteed Credit cerrará: te devolveremos tu dinero', 'OxSteed Credit va a cerrar. Te devolveremos tu saldo de {amount}. Agrega o confirma una cuenta bancaria de pago en la app antes del {deadline}. Si no haces nada, te contactaremos de nuevo y guardaremos tu dinero de forma segura hasta que lo reclames.'],
    fr: ['OxSteed Credit ferme — votre argent vous sera rendu', 'OxSteed Credit ferme. Votre solde de {amount} vous sera remboursé. Ajoutez ou confirmez un compte bancaire de versement dans l’application avant le {deadline}. Sans action de votre part, nous vous recontacterons et conserverons votre argent en sécurité jusqu’à ce que vous le réclamiez.'],
    ht: ['OxSteed Credit ap fèmen — n ap remèt ou lajan ou', 'OxSteed Credit ap fèmen. N ap remèt ou balans {amount} ou a. Ajoute oswa konfime yon kont bank pou peman nan aplikasyon an anvan {deadline}. Si ou pa fè anyen, n ap kontakte ou ankò epi n ap kenbe lajan ou an sekirite jiskaske ou reklame l.'],
    ar: ['خدمة OxSteed Credit ستُغلق — ستُعاد أموالك', 'ستُغلق خدمة OxSteed Credit. سيُعاد إليك رصيدك البالغ {amount}. أضف حسابًا مصرفيًا للدفع أو أكّده في التطبيق قبل {deadline}. إذا لم تفعل شيئًا، فسنتواصل معك مجددًا ونحفظ أموالك بأمان حتى تطالب بها.'],
  },
});

function normalizeLang(value) {
  const raw = String(value || '').trim().toLowerCase();
  const short = raw.split(/[-_]/)[0];
  if (LANGS.includes(raw)) return raw;
  return LANGS.includes(short) ? short : 'en';
}

function formatDate(value, lang) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat(INTL_LOCALE[lang] || 'en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/** { subject, text, html, lang } for a notice in the given language. */
function renderNotice(key, language, params = {}, override = null) {
  const lang = normalizeLang(language);
  const template = T[key];
  if (!template) throw new Error(`Unknown Credit notice: ${key}`);
  const [subjectTpl, bodyTpl] = override || template[lang] || template.en;
  const values = { ...params };
  if (values.amount_minor !== undefined) values.amount = formatMoney(Number(values.amount_minor), values.currency || 'USD', INTL_LOCALE[lang]);
  for (const field of ['date', 'deadline']) {
    if (values[field] && /^\d{4}-\d{2}-\d{2}/.test(String(values[field]))) values[field] = formatDate(values[field], lang);
  }
  const fill = (text) => text.replace(/\{(\w+)\}/g, (_, k) => (values[k] === undefined || values[k] === null ? '' : String(values[k])));
  const subject = fill(subjectTpl);
  const text = fill(bodyTpl);
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const html = `<!doctype html><html lang="${lang}" dir="${dir}"><body style="font-family:Arial,sans-serif;line-height:1.5;text-align:start">`
    + `<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2><p style="margin:0">${escapeHtml(text)}</p>`
    + '<p style="margin-block-start:24px;color:#666;font-size:12px">OxSteed</p></body></html>';
  return { subject, text, html, lang };
}

async function loadOverride(db, key, lang) {
  try {
    const { rows } = await db.query(
      `SELECT subject, body FROM credit_notice_overrides
        WHERE notice_key = $1 AND language = $2 AND active = TRUE
        ORDER BY updated_at DESC LIMIT 1`,
      [key, lang]
    );
    return rows && rows[0] ? [rows[0].subject, rows[0].body] : null;
  } catch {
    return null;
  }
}

/**
 * Email a notice to a user in their preferred language. Never throws:
 * returns { sent, lang, error? } so money flows are not blocked by email,
 * while callers that must prove delivery (dormancy, wind-down) record the
 * result.
 */
async function sendUserNotice({ userId, key, params = {}, idempotencyKey, db = pool }) {
  try {
    const { rows } = await db.query('SELECT id, email, preferred_language FROM users WHERE id = $1', [userId]);
    const user = rows && rows[0];
    if (!user || !user.email) return { sent: false, error: 'no_email' };
    const lang = normalizeLang(user.preferred_language);
    const override = await loadOverride(db, key, lang);
    const notice = renderNotice(key, lang, params, override);
    const { sendEmail } = require('../../utils/email');
    const result = await sendEmail({ to: user.email, subject: notice.subject, text: notice.text, html: notice.html, idempotencyKey });
    return { sent: Boolean(result && result.success), lang, providerId: result?.id || null, error: result?.success ? null : (result?.error || 'send_failed') };
  } catch (error) {
    logger.warn('credit_notice.send_failed', { key, error: error.message });
    return { sent: false, error: error.message };
  }
}

module.exports = { LANGS, NOTICES: T, normalizeLang, renderNotice, sendUserNotice };
