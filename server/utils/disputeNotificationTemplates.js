'use strict';

// Review W2 (P3-817, P3-819): localized dispute notification templates.
const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

exports.disputeNotifications = {
  dispute_opened_against: {
    title: t('A dispute was opened on your job', 'Se abrió una disputa sobre tu trabajo', 'Un litige a été ouvert sur votre mission', 'Yo louvri yon diskisyon sou travay ou', 'تم فتح نزاع بشأن مهمتك'),
    body: t('The other party opened a dispute. You can review it, add evidence and reply.', 'La otra parte abrió una disputa. Puedes revisarla, agregar pruebas y responder.', "L'autre partie a ouvert un litige. Vous pouvez le consulter, ajouter des preuves et répondre.", 'Lòt pati a louvri yon diskisyon. Ou ka gade l, ajoute prèv epi reponn.', 'فتح الطرف الآخر نزاعًا. يمكنك مراجعته وإضافة أدلة والرد.'),
  },
  dispute_under_review: {
    title: t('Dispute under review', 'Disputa en revisión', 'Litige en cours d’examen', 'Diskisyon an anba revizyon', 'النزاع قيد المراجعة'),
    body: t('Our team is now reviewing this dispute. Payments for the job stay on hold until it is decided.', 'Nuestro equipo está revisando esta disputa. Los pagos del trabajo quedan retenidos hasta la decisión.', 'Notre équipe examine ce litige. Les paiements de la mission restent bloqués jusqu’à la décision.', 'Ekip nou an ap revize diskisyon sa a. Peman pou travay la rete bloke jiskaske yo deside.', 'يراجع فريقنا هذا النزاع الآن. تبقى مدفوعات المهمة معلّقة حتى صدور القرار.'),
  },
  dispute_resolved: {
    title: t('Dispute resolved', 'Disputa resuelta', 'Litige résolu', 'Diskisyon an rezoud', 'تم حل النزاع'),
    body: t('A decision was made on this dispute. Open it to see the outcome.', 'Se tomó una decisión sobre esta disputa. Ábrela para ver el resultado.', 'Une décision a été prise sur ce litige. Ouvrez-le pour voir le résultat.', 'Yo pran yon desizyon sou diskisyon sa a. Louvri l pou wè rezilta a.', 'تم اتخاذ قرار بشأن هذا النزاع. افتحه لمعرفة النتيجة.'),
  },
  dispute_reopened: {
    title: t('Dispute reopened', 'Disputa reabierta', 'Litige rouvert', 'Diskisyon an relouvri', 'أُعيد فتح النزاع'),
    body: t('This dispute was sent back to open status. You can add more information while it awaits review.', 'Esta disputa volvió al estado abierta. Puedes agregar más información mientras espera revisión.', 'Ce litige a été renvoyé au statut ouvert. Vous pouvez ajouter des informations en attendant sa révision.', 'Diskisyon sa a tounen nan estati louvri. Ou ka ajoute plis enfòmasyon pandan l ap tann revizyon.', 'أُعيد هذا النزاع إلى الحالة المفتوحة. يمكنك إضافة مزيد من المعلومات أثناء انتظار المراجعة.'),
  },
  credit_dispute_provisional_credit: {
    title: t('Provisional credit added', 'Crédito provisional agregado', 'Crédit provisoire ajouté', 'Yo ajoute yon kredi pwovizwa', 'تمت إضافة رصيد مؤقت'),
    body: t('We added provisional OxSteed Credit while we review your dispute.', 'Agregamos Crédito OxSteed provisional mientras revisamos tu disputa.', 'Nous avons ajouté un crédit OxSteed provisoire pendant l’examen de votre litige.', 'Nou ajoute Kredi OxSteed pwovizwa pandan n ap revize diskisyon ou.', 'أضفنا رصيد OxSteed مؤقتًا أثناء مراجعة نزاعك.'),
  },
  credit_dispute_updated: {
    title: t('Your Credit dispute was updated', 'Tu disputa de Crédito se actualizó', 'Votre litige Crédit a été mis à jour', 'Diskisyon Kredi ou a mete ajou', 'تم تحديث نزاع الرصيد الخاص بك'),
    body: t('There is an update on your OxSteed Credit dispute.', 'Hay una actualización de tu disputa de Crédito OxSteed.', 'Il y a du nouveau sur votre litige Crédit OxSteed.', 'Gen yon nouvèl sou diskisyon Kredi OxSteed ou.', 'يوجد تحديث على نزاع رصيد OxSteed الخاص بك.'),
  },
  credit_dispute_resolved: {
    title: t('Your Credit dispute was decided', 'Se decidió tu disputa de Crédito', 'Votre litige Crédit a été tranché', 'Yo deside sou diskisyon Kredi ou', 'تم البت في نزاع الرصيد الخاص بك'),
    body: t('A decision was made on your OxSteed Credit dispute. Check your wallet for any compensation.', 'Se tomó una decisión sobre tu disputa de Crédito OxSteed. Revisa tu billetera por cualquier compensación.', 'Une décision a été prise sur votre litige Crédit OxSteed. Consultez votre portefeuille pour toute compensation.', 'Yo pran yon desizyon sou diskisyon Kredi OxSteed ou. Gade pòtfèy ou pou nenpòt konpansasyon.', 'تم اتخاذ قرار بشأن نزاع رصيد OxSteed. راجع محفظتك لأي تعويض.'),
  },
  credit_card_frozen: {
    title: t('Your OxSteed Credit card was frozen', 'Tu tarjeta OxSteed Credit fue congelada', 'Votre carte OxSteed Credit a été gelée', 'Kat OxSteed Credit ou a jele', 'تم تجميد بطاقة OxSteed Credit الخاصة بك'),
    body: t('OxSteed froze your Credit card. You can review it on your cards page.', 'OxSteed congeló tu tarjeta de Crédito. Puedes revisarla en tu página de tarjetas.', 'OxSteed a gelé votre carte Crédit. Vous pouvez la consulter sur votre page de cartes.', 'OxSteed jele kat Kredi ou. Ou ka revize l sou paj kat ou.', 'جمّدت OxSteed بطاقة الرصيد الخاصة بك. يمكنك مراجعتها على صفحة بطاقاتك.'),
  },
  credit_card_revoked: {
    title: t('Your OxSteed Credit card was revoked', 'Tu tarjeta OxSteed Credit fue revocada', 'Votre carte OxSteed Credit a été révoquée', 'Kat OxSteed Credit ou a anile', 'تم إلغاء بطاقة OxSteed Credit الخاصة بك'),
    body: t('OxSteed revoked your Credit card. It can no longer be used. You can request a replacement from your cards page.', 'OxSteed revocó tu tarjeta de Crédito. Ya no se puede usar. Puedes solicitar un reemplazo desde tu página de tarjetas.', 'OxSteed a révoqué votre carte Crédit. Elle ne peut plus être utilisée. Vous pouvez demander un remplacement depuis votre page de cartes.', 'OxSteed anile kat Kredi ou. Ou pa ka itilize l ankò. Ou ka mande yon ranplasman sou paj kat ou.', 'ألغت OxSteed بطاقة الرصيد الخاصة بك. لم يعد بالإمكان استخدامها. يمكنك طلب بطاقة بديلة من صفحة بطاقاتك.'),
  },
  // Credit redesign (D-800): the owner is told on every reveal and card
  // action, so a use of the card the owner did not make is visible.
  credit_card_revealed: {
    title: t('Your OxSteed Credit card number was viewed', 'Se vio el número de tu tarjeta OxSteed Credit', 'Le numéro de votre carte OxSteed Credit a été affiché', 'Yo te wè nimewo kat OxSteed Credit ou a', 'تم عرض رقم بطاقة OxSteed Credit الخاصة بك'),
    body: t('Your Credit card number was revealed after verification. If that was not you, freeze the card from your cards page.', 'Tu número de tarjeta de Crédito se reveló después de la verificación. Si no fuiste tú, congela la tarjeta desde tu página de tarjetas.', 'Le numéro de votre carte Crédit a été affiché après vérification. Si ce n’était pas vous, gelez la carte depuis votre page de cartes.', 'Yo te montre nimewo kat Kredi ou apre verifikasyon. Si se pa t ou, jele kat la nan paj kat ou.', 'تم الكشف عن رقم بطاقة الرصيد الخاصة بك بعد التحقق. إذا لم تكن أنت، فجمّد البطاقة من صفحة بطاقاتك.'),
  },
  credit_card_security_code_reset: {
    title: t('Your OxSteed Credit security code was reset', 'Se restableció el código de seguridad de tu tarjeta OxSteed Credit', 'Le code de sécurité de votre carte OxSteed Credit a été réinitialisé', 'Yo te reset kòd sekirite kat OxSteed Credit ou a', 'تمت إعادة تعيين رمز أمان بطاقة OxSteed Credit الخاصة بك'),
    body: t('A new security code was set on your Credit card after verification. Your old code no longer works.', 'Se estableció un nuevo código de seguridad en tu tarjeta de Crédito después de la verificación. Tu código anterior ya no funciona.', 'Un nouveau code de sécurité a été défini sur votre carte Crédit après vérification. Votre ancien code ne fonctionne plus.', 'Yo te mete yon nouvo kòd sekirite sou kat Kredi ou apre verifikasyon. Ansyen kòd ou a pa mache ankò.', 'تم تعيين رمز أمان جديد على بطاقة الرصيد الخاصة بك بعد التحقق. لم يعد رمزك القديم يعمل.'),
  },
  credit_card_limits_updated: {
    title: t('Your OxSteed Credit card limits changed', 'Cambiaron los límites de tu tarjeta OxSteed Credit', 'Les limites de votre carte OxSteed Credit ont changé', 'Limit kat OxSteed Credit ou yo chanje', 'تغيّرت حدود بطاقة OxSteed Credit الخاصة بك'),
    body: t('The spend limits on your Credit card changed after verification. You can review them on your cards page.', 'Los límites de gasto de tu tarjeta de Crédito cambiaron después de la verificación. Puedes revisarlos en tu página de tarjetas.', 'Les limites de dépense de votre carte Crédit ont changé après vérification. Vous pouvez les consulter sur votre page de cartes.', 'Limit depans kat Kredi ou yo chanje apre verifikasyon. Ou ka revize yo sou paj kat ou.', 'تغيّرت حدود الإنفاق على بطاقة الرصيد الخاصة بك بعد التحقق. يمكنك مراجعتها على صفحة بطاقاتك.'),
  },
  // Group 13 (694, D-401/D-402): one type for every participant
  // eligibility/status change. The caller appends the new state and what
  // it means in English after this localized body, the same shape as the
  // card-frozen reason append (D-362); the machine-readable status rides
  // in data.
  credit_participant_status_changed: {
    title: t('Your OxSteed Credit status changed', 'Tu estado de Crédito OxSteed cambió', 'Votre statut Crédit OxSteed a changé', 'Estati Kredi OxSteed ou a chanje', 'تغيّرت حالة رصيد OxSteed الخاص بك'),
    body: t('Your OxSteed Credit eligibility or participation status changed. Open your application to see the new status and what it means.', 'Tu elegibilidad o estado de participación de Crédito OxSteed cambió. Abre tu solicitud para ver el nuevo estado y lo que significa.', 'Votre éligibilité ou votre statut de participation au Crédit OxSteed a changé. Ouvrez votre demande pour voir le nouveau statut et ce qu’il signifie.', 'Elijibilite oswa estati patisipasyon Kredi OxSteed ou a chanje. Louvri aplikasyon ou pou wè nouvo estati a ak sa li vle di.', 'تغيّرت أهليتك أو حالة مشاركتك في رصيد OxSteed. افتح طلبك لمعرفة الحالة الجديدة وما تعنيه.'),
  },
  payment_dispute_updated: {
    title: t('Your refund request was updated', 'Tu solicitud de reembolso se actualizó', 'Votre demande de remboursement a été mise à jour', 'Demann ranbousman ou a mete ajou', 'تم تحديث طلب الاسترداد الخاص بك'),
    body: t('Our team made a decision on your refund request. Open your support tickets for details.', 'Nuestro equipo tomó una decisión sobre tu solicitud de reembolso. Abre tus tickets de soporte para ver los detalles.', 'Notre équipe a pris une décision sur votre demande de remboursement. Ouvrez vos tickets d’assistance pour les détails.', 'Ekip nou an pran yon desizyon sou demann ranbousman ou. Louvri tikè sipò ou yo pou detay.', 'اتخذ فريقنا قرارًا بشأن طلب الاسترداد. افتح تذاكر الدعم للتفاصيل.'),
  },
  // Wave 3 (589, D-572/D-569): rental escalation notices. The opened
  // notice goes to the counterparty and to the moderation admins; the
  // resolved notice goes to both parties when an admin closes the thread.
  // The machine-readable ids ride in data; the caller appends nothing.
  tool_rental_escalation_opened: {
    title: t('A rental escalation was opened', 'Se abrió una escalación de alquiler', 'Une escalade de location a été ouverte', 'Yo louvri yon eskalasyon lokasyon', 'تم فتح تصعيد إيجار'),
    body: t('A party on a tool rental opened a support escalation. Open the rental moderation queue to read the thread and reply.', 'Una parte de un alquiler de herramientas abrió una escalación de soporte. Abre la cola de moderación de alquileres para leer el hilo y responder.', 'Une partie à une location d’outil a ouvert une escalade d’assistance. Ouvrez la file de modération des locations pour lire le fil et répondre.', 'Yon pati nan yon lokasyon zouti louvri yon eskalasyon sipò. Louvri ke modération lokasyon yo pou li fil la epi reponn.', 'فتح أحد طرفي إيجار أداة تصعيد دعم. افتح قائمة مراجعة الإيجارات لقراءة المحادثة والرد.'),
  },
  tool_rental_escalation_resolved: {
    title: t('A rental escalation was resolved', 'Se resolvió una escalación de alquiler', 'Une escalade de location a été résolue', 'Yo rezoud yon eskalasyon lokasyon', 'تم حل تصعيد إيجار'),
    body: t('An admin closed a support escalation on a tool rental. Open the booking to accept the resolution or dispute it.', 'Un administrador cerró una escalación de soporte sobre un alquiler de herramientas. Abre la reserva para aceptar la resolución o disputarla.', 'Un administrateur a clôturé une escalade d’assistance sur une location d’outil. Ouvrez la réservation pour accepter la résolution ou la contester.', 'Yon admin fèmen yon eskalasyon sipò sou yon lokasyon zouti. Louvri rezervasyon an pou aksepte rezolisyon an oswa konteste l.', 'أغلق أحد المسؤولين تصعيد دعم بشأن إيجار أداة. افتح الحجز لقبول الحل أو الاعتراض عليه.'),
  },
  // G1-B6 (D-673): a customer files a product return request. One
  // type for both recipients; the helper who sold the order and the
  // operations admins each get the notice with their own queue link.
  // The machine-readable ids ride in data; the caller appends nothing.
  marketplace_return_requested: {
    title: t('A return was requested for a marketplace order', 'Se solicitó una devolución de un pedido del mercado', 'Un retour a été demandé pour une commande de la marketplace', 'Yo mande yon retou pou yon lòd nan mache a', 'تم طلب إرجاع لطلب من السوق'),
    body: t('A customer asked to return items from a marketplace order. Open the return queue to review the request.', 'Un cliente pidió devolver artículos de un pedido del mercado. Abre la cola de devoluciones para revisar la solicitud.', 'Un client a demandé le retour d’articles d’une commande de la marketplace. Ouvrez la file des retours pour examiner la demande.', 'Yon kliyan mande pou retounen atik nan yon lòd nan mache a. Louvri ke retou yo pou revize demann lan.', 'طلب عميل إرجاع عناصر من طلب في السوق. افتح قائمة الإرجاع لمراجعة الطلب.'),
  },
  // G11-B13 (D-620): a party accepts or disputes an admin-closed
  // escalation. Two types so the bell never mislabels a dispute as an
  // acceptance; the disputed notice goes to the counterparty and the
  // moderation admins, because the thread is open again.
  tool_rental_escalation_acknowledged: {
    title: t('A rental escalation resolution was accepted', 'Se aceptó la resolución de una escalación de alquiler', 'La résolution d’une escalade de location a été acceptée', 'Yo aksepte rezolisyon yon eskalasyon lokasyon', 'تم قبول تسوية تصعيد إيجار'),
    body: t('A party on a tool rental accepted the resolution on a support escalation. Open the booking to review it.', 'Una parte de un alquiler de herramientas aceptó la resolución de una escalación de soporte. Abre la reserva para revisarla.', 'Une partie à une location d’outil a accepté la résolution d’une escalade d’assistance. Ouvrez la réservation pour la vérifier.', 'Yon pati nan yon lokasyon zouti aksepte rezolisyon yon eskalasyon sipò. Louvri rezervasyon an pou revize li.', 'قبل أحد طرفي إيجار أداة تسوية تصعيد دعم. افتح الحجز لمراجعتها.'),
  },
  tool_rental_escalation_disputed: {
    title: t('A rental escalation resolution was disputed', 'Se disputó la resolución de una escalación de alquiler', 'La résolution d’une escalade de location a été contestée', 'Yo konteste rezolisyon yon eskalasyon lokasyon', 'تم الاعتراض على تسوية تصعيد إيجار'),
    body: t('A party on a tool rental disputed the resolution on a support escalation. The thread is open again for admin review.', 'Una parte de un alquiler de herramientas disputó la resolución de una escalación de soporte. El hilo está abierto de nuevo para revisión del administrador.', 'Une partie à une location d’outil a contesté la résolution d’une escalade d’assistance. Le fil est de nouveau ouvert pour examen par l’administrateur.', 'Yon pati nan yon lokasyon zouti konteste rezolisyon yon eskalasyon sipò. Fil la louvri ankò pou admin revize li.', 'اعترض أحد طرفي إيجار أداة على تسوية تصعيد دعم. المحادثة مفتوحة مجددًا لمراجعة المسؤول.'),
  },
};
