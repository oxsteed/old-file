// Careers notification templates in the five app languages (careers spec
// §11, §13). Placeholders use the {name} convention and are interpolated by
// tNotif(type, lang, params). {reason} and {status} receive localized words
// from careerReasonText()/careerCheckStatusText() below, never raw codes.

'use strict';

const L = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

const reasonText = {
  requirements_not_met: L('the role needs a requirement you have not shown yet', 'el puesto requiere algo que aún no has demostrado', 'le poste demande une exigence que vous n\'avez pas encore montrée', 'pòs la mande yon kondisyon ou poko montre', 'تتطلب الوظيفة شرطًا لم تُظهره بعد'),
  schedule_mismatch: L('the schedule did not match', 'el horario no coincidió', 'l\'horaire ne correspondait pas', 'orè a pa t koresponn', 'لم يتوافق الجدول الزمني'),
  position_filled: L('the position has been filled', 'el puesto ya fue cubierto', 'le poste a été pourvu', 'pòs la gen moun deja', 'تم شغل الوظيفة'),
  location_mismatch: L('the location did not match', 'la ubicación no coincidió', 'le lieu ne correspondait pas', 'kote a pa t koresponn', 'لم يتوافق الموقع'),
  withdrew_interest: L('you withdrew your interest', 'retiraste tu interés', 'vous avez retiré votre intérêt', 'ou te retire enterè ou', 'لقد سحبت اهتمامك'),
  no_response: L('we did not hear back from you', 'no recibimos respuesta tuya', 'nous n\'avons pas eu de réponse de votre part', 'nou pa t resevwa repons ou', 'لم نتلقَّ ردًا منك'),
  other_business_reason: L('of a business decision', 'una decisión del negocio', 'd\'une décision de l\'entreprise', 'yon desizyon biznis la', 'قرار يخص النشاط التجاري'),
};

const checkStatusText = {
  invited: L('invited', 'invitado', 'invité', 'envite', 'تمت الدعوة'),
  consented: L('consent given', 'consentimiento dado', 'consentement donné', 'konsantman bay', 'تمت الموافقة'),
  pending: L('in progress', 'en curso', 'en cours', 'ap fèt', 'قيد التنفيذ'),
  clear: L('complete', 'completo', 'terminé', 'fini', 'مكتمل'),
  consider: L('needs review', 'requiere revisión', 'à examiner', 'bezwen revize', 'يحتاج إلى مراجعة'),
  pre_adverse_sent: L('pre-adverse notice sent', 'aviso previo enviado', 'préavis envoyé', 'avi davans voye', 'أُرسل إشعار ما قبل الإجراء'),
  disputed: L('disputed', 'en disputa', 'contesté', 'konteste', 'متنازع عليه'),
  adverse_sent: L('final notice sent', 'aviso final enviado', 'avis final envoyé', 'dènye avi voye', 'أُرسل الإشعار النهائي'),
  cancelled: L('cancelled', 'cancelado', 'annulé', 'anile', 'أُلغي'),
};

function pick(map, code, lang) {
  const entry = map[code];
  if (!entry) return String(code || '');
  return entry[lang] || entry.en;
}
const careerReasonText = (code, lang = 'en') => pick(reasonText, code, lang);
const careerCheckStatusText = (code, lang = 'en') => pick(checkStatusText, code, lang);

