'use strict';

const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

exports.reviewW11Notifications = {
  warranty_claim_filed: {
    title: t('New warranty claim', 'Nueva reclamación de garantía', 'Nouvelle réclamation de garantie', 'Nouvo reklamasyon garanti', 'مطالبة ضمان جديدة'),
    body: t('The other party filed a warranty claim. Open your agreement to review and respond.',
      'La otra parte presentó una reclamación de garantía. Abre tu acuerdo para revisarla y responder.',
      'L’autre partie a déposé une réclamation de garantie. Ouvrez votre accord pour la consulter et répondre.',
      'Lòt pati a depoze yon reklamasyon garanti. Louvri akò ou pou revize l epi reponn.',
      'قدّم الطرف الآخر مطالبة ضمان. افتح اتفاقيتك لمراجعتها والرد عليها.'),
  },
  warranty_claim_updated: {
    title: t('Warranty claim updated', 'Reclamación de garantía actualizada', 'Réclamation de garantie mise à jour', 'Reklamasyon garanti mete ajou', 'تم تحديث مطالبة الضمان'),
    body: t('The other party updated a warranty claim. Open your agreement to view its status and response.',
      'La otra parte actualizó una reclamación de garantía. Abre tu acuerdo para ver su estado y la respuesta.',
      'L’autre partie a mis à jour une réclamation de garantie. Ouvrez votre accord pour consulter son statut et la réponse.',
      'Lòt pati a mete yon reklamasyon garanti ajou. Louvri akò ou pou wè estati a ak repons lan.',
      'حدّث الطرف الآخر مطالبة ضمان. افتح اتفاقيتك لعرض حالتها والرد.'),
  },
  job_started: {
    title: t('Job started', 'Trabajo iniciado', 'Travail commencé', 'Travay la kòmanse', 'بدأ العمل'),
    body: t('Your job is now in progress. Open it to view the details and contact the other participant.',
      'Tu trabajo está en curso. Ábrelo para ver los detalles y contactar con la otra persona.',
      'Votre travail est en cours. Ouvrez-le pour consulter les détails et contacter l’autre participant.',
      'Travay ou ap fèt kounye a. Louvri l pou wè detay yo epi kontakte lòt patisipan an.',
      'عملك قيد التنفيذ الآن. افتحه لعرض التفاصيل والتواصل مع المشارك الآخر.'),
  },
};
