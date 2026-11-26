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
  job_exception_raised: {
    title: t('A problem was reported on your job', 'Se reportó un problema en tu trabajo', 'Un problème a été signalé sur votre intervention', 'Yo siyale yon pwoblèm sou travay ou', 'تم الإبلاغ عن مشكلة في عملك'),
    body: t('Open the job to review it.', 'Abre el trabajo para revisarlo.', 'Ouvrez l’intervention pour l’examiner.', 'Louvri travay la pou revize l.', 'افتح العمل لمراجعته.'),
  },
  job_exception_updated: {
    title: t('Your job report was updated', 'Tu reporte del trabajo fue actualizado', 'Votre signalement a été mis à jour', 'Yo mete rapò travay ou ajou', 'تم تحديث بلاغ العمل الخاص بك'),
    body: t('Open the job to see the status.', 'Abre el trabajo para ver el estado.', 'Ouvrez l’intervention pour voir le statut.', 'Louvri travay la pou wè estati a.', 'افتح العمل لرؤية الحالة.'),
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
  business_job_follow_up: {
    title: t('A job needs a follow-up', 'Un trabajo necesita seguimiento', 'Une intervention nécessite un suivi', 'Yon travay bezwen yon swivi', 'عمل يحتاج إلى متابعة'),
    body: t('The completion record asks for a follow-up visit or call.', 'El registro de finalización pide una visita o llamada de seguimiento.', 'Le compte rendu demande une visite ou un appel de suivi.', 'Rapò fen travay la mande yon vizit oswa yon apèl swivi.', 'يطلب سجل الإنجاز زيارة أو مكالمة متابعة.'),
  },
  business_feedback_follow_up: {
    title: t('Low customer rating to follow up', 'Calificación baja de un cliente para dar seguimiento', 'Note client basse à suivre', 'Yon kliyan bay yon nòt ki ba, fè swivi', 'تقييم منخفض من عميل يحتاج إلى متابعة'),
    body: t('A customer rated a visit 3 stars or less. Reach out from the owner console.', 'Un cliente calificó una visita con 3 estrellas o menos. Contáctalo desde la consola del dueño.', 'Un client a noté une intervention 3 étoiles ou moins. Contactez-le depuis la console du propriétaire.', 'Yon kliyan bay yon vizit 3 zetwal oswa mwens. Kontakte l nan konsòl pwopriyetè a.', 'قيّم عميل زيارة بثلاث نجوم أو أقل. تواصل معه من لوحة المالك.'),
  },
  // D-475 (285, G5-22): the same low rating, routed to the member who did
  // the visit — the manager copy above tells the reader to use the owner
  // console, which is not the member's surface.
  business_feedback_for_you: {
    title: t('A customer rated your visit 3 stars or less', 'Un cliente calificó tu visita con 3 estrellas o menos', 'Un client a noté votre intervention 3 étoiles ou moins', 'Yon kliyan bay vizit ou a 3 zetwal oswa mwens', 'قيّم عميل زيارتك بثلاث نجوم أو أقل'),
    body: t('See the feedback in My work — the visit may need a follow-up.', 'Consulta los comentarios en Mi trabajo; es posible que la visita necesite seguimiento.', 'Consultez les avis dans Mon travail — la visite peut nécessiter un suivi.', 'Gade fidbak la nan Travay mwen — vizit la ka bezwen yon swivi.', 'اطّلع على الملاحظات في عملي — قد تحتاج الزيارة إلى متابعة.'),
  },
  business_shift_handover: {
    title: t('You have a shift handover', 'Tienes una entrega de turno', 'Vous avez une passation de quart', 'Ou gen yon remiz ekip', 'لديك تسليم وردية'),
    body: t('Read the notes and acknowledge them in My work.', 'Lee las notas y confírmalas en Mi trabajo.', 'Lisez les notes et confirmez-les dans Mon travail.', 'Li nòt yo epi konfime yo nan Travay mwen.', 'اقرأ الملاحظات وأكّد استلامها في عملي.'),
  },
  business_task_assigned_to_you: {
    title: t('Tasks were handed to you', 'Te entregaron tareas', 'Des tâches vous ont été confiées', 'Yo ba w kèk travay', 'تم تسليم مهام إليك'),
    body: t('Open My work to see what moved to you.', 'Abre Mi trabajo para ver lo que pasó a ti.', 'Ouvrez Mon travail pour voir ce qui vous a été confié.', 'Louvri Travay mwen pou wè sa yo ba ou.', 'افتح عملي لرؤية ما انتقل إليك.'),
  },
  business_delegation_proposed: {
    title: t('A teammate asked you to cover', 'Un compañero te pidió que lo cubras', 'Un collègue vous demande de le remplacer', 'Yon kolèg mande w ranplase l', 'طلب منك أحد الزملاء أن تنوب عنه'),
    body: t('Accept or decline the absence cover in My work.', 'Acepta o rechaza la cobertura de ausencia en Mi trabajo.', 'Acceptez ou refusez le remplacement dans Mon travail.', 'Aksepte oswa refize ranplasman an nan Travay mwen.', 'اقبل أو ارفض النيابة في عملي.'),
  },
  business_delegation_answered: {
    title: t('Your absence cover was answered', 'Respondieron a tu cobertura de ausencia', 'Votre demande de remplacement a reçu une réponse', 'Yo reponn demann ranplasman ou', 'تم الرد على طلب النيابة'),
    body: t('Open My work to see the answer.', 'Abre Mi trabajo para ver la respuesta.', 'Ouvrez Mon travail pour voir la réponse.', 'Louvri Travay mwen pou wè repons lan.', 'افتح عملي لرؤية الرد.'),
  },
  business_delegation_visits: {
    title: t('Visits need a new assignee', 'Hay visitas que necesitan otro responsable', 'Des interventions doivent être réattribuées', 'Kèk vizit bezwen yon lòt moun', 'زيارات تحتاج إلى مسؤول جديد'),
    body: t('{count} visit(s) fall in a team member’s absence. Reassign them.', '{count} visita(s) caen durante la ausencia de un miembro. Reasígnalas.', '{count} intervention(s) tombent pendant l’absence d’un membre. Réattribuez-les.', '{count} vizit tonbe pandan yon manm absan. Bay yon lòt moun yo.', '{count} زيارة تقع خلال غياب أحد الأعضاء. أعد إسنادها.'),
  },
  business_member_left: {
    title: t('A team member left', 'Un miembro del equipo se fue', 'Un membre de l’équipe est parti', 'Yon manm ekip la kite', 'غادر أحد أعضاء الفريق'),
    body: t('Their open work moved to a manager. Review the team page.', 'Su trabajo pendiente pasó a un gerente. Revisa la página del equipo.', 'Son travail en cours a été confié à un responsable. Consultez la page de l’équipe.', 'Travay li te genyen an ale bay yon manadjè. Gade paj ekip la.', 'انتقل عمله المفتوح إلى مدير. راجع صفحة الفريق.'),
  },
  property_assigned: {
    title: t('New property assignment', 'Nueva asignación de propiedad', 'Nouvelle affectation de propriété', 'Nouvo asiyasyon pwopriyete', 'تعيين عقار جديد'),
    body: t('You were assigned to {property}.', 'Se te asignó a {property}.', 'Vous avez été affecté à {property}.', 'Yo asiyen w nan {property}.', 'تم تعيينك في {property}.'),
  },
  property_manager_changed: {
    title: t('Property handed over', 'Propiedad transferida', 'Propriété transférée', 'Pwopriyete transfere', 'تم تسليم العقار'),
    body: t('{property} now has a new manager.', '{property} ahora tiene un nuevo administrador.', '{property} a maintenant un nouveau gestionnaire.', '{property} gen yon nouvo manadjè kounye a.', 'لدى {property} مدير جديد الآن.'),
  },
  property_contact_updated: {
    title: t('Your property contact changed', 'Cambió tu contacto de la propiedad', 'Votre contact pour la propriété a changé', 'Kontak pwopriyete ou chanje', 'تغيّر جهة الاتصال الخاصة بعقارك'),
    body: t('Your management contact for {property} changed. Open requests continue as before.', 'Tu contacto de administración para {property} cambió. Las solicitudes abiertas siguen igual.', 'Votre contact de gestion pour {property} a changé. Les demandes ouvertes continuent.', 'Kontak jesyon w pou {property} chanje. Demann ki ouvè yo kontinye.', 'تغيّرت جهة الإدارة لعقار {property}. تستمر الطلبات المفتوحة كما هي.'),
  },
  property_access_revoked: {
    title: t('Property access ended', 'Acceso a la propiedad finalizado', 'Accès à la propriété terminé', 'Aksè pwopriyete fini', 'انتهى الوصول إلى العقار'),
    body: t('Your access to {property} ended. Return any keys you hold.', 'Tu acceso a {property} terminó. Devuelve las llaves que tengas.', 'Votre accès à {property} a pris fin. Rendez les clés que vous détenez.', 'Aksè w nan {property} fini. Remèt kle ou genyen yo.', 'انتهى وصولك إلى {property}. أعد أي مفاتيح لديك.'),
  },
  property_approval_requested: {
    title: t('Repair needs your approval', 'Una reparación necesita tu aprobación', 'Une réparation nécessite votre approbation', 'Yon reparasyon bezwen apwobasyon w', 'إصلاح يحتاج إلى موافقتك'),
    body: t('{title} at {property} is over your approval limit.', '{title} en {property} supera tu límite de aprobación.', '{title} à {property} dépasse votre seuil d’approbation.', '{title} nan {property} depase limit apwobasyon w.', '{title} في {property} يتجاوز حد موافقتك.'),
  },
  property_approval_decided: {
    title: t('Owner decision received', 'Decisión del propietario recibida', 'Décision du propriétaire reçue', 'Desizyon pwopriyetè a rive', 'وصل قرار المالك'),
    body: t('The owner decided on {title} at {property}.', 'El propietario decidió sobre {title} en {property}.', 'Le propriétaire a statué sur {title} à {property}.', 'Pwopriyetè a deside sou {title} nan {property}.', 'قرر المالك بشأن {title} في {property}.'),
  },
  property_entry_scheduled: {
    title: t('Choose a visit time', 'Elige un horario de visita', 'Choisissez une heure de visite', 'Chwazi yon lè pou vizit la', 'اختر موعد الزيارة'),
    body: t('Pick a time for us to enter for {title}.', 'Elige un horario para entrar por {title}.', 'Choisissez quand nous pouvons entrer pour {title}.', 'Chwazi ki lè nou ka antre pou {title}.', 'اختر وقتاً لدخولنا من أجل {title}.'),
  },
  property_entry_window_selected: {
    title: t('Visit time chosen', 'Horario de visita elegido', 'Heure de visite choisie', 'Lè vizit la chwazi', 'تم اختيار موعد الزيارة'),
    body: t('The occupant chose a visit time for {title}.', 'El ocupante eligió un horario para {title}.', 'L’occupant a choisi une heure pour {title}.', 'Lokatè a chwazi yon lè pou {title}.', 'اختار الساكن موعداً لـ {title}.'),
  },
  property_request_status: {
    title: t('Your repair has an update', 'Tu reparación tiene una actualización', 'Votre réparation a été mise à jour', 'Reparasyon ou gen yon mizajou', 'هناك تحديث بشأن الإصلاح الخاص بك'),
    body: t('There is an update on your repair: {title}.', 'Hay una actualización sobre tu reparación: {title}.', 'Une mise à jour concerne votre réparation : {title}.', 'Gen yon mizajou sou reparasyon ou: {title}.', 'هناك تحديث بشأن الإصلاح الخاص بك: {title}.'),
  },
  property_emergency: {
    title: t('Emergency at a property', 'Emergencia en una propiedad', 'Urgence dans une propriété', 'Ijans nan yon pwopriyete', 'حالة طارئة في عقار'),
    body: t('Emergency: {title}. Respond now.', 'Emergencia: {title}. Responde ahora.', 'Urgence : {title}. Intervenez maintenant.', 'Ijans: {title}. Reponn kounye a.', 'طارئ: {title}. استجب الآن.'),
  },
  property_incident_summary: {
    title: t('Incident summary shared', 'Resumen de incidente compartido', 'Résumé d’incident partagé', 'Rezime ensidan pataje', 'تمت مشاركة ملخص الحادث'),
    body: t('Your manager shared a summary of {title} at {property}.', 'Tu administrador compartió un resumen de {title} en {property}.', 'Votre gestionnaire a partagé un résumé de {title} à {property}.', 'Manadjè w pataje yon rezime {title} nan {property}.', 'شارك مديرك ملخصاً لـ {title} في {property}.'),
  },
  property_maintenance_due: {
    title: t('Maintenance overdue', 'Mantenimiento vencido', 'Entretien en retard', 'Antretyen an reta', 'صيانة متأخرة'),
    body: t('{title} is past due.', '{title} está vencido.', '{title} est en retard.', '{title} an reta.', '{title} متأخر عن موعده.'),
  },
  property_sla_breach: {
    title: t('Maintenance deadline missed', 'Se venció el plazo de mantenimiento', 'Délai d’entretien dépassé', 'Dat limit antretyen an pase', 'تم تجاوز الموعد النهائي للصيانة'),
    body: t('{title} missed its maintenance deadline.', '{title} no cumplió su plazo de mantenimiento.', '{title} a dépassé son délai d’entretien.', '{title} rate dat limit antretyen li.', 'تجاوز {title} الموعد النهائي للصيانة.'),
  },
  property_budget_over: {
    title: t('Over budget', 'Presupuesto excedido', 'Budget dépassé', 'Bidjè depase', 'تجاوز الميزانية'),
    body: t('{property} is over its monthly maintenance budget.', '{property} superó su presupuesto mensual de mantenimiento.', '{property} dépasse son budget d’entretien mensuel.', '{property} depase bidjè antretyen chak mwa li.', 'تجاوز {property} ميزانية الصيانة الشهرية.'),
  },
  restaurant_pickup_unclaimed: {
    title: t('Pickup waiting', 'Pedido esperando', 'Commande en attente', 'Kòmand ap tann', 'طلب ينتظر الاستلام'),
    body: t('Order {queue} has not been picked up.', 'El pedido {queue} no se ha recogido.', 'La commande {queue} n’a pas été récupérée.', 'Yo poko vin chèche kòmand {queue}.', 'لم يُستلم الطلب {queue} بعد.'),
  },
  restaurant_order_transfer_requested: {
    title: t('Order transfer request', 'Solicitud de traslado de pedido', 'Demande de transfert de commande', 'Demann transfè kòmand', 'طلب نقل طلبية'),
    body: t('Another store wants to move order {queue} to you.', 'Otra tienda quiere pasarte el pedido {queue}.', 'Un autre magasin veut vous transférer la commande {queue}.', 'Yon lòt magazen vle voye kòmand {queue} ba ou.', 'متجر آخر يريد نقل الطلب {queue} إليك.'),
  },
  restaurant_order_transfer_decided: {
    title: t('Transfer answered', 'Traslado respondido', 'Transfert traité', 'Transfè a gen repons', 'تم الرد على النقل'),
    body: t('The other store answered the transfer for order {queue}.', 'La otra tienda respondió al traslado del pedido {queue}.', 'L’autre magasin a répondu pour la commande {queue}.', 'Lòt magazen an reponn pou kòmand {queue}.', 'ردّ المتجر الآخر على نقل الطلب {queue}.'),
  },
  restaurant_order_moved: {
    title: t('Your order moved', 'Tu pedido cambió de tienda', 'Votre commande a changé de magasin', 'Kòmand ou chanje magazen', 'تم نقل طلبك'),
    body: t('Your order is now being prepared at another location. Check the pickup address.', 'Tu pedido se prepara ahora en otra tienda. Revisa la dirección de recogida.', 'Votre commande est préparée dans un autre magasin. Vérifiez l’adresse de retrait.', 'Kòmand ou ap prepare nan yon lòt kote. Tcheke adrès pou vin chèche l.', 'يتم تحضير طلبك الآن في فرع آخر. تحقق من عنوان الاستلام.'),
  },
  restaurant_equipment_down: {
    title: t('Equipment down', 'Equipo fuera de servicio', 'Équipement en panne', 'Ekipman an pàn', 'معدات معطلة'),
    body: t('{equipment} was reported down.', 'Se reportó {equipment} fuera de servicio.', '{equipment} a été signalé en panne.', 'Yo siyale {equipment} an pàn.', 'تم الإبلاغ عن تعطل {equipment}.'),
  },
  restaurant_location_emergency_closed: {
    title: t('Store closed', 'Tienda cerrada', 'Magasin fermé', 'Magazen fèmen', 'تم إغلاق المتجر'),
    body: t('{location} closed for an emergency.', '{location} cerró por una emergencia.', '{location} a fermé en urgence.', '{location} fèmen pou yon ijans.', 'أُغلق {location} بسبب حالة طارئة.'),
  },
  restaurant_closure_customer_notice: {
    title: t('Store closed while your order was open', 'Tienda cerrada con tu pedido abierto', 'Magasin fermé pendant que votre commande était ouverte', 'Magazen fèmen pandan kòmand ou te louvri', 'أُغلق المتجر بينما كان طلبك مفتوحًا'),
    body: t('Your order #{queue} at {location} is affected by an emergency closure. {message}', 'Tu pedido #{queue} en {location} se ve afectado por un cierre de emergencia. {message}', 'Votre commande nº {queue} à {location} est touchée par une fermeture d’urgence. {message}', 'Kòmand ou #{queue} nan {location} afekte pa yon fèmti ijans. {message}', 'طلبك رقم {queue} في {location} متأثر بإغلاق طارئ. {message}'),
  },
  restaurant_stock_notice: {
    title: t('Stock notice', 'Aviso de inventario', 'Alerte de stock', 'Avi sou stòk', 'إشعار مخزون'),
    body: t('A teammate flagged stock at {location}.', 'Un compañero marcó un aviso de inventario en {location}.', 'Un collègue a signalé le stock à {location}.', 'Yon kolèg siyale stòk nan {location}.', 'أبلغ زميل عن المخزون في {location}.'),
  },
  restaurant_ticket_transferred: {
    title: t('Ticket handed to you', 'Ticket asignado a ti', 'Ticket qui vous est confié', 'Tikè ba ou', 'تم تسليمك تذكرة'),
    body: t('You now own ticket {queue}.', 'Ahora tienes el ticket {queue}.', 'Le ticket {queue} est maintenant à vous.', 'Tikè {queue} se pou ou kounye a.', 'التذكرة {queue} أصبحت مسؤوليتك.'),
  },
  restaurant_substitution_request: {
    title: t('Substitution question', 'Pregunta de sustitución', 'Question de remplacement', 'Kesyon sou ranplasman', 'سؤال عن بديل'),
    body: t('An item is out. Is {item} OK instead?', 'Un artículo se agotó. ¿Te sirve {item}?', 'Un article manque. {item} vous convient-il ?', 'Yon atik fini. Èske {item} bon pou ou?', 'نفد صنف. هل يناسبك {item} بدلاً منه؟'),
  },
  restaurant_order_issue_escalated: {
    title: t('Order issue escalated', 'Problema de pedido escalado', 'Problème de commande transmis', 'Pwoblèm kòmand monte', 'تم تصعيد مشكلة طلب'),
    body: t('Order {queue} needs a manager.', 'El pedido {queue} necesita un gerente.', 'La commande {queue} nécessite un responsable.', 'Kòmand {queue} bezwen yon manadjè.', 'الطلب {queue} يحتاج إلى مدير.'),
  },
  restaurant_order_late: {
    title: t('Order running late', 'Pedido retrasado', 'Commande en retard', 'Kòmand an reta', 'طلب متأخر'),
    body: t('Order {queue} is past its promised time.', 'El pedido {queue} pasó su hora prometida.', 'La commande {queue} a dépassé l’heure promise.', 'Kòmand {queue} depase lè yo te pwomèt la.', 'تجاوز الطلب {queue} الوقت الموعود.'),
  },
  restaurant_incident_assigned: {
    title: t('Incident assigned', 'Incidente asignado', 'Incident attribué', 'Ensidan asiyen', 'تم إسناد حادث'),
    body: t('You own the follow-up for {title}.', 'Tienes el seguimiento de {title}.', 'Vous êtes responsable du suivi de {title}.', 'Ou responsab swivi {title}.', 'أنت مسؤول عن متابعة {title}.'),
  },
  restaurant_access_change_handoff: {
    title: t('Shift ended by access change', 'Turno cerrado por cambio de acceso', 'Service terminé suite à un changement d’accès', 'Chif fini akoz chanjman aksè', 'انتهت الوردية بسبب تغيير الصلاحيات'),
    body: t('A teammate lost access to {location}; their tickets were released.', 'Un compañero perdió acceso a {location}; sus tickets se liberaron.', 'Un collègue a perdu l’accès à {location} ; ses tickets ont été libérés.', 'Yon kolèg pèdi aksè nan {location}; tikè l yo lage.', 'فقد زميل الوصول إلى {location}؛ تم تحرير تذاكره.'),
  },
};

module.exports = { businessTeamNotifications, BUSINESS_TEAM_NOTIFICATION_TYPES: Object.keys(businessTeamNotifications) };
