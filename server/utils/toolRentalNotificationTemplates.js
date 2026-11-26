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
};
