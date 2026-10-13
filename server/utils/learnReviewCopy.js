'use strict';
const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });
const videoModerated = t(
  'This video was removed by moderation and cannot be submitted to this guide.',
  'Este vídeo fue retirado por moderación y no se puede enviar a esta guía.',
  'Cette vidéo a été retirée par la modération et ne peut pas être proposée pour ce guide.',
  'Moderasyon retire videyo sa a. Ou pa ka soumèt li pou gid sa a.',
  'أزيل هذا الفيديو بقرار من الإشراف ولا يمكن تقديمه لهذا الدليل.');
const moderationActionFailed = t(
  'Could not save the moderation decision. Please try again.',
  'No se pudo guardar la decisión de moderación. Inténtalo de nuevo.',
  'Impossible d’enregistrer la décision de modération. Réessayez.',
  'Nou pa t ka anrejistre desizyon moderasyon an. Tanpri eseye ankò.',
  'تعذّر حفظ قرار الإشراف. حاول مرة أخرى.');
const flagNotFound = t("Video flag not found.","No se encontró el reporte del vídeo.","Signalement de vidéo introuvable.","Nou pa jwenn rapò videyo a.","لم يُعثر على بلاغ الفيديو.");
const flagAlreadyDecided = t("This video flag was already reviewed.","Este reporte del vídeo ya se revisó.","Ce signalement de vidéo a déjà été examiné.","Yo deja revize rapò videyo sa a.","تمت مراجعة بلاغ الفيديو هذا مسبقًا.");
const guideNotFound = t("Guide not found.","No se encontró la guía.","Guide introuvable.","Nou pa jwenn gid la.","لم يُعثر على الدليل.");
const videoDuplicate = t("This video is already on this guide.","Este vídeo ya está en esta guía.","Cette vidéo figure déjà dans ce guide.","Videyo sa a deja nan gid sa a.","هذا الفيديو موجود بالفعل في هذا الدليل.");
exports.moderationLabels = Object.fromEntries(['en','es','fr','ht','ar'].map(lang => [lang, {
  flagNotFound: flagNotFound[lang], flagAlreadyDecided: flagAlreadyDecided[lang], guideNotFound: guideNotFound[lang], videoDuplicate: videoDuplicate[lang], videoModerated: videoModerated[lang], moderationActionFailed: moderationActionFailed[lang],
}]));
exports.learnReviewNotifications = {
  learn_video_review_received: {
    title: t('Learn video submitted for review', 'Vídeo de Learn enviado para revisión', 'Vidéo Learn proposée à la modération', 'Videyo Learn soumèt pou revizyon', 'تم تقديم فيديو Learn للمراجعة'),
    body: t('A video was submitted to a guide. Open the review queue before its 24-hour publication window.',
      'Se ha enviado un vídeo a una guía. Abre la cola de revisión antes de su plazo de publicación de 24 horas.',
      'Une vidéo a été proposée pour un guide. Consultez la file de modération avant le délai de publication de 24 heures.',
      'Yo soumèt yon videyo pou yon gid. Louvri lis revizyon an anvan delè piblikasyon 24 èdtan an.',
      'تم تقديم فيديو لدليل. افتح قائمة المراجعة قبل موعد نشره بعد 24 ساعة.'),
  },
  learn_video_review_overdue: {
    title: t('Learn video review window reached', 'Plazo de revisión de vídeo de Learn alcanzado', 'Délai de modération d’une vidéo Learn atteint', 'Delè revizyon videyo Learn rive', 'انقضت مهلة مراجعة فيديو Learn'),
    body: t('A submission reached its 24-hour review window. Check the review queue and publication status.',
      'Un envío alcanzó su plazo de revisión de 24 horas. Comprueba la cola de revisión y el estado de publicación.',
      'Une proposition a atteint son délai de modération de 24 heures. Vérifiez la file et son statut de publication.',
      'Yon soumisyon rive nan delè revizyon 24 èdtan li a. Tcheke lis revizyon an ak estati piblikasyon an.',
      'بلغ تقديم الفيديو مهلة المراجعة البالغة 24 ساعة. تحقّق من قائمة المراجعة وحالة النشر.'),
  },
};
