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
  business_ownership_transfer_requested: {
    title: t('You were asked to take over a business', 'Te pidieron hacerte cargo de un negocio', 'On vous propose de reprendre une entreprise', 'Yo mande w pran responsablite yon biznis', 'طُلب منك تولي ملكية نشاط تجاري'),
    body: t('Review the ownership transfer in the owner console. It expires in 7 days.', 'Revisa la transferencia de propiedad en la consola del dueño. Vence en 7 días.', 'Examinez le transfert de propriété dans la console du propriétaire. Il expire dans 7 jours.', 'Revize transfè pwopriyete a nan konsòl pwopriyetè a. Li ekspire nan 7 jou.', 'راجع نقل الملكية في لوحة المالك. تنتهي صلاحيته خلال 7 أيام.'),
  },
  business_ownership_transfer_completed: {
    title: t('Business ownership changed', 'Cambió la propiedad del negocio', 'La propriété de l’entreprise a changé', 'Pwopriyete biznis la chanje', 'تغيرت ملكية النشاط التجاري'),
    body: t('The ownership transfer is complete. The previous owner is now a manager.', 'La transferencia de propiedad se completó. El dueño anterior ahora es gerente.', 'Le transfert de propriété est terminé. L’ancien propriétaire est désormais responsable.', 'Transfè pwopriyete a fini. Ansyen pwopriyetè a se yon manadjè kounye a.', 'اكتمل نقل الملكية. أصبح المالك السابق مديرًا الآن.'),
  },
  business_ownership_transfer_declined: {
    title: t('The ownership transfer did not go ahead', 'La transferencia de propiedad no se realizó', 'Le transfert de propriété n’a pas eu lieu', 'Transfè pwopriyete a pa fèt', 'لم يتم نقل الملكية'),
    body: t('Open the owner console for details.', 'Abre la consola del dueño para ver los detalles.', 'Ouvrez la console du propriétaire pour en savoir plus.', 'Louvri konsòl pwopriyetè a pou detay yo.', 'افتح لوحة المالك لمعرفة التفاصيل.'),
  },
  business_deputy_designated: {
    title: t('You are the owner’s deputy', 'Eres el suplente del dueño', 'Vous êtes l’adjoint du propriétaire', 'Ou se depite pwopriyetè a', 'أنت نائب المالك'),
    body: t('You can manage day-to-day operations until the end date the owner set.', 'Puedes gestionar las operaciones diarias hasta la fecha que fijó el dueño.', 'Vous pouvez gérer les opérations courantes jusqu’à la date fixée par le propriétaire.', 'Ou ka jere operasyon chak jou jiska dat pwopriyetè a fikse a.', 'يمكنك إدارة العمليات اليومية حتى تاريخ الانتهاء الذي حدده المالك.'),
  },
  business_work_transferred: {
    title: t('Work was moved to you', 'Se te asignó trabajo', 'Du travail vous a été confié', 'Yo transfere travay ba ou', 'نُقل إليك عمل'),
    body: t('{count} open items are now yours. Check My work.', 'Ahora tienes {count} pendientes. Revisa Mi trabajo.', '{count} éléments ouverts vous sont désormais attribués. Consultez Mon travail.', '{count} travay ouvè se pou ou kounye a. Gade Travay mwen.', 'أصبح لديك {count} من العناصر المفتوحة. راجع عملي.'),
  },
};

module.exports = { businessTeamNotifications, BUSINESS_TEAM_NOTIFICATION_TYPES: Object.keys(businessTeamNotifications) };
