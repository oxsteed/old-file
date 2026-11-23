'use strict';
// Groups 5-6 (items 201-300): business owner and team member notification
// copy in the five supported languages. Spread into utils/i18n.js.
const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

const businessTeamNotifications = {
  business_listing_claim_approved: {
    title: t('Your listing claim was approved', 'Tu reclamo del perfil fue aprobado', 'Votre revendication de fiche a été approuvée', 'Demann fich ou a apwouve', 'تمت الموافقة على مطالبتك بالقائمة'),
    body: t('The directory listing is now linked to your business.', 'El perfil del directorio ya está vinculado a tu negocio.', 'La fiche de l’annuaire est maintenant liée à votre entreprise.', 'Fich anyè a konekte ak biznis ou kounye a.', 'أصبحت قائمة الدليل مرتبطة بنشاطك التجاري الآن.'),
  },
  business_listing_claim_rejected: {
    title: t('Your listing claim was not approved', 'Tu reclamo del perfil no fue aprobado', 'Votre revendication de fiche n’a pas été approuvée', 'Demann fich ou a pa apwouve', 'لم تتم الموافقة على مطالبتك بالقائمة'),
    body: t('Open your business to see the reason and next steps.', 'Abre tu negocio para ver el motivo y los próximos pasos.', 'Ouvrez votre entreprise pour voir le motif et la suite.', 'Louvri biznis ou pou wè rezon an ak pwochen etap yo.', 'افتح نشاطك التجاري لمعرفة السبب والخطوات التالية.'),
  },
  business_service_issue_reported: {
    title: t('A customer reported a service issue', 'Un cliente reportó un problema con el servicio', 'Un client a signalé un problème de service', 'Yon kliyan siyale yon pwoblèm sèvis', 'أبلغ عميل عن مشكلة في الخدمة'),
    body: t('Review it in the owner console.', 'Revísalo en la consola del dueño.', 'Examinez-le dans la console du propriétaire.', 'Revize l nan konsòl pwopriyetè a.', 'راجعها في لوحة المالك.'),
  },
  business_service_issue_resolved: {
    title: t('Your service issue was reviewed', 'Tu problema con el servicio fue revisado', 'Votre problème de service a été examiné', 'Yo revize pwoblèm sèvis ou a', 'تمت مراجعة مشكلة الخدمة الخاصة بك'),
    body: t('Open My bookings to see the business’s response.', 'Abre Mis reservas para ver la respuesta del negocio.', 'Ouvrez Mes réservations pour voir la réponse de l’entreprise.', 'Louvri Rezèvasyon mwen pou wè repons biznis la.', 'افتح حجوزاتي لرؤية رد النشاط التجاري.'),
  },
};

module.exports = { businessTeamNotifications, BUSINESS_TEAM_NOTIFICATION_TYPES: Object.keys(businessTeamNotifications) };