const careerNotifications = {
  career_application_received: {
    title: L('Application sent to {employerName}', 'Solicitud enviada a {employerName}', 'Candidature envoyée à {employerName}', 'Aplikasyon voye bay {employerName}', 'تم إرسال الطلب إلى {employerName}'),
    body: L('We received your application for {openingTitle}. You can follow it in My applications.', 'Recibimos tu solicitud para {openingTitle}. Puedes seguirla en Mis solicitudes.', 'Nous avons reçu votre candidature pour {openingTitle}. Suivez-la dans Mes candidatures.', 'Nou resevwa aplikasyon ou pou {openingTitle}. Ou ka swiv li nan Aplikasyon mwen yo.', 'استلمنا طلبك لوظيفة {openingTitle}. يمكنك متابعته في طلباتي.'),
  },
  career_new_applicant: {
    title: L('New applicant for {openingTitle}', 'Nuevo candidato para {openingTitle}', 'Nouveau candidat pour {openingTitle}', 'Nouvo kandida pou {openingTitle}', 'متقدم جديد لوظيفة {openingTitle}'),
    body: L('Applicant #{applicantNumber} applied. Review them on the hiring board.', 'El candidato n.º {applicantNumber} se postuló. Revísalo en el tablero de contratación.', 'Le candidat n° {applicantNumber} a postulé. Consultez-le sur le tableau de recrutement.', 'Kandida #{applicantNumber} aplike. Gade li sou tablo anbochaj la.', 'تقدم المتقدم رقم {applicantNumber}. راجعه في لوحة التوظيف.'),
  },
  career_stage_changed: {
    title: L('Update on {openingTitle}', 'Novedades sobre {openingTitle}', 'Mise à jour pour {openingTitle}', 'Nouvèl sou {openingTitle}', 'تحديث بشأن {openingTitle}'),
    body: L('{employerName} moved your application to the next step.', '{employerName} pasó tu solicitud al siguiente paso.', '{employerName} a fait passer votre candidature à l\'étape suivante.', '{employerName} fè aplikasyon ou pase nan pwochen etap la.', 'نقل {employerName} طلبك إلى الخطوة التالية.'),
  },
  career_application_rejected: {
    title: L('Update on {openingTitle}', 'Novedades sobre {openingTitle}', 'Mise à jour pour {openingTitle}', 'Nouvèl sou {openingTitle}', 'تحديث بشأن {openingTitle}'),
    body: L('{employerName} is not moving forward because {reason}. Your profile is still yours to use for other roles.', '{employerName} no continuará porque {reason}. Tu perfil sigue disponible para otros puestos.', '{employerName} ne poursuit pas car {reason}. Votre profil reste disponible pour d\'autres postes.', '{employerName} pap kontinye paske {reason}. Pwofil ou toujou la pou lòt pòs.', 'لن يواصل {employerName} لأن {reason}. لا يزال ملفك متاحًا لوظائف أخرى.'),
  },
  career_application_closed: {
    title: L('{openingTitle} has closed', '{openingTitle} se cerró', '{openingTitle} est clôturé', '{openingTitle} fèmen', 'تم إغلاق {openingTitle}'),
    body: L('{employerName} closed this opening without filling it. Thank you for applying.', '{employerName} cerró esta vacante sin cubrirla. Gracias por postularte.', '{employerName} a clôturé cette offre sans la pourvoir. Merci d\'avoir postulé.', '{employerName} fèmen pòs sa a san li pa jwenn moun. Mèsi paske ou te aplike.', 'أغلق {employerName} هذه الوظيفة دون شغلها. شكرًا على تقديمك.'),
  },
  career_application_withdrawn: {
    title: L('An applicant withdrew from {openingTitle}', 'Un candidato se retiró de {openingTitle}', 'Un candidat s\'est retiré de {openingTitle}', 'Yon kandida retire tèt li nan {openingTitle}', 'انسحب متقدم من {openingTitle}'),
    body: L('Applicant #{applicantNumber} withdrew. Any pending offer was withdrawn too.', 'El candidato n.º {applicantNumber} se retiró. También se retiró cualquier oferta pendiente.', 'Le candidat n° {applicantNumber} s\'est retiré. Toute offre en attente a aussi été retirée.', 'Kandida #{applicantNumber} retire. Nenpòt òf ki t ap tann retire tou.', 'انسحب المتقدم رقم {applicantNumber}. وسُحب أي عرض معلق أيضًا.'),
  },
  career_interview_scheduled: {
    title: L('Interview for {openingTitle}', 'Entrevista para {openingTitle}', 'Entretien pour {openingTitle}', 'Entèvyou pou {openingTitle}', 'مقابلة لوظيفة {openingTitle}'),
    body: L('{employerName} scheduled an interview on {when} ({timezone}). A calendar file is attached to the email.', '{employerName} programó una entrevista el {when} ({timezone}). El correo incluye un archivo de calendario.', '{employerName} a planifié un entretien le {when} ({timezone}). Un fichier d\'agenda est joint à l\'e-mail.', '{employerName} pwograme yon entèvyou {when} ({timezone}). Imèl la gen yon fichye kalandriye.', 'حدد {employerName} مقابلة في {when} ({timezone}). أُرفق ملف تقويم بالبريد الإلكتروني.'),
  },
  career_interview_cancelled: {
    title: L('Interview cancelled', 'Entrevista cancelada', 'Entretien annulé', 'Entèvyou anile', 'أُلغيت المقابلة'),
    body: L('{employerName} cancelled the interview for {openingTitle}.', '{employerName} canceló la entrevista para {openingTitle}.', '{employerName} a annulé l\'entretien pour {openingTitle}.', '{employerName} anile entèvyou pou {openingTitle}.', 'ألغى {employerName} مقابلة {openingTitle}.'),
  },
  career_offer_received: {
    title: L('You have an offer from {employerName}', 'Tienes una oferta de {employerName}', 'Vous avez une offre de {employerName}', 'Ou gen yon òf nan men {employerName}', 'لديك عرض من {employerName}'),
    body: L('Review the offer for {openingTitle} before it expires on {expires}.', 'Revisa la oferta para {openingTitle} antes de que venza el {expires}.', 'Consultez l\'offre pour {openingTitle} avant son expiration le {expires}.', 'Gade òf pou {openingTitle} anvan li ekspire {expires}.', 'راجع عرض {openingTitle} قبل انتهائه في {expires}.'),
  },
  career_offer_expiring: {
    title: L('Your offer expires soon', 'Tu oferta vence pronto', 'Votre offre expire bientôt', 'Òf ou a pral ekspire byento', 'ينتهي عرضك قريبًا'),
    body: L('The offer from {employerName} for {openingTitle} expires on {expires}.', 'La oferta de {employerName} para {openingTitle} vence el {expires}.', 'L\'offre de {employerName} pour {openingTitle} expire le {expires}.', 'Òf {employerName} pou {openingTitle} ekspire {expires}.', 'ينتهي عرض {employerName} لوظيفة {openingTitle} في {expires}.'),
  },
  career_offer_expired: {
    title: L('An offer expired', 'Una oferta venció', 'Une offre a expiré', 'Yon òf ekspire', 'انتهت صلاحية عرض'),
    body: L('The offer for {openingTitle} expired without an answer.', 'La oferta para {openingTitle} venció sin respuesta.', 'L\'offre pour {openingTitle} a expiré sans réponse.', 'Òf pou {openingTitle} ekspire san repons.', 'انتهى عرض {openingTitle} دون رد.'),
  },
  career_offer_withdrawn: {
    title: L('Offer withdrawn', 'Oferta retirada', 'Offre retirée', 'Òf retire', 'تم سحب العرض'),
    body: L('{employerName} withdrew the offer for {openingTitle}.', '{employerName} retiró la oferta para {openingTitle}.', '{employerName} a retiré l\'offre pour {openingTitle}.', '{employerName} retire òf pou {openingTitle}.', 'سحب {employerName} عرض {openingTitle}.'),
  },
  career_offer_accepted: {
    title: L('Offer accepted for {openingTitle}', 'Oferta aceptada para {openingTitle}', 'Offre acceptée pour {openingTitle}', 'Òf aksepte pou {openingTitle}', 'تم قبول العرض لوظيفة {openingTitle}'),
    body: L('{candidateName} accepted. Onboarding has started.', '{candidateName} aceptó. La incorporación comenzó.', '{candidateName} a accepté. L\'intégration a commencé.', '{candidateName} aksepte. Entegrasyon an kòmanse.', 'قبل {candidateName}. بدأت إجراءات الانضمام.'),
  },
  career_offer_declined: {
    title: L('Offer declined for {openingTitle}', 'Oferta rechazada para {openingTitle}', 'Offre refusée pour {openingTitle}', 'Òf refize pou {openingTitle}', 'تم رفض العرض لوظيفة {openingTitle}'),
    body: L('Applicant #{applicantNumber} declined the offer.', 'El candidato n.º {applicantNumber} rechazó la oferta.', 'Le candidat n° {applicantNumber} a refusé l\'offre.', 'Kandida #{applicantNumber} refize òf la.', 'رفض المتقدم رقم {applicantNumber} العرض.'),
  },
  career_offer_needs_approval: {
    title: L('Offer above the posted range', 'Oferta por encima del rango publicado', 'Offre au-dessus de la fourchette publiée', 'Òf ki pi wo pase ranje ki pibliye a', 'عرض أعلى من النطاق المنشور'),
    body: L('An offer for {openingTitle} is above the posted pay range and needs your approval.', 'Una oferta para {openingTitle} supera el rango salarial publicado y necesita tu aprobación.', 'Une offre pour {openingTitle} dépasse la fourchette publiée et doit être approuvée.', 'Yon òf pou {openingTitle} pi wo pase ranje salè a epi li bezwen apwobasyon ou.', 'عرض {openingTitle} أعلى من نطاق الأجر المنشور ويحتاج إلى موافقتك.'),
  },
  career_invitation_received: {
    title: L('{employerName} invited you to apply', '{employerName} te invitó a postularte', '{employerName} vous invite à postuler', '{employerName} envite ou aplike', 'دعاك {employerName} للتقديم'),
    body: L('They think you are a good fit for {openingTitle}. Applying is your choice.', 'Creen que encajas en {openingTitle}. Postularte es tu decisión.', 'Ils pensent que vous convenez pour {openingTitle}. Postuler reste votre choix.', 'Yo panse ou bon pou {openingTitle}. Se ou ki deside si w ap aplike.', 'يرون أنك مناسب لوظيفة {openingTitle}. التقديم قرارك.'),
  },
  career_background_check_invited: {
    title: L('Background check for {openingTitle}', 'Verificación de antecedentes para {openingTitle}', 'Vérification des antécédents pour {openingTitle}', 'Verifikasyon dosye pou {openingTitle}', 'فحص الخلفية لوظيفة {openingTitle}'),
    body: L('Your offer is conditional on a background check. Read the disclosure and give consent if you agree.', 'Tu oferta depende de una verificación de antecedentes. Lee el aviso y da tu consentimiento si estás de acuerdo.', 'Votre offre dépend d\'une vérification des antécédents. Lisez l\'avis et consentez si vous êtes d\'accord.', 'Òf ou a depann de yon verifikasyon dosye. Li avi a epi bay konsantman si ou dakò.', 'عرضك مشروط بفحص الخلفية. اقرأ الإفصاح ووافق إن كنت موافقًا.'),
  },
  career_background_check_update: {
    title: L('Background check: {status}', 'Verificación de antecedentes: {status}', 'Vérification des antécédents : {status}', 'Verifikasyon dosye: {status}', 'فحص الخلفية: {status}'),
    body: L('The check for applicant #{applicantNumber} ({openingTitle}) is now {status}.', 'La verificación del candidato n.º {applicantNumber} ({openingTitle}) ahora está: {status}.', 'La vérification du candidat n° {applicantNumber} ({openingTitle}) est maintenant : {status}.', 'Verifikasyon kandida #{applicantNumber} ({openingTitle}) kounye a: {status}.', 'أصبحت حالة فحص المتقدم رقم {applicantNumber} ({openingTitle}): {status}.'),
  },
  career_pre_adverse_notice: {
    title: L('Notice about your background check', 'Aviso sobre tu verificación de antecedentes', 'Avis concernant votre vérification des antécédents', 'Avi sou verifikasyon dosye ou', 'إشعار بشأن فحص خلفيتك'),
    body: L('{employerName} may withdraw the offer for {openingTitle} based on your report. You have at least 5 business days to review it and respond.', '{employerName} podría retirar la oferta para {openingTitle} según tu informe. Tienes al menos 5 días hábiles para revisarlo y responder.', '{employerName} pourrait retirer l\'offre pour {openingTitle} sur la base de votre rapport. Vous avez au moins 5 jours ouvrés pour le consulter et répondre.', '{employerName} ka retire òf pou {openingTitle} akoz rapò ou. Ou gen omwen 5 jou travay pou gade l epi reponn.', 'قد يسحب {employerName} عرض {openingTitle} بناءً على تقريرك. لديك 5 أيام عمل على الأقل لمراجعته والرد.'),
  },
  career_onboarding_needs_action: {
    title: L('Onboarding needs your attention', 'La incorporación necesita tu atención', 'L\'intégration demande votre attention', 'Entegrasyon an bezwen atansyon ou', 'تحتاج إجراءات الانضمام إلى انتباهك'),
    body: L('A step for the new hire on {openingTitle} could not finish on its own.', 'Un paso de la nueva contratación para {openingTitle} no pudo completarse solo.', 'Une étape pour la nouvelle recrue de {openingTitle} n\'a pas pu se terminer seule.', 'Yon etap pou nouvo anplwaye {openingTitle} pa t ka fini pou kont li.', 'تعذر إكمال خطوة للموظف الجديد في {openingTitle} تلقائيًا.'),
  },
  career_fact_dispute_resolved: {
    title: L('Your fact dispute was reviewed', 'Revisamos tu disputa', 'Votre contestation a été examinée', 'Nou revize kontestasyon ou', 'تمت مراجعة اعتراضك'),
    body: L('Open your career profile to see the result.', 'Abre tu perfil profesional para ver el resultado.', 'Ouvrez votre profil carrière pour voir le résultat.', 'Louvri pwofil karyè ou pou wè rezilta a.', 'افتح ملفك المهني لرؤية النتيجة.'),
  },
  career_ranking_disabled: {
    title: L('AI ranking turned off in {scope}', 'Clasificación con IA desactivada en {scope}', 'Classement IA désactivé dans {scope}', 'Klasman IA etenn nan {scope}', 'أُوقف الترتيب بالذكاء الاصطناعي في {scope}'),
    body: L('The impact ratio fell to {ratio}, below the 0.8 limit. A person must review before it can be turned back on.', 'La proporción de impacto bajó a {ratio}, por debajo del límite de 0.8. Una persona debe revisarlo antes de reactivarla.', 'Le ratio d\'impact est tombé à {ratio}, sous la limite de 0,8. Une personne doit l\'examiner avant de le réactiver.', 'Rapò enpak la desann a {ratio}, anba limit 0.8 la. Yon moun dwe revize l anvan yo limen l ankò.', 'انخفضت نسبة التأثير إلى {ratio} وهي أقل من حد 0.8. يجب أن يراجعها شخص قبل إعادة التشغيل.'),
  },
};

module.exports = { careerNotifications, careerReasonText, careerCheckStatusText, reasonText, checkStatusText };
