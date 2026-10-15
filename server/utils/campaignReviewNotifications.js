'use strict';

// Campaign review decision notifications (logistics pooled orders).
// This catalog is consumed by notificationService through tNotif, so email,
// in-app and push all use the recipient's preferred language.
// The campaign title and reviewer note are appended by the caller as
// user-generated content (quoted), so the static copy below stays fully
// localized with no interpolation.
// Machine-assisted translations; not professionally reviewed.

const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th'];

const copy = {
  logistics_campaign_approved: [
    ['Campaign approved', 'Operations approved your campaign. It is now published and buyers can pledge.'],
    ['Campaña aprobada', 'Operaciones aprobó tu campaña. Ya está publicada y los compradores pueden participar.'],
    ['Campagne approuvée', 'Les opérations ont approuvé votre campagne. Elle est maintenant publiée et les acheteurs peuvent participer.'],
    ['Kanpay apwouve', 'Operasyon apwouve kanpay ou a. Li pibliye kounye a epi achtè yo ka patisipe.'],
    ['تمت الموافقة على الحملة', 'وافقت العمليات على حملتك. تم نشرها الآن ويمكن للمشترين المشاركة.'],
    ['活动已获批准', '运营团队已批准您的活动。该活动现已发布，买家可以参与认购。'],
    ['캠페인 승인됨', '운영팀이 캠페인을 승인했습니다. 이제 게시되었으며 구매자가 참여할 수 있습니다.'],
    ['Kampeni imeidhinishwa', 'Uendeshaji umeidhinisha kampeni yako. Sasa imechapishwa na wanunuzi wanaweza kushiriki.'],
    ['Campanha aprovada', 'A equipe de operações aprovou sua campanha. Ela já está publicada e os compradores podem participar.'],
    ['अभियान स्वीकृत', 'संचालन टीम ने आपके अभियान को स्वीकृत कर दिया है। यह अब प्रकाशित है और खरीदार भाग ले सकते हैं।'],
    ['Chiến dịch đã được phê duyệt', 'Bộ phận vận hành đã phê duyệt chiến dịch của bạn. Chiến dịch đã được đăng và người mua có thể tham gia.'],
    ['Кампания одобрена', 'Операционная команда одобрила вашу кампанию. Она опубликована, и покупатели могут участвовать.'],
    ['キャンペーンが承認されました', '運営チームがキャンペーンを承認しました。公開され、購入者が参加できるようになりました。'],
    ['Kampagne genehmigt', 'Das Operations-Team hat Ihre Kampagne genehmigt. Sie ist jetzt veröffentlicht und Käufer können teilnehmen.'],
    ['Kampanye disetujui', 'Tim operasional telah menyetujui kampanye Anda. Kampanye kini dipublikasikan dan pembeli dapat bergabung.'],
    ['مہم منظور ہو گئی', 'آپریشنز ٹیم نے آپ کی مہم منظور کر لی ہے۔ یہ اب شائع ہو گئی ہے اور خریدار حصہ لے سکتے ہیں۔'],
    ['প্রচারণা অনুমোদিত', 'অপারেশনস টিম আপনার প্রচারণা অনুমোদন করেছে। এটি এখন প্রকাশিত এবং ক্রেতারা যোগ দিতে পারবেন।'],
    ['Campagna approvata', 'Il team operativo ha approvato la tua campagna. Ora è pubblicata e gli acquirenti possono partecipare.'],
    ['Kampanya onaylandı', 'Operasyon ekibi kampanyanızı onayladı. Artık yayında ve alıcılar katılabilir.'],
    ['แคมเปญได้รับการอนุมัติแล้ว', 'ทีมปฏิบัติการอนุมัติแคมเปญของคุณแล้ว ขณะนี้เผยแพร่แล้วและผู้ซื้อสามารถเข้าร่วมได้'],
  ],
  logistics_campaign_revisions_requested: [
    ['Revisions requested', 'Operations reviewed your campaign and requested changes before it can be published.'],
    ['Revisiones solicitadas', 'Operaciones revisó tu campaña y solicitó cambios antes de poder publicarla.'],
    ['Révisions demandées', 'Les opérations ont examiné votre campagne et demandé des modifications avant sa publication.'],
    ['Yo mande revizyon', 'Operasyon revize kanpay ou a epi mande chanjman anvan yo ka pibliye li.'],
    ['تم طلب مراجعات', 'راجعت العمليات حملتك وطلبت تغييرات قبل نشرها.'],
    ['已请求修改', '运营团队已审核您的活动，并要求在发布前进行修改。'],
    ['수정 요청됨', '운영팀이 캠페인을 검토하고 게시 전에 변경을 요청했습니다.'],
    ['Marekebisho yameombwa', 'Uendeshaji umekagua kampeni yako na kuomba mabadiliko kabla haijachapishwa.'],
    ['Revisões solicitadas', 'A equipe de operações revisou sua campanha e solicitou alterações antes da publicação.'],
    ['संशोधन का अनुरोध किया गया', 'संचालन टीम ने आपके अभियान की समीक्षा की और प्रकाशन से पहले बदलावों का अनुरोध किया है।'],
    ['Đã yêu cầu chỉnh sửa', 'Bộ phận vận hành đã xem xét chiến dịch của bạn và yêu cầu thay đổi trước khi đăng.'],
    ['Запрошены доработки', 'Операционная команда проверила вашу кампанию и запросила изменения перед публикацией.'],
    ['修正がリクエストされました', '運営チームがキャンペーンを確認し、公開前に変更をリクエストしました。'],
    ['Überarbeitungen angefordert', 'Das Operations-Team hat Ihre Kampagne geprüft und vor der Veröffentlichung Änderungen angefordert.'],
    ['Revisi diminta', 'Tim operasional telah meninjau kampanye Anda dan meminta perubahan sebelum dipublikasikan.'],
    ['ترامیم کی درخواست کی گئی', 'آپریشنز ٹیم نے آپ کی مہم کا جائزہ لیا ہے اور اشاعت سے پہلے تبدیلیوں کی درخواست کی ہے۔'],
    ['সংশোধনের অনুরোধ করা হয়েছে', 'অপারেশনস টিম আপনার প্রচারণা পর্যালোচনা করেছে এবং প্রকাশের আগে পরিবর্তনের অনুরোধ করেছে।'],
    ['Revisioni richieste', 'Il team operativo ha esaminato la tua campagna e ha richiesto modifiche prima della pubblicazione.'],
    ['Revizyon istendi', 'Operasyon ekibi kampanyanızı inceledi ve yayınlanmadan önce değişiklik istedi.'],
    ['มีการขอให้แก้ไข', 'ทีมปฏิบัติการตรวจสอบแคมเปญของคุณแล้วและขอให้แก้ไขก่อนเผยแพร่'],
  ],
  logistics_campaign_rejected: [
    ['Campaign rejected', 'Operations rejected your campaign. Read the review note, update your draft, and resubmit when ready.'],
    ['Campaña rechazada', 'Operaciones rechazó tu campaña. Lee la nota de revisión, actualiza tu borrador y vuelve a enviarla cuando esté lista.'],
    ['Campagne rejetée', 'Les opérations ont rejeté votre campagne. Lisez la note d’examen, mettez à jour votre brouillon et soumettez-le à nouveau quand il est prêt.'],
    ['Kanpay rejte', 'Operasyon rejte kanpay ou a. Li nòt revizyon an, mete bouyon ou a ajou, epi soumèt li ankò lè li pare.'],
    ['تم رفض الحملة', 'رفضت العمليات حملتك. اقرأ ملاحظة المراجعة، وحدّث مسودتك، وأعد إرسالها عندما تكون جاهزة.'],
    ['活动已被拒绝', '运营团队已拒绝您的活动。请阅读审核备注，更新草稿，准备就绪后重新提交。'],
    ['캠페인 거부됨', '운영팀이 캠페인을 거부했습니다. 검토 메모를 읽고 초안을 업데이트한 뒤 준비되면 다시 제출하세요.'],
    ['Kampeni imekataliwa', 'Uendeshaji umekataa kampeni yako. Soma maelezo ya ukaguzi, sasisha rasimu yako, na uitume tena inapokuwa tayari.'],
    ['Campanha rejeitada', 'A equipe de operações rejeitou sua campanha. Leia a nota de revisão, atualize seu rascunho e envie novamente quando estiver pronto.'],
    ['अभियान अस्वीकृत', 'संचालन टीम ने आपके अभियान को अस्वीकार कर दिया है। समीक्षा नोट पढ़ें, अपना ड्राफ्ट अपडेट करें और तैयार होने पर फिर से जमा करें।'],
    ['Chiến dịch bị từ chối', 'Bộ phận vận hành đã từ chối chiến dịch của bạn. Đọc ghi chú đánh giá, cập nhật bản nháp và gửi lại khi sẵn sàng.'],
    ['Кампания отклонена', 'Операционная команда отклонила вашу кампанию. Прочитайте замечание, обновите черновик и отправьте повторно, когда будете готовы.'],
    ['キャンペーンが却下されました', '運営チームがキャンペーンを却下しました。レビューメモを読み、ドラフトを更新して、準備ができたら再提出してください。'],
    ['Kampagne abgelehnt', 'Das Operations-Team hat Ihre Kampagne abgelehnt. Lesen Sie die Prüfnotiz, aktualisieren Sie Ihren Entwurf und reichen Sie ihn erneut ein, wenn er bereit ist.'],
    ['Kampanye ditolak', 'Tim operasional telah menolak kampanye Anda. Baca catatan peninjauan, perbarui draf Anda, dan kirim ulang saat sudah siap.'],
    ['مہم مسترد کر دی گئی', 'آپریشنز ٹیم نے آپ کی مہم مسترد کر دی ہے۔ جائزہ نوٹ پڑھیں، اپنا مسودہ اپ ڈیٹ کریں، اور تیار ہونے پر دوبارہ جمع کروائیں۔'],
    ['প্রচারণা প্রত্যাখ্যান করা হয়েছে', 'অপারেশনস টিম আপনার প্রচারণা প্রত্যাখ্যান করেছে। পর্যালোচনা নোট পড়ুন, আপনার খসড়া আপডেট করুন এবং প্রস্তুত হলে আবার জমা দিন।'],
    ['Campagna rifiutata', 'Il team operativo ha rifiutato la tua campagna. Leggi la nota di revisione, aggiorna la bozza e inviala di nuovo quando è pronta.'],
    ['Kampanya reddedildi', 'Operasyon ekibi kampanyanızı reddetti. İnceleme notunu okuyun, taslağınızı güncelleyin ve hazır olduğunda yeniden gönderin.'],
    ['แคมเปญถูกปฏิเสธ', 'ทีมปฏิบัติการปฏิเสธแคมเปญของคุณ โปรดอ่านบันทึกการตรวจสอบ อัปเดตร่างของคุณ และส่งอีกครั้งเมื่อพร้อม'],
  ],
};

const campaignReviewNotifications = {};
for (const [name, translations] of Object.entries(copy)) {
  campaignReviewNotifications[name] = {
    title: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][0]])),
    body: Object.fromEntries(LANGUAGES.map((lang, index) => [lang, translations[index][1]])),
  };
}

module.exports = { campaignReviewNotifications };
