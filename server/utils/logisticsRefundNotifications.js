'use strict';

/**
 * OxSteed Logistics — refund notification catalog (Phase 3).
 *
 * Buyer notifications for the dual-admin refund flow. This catalog is a pure
 * data module consumed by server/utils/i18n.js through tNotif, so email,
 * in-app and push all use the recipient's preferred language.
 *
 * Machine translations for all 20 supported languages; never describe them
 * as professionally reviewed. Amounts are appended at send time.
 */

const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];

const copy = {
  proposed: [
    ['Refund requested', 'Our team received a refund request for your logistics payment. It is now under review.'],
    ['Reembolso solicitado', 'Nuestro equipo recibió una solicitud de reembolso para tu pago de logística. Está en revisión.'],
    ['Remboursement demandé', 'Notre équipe a reçu une demande de remboursement pour votre paiement logistique. Elle est en cours d’examen.'],
    ['Yo mande ranbousman', 'Ekip nou an resevwa yon demann ranbousman pou peman lojistik ou a. Li an revizyon kounye a.'],
    ['تم طلب استرداد', 'تلقى فريقنا طلب استرداد لمدفوعاتك اللوجستية. وهو قيد المراجعة الآن.'],
    ['已申请退款', '我们的团队已收到您的物流付款退款申请，目前正在审核中。'],
    ['환불 요청 접수', '물류 결제 환불 요청이 접수되어 현재 검토 중입니다.'],
    ['Ombi la kurejeshewa limetumwa', 'Timu yetu imepokea ombi la kurejeshewa kwa malipo yako ya vifaa. Linaangaliwa sasa.'],
    ['Reembolso solicitado', 'Nossa equipe recebeu um pedido de reembolso do seu pagamento de logística. Está em análise.'],
    ['रिफंड का अनुरोध किया गया', 'हमारी टीम को आपके लॉजिस्टिक्स भुगतान के लिए रिफंड अनुरोध प्राप्त हुआ है। यह समीक्षा में है।'],
    ['Đã yêu cầu hoàn tiền', 'Đội ngũ của chúng tôi đã nhận được yêu cầu hoàn tiền cho khoản thanh toán logistics của bạn. Yêu cầu đang được xem xét.'],
    ['Запрошен возврат', 'Наша команда получила запрос на возврат вашего платежа за логистику. Он на рассмотрении.'],
    ['返金がリクエストされました', '物流のお支払いに対する返金リクエストを受け付けました。現在審査中です。'],
    ['Rückerstattung angefordert', 'Unser Team hat eine Rückerstattungsanfrage für Ihre Logistikzahlung erhalten. Sie wird geprüft.'],
    ['Pengembalian dana diminta', 'Tim kami menerima permintaan pengembalian dana untuk pembayaran logistik Anda. Saat ini sedang ditinjau.'],
    ['رقم کی واپسی کی درخواست کی گئی', 'ہماری ٹیم کو آپ کی لاجسٹکس ادائیگی کے لیے رقم کی واپسی کی درخواست موصول ہوئی ہے۔ اس کا جائزہ لیا جا رہا ہے۔'],
    ['ফেরতের অনুরোধ করা হয়েছে', 'আমাদের টিম আপনার লজিস্টিক পেমেন্টের জন্য ফেরতের অনুরোধ পেয়েছে। এটি পর্যালোচনাধীন।'],
    ['Rimborso richiesto', 'Il nostro team ha ricevuto una richiesta di rimborso per il tuo pagamento logistico. È in revisione.'],
    ['İade talebi alındı', 'Ekibimiz lojistik ödemeniz için bir iade talebi aldı. Şu anda inceleniyor.'],
    ['ขอคืนเงินแล้ว', 'ทีมของเราได้รับคำขอคืนเงินสำหรับการชำระเงินโลจิสติกส์ของคุณแล้ว กำลังอยู่ระหว่างการตรวจสอบ'],
  ],
  approved: [
    ['Refund approved', 'Your logistics refund was approved by our team and will be processed shortly.'],
    ['Reembolso aprobado', 'Tu reembolso de logística fue aprobado por nuestro equipo y se procesará pronto.'],
    ['Remboursement approuvé', 'Votre remboursement logistique a été approuvé par notre équipe et sera traité sous peu.'],
    ['Ranbousman apwouve', 'Ekip nou an apwouve ranbousman lojistik ou a epi l ap trete talè.'],
    ['تمت الموافقة على الاسترداد', 'وافق فريقنا على استرداد مدفوعاتك اللوجستية وسيتم معالجته قريبًا.'],
    ['退款已批准', '我们的团队已批准您的物流退款，将尽快处理。'],
    ['환불 승인됨', '물류 환불이 팀에서 승인되었으며 곧 처리됩니다.'],
    ['Kurejeshewa kumekubaliwa', 'Timu yetu imekubali kurejeshewa kwako kwa vifaa na kitachakatwa hivi karibuni.'],
    ['Reembolso aprovado', 'Nossa equipe aprovou seu reembolso de logística e ele será processado em breve.'],
    ['रिफंड स्वीकृत', 'हमारी टीम ने आपके लॉजिस्टिक्स रिफंड को स्वीकृत कर दिया है और इसे जल्द ही संसाधित किया जाएगा।'],
    ['Hoàn tiền đã được phê duyệt', 'Đội ngũ của chúng tôi đã phê duyệt khoản hoàn tiền logistics của bạn và sẽ xử lý trong thời gian ngắn.'],
    ['Возврат одобрен', 'Наша команда одобрила ваш возврат за логистику, он будет обработан в ближайшее время.'],
    ['返金が承認されました', '物流の返金がチームにより承認され、まもなく処理されます。'],
    ['Rückerstattung genehmigt', 'Unser Team hat Ihre Logistik-Rückerstattung genehmigt. Sie wird in Kürze bearbeitet.'],
    ['Pengembalian dana disetujui', 'Tim kami telah menyetujui pengembalian dana logistik Anda dan akan segera diproses.'],
    ['رقم کی واپسی منظور ہو گئی', 'ہماری ٹیم نے آپ کی لاجسٹکس رقم کی واپسی منظور کر لی ہے اور اس پر جلد کارروائی کی جائے گی۔'],
    ['ফেরত অনুমোদিত হয়েছে', 'আমাদের টিম আপনার লজিস্টিক ফেরত অনুমোদন করেছে এবং এটি শীঘ্রই প্রক্রিয়া করা হবে।'],
    ['Rimborso approvato', 'Il nostro team ha approvato il tuo rimborso logistico, che verrà elaborato a breve.'],
    ['İade onaylandı', 'Ekibimiz lojistik iadenizi onayladı ve kısa süre içinde işleme alınacak.'],
    ['อนุมัติการคืนเงินแล้ว', 'ทีมของเราอนุมัติการคืนเงินโลจิสติกส์ของคุณแล้ว และจะดำเนินการในเร็วๆ นี้'],
  ],
  rejected: [
    ['Refund request declined', 'Your logistics refund request was reviewed and declined. Contact support if you have questions.'],
    ['Solicitud de reembolso rechazada', 'Tu solicitud de reembolso de logística fue revisada y rechazada. Contacta con soporte si tienes preguntas.'],
    ['Demande de remboursement refusée', 'Votre demande de remboursement logistique a été examinée et refusée. Contactez l’assistance si vous avez des questions.'],
    ['Demann ranbousman refize', 'Yo revize demann ranbousman lojistik ou a epi yo refize l. Kontakte sipò si ou gen kesyon.'],
    ['تم رفض طلب الاسترداد', 'تمت مراجعة طلب استرداد مدفوعاتك اللوجستية ورفضه. تواصل مع الدعم إذا كانت لديك أسئلة.'],
    ['退款申请被拒绝', '您的物流退款申请已审核并被拒绝。如有疑问，请联系客服。'],
    ['환불 요청 거절됨', '물류 환불 요청이 검토 후 거절되었습니다. 문의 사항이 있으면 지원팀에 연락하세요.'],
    ['Ombi la kurejeshewa limekataliwa', 'Ombi lako la kurejeshewa kwa vifaa limeangaliwa na kukataliwa. Wasiliana na usaidizi ukiwa na maswali.'],
    ['Pedido de reembolso recusado', 'Seu pedido de reembolso de logística foi analisado e recusado. Fale com o suporte se tiver dúvidas.'],
    ['रिफंड अनुरोध अस्वीकृत', 'आपके लॉजिस्टिक्स रिफंड अनुरोध की समीक्षा की गई और उसे अस्वीकार कर दिया गया। प्रश्न हों तो सहायता से संपर्क करें।'],
    ['Yêu cầu hoàn tiền bị từ chối', 'Yêu cầu hoàn tiền logistics của bạn đã được xem xét và bị từ chối. Liên hệ bộ phận hỗ trợ nếu bạn có thắc mắc.'],
    ['Запрос на возврат отклонён', 'Ваш запрос на возврат за логистику рассмотрен и отклонён. Обратитесь в поддержку при вопросах.'],
    ['返金リクエストが却下されました', '物流の返金リクエストは審査の結果、却下されました。ご質問はサポートまでお問い合わせください。'],
    ['Rückerstattungsanfrage abgelehnt', 'Ihre Logistik-Rückerstattungsanfrage wurde geprüft und abgelehnt. Bei Fragen wenden Sie sich an den Support.'],
    ['Permintaan pengembalian dana ditolak', 'Permintaan pengembalian dana logistik Anda telah ditinjau dan ditolak. Hubungi dukungan jika ada pertanyaan.'],
    ['رقم کی واپسی کی درخواست مسترد', 'آپ کی لاجسٹکس رقم کی واپسی کی درخواست کا جائزہ لیا گیا اور اسے مسترد کر دیا گیا۔ سوالات ہوں تو سپورٹ سے رابطہ کریں۔'],
    ['ফেরতের অনুরোধ প্রত্যাখ্যান করা হয়েছে', 'আপনার লজিস্টিক ফেরতের অনুরোধ পর্যালোচনা করে প্রত্যাখ্যান করা হয়েছে। প্রশ্ন থাকলে সহায়তার সাথে যোগাযোগ করুন।'],
    ['Richiesta di rimborso rifiutata', 'La tua richiesta di rimborso logistico è stata esaminata e rifiutata. Contatta l’assistenza per domande.'],
    ['İade talebi reddedildi', 'Lojistik iade talebiniz incelendi ve reddedildi. Sorularınız için destek ile iletişime geçin.'],
    ['คำขอคืนเงินถูกปฏิเสธ', 'คำขอคืนเงินโลจิสติกส์ของคุณได้รับการตรวจสอบและถูกปฏิเสธแล้ว โปรดติดต่อฝ่ายสนับสนุนหากมีคำถาม'],
  ],
  processed: [
    ['Refund processed', 'Your logistics refund has been sent back to your original payment method.'],
    ['Reembolso procesado', 'Tu reembolso de logística se ha enviado a tu método de pago original.'],
    ['Remboursement traité', 'Votre remboursement logistique a été renvoyé vers votre moyen de paiement d’origine.'],
    ['Ranbousman trete', 'Yo voye ranbousman lojistik ou a tounen sou mwayen peman orijinal ou a.'],
    ['تمت معالجة الاسترداد', 'تم إرسال استرداد مدفوعاتك اللوجستية إلى طريقة الدفع الأصلية الخاصة بك.'],
    ['退款已处理', '您的物流退款已退回至原支付方式。'],
    ['환불 처리 완료', '물류 환불이 원래 결제 수단으로 반환되었습니다.'],
    ['Kurejeshewa kumeshughulikiwa', 'Kurejeshewa kwako kwa vifaa kumetumwa kwenye njia yako ya awali ya malipo.'],
    ['Reembolso processado', 'Seu reembolso de logística foi devolvido ao seu método de pagamento original.'],
    ['रिफंड संसाधित', 'आपका लॉजिस्टिक्स रिफंड आपके मूल भुगतान विधि पर वापस भेज दिया गया है।'],
    ['Hoàn tiền đã được xử lý', 'Khoản hoàn tiền logistics của bạn đã được gửi lại về phương thức thanh toán ban đầu.'],
    ['Возврат обработан', 'Ваш возврат за логистику отправлен на исходный способ оплаты.'],
    ['返金が処理されました', '物流の返金が元の支払い方法に返金されました。'],
    ['Rückerstattung verarbeitet', 'Ihre Logistik-Rückerstattung wurde an Ihre ursprüngliche Zahlungsmethode zurückgesendet.'],
    ['Pengembalian dana diproses', 'Pengembalian dana logistik Anda telah dikirim kembali ke metode pembayaran awal Anda.'],
    ['رقم کی واپسی پر کارروائی ہو گئی', 'آپ کی لاجسٹکس رقم کی واپسی آپ کے اصل ادائیگی کے طریقے پر واپس بھیج دی گئی ہے۔'],
    ['ফেরত প্রক্রিয়া করা হয়েছে', 'আপনার লজিস্টিক ফেরত আপনার আসল পেমেন্ট পদ্ধতিতে ফেরত পাঠানো হয়েছে।'],
    ['Rimborso elaborato', 'Il tuo rimborso logistico è stato restituito al tuo metodo di pagamento originale.'],
    ['İade işlendi', 'Lojistik iadeniz orijinal ödeme yönteminize geri gönderildi.'],
    ['ดำเนินการคืนเงินแล้ว', 'การคืนเงินโลจิสติกส์ของคุณได้ถูกส่งกลับไปยังวิธีการชำระเงินเดิมของคุณแล้ว'],
  ],
  failed: [
    ['Refund could not be completed', 'We could not complete your logistics refund. Our team will reconcile it manually and update you.'],
    ['No se pudo completar el reembolso', 'No pudimos completar tu reembolso de logística. Nuestro equipo lo conciliará manualmente y te avisará.'],
    ['Remboursement impossible', 'Nous n’avons pas pu finaliser votre remboursement logistique. Notre équipe va le rapprocher manuellement et vous tiendra informé.'],
    ['Yo pa t ka fini ranbousman an', 'Nou pa t ka fini ranbousman lojistik ou a. Ekip nou an ap rekonsilye l manyèlman epi ap mete ou okouran.'],
    ['تعذر إتمام الاسترداد', 'تعذر علينا إتمام استرداد مدفوعاتك اللوجستية. سيقوم فريقنا بتسويته يدويًا وإبلاغك.'],
    ['退款未能完成', '我们未能完成您的物流退款。我们的团队将手动对账并通知您。'],
    ['환불을 완료할 수 없음', '물류 환불을 완료할 수 없었습니다. 팀에서 수동으로 정산하고 알려드리겠습니다.'],
    ['Kurejeshewa hakikuweza kukamilika', 'Hatukuweza kukamilisha kurejeshewa kwako kwa vifaa. Timu yetu italisawazisha mwenyewe na kukujulisha.'],
    ['Não foi possível concluir o reembolso', 'Não conseguimos concluir seu reembolso de logística. Nossa equipe fará a conciliação manual e avisará você.'],
    ['रिफंड पूरा नहीं हो सका', 'हम आपका लॉजिस्टिक्स रिफंड पूरा नहीं कर सके। हमारी टीम इसे मैन्युअल रूप से समेटेगी और आपको अपडेट करेगी।'],
    ['Không thể hoàn tất việc hoàn tiền', 'Chúng tôi không thể hoàn tất khoản hoàn tiền logistics của bạn. Đội ngũ của chúng tôi sẽ đối soát thủ công và cập nhật cho bạn.'],
    ['Возврат не удалось завершить', 'Нам не удалось завершить ваш возврат за логистику. Наша команда сверит его вручную и сообщит вам.'],
    ['返金を完了できませんでした', '物流の返金を完了できませんでした。チームが手動で照合し、ご連絡します。'],
    ['Rückerstattung konnte nicht abgeschlossen werden', 'Ihre Logistik-Rückerstattung konnte nicht abgeschlossen werden. Unser Team gleicht sie manuell ab und informiert Sie.'],
    ['Pengembalian dana tidak dapat diselesaikan', 'Kami tidak dapat menyelesaikan pengembalian dana logistik Anda. Tim kami akan merekonsiliasinya secara manual dan memberi kabar.'],
    ['رقم کی واپسی مکمل نہیں ہو سکی', 'ہم آپ کی لاجسٹکس رقم کی واپسی مکمل نہیں کر سکے۔ ہماری ٹیم اسے دستی طور پر ملائے گی اور آپ کو آگاہ کرے گی۔'],
    ['ফেরত সম্পন্ন করা যায়নি', 'আমরা আপনার লজিস্টিক ফেরত সম্পন্ন করতে পারিনি। আমাদের টিম এটি ম্যানুয়ালি মিলিয়ে নেবে এবং আপনাকে জানাবে।'],
    ['Impossibile completare il rimborso', 'Non siamo riusciti a completare il tuo rimborso logistico. Il nostro team lo riconcilierà manualmente e ti aggiornerà.'],
    ['İade tamamlanamadı', 'Lojistik iadenizi tamamlayamadık. Ekibimiz manuel olarak mutabakat yapacak ve sizi bilgilendirecek.'],
    ['ไม่สามารถดำเนินการคืนเงินให้เสร็จสมบูรณ์ได้', 'เราไม่สามารถดำเนินการคืนเงินโลจิสติกส์ของคุณให้เสร็จสมบูรณ์ได้ ทีมของเราจะปรับยอดด้วยตนเองและแจ้งให้คุณทราบ'],
  ],
  expired: [
    ['Refund request expired', 'Your logistics refund request expired before approval. Contact support to start a new request.'],
    ['La solicitud de reembolso venció', 'Tu solicitud de reembolso de logística venció antes de la aprobación. Contacta con soporte para iniciar una nueva.'],
    ['Demande de remboursement expirée', 'Votre demande de remboursement logistique a expiré avant approbation. Contactez l’assistance pour en créer une nouvelle.'],
    ['Demann ranbousman an ekspire', 'Demann ranbousman lojistik ou a ekspire anvan apwobasyon. Kontakte sipò pou kòmanse yon nouvo demann.'],
    ['انتهت صلاحية طلب الاسترداد', 'انتهت صلاحية طلب استرداد مدفوعاتك اللوجستية قبل الموافقة. تواصل مع الدعم لبدء طلب جديد.'],
    ['退款申请已过期', '您的物流退款申请在批准前已过期。请联系客服发起新的申请。'],
    ['환불 요청 만료됨', '물류 환불 요청이 승인 전에 만료되었습니다. 새 요청을 시작하려면 지원팀에 문의하세요.'],
    ['Ombi la kurejeshewa limeisha muda', 'Ombi lako la kurejeshewa kwa vifaa limeisha muda kabla ya kuidhinishwa. Wasiliana na usaidizi kuanzisha ombi jipya.'],
    ['Pedido de reembolso expirado', 'Seu pedido de reembolso de logística expirou antes da aprovação. Fale com o suporte para iniciar um novo.'],
    ['रिफंड अनुरोध समाप्त', 'आपका लॉजिस्टिक्स रिफंड अनुरोध स्वीकृति से पहले समाप्त हो गया। नया अनुरोध शुरू करने के लिए सहायता से संपर्क करें।'],
    ['Yêu cầu hoàn tiền đã hết hạn', 'Yêu cầu hoàn tiền logistics của bạn đã hết hạn trước khi được phê duyệt. Liên hệ bộ phận hỗ trợ để tạo yêu cầu mới.'],
    ['Срок запроса на возврат истёк', 'Срок вашего запроса на возврат за логистику истёк до одобрения. Обратитесь в поддержку, чтобы создать новый запрос.'],
    ['返金リクエストの期限が切れました', '物流の返金リクエストは承認前に期限切れとなりました。新しいリクエストはサポートまでご連絡ください。'],
    ['Rückerstattungsanfrage abgelaufen', 'Ihre Logistik-Rückerstattungsanfrage ist vor der Genehmigung abgelaufen. Wenden Sie sich an den Support, um eine neue zu stellen.'],
    ['Permintaan pengembalian dana kedaluwarsa', 'Permintaan pengembalian dana logistik Anda kedaluwarsa sebelum disetujui. Hubungi dukungan untuk membuat permintaan baru.'],
    ['رقم کی واپسی کی درخواست کی میعاد ختم', 'آپ کی لاجسٹکس رقم کی واپسی کی درخواست منظوری سے پہلے ختم ہو گئی۔ نئی درخواست کے لیے سپورٹ سے رابطہ کریں۔'],
    ['ফেরতের অনুরোধের মেয়াদ শেষ', 'অনুমোদনের আগেই আপনার লজিস্টিক ফেরতের অনুরোধের মেয়াদ শেষ হয়ে গেছে। নতুন অনুরোধের জন্য সহায়তার সাথে যোগাযোগ করুন।'],
    ['Richiesta di rimborso scaduta', 'La tua richiesta di rimborso logistico è scaduta prima dell’approvazione. Contatta l’assistenza per avviarne una nuova.'],
    ['İade talebinin süresi doldu', 'Lojistik iade talebiniz onaylanmadan süresi doldu. Yeni bir talep için destek ile iletişime geçin.'],
    ['คำขอคืนเงินหมดอายุ', 'คำขอคืนเงินโลจิสติกส์ของคุณหมดอายุก่อนการอนุมัติ โปรดติดต่อฝ่ายสนับสนุนเพื่อเริ่มคำขอใหม่'],
  ],
};

const refundNotifications = {};
for (const [name, translations] of Object.entries(copy)) {
  refundNotifications['logistics:refund_' + name] = {
    title: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][0]])),
    body: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][1]])),
  };
}

const REFUND_NOTIFICATION_EVENTS = Object.freeze(Object.keys(refundNotifications));

module.exports = { REFUND_NOTIFICATION_EVENTS, refundNotifications };
