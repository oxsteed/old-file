'use strict';

// Review W3 (P1-131, P1-132, P2-478): job lifecycle notification copy in the
// five supported languages. Spread into the i18n catalog (utils/i18n.js).
const t = (en, es, fr, ht, ar) => ({ en, es, fr, ht, ar });

const jobLifecycleNotifications = {
  job_completion_requested: {
    title: t('Your helper marked the job done',
      'Tu ayudante marcó el trabajo como terminado',
      'Votre prestataire a marqué le travail comme terminé',
      'Èd ou a make travay la fini',
      'حدد المساعد أن العمل قد اكتمل'),
    body: t('Confirm "%{title}" is complete, or open a dispute. Payment is released automatically after %{hours} hours.',
      'Confirma que "%{title}" está completo o abre una disputa. El pago se libera automáticamente después de %{hours} horas.',
      'Confirmez que « %{title} » est terminé ou ouvrez un litige. Le paiement est libéré automatiquement après %{hours} heures.',
      'Konfime "%{title}" fini, oswa louvri yon diskisyon. Peman an ap lage otomatikman apre %{hours} èdtan.',
      'أكّد اكتمال "%{title}" أو افتح نزاعًا. يُحرَّر الدفع تلقائيًا بعد %{hours} ساعة.'),
  },
  job_auto_cancel_warning: {
    title: t('Job will auto-cancel soon',
      'El trabajo se cancelará pronto',
      'Le travail sera bientôt annulé',
      'Travay la pral anile byento',
      'سيتم إلغاء العمل قريبًا'),
    body: t('"%{title}" has not started. It will be cancelled automatically in %{days} day(s) unless work begins.',
      '"%{title}" no ha comenzado. Se cancelará automáticamente en %{days} día(s) si no comienza el trabajo.',
      '« %{title} » n\'a pas commencé. Il sera annulé automatiquement dans %{days} jour(s) si le travail ne commence pas.',
      '"%{title}" poko kòmanse. Li pral anile otomatikman nan %{days} jou si travay la pa kòmanse.',
      'لم يبدأ "%{title}" بعد. سيُلغى تلقائيًا خلال %{days} يوم ما لم يبدأ العمل.'),
  },
  job_auto_cancelled: {
    title: t('Job auto-cancelled',
      'Trabajo cancelado automáticamente',
      'Travail annulé automatiquement',
      'Travay anile otomatikman',
      'تم إلغاء العمل تلقائيًا'),
    body: t('"%{title}" was cancelled because work did not start within %{days} days of acceptance. No fee was charged.',
      '"%{title}" se canceló porque el trabajo no comenzó dentro de %{days} días después de la aceptación. No se cobró ninguna tarifa.',
      '« %{title} » a été annulé car le travail n\'a pas commencé dans les %{days} jours suivant l\'acceptation. Aucuns frais n\'ont été facturés.',
      '"%{title}" anile paske travay la pa t kòmanse nan %{days} jou apre akseptasyon. Pa gen frè ki te chaje.',
      'أُلغي "%{title}" لأن العمل لم يبدأ خلال %{days} أيام من القبول. لم تُفرض أي رسوم.'),
  },
};

module.exports = { jobLifecycleNotifications };
