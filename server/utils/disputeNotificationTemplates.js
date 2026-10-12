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
};
