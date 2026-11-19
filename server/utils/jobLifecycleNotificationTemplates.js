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
  // PR #804 G-15/G-16: arrival, no-show, and rework notices.
  job_arrived: {
    title: t('Your helper has arrived',
      'Tu ayudante llegó',
      'Votre prestataire est arrivé',
      'Èd ou a rive',
      'وصل المساعد الخاص بك'),
    body: t('Your helper has arrived on site. Open the job to follow the visit.',
      'Tu ayudante llegó al lugar. Abre el trabajo para seguir la visita.',
      'Votre prestataire est arrivé sur place. Ouvrez le travail pour suivre la visite.',
      'Èd ou a rive sou plas la. Louvri travay la pou swiv vizit la.',
      'وصل المساعد إلى الموقع. افتح العمل لمتابعة الزيارة.'),
  },
  job_no_show: {
    title: t('No-show recorded for your job',
      'Se registró una ausencia en tu trabajo',
      'Absence enregistrée pour votre travail',
      'Yo anrejistre yon absans pou travay ou',
      'تم تسجيل عدم الحضور لعملك'),
    body: t('One party did not show up for the job. Open the job to rebook or follow up.',
      'Una de las partes no se presentó al trabajo. Abre el trabajo para volver a reservar o dar seguimiento.',
      'Une partie ne s\'est pas présentée pour le travail. Ouvrez le travail pour réserver à nouveau ou faire un suivi.',
      'Yon pati pa t parèt pou travay la. Louvri travay la pou re-rezève oswa swiv.',
      'لم يحضر أحد الطرفين للعمل. افتح العمل لإعادة الحجز أو المتابعة.'),
  },
  job_changes_requested: {
    title: t('Customer asked for changes',
      'El cliente pidió cambios',
      'Le client a demandé des modifications',
      'Kliyan an te mande chanjman',
      'طلب العميل إجراء تغييرات'),
    body: t('The customer asked for changes instead of confirming completion. Open the job to see what needs fixing.',
      'El cliente pidió cambios en lugar de confirmar la finalización. Abre el trabajo para ver qué hay que corregir.',
      'Le client a demandé des modifications au lieu de confirmer l\'achèvement. Ouvrez le travail pour voir ce qui doit être corrigé.',
      'Kliyan an te mande chanjman olye li konfime travay la fini. Louvri travay la pou wè sa ki bezwen repare.',
      'طلب العميل إجراء تغييرات بدلًا من تأكيد الاكتمال. افتح العمل لمعرفة ما يحتاج إلى إصلاح.'),
  },
};

module.exports = { jobLifecycleNotifications };
