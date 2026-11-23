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
  business_permission_requested: {
    title: t('A team member asked for access', 'Un miembro del equipo pidió acceso', 'Un membre de l’équipe demande un accès', 'Yon manm ekip mande aksè', 'طلب عضو في الفريق صلاحية وصول'),
    body: t('Review the request in the owner console.', 'Revisa la solicitud en la consola del dueño.', 'Examinez la demande dans la console du propriétaire.', 'Revize demann lan nan konsòl pwopriyetè a.', 'راجع الطلب في لوحة المالك.'),
  },
  business_permission_decided: {
    title: t('Your access request was answered', 'Respondieron tu solicitud de acceso', 'Votre demande d’accès a reçu une réponse', 'Yo reponn demann aksè ou', 'تم الرد على طلب الوصول الخاص بك'),
    body: t('Open My work to see the decision.', 'Abre Mi trabajo para ver la decisión.', 'Ouvrez Mon travail pour voir la décision.', 'Louvri Travay mwen pou wè desizyon an.', 'افتح عملي لرؤية القرار.'),
  },
  business_work_released: {
    title: t('A visit needs a new assignee', 'Una visita necesita otra persona asignada', 'Une visite doit être réattribuée', 'Yon vizit bezwen yon lòt moun', 'زيارة تحتاج إلى شخص آخر'),
    body: t('A team member released a visit. Assign it in the owner console.', 'Un miembro del equipo liberó una visita. Asígnala en la consola del dueño.', 'Un membre de l’équipe a libéré une visite. Attribuez-la dans la console du propriétaire.', 'Yon manm ekip lage yon vizit. Asiyen l nan konsòl pwopriyetè a.', 'أعاد أحد أعضاء الفريق زيارة. عيّنها من لوحة المالك.'),
  },
  business_dispatch_declined: {
    title: t('An assignment was declined', 'Rechazaron una asignación', 'Une affectation a été refusée', 'Yo refize yon asiyasyon', 'تم رفض تكليف'),
    body: t('The visit is unassigned again. Pick someone in the owner console.', 'La visita quedó sin asignar. Elige a alguien en la consola del dueño.', 'La visite n’est plus attribuée. Choisissez quelqu’un dans la console du propriétaire.', 'Vizit la san moun ankò. Chwazi yon moun nan konsòl pwopriyetè a.', 'أصبحت الزيارة دون تعيين. اختر شخصًا من لوحة المالك.'),
  },
  business_work_exception_raised: {
    title: t('A team member needs help', 'Un miembro del equipo necesita ayuda', 'Un membre de l’équipe a besoin d’aide', 'Yon manm ekip bezwen èd', 'عضو في الفريق يحتاج إلى مساعدة'),
    body: t('An issue was raised on a job. Review it in the owner console.', 'Se reportó un problema en un trabajo. Revísalo en la consola del dueño.', 'Un problème a été signalé sur une intervention. Examinez-le dans la console du propriétaire.', 'Yo siyale yon pwoblèm sou yon travay. Revize l nan konsòl pwopriyetè a.', 'تم الإبلاغ عن مشكلة في عمل. راجعها في لوحة المالك.'),
  },
  business_work_exception_updated: {
    title: t('Your issue was updated', 'Tu reporte fue actualizado', 'Votre signalement a été mis à jour', 'Yo mete siyalman ou ajou', 'تم تحديث بلاغك'),
    body: t('Open My work to see the status.', 'Abre Mi trabajo para ver el estado.', 'Ouvrez Mon travail pour voir le statut.', 'Louvri Travay mwen pou wè estati a.', 'افتح عملي لرؤية الحالة.'),
  },
  business_crew_allocated: {
    title: t('You were added to a job crew', 'Te agregaron al equipo de un trabajo', 'Vous avez été ajouté à l’équipe d’une intervention', 'Yo ajoute w nan ekip yon travay', 'تمت إضافتك إلى فريق عمل'),
    body: t('Confirm whether you can attend in My work.', 'Confirma en Mi trabajo si puedes asistir.', 'Confirmez votre présence dans Mon travail.', 'Konfime nan Travay mwen si ou ka vini.', 'أكّد في عملي ما إذا كان بإمكانك الحضور.'),
  },
  business_crew_declined: {
    title: t('A crew member can’t make it', 'Un miembro del equipo no puede asistir', 'Un membre de l’équipe ne peut pas venir', 'Yon manm ekip pa ka vini', 'أحد أعضاء الفريق لا يستطيع الحضور'),
    body: t('Check the job’s crew in My work.', 'Revisa el equipo del trabajo en Mi trabajo.', 'Vérifiez l’équipe de l’intervention dans Mon travail.', 'Tcheke ekip travay la nan Travay mwen.', 'راجع فريق العمل في عملي.'),
  },
  business_team_mention: {
    title: t('A teammate mentioned you', 'Un compañero te mencionó', 'Un collègue vous a mentionné', 'Yon kolèg mansyone w', 'أشار إليك أحد زملائك'),
    body: t('You were mentioned in a job note. Open My work to read it.', 'Te mencionaron en una nota de trabajo. Abre Mi trabajo para leerla.', 'Vous avez été mentionné dans une note d’intervention. Ouvrez Mon travail pour la lire.', 'Yo mansyone w nan yon nòt travay. Louvri Travay mwen pou li l.', 'تمت الإشارة إليك في ملاحظة عمل. افتح عملي لقراءتها.'),
  },
  business_coverage_claimed: {
    title: t('A shift cover needs approval', 'Una cobertura de turno necesita aprobación', 'Un remplacement de quart attend une approbation', 'Yon ranplasman ekip bezwen apwobasyon', 'تغطية وردية تحتاج إلى موافقة'),
    body: t('A teammate offered to cover a shift. Approve or decline it.', 'Un compañero se ofreció a cubrir un turno. Apruébalo o recházalo.', 'Un collègue propose de remplacer un quart. Approuvez ou refusez.', 'Yon kolèg ofri ranplase yon ekip. Apwouve oswa refize.', 'عرض أحد الزملاء تغطية وردية. وافق أو ارفض.'),
  },
  business_coverage_decided: {
    title: t('A shift cover was decided', 'Se decidió una cobertura de turno', 'Un remplacement de quart a été décidé', 'Yo pran desizyon sou yon ranplasman ekip', 'تم البت في تغطية وردية'),
    body: t('Open My work to see whether it was approved and your schedule.', 'Abre Mi trabajo para ver si se aprobó y tu horario.', 'Ouvrez Mon travail pour voir s’il a été approuvé et votre planning.', 'Louvri Travay mwen pou wè si yo apwouve l ak orè ou.', 'افتح عملي لمعرفة ما إذا تمت الموافقة عليها ولرؤية جدولك.'),
  },
};

module.exports = { businessTeamNotifications, BUSINESS_TEAM_NOTIFICATION_TYPES: Object.keys(businessTeamNotifications) };
