'use strict';

// G11 rental lifecycle notification templates (D-603 onwards). Titles and
// bodies resolve through tNotif, the same split-template pattern as
// disputeNotificationTemplates: a 0-hit grep on i18n.js alone does NOT
// prove a type is lost (S-E1 lesson). Every type registered here must
// also be registered in server/utils/notificationTypeCatalog.js, and
// every send goes through server/utils/toolRentalNotifications.js so the
// renter's notify_bookings toggle is honored.
const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

exports.toolRentalNotifications = {
  // G11-A1/A3 (D-603): the renter recorded payment proof; the owner must
  // confirm receipt before the booking leaves invoice_sent.
  tool_rental_payment_proof_submitted: {
    title: t('A renter recorded a rental payment', 'Un arrendatario registró un pago de alquiler', 'Un locataire a enregistré un paiement de location', 'Yon lokatè anrejistre yon peman lokasyon', 'سجّل مستأجر دفعة إيجار'),
    body: t('A renter recorded payment for a tool rental. Open the booking to check the reference and confirm receipt.', 'Un arrendatario registró el pago de un alquiler de herramientas. Abre la reserva para revisar la referencia y confirmar la recepción.', 'Un locataire a enregistré le paiement d’une location d’outil. Ouvrez la réservation pour vérifier la référence et confirmer la réception.', 'Yon lokatè anrejistre peman pou yon lokasyon zouti. Louvri rezervasyon an pou tcheke referans lan epi konfime resepsyon an.', 'سجّل مستأجر دفعة لإيجار أداة. افتح الحجز للتحقق من المرجع وتأكيد الاستلام.'),
  },
  // G11-A1/A3 (D-603): the owner confirmed receipt; the booking is paid.
  tool_rental_payment_confirmed: {
    title: t('Your rental payment was confirmed', 'Se confirmó el pago de tu alquiler', 'Le paiement de votre location a été confirmé', 'Peman lokasyon ou a konfime', 'تم تأكيد دفعة الإيجار الخاصة بك'),
    body: t('The tool owner confirmed receipt of your payment. The booking is confirmed and pickup can proceed.', 'El propietario confirmó la recepción de tu pago. La reserva está confirmada y puedes proceder con la recogida.', 'Le propriétaire a confirmé la réception de votre paiement. La réservation est confirmée et la récupération peut avoir lieu.', 'Pwopriyetè zouti a konfime li resevwa peman ou. Rezèvasyon an konfime epi ou ka kontinye ak ramase a.', 'أكّد مالك الأداة استلام دفعتك. تم تأكيد الحجز ويمكن المتابعة إلى الاستلام.'),
  },
  // G11-A5 (D-609): the owner approved the booking request.
  tool_rental_booking_approved: {
    title: t('Your rental request was approved', 'Se aprobó tu solicitud de alquiler', 'Votre demande de location a été approuvée', 'Demann lokasyon ou a apwouve', 'تمت الموافقة على طلب الإيجار الخاص بك'),
    body: t('The tool owner approved your rental request. You can now proceed to payment.', 'El propietario aprobó tu solicitud de alquiler. Ya puedes proceder con el pago.', 'Le propriétaire a approuvé votre demande de location. Vous pouvez maintenant procéder au paiement.', 'Pwopriyetè zouti a apwouve demann lokasyon ou. Ou ka kontinye ak peman an kounye a.', 'وافق مالك الأداة على طلب الإيجار الخاص بك. يمكنك الآن المتابعة إلى الدفع.'),
  },
  // G11-A5 (D-609): the owner declined the booking request.
  tool_rental_booking_declined: {
    title: t('Your rental request was declined', 'Se rechazó tu solicitud de alquiler', 'Votre demande de location a été refusée', 'Demann lokasyon ou a refize', 'تم رفض طلب الإيجار الخاص بك'),
    body: t('The tool owner declined your rental request. You can look for another tool.', 'El propietario rechazó tu solicitud de alquiler. Puedes buscar otra herramienta.', 'Le propriétaire a refusé votre demande de location. Vous pouvez chercher un autre outil.', 'Pwopriyetè zouti a refize demann lokasyon ou. Ou ka chèche yon lòt zouti.', 'رفض مالك الأداة طلب الإيجار الخاص بك. يمكنك البحث عن أداة أخرى.'),
  },
  // G11-A5 (D-609): the owner sent the invoice.
  tool_rental_invoice_sent: {
    title: t('Your rental invoice arrived', 'Llegó tu factura de alquiler', 'Votre facture de location est arrivée', 'Fakti lokasyon ou a rive', 'وصلت فاتورة الإيجار الخاصة بك'),
    body: t('The tool owner sent your rental invoice. Open the booking to review it and record your payment.', 'El propietario envió tu factura de alquiler. Abre la reserva para revisarla y registrar tu pago.', 'Le propriétaire a envoyé votre facture de location. Ouvrez la réservation pour la vérifier et enregistrer votre paiement.', 'Pwopriyetè zouti a voye fakti lokasyon ou. Louvri rezervasyon an pou revize li epi anrejistre peman ou.', 'أرسل مالك الأداة فاتورة الإيجار الخاصة بك. افتح الحجز لمراجعتها وتسجيل دفعتك.'),
  },
  // G11-A5 (D-609): the other party cancelled the booking.
  tool_rental_booking_cancelled: {
    title: t('A rental booking was cancelled', 'Se canceló una reserva de alquiler', 'Une réservation de location a été annulée', 'Yon rezervasyon lokasyon anile', 'تم إلغاء حجز إيجار'),
    body: t('The other party cancelled a rental booking. Open the booking to review it.', 'La otra parte canceló una reserva de alquiler. Abre la reserva para revisarla.', 'L’autre partie a annulé une réservation de location. Ouvrez la réservation pour la vérifier.', 'Lòt pati a anile yon rezervasyon lokasyon. Louvri rezervasyon an pou revize li.', 'ألغى الطرف الآخر حجز إيجار. افتح الحجز لمراجعته.'),
  },
  // G11-B2 (D-609): the tool was marked returned.
  tool_rental_return_marked: {
    title: t('A rental tool was marked returned', 'Se marcó una herramienta de alquiler como devuelta', 'Un outil de location a été marqué comme rendu', 'Yo make yon zouti lokasyon kòm retounen', 'تم وضع علامة على أداة إيجار بأنها مُعادة'),
    body: t('The other party marked the tool as returned. Open the booking to review the return.', 'La otra parte marcó la herramienta como devuelta. Abre la reserva para revisar la devolución.', 'L’autre partie a marqué l’outil comme rendu. Ouvrez la réservation pour vérifier le retour.', 'Lòt pati a make zouti a kòm retounen. Louvri rezervasyon an pou revize retou a.', 'وضع الطرف الآخر علامة على الأداة بأنها مُعادة. افتح الحجز لمراجعة الإعادة.'),
  },
  // G11-B2 (D-609): a damage claim was filed on the booking.
  tool_rental_damage_claim_filed: {
    title: t('A damage claim was filed on your rental', 'Se presentó una reclamación por daños en tu alquiler', 'Une réclamation pour dommages a été déposée sur votre location', 'Yo depoze yon reklamasyon domaj sou lokasyon ou', 'تم تقديم مطالبة أضرار على إيجارك'),
    body: t('The other party filed a damage claim on a booking. Open the booking to review it.', 'La otra parte presentó una reclamación por daños en una reserva. Abre la reserva para revisarla.', 'L’autre partie a déposé une réclamation pour dommages sur une réservation. Ouvrez la réservation pour la vérifier.', 'Lòt pati a depoze yon reklamasyon domaj sou yon rezervasyon. Louvri rezervasyon an pou revize li.', 'قدّم الطرف الآخر مطالبة أضرار على حجز. افتح الحجز لمراجعتها.'),
  },
  // G11-B2 (D-609): the claim was resolved by the other party.
  tool_rental_damage_claim_resolved: {
    title: t('Your damage claim was resolved', 'Se resolvió tu reclamación por daños', 'Votre réclamation pour dommages a été résolue', 'Reklamasyon domaj ou a rezoud', 'تمت تسوية مطالبة الأضرار الخاصة بك'),
    body: t('The other party resolved your damage claim. Open the booking to review the resolution.', 'La otra parte resolvió tu reclamación por daños. Abre la reserva para revisar la resolución.', 'L’autre partie a résolu votre réclamation pour dommages. Ouvrez la réservation pour vérifier la résolution.', 'Lòt pati a rezoud reklamasyon domaj ou. Louvri rezervasyon an pou revize rezolisyon an.', 'سوّى الطرف الآخر مطالبة الأضرار الخاصة بك. افتح الحجز لمراجعة التسوية.'),
  },
  // G11-B2 (D-609): the filer acknowledged the claim resolution.
  tool_rental_damage_claim_acknowledged: {
    title: t('A damage claim resolution was acknowledged', 'Se reconoció la resolución de una reclamación por daños', 'La résolution d’une réclamation pour dommages a été reconnue', 'Yo rekonèt rezolisyon yon reklamasyon domaj', 'تم الإقرار بتسوية مطالبة أضرار'),
    body: t('The filer acknowledged the damage claim resolution. Open the booking to review it.', 'El reclamante reconoció la resolución de la reclamación por daños. Abre la reserva para revisarla.', 'Le déposant a reconnu la résolution de la réclamation pour dommages. Ouvrez la réservation pour la vérifier.', 'Moun ki te depoze reklamasyon an rekonèt rezolisyon reklamasyon domaj la. Louvri rezervasyon an pou revize li.', 'أقرّ مقدّم المطالبة بتسوية مطالبة الأضرار. افتح الحجز لمراجعتها.'),
  },
  // G11-B2 (D-609): a message was posted on an escalation thread.
  // Sent by the disputes controller's own sender (safety thread, same
  // as the Wave 3 open/resolved notices), not the bookings toggle.
  tool_rental_escalation_replied: {
    title: t('New message on your rental escalation', 'Nuevo mensaje en tu escalación de alquiler', 'Nouveau message sur votre escalade de location', 'Nouvo mesaj sou eskalasyon lokasyon ou', 'رسالة جديدة على تصعيد الإيجار الخاص بك'),
    body: t('Someone posted a new message on a rental escalation. Open the booking to read it.', 'Alguien publicó un nuevo mensaje en una escalación de alquiler. Abre la reserva para leerlo.', 'Quelqu’un a publié un nouveau message sur une escalade de location. Ouvrez la réservation pour le lire.', 'Yon moun poste yon nouvo mesaj sou yon eskalasyon lokasyon. Louvri rezervasyon an pou li li.', 'نشر شخص ما رسالة جديدة على تصعيد إيجار. افتح الحجز لقراءتها.'),
  },
  // G11-B2 (D-609): the renter proposed a new return date.
  tool_rental_reschedule_proposed: {
    title: t('A new return date was proposed', 'Se propuso una nueva fecha de devolución', 'Une nouvelle date de retour a été proposée', 'Yo pwopoze yon nouvo dat retou', 'تم اقتراح موعد إعادة جديد'),
    body: t('The renter proposed a new return date for a rental. Open the booking to decide.', 'El arrendatario propuso una nueva fecha de devolución para un alquiler. Abre la reserva para decidir.', 'Le locataire a proposé une nouvelle date de retour pour une location. Ouvrez la réservation pour décider.', 'Lokatè a pwopoze yon nouvo dat retou pou yon lokasyon. Louvri rezervasyon an pou deside.', 'اقترح المستأجر موعد إعادة جديدًا لإيجار. افتح الحجز لاتخاذ القرار.'),
  },
  // G11-B2 (D-609): the owner approved the proposed return date.
  tool_rental_reschedule_approved: {
    title: t('Your new return date was approved', 'Se aprobó tu nueva fecha de devolución', 'Votre nouvelle date de retour a été approuvée', 'Nouvo dat retou ou a apwouve', 'تمت الموافقة على موعد الإعادة الجديد الخاص بك'),
    body: t('The tool owner approved your proposed return date. Open the booking to review it.', 'El propietario aprobó tu fecha de devolución propuesta. Abre la reserva para revisarla.', 'Le propriétaire a approuvé votre date de retour proposée. Ouvrez la réservation pour la vérifier.', 'Pwopriyetè zouti a apwouve nouvo dat retou ou te pwopoze a. Louvri rezervasyon an pou revize li.', 'وافق مالك الأداة على موعد الإعادة المقترح. افتح الحجز لمراجعته.'),
  },
  // G11-B2 (D-609): the owner declined the proposed return date.
  tool_rental_reschedule_declined: {
    title: t('Your new return date was declined', 'Se rechazó tu nueva fecha de devolución', 'Votre nouvelle date de retour a été refusée', 'Nouvo dat retou ou a refize', 'تم رفض موعد الإعادة الجديد الخاص بك'),
    body: t('The tool owner declined your proposed return date. Open the booking to review the reason.', 'El propietario rechazó tu fecha de devolución propuesta. Abre la reserva para revisar el motivo.', 'Le propriétaire a refusé votre date de retour proposée. Ouvrez la réservation pour vérifier le motif.', 'Pwopriyetè zouti a refize nouvo dat retou ou te pwopoze a. Louvri rezervasyon an pou revize rezon an.', 'رفض مالك الأداة موعد الإعادة المقترح. افتح الحجز لمراجعة السبب.'),
  },
  // G11-B2 (D-609): a refund settlement was proposed.
  tool_rental_refund_proposed: {
    title: t('A refund settlement was proposed', 'Se propuso un acuerdo de reembolso', 'Un règlement de remboursement a été proposé', 'Yo pwopoze yon akò ranbousman', 'تم اقتراح تسوية استرداد'),
    body: t('The other party proposed a refund settlement for a cancelled booking. Open the booking to review it.', 'La otra parte propuso un acuerdo de reembolso para una reserva cancelada. Abre la reserva para revisarlo.', 'L’autre partie a proposé un règlement de remboursement pour une réservation annulée. Ouvrez la réservation pour le vérifier.', 'Lòt pati a pwopoze yon akò ranbousman pou yon rezervasyon anile. Louvri rezervasyon an pou revize li.', 'اقترح الطرف الآخر تسوية استرداد لحجز ملغى. افتح الحجز لمراجعتها.'),
  },
  // G11-B2 (D-609): the other party agreed to the refund settlement.
  tool_rental_refund_confirmed: {
    title: t('Your refund settlement was agreed', 'Se acordó tu acuerdo de reembolso', 'Votre règlement de remboursement a été accepté', 'Akò ranbousman ou a dakò', 'تمت الموافقة على تسوية الاسترداد الخاصة بك'),
    body: t('The other party agreed to your proposed refund settlement. Open the booking to review it.', 'La otra parte aceptó tu acuerdo de reembolso propuesto. Abre la reserva para revisarlo.', 'L’autre partie a accepté votre règlement de remboursement proposé. Ouvrez la réservation pour le vérifier.', 'Lòt pati a dakò ak akò ranbousman ou te pwopoze a. Louvri rezervasyon an pou revize li.', 'وافق الطرف الآخر على تسوية الاسترداد التي اقترحتها. افتح الحجز لمراجعتها.'),
  },
  // G11-B2 (D-609): the agreed refund was marked settled.
  tool_rental_refund_settled: {
    title: t('A refund settlement was marked settled', 'Se marcó un acuerdo de reembolso como liquidado', 'Un règlement de remboursement a été marqué comme réglé', 'Yo make yon akò ranbousman kòm regle', 'تم وضع علامة على تسوية استرداد كمسددة'),
    body: t('The other party marked the agreed refund settlement as settled. Open the booking to review it.', 'La otra parte marcó el acuerdo de reembolso acordado como liquidado. Abre la reserva para revisarlo.', 'L’autre partie a marqué le règlement de remboursement convenu comme réglé. Ouvrez la réservation pour le vérifier.', 'Lòt pati a make akò ranbousman yo te dakò sou li a kòm regle. Louvri rezervasyon an pou revize li.', 'وضع الطرف الآخر علامة على تسوية الاسترداد المتفق عليها كمسددة. افتح الحجز لمراجعتها.'),
  },
  // G11-B2 (D-609): the owner resolved the deposit.
  tool_rental_deposit_resolved: {
    title: t('Your rental deposit was resolved', 'Se resolvió el depósito de tu alquiler', 'Votre dépôt de location a été résolu', 'Depo lokasyon ou a rezoud', 'تمت تسوية وديعة الإيجار الخاصة بك'),
    body: t('The tool owner resolved your deposit. Open the booking to review the resolution.', 'El propietario resolvió el depósito de tu alquiler. Abre la reserva para revisar la resolución.', 'Le propriétaire a résolu votre dépôt de location. Ouvrez la réservation pour vérifier la résolution.', 'Pwopriyetè zouti a rezoud depo lokasyon ou. Louvri rezervasyon an pou revize rezolisyon an.', 'سوّى مالك الأداة وديعة الإيجار الخاصة بك. افتح الحجز لمراجعة التسوية.'),
  },
  // G11-B2 (D-609): the renter acknowledged the deposit resolution.
  tool_rental_deposit_acknowledged: {
    title: t('A deposit resolution was acknowledged', 'Se reconoció la resolución de un depósito', 'La résolution d’un dépôt a été reconnue', 'Yo rekonèt rezolisyon yon depo', 'تم الإقرار بتسوية وديعة'),
    body: t('The renter acknowledged the deposit resolution. Open the booking to review it.', 'El arrendatario reconoció la resolución del depósito. Abre la reserva para revisarla.', 'Le locataire a reconnu la résolution du dépôt. Ouvrez la réservation pour la vérifier.', 'Lokatè a rekonèt rezolisyon depo a. Louvri rezervasyon an pou revize li.', 'أقرّ المستأجر بتسوية الوديعة. افتح الحجز لمراجعتها.'),
  },
  // G11-A5 (D-609): owner-facing copy for the payment-confirmation
  // email (sendPaymentConfirmedToOwner). Email-only: never sent
  // in-app, so it has no notifyRental call site; the renter-facing
  // tool_rental_payment_confirmed entry above is the in-app one.
  tool_rental_payment_confirmed_owner: {
    title: t('You confirmed a rental payment', 'Confirmaste un pago de alquiler', 'Vous avez confirmé un paiement de location', 'Ou konfime yon peman lokasyon', 'أكّدت دفعة إيجار'),
    body: t('You confirmed receipt of the renter’s payment. The booking is confirmed, the deposit is now held, and pickup can proceed.', 'Confirmaste la recepción del pago del arrendatario. La reserva está confirmada, el depósito ahora está retenido y puedes proceder con la entrega.', 'Vous avez confirmé la réception du paiement du locataire. La réservation est confirmée, le dépôt est désormais retenu et la remise peut avoir lieu.', 'Ou konfime ou resevwa peman lokatè a. Rezèvasyon an konfime, depo a kenbe kounye a, epi ramase a ka kontinye.', 'أكّدت استلام دفعة المستأجر. تم تأكيد الحجز، والوديعة محتجزة الآن، ويمكن المتابعة إلى التسليم.'),
  },
};
