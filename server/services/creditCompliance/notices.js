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
  dispute_provisional_credit: {
    en: ['Provisional credit added', 'While we finish investigating your report ({reference}), we added {amount} to your balance. You can use it now. We will tell you the final result by {deadline}.'],
    es: ['Crédito provisional agregado', 'Mientras terminamos de investigar tu reporte ({reference}), agregamos {amount} a tu saldo. Puedes usarlo ahora. Te diremos el resultado final a más tardar el {deadline}.'],
    fr: ['Crédit provisoire ajouté', 'Pendant que nous terminons l’enquête sur votre signalement ({reference}), nous avons ajouté {amount} à votre solde. Vous pouvez l’utiliser dès maintenant. Nous vous communiquerons le résultat final au plus tard le {deadline}.'],
    ht: ['Nou ajoute yon kredi pwovizwa', 'Pandan n ap fini envestige rapò ou a ({reference}), nou ajoute {amount} nan balans ou. Ou ka itilize l kounye a. N ap di ou rezilta final la anvan {deadline}.'],
    ar: ['تمت إضافة رصيد مؤقت', 'أثناء إنهاء التحقيق في بلاغك ({reference})، أضفنا {amount} إلى رصيدك. يمكنك استخدامه الآن. سنبلغك بالنتيجة النهائية بحلول {deadline}.'],
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
  dispute_results: {
    en: ['Written results of your report', 'We finished investigating your report ({reference}). Result: {outcome}. Explanation: {explanation} You can ask us for copies of the documents we relied on. If you disagree, reply through Help in the OxSteed app.'],
    es: ['Resultado por escrito de tu reporte', 'Terminamos de investigar tu reporte ({reference}). Resultado: {outcome}. Explicación: {explanation} Puedes pedirnos copias de los documentos en los que nos basamos. Si no estás de acuerdo, responde desde Ayuda en la app de OxSteed.'],
    fr: ['Résultat écrit de votre signalement', 'Nous avons terminé l’enquête sur votre signalement ({reference}). Résultat : {outcome}. Explication : {explanation} Vous pouvez demander une copie des documents sur lesquels nous nous sommes appuyés. En cas de désaccord, répondez depuis Aide dans l’application OxSteed.'],
    ht: ['Rezilta ekri rapò ou a', 'Nou fini envestige rapò ou a ({reference}). Rezilta: {outcome}. Esplikasyon: {explanation} Ou ka mande nou kopi dokiman nou te itilize yo. Si ou pa dakò, reponn nan Èd nan aplikasyon OxSteed la.'],
    ar: ['النتيجة المكتوبة لبلاغك', 'أنهينا التحقيق في بلاغك ({reference}). النتيجة: {outcome}. الشرح: {explanation} يمكنك أن تطلب منا نسخًا من المستندات التي اعتمدنا عليها. إذا لم توافق، فرُدّ من قسم المساعدة في تطبيق OxSteed.'],
  },
  dispute_provisional_reversal: {
    en: ['We will take back the temporary credit', 'Our investigation of your report ({reference}) found no error. The temporary credit of {amount} we added to your balance will be removed on {date}. Until then you can keep using it. You can ask for the documents we relied on.'],
    es: ['Retiraremos el crédito temporal', 'Nuestra investigación de tu reporte ({reference}) no encontró ningún error. El crédito temporal de {amount} que agregamos a tu saldo se retirará el {date}. Hasta entonces puedes seguir usándolo. Puedes pedir los documentos en los que nos basamos.'],
    fr: ['Nous allons reprendre le crédit temporaire', 'Notre enquête sur votre signalement ({reference}) n’a trouvé aucune erreur. Le crédit temporaire de {amount} ajouté à votre solde sera retiré le {date}. D’ici là, vous pouvez continuer à l’utiliser. Vous pouvez demander les documents sur lesquels nous nous sommes appuyés.'],
    ht: ['Nou pral retire kredi tanporè a', 'Envestigasyon nou fè sou rapò ou a ({reference}) pa jwenn okenn erè. Kredi tanporè {amount} nou te mete sou balans ou a ap retire {date}. Jiska dat sa a ou ka kontinye itilize l. Ou ka mande dokiman nou te itilize yo.'],
    ar: ['سنسترد الرصيد المؤقت', 'لم يجد تحقيقنا في بلاغك ({reference}) أي خطأ. سيُخصم الرصيد المؤقت البالغ {amount} الذي أضفناه إلى رصيدك في {date}. يمكنك الاستمرار في استخدامه حتى ذلك الحين. يمكنك طلب المستندات التي اعتمدنا عليها.'],
  },
  cashout_dispute_received: {
    en: ['We received your cash-out report', 'We received your report that a cash-out of {amount} did not arrive ({reference}). We will trace it with the bank and give you a written answer by {deadline}.'],
    es: ['Recibimos tu reporte de retiro', 'Recibimos tu reporte de que un retiro de {amount} no llegó ({reference}). Lo rastrearemos con el banco y te daremos una respuesta por escrito antes del {deadline}.'],
    fr: ['Nous avons reçu votre signalement de retrait', 'Nous avons reçu votre signalement indiquant qu’un retrait de {amount} n’est pas arrivé ({reference}). Nous allons le retracer avec la banque et vous répondrons par écrit avant le {deadline}.'],
    ht: ['Nou resevwa rapò retrè ou a', 'Nou resevwa rapò ou ki di yon retrè {amount} pa rive ({reference}). N ap swiv li ak bank lan epi n ap ba ou yon repons ekri anvan {deadline}.'],
    ar: ['استلمنا بلاغك عن السحب', 'استلمنا بلاغك بأن سحبًا بمبلغ {amount} لم يصل ({reference}). سنتتبعه مع البنك ونرسل إليك ردًا مكتوبًا قبل {deadline}.'],
  },
  escheat_completed: {
    en: ['Your inactive balance was sent for safekeeping', 'Your OxSteed Credit balance of {amount} had no activity and you did not respond to our notices, so we moved it to unclaimed property. It is still yours: contact OxSteed support to get it back. If it has already been sent to {authority}, you can claim it there.'],
    es: ['Tu saldo inactivo se envió para su resguardo', 'Tu saldo de Crédito OxSteed de {amount} no tuvo actividad y no respondiste a nuestros avisos, así que lo pasamos a bienes no reclamados. Sigue siendo tuyo: contacta al soporte de OxSteed para recuperarlo. Si ya se envió a {authority}, puedes reclamarlo allí.'],
    fr: ['Votre solde inactif a été mis en sécurité', 'Votre solde Crédit OxSteed de {amount} n’a enregistré aucune opération et vous n’avez pas répondu à nos avis : nous l’avons donc transféré en avoirs non réclamés. Il vous appartient toujours : contactez le support OxSteed pour le récupérer. S’il a déjà été versé à {authority}, vous pouvez le réclamer auprès de cet organisme.'],
    ht: ['Balans ou ki pa aktif la voye pou yo kenbe l an sekirite', 'Balans Kredi OxSteed ou a ki se {amount} pa t gen aktivite epi ou pa t reponn avi nou yo, kidonk nou mete l nan byen ki pa reklame. Li toujou pou ou: kontakte sipò OxSteed pou jwenn li ankò. Si nou te deja voye l bay {authority}, ou ka reklame l la.'],
    ar: ['نُقل رصيدك غير النشط للحفظ', 'لم يشهد رصيدك في OxSteed البالغ {amount} أي نشاط ولم ترد على إشعاراتنا، لذا نقلناه إلى الأموال غير المطالب بها. ما زال ملكًا لك: تواصل مع دعم OxSteed لاسترداده. وإذا كان قد أُرسل بالفعل إلى {authority} فيمكنك المطالبة به لديها.'],
  },
  wind_down_redemption_sent: {
    en: ['Your OxSteed Credit balance was paid out', 'We sent {amount} to your bank account ending in {last4}. This is the redemption of your OxSteed Credit balance because the service is closing.'],
    es: ['Pagamos tu saldo de Crédito OxSteed', 'Enviamos {amount} a tu cuenta bancaria terminada en {last4}. Es el reembolso de tu saldo de Crédito OxSteed porque el servicio va a cerrar.'],
    fr: ['Votre solde Crédit OxSteed a été versé', 'Nous avons envoyé {amount} sur votre compte bancaire se terminant par {last4}. Il s’agit du remboursement de votre solde Crédit OxSteed, car le service ferme.'],
    ht: ['Nou peye balans Kredi OxSteed ou a', 'Nou voye {amount} sou kont bank ou ki fini ak {last4}. Se ranbousman balans Kredi OxSteed ou a paske sèvis la ap fèmen.'],
    ar: ['صُرف رصيدك في OxSteed Credit', 'أرسلنا {amount} إلى حسابك المصرفي المنتهي بـ {last4}. هذا استرداد رصيدك في OxSteed Credit لأن الخدمة ستُغلق.'],
  },
});

