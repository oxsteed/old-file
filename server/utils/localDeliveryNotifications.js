'use strict';

// This catalog is consumed by notificationService through tNotif, so email,
// in-app and push all use the recipient's preferred language.
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const copy = {
  posted: [
    ['Delivery request received', 'Your delivery request is ready for coordination.'],
    ['Solicitud de entrega recibida', 'Tu solicitud de entrega está lista para coordinarse.'],
    ['Demande de livraison reçue', 'Votre demande de livraison est prête à être organisée.'],
    ['Nou resevwa demann livrezon an', 'Demann livrezon ou an pare pou òganize.'],
    ['تم استلام طلب التوصيل', 'طلب التوصيل الخاص بك جاهز للتنسيق.'],
  ],
  assigned: [
    ['Driver assigned', 'A driver has been assigned to your delivery.'],
    ['Conductor asignado', 'Se ha asignado un conductor a tu entrega.'],
    ['Chauffeur attribué', 'Un chauffeur a été attribué à votre livraison.'],
    ['Yo asiyen yon chofè', 'Yo asiyen yon chofè pou livrezon ou an.'],
    ['تم تعيين سائق', 'تم تعيين سائق لطلب التوصيل الخاص بك.'],
  ],
  picked_up: [
    ['Pickup completed', 'Your package has been picked up.'],
    ['Recogida completada', 'Tu paquete ha sido recogido.'],
    ['Collecte effectuée', 'Votre colis a été récupéré.'],
    ['Yo pran pakè a', 'Yo fin pran pakè ou a.'],
    ['تم استلام الطرد', 'تم استلام الطرد الخاص بك.'],
  ],
  in_transit: [
    ['Delivery in transit', 'Your delivery is on the way to its destination.'],
    ['Entrega en camino', 'Tu entrega está en camino a su destino.'],
    ['Livraison en cours', 'Votre livraison est en route vers sa destination.'],
    ['Livrezon an sou wout', 'Livrezon ou an sou wout pou rive nan destinasyon li.'],
    ['التوصيل قيد النقل', 'طلب التوصيل الخاص بك في طريقه إلى وجهته.'],
  ],
  delivered: [
    ['Delivery completed', 'Your delivery has been completed.'],
    ['Entrega completada', 'Tu entrega se ha completado.'],
    ['Livraison terminée', 'Votre livraison a été effectuée.'],
    ['Livrezon an fini', 'Livrezon ou an fini.'],
    ['اكتمل التوصيل', 'اكتمل طلب التوصيل الخاص بك.'],
  ],
  cancelled: [
    ['Delivery cancelled', 'Your delivery has been cancelled.'],
    ['Entrega cancelada', 'Tu entrega ha sido cancelada.'],
    ['Livraison annulée', 'Votre livraison a été annulée.'],
    ['Livrezon an anile', 'Yo anile livrezon ou an.'],
    ['تم إلغاء التوصيل', 'تم إلغاء طلب التوصيل الخاص بك.'],
  ],
  failed: [
    ['Delivery needs attention', 'Your delivery could not be completed. Open it for next steps.'],
    ['La entrega necesita atención', 'No se pudo completar tu entrega. Ábrela para ver los siguientes pasos.'],
    ['La livraison nécessite votre attention', 'Votre livraison n’a pas pu être effectuée. Consultez les prochaines étapes.'],
    ['Livrezon an bezwen atansyon', 'Livrezon ou an pa t kapab fini. Louvri li pou wè pwochen etap yo.'],
    ['التوصيل يحتاج إلى متابعة', 'تعذر إكمال طلب التوصيل. افتحه للاطلاع على الخطوات التالية.'],
  ],
  returned: [
    ['Return completed', 'Your package return has been completed.'],
    ['Devolución completada', 'La devolución de tu paquete se ha completado.'],
    ['Retour effectué', 'Le retour de votre colis a été effectué.'],
    ['Retou a fini', 'Retou pakè ou a fini.'],
    ['اكتمل الإرجاع', 'اكتمل إرجاع الطرد الخاص بك.'],
  ],
  exception_reported: [
    ['Delivery needs attention', 'An issue has been reported for your delivery.'],
    ['La entrega necesita atención', 'Se ha informado de un problema con tu entrega.'],
    ['La livraison nécessite votre attention', 'Un problème a été signalé pour votre livraison.'],
    ['Livrezon an bezwen atansyon', 'Yo rapòte yon pwoblèm pou livrezon ou an.'],
    ['التوصيل يحتاج إلى متابعة', 'تم الإبلاغ عن مشكلة في طلب التوصيل الخاص بك.'],
  ],
  exception_resolved: [
    ['Delivery issue resolved', 'The issue with your delivery has been resolved.'],
    ['Problema de entrega resuelto', 'Se ha resuelto el problema con tu entrega.'],
    ['Problème de livraison résolu', 'Le problème de votre livraison a été résolu.'],
    ['Pwoblèm livrezon an rezoud', 'Pwoblèm livrezon ou an rezoud.'],
    ['تم حل مشكلة التوصيل', 'تم حل المشكلة المتعلقة بطلب التوصيل الخاص بك.'],
  ],
  reschedule_requested: [
    ['Reschedule requested', 'A new delivery time is waiting for review.'],
    ['Cambio de horario solicitado', 'Un nuevo horario de entrega está pendiente de revisión.'],
    ['Report demandé', 'Un nouvel horaire de livraison attend une validation.'],
    ['Yo mande chanje orè a', 'Yon nouvo lè livrezon ap tann revizyon.'],
    ['تم طلب تغيير الموعد', 'موعد توصيل جديد بانتظار المراجعة.'],
  ],
  reschedule_approved: [
    ['Reschedule approved', 'Your delivery time has been updated.'],
    ['Cambio de horario aprobado', 'Se ha actualizado el horario de tu entrega.'],
    ['Report approuvé', 'L’horaire de votre livraison a été modifié.'],
    ['Chanjman orè a apwouve', 'Yo mete lè livrezon ou an ajou.'],
    ['تمت الموافقة على تغيير الموعد', 'تم تحديث موعد التوصيل الخاص بك.'],
  ],
  reschedule_rejected: [
    ['Reschedule declined', 'The requested delivery time change was declined.'],
    ['Cambio de horario rechazado', 'Se ha rechazado el cambio de horario solicitado.'],
    ['Report refusé', 'Le changement d’horaire demandé a été refusé.'],
    ['Chanjman orè a refize', 'Yo refize chanjman lè livrezon ou te mande a.'],
    ['تم رفض تغيير الموعد', 'تم رفض طلب تغيير موعد التوصيل.'],
  ],
  return_requested: [
    ['Return requested', 'A return request has been recorded for your delivery.'],
    ['Devolución solicitada', 'Se ha registrado una solicitud de devolución para tu entrega.'],
    ['Retour demandé', 'Une demande de retour a été enregistrée pour votre livraison.'],
    ['Yo mande yon retou', 'Yo anrejistre yon demann retou pou livrezon ou an.'],
    ['تم طلب الإرجاع', 'تم تسجيل طلب إرجاع للتوصيل الخاص بك.'],
  ],
  return_approved: [
    ['Return approved', 'The return of your delivery has been approved.'],
    ['Devolución aprobada', 'Se ha aprobado la devolución de tu entrega.'],
    ['Retour approuvé', 'Le retour de votre livraison a été approuvé.'],
    ['Retou a apwouve', 'Yo apwouve retou livrezon ou an.'],
    ['تمت الموافقة على الإرجاع', 'تمت الموافقة على إرجاع طلب التوصيل الخاص بك.'],
  ],
  return_in_transit: [
    ['Return in transit', 'Your package is on its way back.'],
    ['Devolución en camino', 'Tu paquete está en camino de regreso.'],
    ['Retour en cours', 'Votre colis est en cours de retour.'],
    ['Retou a sou wout', 'Pakè ou a sou wout pou retounen.'],
    ['الإرجاع قيد النقل', 'الطرد الخاص بك في طريق العودة.'],
  ],
  return_cancelled: [
    ['Return cancelled', 'The return request for your delivery has been cancelled.'],
    ['Devolución cancelada', 'Se ha cancelado la solicitud de devolución de tu entrega.'],
    ['Retour annulé', 'La demande de retour de votre livraison a été annulée.'],
    ['Retou a anile', 'Yo anile demann retou livrezon ou an.'],
    ['تم إلغاء الإرجاع', 'تم إلغاء طلب الإرجاع للتوصيل الخاص بك.'],
  ],
  extra_requested: [
    ['Additional charge requested', 'Review an additional charge requested for your delivery.'],
    ['Cargo adicional solicitado', 'Revisa el cargo adicional solicitado para tu entrega.'],
    ['Supplément demandé', 'Vérifiez le supplément demandé pour votre livraison.'],
    ['Yo mande yon frè anplis', 'Revize frè anplis yo mande pou livrezon ou an.'],
    ['تم طلب رسوم إضافية', 'راجع الرسوم الإضافية المطلوبة للتوصيل الخاص بك.'],
  ],
  extra_approved: [
    ['Additional charge approved', 'An additional delivery charge has been approved.'],
    ['Cargo adicional aprobado', 'Se ha aprobado un cargo adicional de entrega.'],
    ['Supplément approuvé', 'Un supplément de livraison a été approuvé.'],
    ['Frè anplis la apwouve', 'Yo apwouve yon frè anplis pou livrezon an.'],
    ['تمت الموافقة على الرسوم الإضافية', 'تمت الموافقة على رسوم توصيل إضافية.'],
  ],
  extra_rejected: [
    ['Additional charge declined', 'An additional delivery charge has been declined.'],
    ['Cargo adicional rechazado', 'Se ha rechazado un cargo adicional de entrega.'],
    ['Supplément refusé', 'Un supplément de livraison a été refusé.'],
    ['Frè anplis la refize', 'Yo refize yon frè anplis pou livrezon an.'],
    ['تم رفض الرسوم الإضافية', 'تم رفض رسوم توصيل إضافية.'],
  ],
  extra_payment_started: [
    ['Delivery payment pending', 'Complete the payment for your approved additional charge.'],
    ['Pago de entrega pendiente', 'Completa el pago del cargo adicional aprobado.'],
    ['Paiement de livraison en attente', 'Effectuez le paiement du supplément approuvé.'],
    ['Peman livrezon an annatant', 'Fini peman frè anplis yo apwouve a.'],
    ['دفع التوصيل معلق', 'أكمل دفع الرسوم الإضافية المعتمدة.'],
  ],
  extra_payment_captured: [
    ['Delivery payment received', 'Payment for your additional delivery charge has been received.'],
    ['Pago de entrega recibido', 'Se ha recibido el pago del cargo adicional de entrega.'],
    ['Paiement de livraison reçu', 'Le paiement de votre supplément de livraison a été reçu.'],
    ['Nou resevwa peman livrezon an', 'Nou resevwa peman frè anplis livrezon ou an.'],
    ['تم استلام دفعة التوصيل', 'تم استلام دفعة الرسوم الإضافية للتوصيل.'],
  ],
  eta_updated: [
    ['Delivery arrival estimate updated', 'Open your delivery for the latest available arrival estimate.'],
    ['Estimación de llegada actualizada', 'Abre tu entrega para ver la última estimación de llegada disponible.'],
    ['Estimation d’arrivée mise à jour', 'Consultez votre livraison pour voir la dernière estimation d’arrivée disponible.'],
    ['Estimasyon lè arive a ajou', 'Louvri livrezon ou an pou wè dènye estimasyon lè arive ki disponib la.'],
    ['تم تحديث وقت الوصول المتوقع', 'افتح طلب التوصيل للاطلاع على أحدث وقت وصول متوقع متاح.'],
  ],
  approaching: [
    ['Delivery approaching', 'Your driver is approaching the delivery destination.'],
    ['La entrega se aproxima', 'Tu conductor se está acercando al destino de entrega.'],
    ['Livraison à proximité', 'Votre chauffeur approche du lieu de livraison.'],
    ['Livrezon an prèske rive', 'Chofè ou a ap pwoche bò kote livrezon an dwe fèt la.'],
    ['التوصيل يقترب', 'السائق يقترب من وجهة التوصيل.'],
  ],
};
copy.return_completed = copy.returned;

const DELIVERY_NOTIFICATION_EVENTS = Object.freeze(Object.keys(copy).map((name) => 'delivery_' + name));
const deliveryNotifications = {};
for (const [name, translations] of Object.entries(copy)) {
  deliveryNotifications['delivery:delivery_' + name] = {
    title: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][0]])),
    body: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][1]])),
  };
}
// Older callers may still use the internal assignment event key.
deliveryNotifications['delivery:delivery_coordinated'] = deliveryNotifications['delivery:delivery_assigned'];

module.exports = { DELIVERY_NOTIFICATION_EVENTS, deliveryNotifications };