// Localised dispute outcomes for the {outcome} placeholder (outcome_key).
const OUTCOMES = Object.freeze({
  resolved_customer: { en: 'we found an error and corrected it in your favour', es: 'encontramos un error y lo corregimos a tu favor', fr: 'nous avons trouvé une erreur et l’avons corrigée en votre faveur', ht: 'nou jwenn yon erè epi nou korije l an favè ou', ar: 'وجدنا خطأً وصححناه لصالحك' },
  resolved_merchant: { en: 'we found no error', es: 'no encontramos ningún error', fr: 'nous n’avons trouvé aucune erreur', ht: 'nou pa jwenn okenn erè', ar: 'لم نجد أي خطأ' },
  rejected: { en: 'we could not confirm an error', es: 'no pudimos confirmar un error', fr: 'nous n’avons pas pu confirmer d’erreur', ht: 'nou pa t ka konfime yon erè', ar: 'لم نتمكن من تأكيد وجود خطأ' },
  resolved: { en: 'your report is closed', es: 'tu reporte está cerrado', fr: 'votre signalement est clos', ht: 'rapò ou a fèmen', ar: 'تم إغلاق بلاغك' },
  resolved_paid_confirmed: { en: 'the bank confirmed the payment reached your account', es: 'el banco confirmó que el pago llegó a tu cuenta', fr: 'la banque a confirmé que le paiement est arrivé sur votre compte', ht: 'bank lan konfime peman an rive sou kont ou', ar: 'أكد البنك وصول الدفعة إلى حسابك' },
  resolved_reissued: { en: 'we are sending the payment again', es: 'enviaremos el pago de nuevo', fr: 'nous renvoyons le paiement', ht: 'n ap voye peman an ankò', ar: 'سنرسل الدفعة مرة أخرى' },
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
  if (values.outcome_key && OUTCOMES[values.outcome_key]) values.outcome = OUTCOMES[values.outcome_key][lang] || OUTCOMES[values.outcome_key].en;
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
 *
 * Notifications audit items 8/56: the email was the ONLY channel, so a
 * failed send left zero user-visible trace. Every notice therefore also
 * gets a durable in-app `notifications` row, inserted here once so every
 * caller (present and future) inherits it instead of each site patching
 * its own fallback. The row carries the rendered subject/body (the
 * notification centre and /activity render title + body, and the View
 * button from data.action_url), is deduped on the caller's idempotency
 * key, and records the email delivery result in data + is_email_sent.
 * The row is inserted BEFORE the email attempt so even a throw leaves
 * the trace; the email result is merged into the row afterwards.
 */
async function sendUserNotice({ userId, key, params = {}, idempotencyKey, db = pool }) {
  try {
    const { rows } = await db.query('SELECT id, email, preferred_language FROM users WHERE id = $1', [userId]);
    const user = rows && rows[0];
    if (!user) return { sent: false, error: 'no_user' };
    const lang = normalizeLang(user.preferred_language);
    const override = await loadOverride(db, key, lang);
    const notice = renderNotice(key, lang, params, override);
    const deliveryKey = idempotencyKey ? `credit-notice:${String(idempotencyKey).trim().slice(0, 200)}` : null;
    let notificationId = null;
    let inApp = false;
    try {
      const inserted = await db.query(
        `INSERT INTO notifications (user_id, type, title, body, data, action_url, delivery_key)
         VALUES ($1, 'credit_notice', $2, $3, $4::jsonb, '/wallet', $5)
         ON CONFLICT (delivery_key) WHERE delivery_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [userId, notice.subject.slice(0, 255), notice.text,
          JSON.stringify({ notice_key: key, action_url: '/wallet', email_sent: null, email_error: null }), deliveryKey]
      );
      if (inserted.rows && inserted.rows[0]) {
        notificationId = String(inserted.rows[0].id);
        inApp = true;
      } else if (deliveryKey) {
        const existing = await db.query('SELECT id FROM notifications WHERE delivery_key = $1 LIMIT 1', [deliveryKey]);
        if (existing.rows && existing.rows[0]) {
          notificationId = String(existing.rows[0].id);
          inApp = true;
        }
      }
    } catch (rowError) {
      logger.warn('credit_notice.in_app_failed', { key, error: rowError.message });
    }
    if (!user.email) return { sent: false, error: 'no_email', inApp, notificationId };
    const { sendEmail } = require('../../utils/email');
    const result = await sendEmail({ to: user.email, subject: notice.subject, text: notice.text, html: notice.html, idempotencyKey });
    const sent = Boolean(result && result.success);
    if (notificationId) {
      try {
        await db.query(
          `UPDATE notifications SET data = data || $2::jsonb, is_email_sent = $3 WHERE id = $1`,
          [notificationId, JSON.stringify({ email_sent: sent, email_error: sent ? null : (result?.error || 'send_failed') }), sent]
        );
      } catch (rowError) {
        logger.warn('credit_notice.in_app_update_failed', { key, error: rowError.message });
      }
    }
    return { sent, lang, providerId: result?.id || null, error: sent ? null : (result?.error || 'send_failed'), inApp, notificationId };
  } catch (error) {
    logger.warn('credit_notice.send_failed', { key, error: error.message });
    return { sent: false, error: error.message };
  }
}

module.exports = { LANGS, OUTCOMES, NOTICES: T, normalizeLang, renderNotice, sendUserNotice };
