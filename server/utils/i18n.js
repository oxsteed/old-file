const T = {
  ...require('./customer360NotificationCopy').customer360Notifications,
  ...require('./learnReviewCopy').learnReviewNotifications,
  ...require('./reviewW11NotificationTemplates').reviewW11Notifications,
  ...require('./reviewLifecycleNotificationTemplates').reviewLifecycleNotifications,
  ...require('./mediaCreatorNotifications').creatorNotifications,
  ...require('./disputeNotificationTemplates').disputeNotifications,
  // Analytics platform, Phase 2 Item 9: metric threshold alert titles.
  ...require('./metricAlertNotificationCopy').metricAlertNotifications,
  affiliate_payout_processed: {
    title: {
      en: 'Affiliate payout #{payoutId} processed',
      fr: 'Paiement d’affiliation nº {payoutId} traité',
      es: 'Pago de afiliado n.º {payoutId} procesado',
      ht: 'Peman afilye #{payoutId} trete',
      ar: 'تمت معالجة دفعة الشريك رقم {payoutId}',
    },
    body: {
      en: 'Your affiliate payout was processed and sent to your Stripe account. Open your affiliate dashboard to see the details.',
      fr: 'Votre paiement d’affiliation a été traité et envoyé sur votre compte Stripe. Ouvrez votre tableau de bord d’affiliation pour voir les détails.',
      es: 'Tu pago de afiliado se procesó y se envió a tu cuenta de Stripe. Abre tu panel de afiliado para ver los detalles.',
      ht: 'Peman afilye ou an trete epi yo voye l sou kont Stripe ou. Louvri tablodbò afilye ou pou wè detay yo.',
      ar: 'تمت معالجة دفعتك كشريك وإرسالها إلى حسابك في Stripe. افتح لوحة تحكم الشريك لعرض التفاصيل.',
    },
  },
  affiliate_payout_voided: {
    title: {
      en: 'Affiliate payout #{payoutId} adjusted',
      fr: 'Paiement d’affiliation nº {payoutId} ajusté',
      es: 'Pago de afiliado n.º {payoutId} ajustado',
      ht: 'Peman afilye #{payoutId} ajiste',
      ar: 'تم تعديل دفعة الشريك رقم {payoutId}',
    },
    body: {
      en: 'A refund voided {voidedCount} commission(s) in your affiliate payout. Open your affiliate dashboard to see the updated total.',
      fr: 'Un remboursement a annulé {voidedCount} commission(s) de votre paiement d’affiliation. Ouvrez votre tableau de bord d’affiliation pour voir le total mis à jour.',
      es: 'Un reembolso anuló {voidedCount} comisión(es) de tu pago de afiliado. Abre tu panel de afiliado para ver el total actualizado.',
      ht: 'Yon ranbousman anile {voidedCount} komisyon nan peman afilye ou. Louvri tablodbò afilye ou pou wè total ki ajou a.',
      ar: 'ألغى استرداد {voidedCount} عمولة من دفعتك كشريك. افتح لوحة تحكم الشريك لعرض الإجمالي المحدّث.',
    },
  },
  media_follow: {
    title: {
      en: 'New Media follower',
      es: 'Nuevo seguidor de Media',
      fr: 'Nouvel abonné Media',
      ht: 'Nouvo moun k ap swiv ou sou Media',
      ar: 'متابع جديد على Media',
    },
    body: {
      en: 'Someone followed your OxSteed Media account.',
      es: 'Alguien siguió tu cuenta de OxSteed Media.',
      fr: 'Quelqu’un a suivi votre compte OxSteed Media.',
      ht: 'Yon moun kòmanse swiv kont OxSteed Media ou a.',
      ar: 'تابع شخص ما حسابك على OxSteed Media.',
    },
  },
  oxsteed_credit_card_security: {
    title: { en: 'OxSteed Credit card security', es: 'Seguridad de tarjeta OxSteed Credit', fr: 'Sécurité de la carte OxSteed Credit', ht: 'Sekirite kat OxSteed Credit', ar: 'أمان بطاقة OxSteed Credit' },
    body: {
      en: 'Review recent card security activity. If this was not you, contact support immediately.',
      es: 'Revisa la actividad de seguridad de tu tarjeta. Si no fuiste tú, contacta con soporte de inmediato.',
      fr: 'Consultez les dernières activités de sécurité de votre carte. Si vous ne les reconnaissez pas, contactez immédiatement le support.',
      ht: 'Revize dènye aktivite sekirite kat ou. Si se pa ou, kontakte sipò touswit.',
      ar: 'راجع نشاط أمان بطاقتك الأخير. إذا لم تقم به، فاتصل بالدعم فورًا.',
    },
  },
  // P3-1-F12: security notice when a payout destination is added or changed.
  payout_destination_changed: {
    title: {
      en: 'Payout destination changed',
      es: 'Destino de pago cambiado',
      fr: 'Destination de paiement modifiée',
      ht: 'Destinasyon peman chanje',
      ar: 'تم تغيير وجهة الدفع',
    },
    body: {
      en: 'Your payout destination was changed. If this was not you, contact support immediately.',
      es: 'Tu destino de pago fue cambiado. Si no fuiste tú, contacta con soporte de inmediato.',
      fr: 'Votre destination de paiement a été modifiée. Si vous ne les reconnaissez pas, contactez immédiatement le support.',
      ht: 'Destinasyon peman ou chanje. Si se pa ou, kontakte sipò touswit.',
      ar: 'تم تغيير وجهة الدفع الخاصة بك. إذا لم تقم بذلك، فاتصل بالدعم فورًا.',
    },
  },
  ...require('./localDeliveryNotifications').deliveryNotifications,
  ...require('./logisticsRefundNotifications').refundNotifications,
  ...require('./logisticsQuoteNotifications').quoteNotifications,
  ...require('./logisticsPaymentNotifications').paymentNotifications,
  ...require('./jobLifecycleNotificationTemplates').jobLifecycleNotifications,
  ...require('./businessTeamNotificationTemplates').businessTeamNotifications,
  ...require('./campaignReviewNotifications').campaignReviewNotifications,
  // S-19: staff membership notices (invite/removal/resend/withdraw/rehire/hired).
  ...require('./staffNotificationTemplates').staffNotifications,
  // Careers spec §11: application, interview, offer, check and invitation notices.
  ...require('./careerNotificationTemplates').careerNotifications,
  // D16: admin operational notices.
  ...require('./adminOperationalNoticeCopy').adminOperationalNotifications,
  work_agreement_signature_requested: {
    title: {
      en: 'Work agreement ready to sign',
      es: 'Acuerdo de trabajo listo para firmar',
      fr: 'Accord de travail prêt à signer',
      ht: 'Akò travay la pare pou siyen',
      ar: 'اتفاقية العمل جاهزة للتوقيع',
    },
    body: {
      en: 'The other party created or updated a work agreement for your job. Review and sign it.',
      es: 'La otra parte creó o actualizó un acuerdo de trabajo para tu trabajo. Revísalo y fírmalo.',
      fr: 'L’autre partie a créé ou modifié un accord de travail pour votre mission. Relisez-le et signez-le.',
      ht: 'Lòt pati a kreye oswa mete ajou yon akò travay pou travay ou. Revize l epi siyen l.',
      ar: 'أنشأ الطرف الآخر أو حدّث اتفاقية عمل لوظيفتك. راجعها ووقّعها.',
    },
  },
  work_agreement_proposal_signed: {
    title: {
      en: 'Work agreement signed by the other party',
      es: 'La otra parte firmó el acuerdo de trabajo',
      fr: 'L’autre partie a signé l’accord de travail',
      ht: 'Lòt pati a siyen akò travay la',
      ar: 'وقّع الطرف الآخر اتفاقية العمل',
    },
    body: {
      en: 'The other party signed the terms you proposed. Sign within 7 days, or the agreement will activate automatically on your proposed terms.',
      es: 'La otra parte firmó los términos que propusiste. Firma dentro de 7 días o el acuerdo se activará automáticamente con tus términos propuestos.',
      fr: 'L’autre partie a signé les conditions que vous avez proposées. Signez sous 7 jours, sinon l’accord s’activera automatiquement selon vos conditions proposées.',
      ht: 'Lòt pati a siyen kondisyon ou te pwopoze yo. Siyen nan 7 jou, sinon akò a ap aktive otomatikman sou kondisyon ou te pwopoze yo.',
      ar: 'وقّع الطرف الآخر على الشروط التي اقترحتها. وقّع خلال 7 أيام، وإلا سيتم تفعيل الاتفاقية تلقائيًا وفق شروطك المقترحة.',
    },
  },
  work_agreement_auto_activated: {
    title: {
      en: 'Work agreement activated',
      es: 'Acuerdo de trabajo activado',
      fr: 'Accord de travail activé',
      ht: 'Akò travay la aktive',
      ar: 'تم تفعيل اتفاقية العمل',
    },
    body: {
      en: 'The proposed terms were signed and the response window passed with no changes. The agreement is now active.',
      es: 'Los términos propuestos fueron firmados y el plazo de respuesta pasó sin cambios. El acuerdo ya está activo.',
      fr: 'Les conditions proposées ont été signées et le délai de réponse est écoulé sans modification. L’accord est désormais actif.',
      ht: 'Kondisyon yo te pwopoze yo te siyen epi delè repons lan pase san chanjman. Akò a aktive kounye a.',
      ar: 'تم توقيع الشروط المقترحة وانتهت مهلة الرد دون تغييرات. الاتفاقية نشطة الآن.',
    },
  },
  bid_received: {
    title: {
      en: 'New bid on your job',
      fr: 'Nouvelle offre sur votre annonce',
      es: 'Nueva oferta en tu trabajo',
      ht: 'Yon nouvo òf sou travay ou',
      ar: 'عرض جديد على وظيفتك',
    },
    body: {
      en: 'A new bid has been placed on your job.',
      fr: 'Une nouvelle offre a été reçue sur votre annonce.',
      es: 'Se ha recibido una nueva oferta en tu trabajo.',
      ht: 'Yo resevwa yon nouvo òf sou travay ou.',
      ar: 'تم تقديم عرض جديد على وظيفتك.',
    },
  },
  bid_accepted: {
    title: {
      en: "You've been hired!",
      fr: "Vous avez été embauché(e) !",
      es: '¡Has sido contratado/a!',
      ht: 'Ou te resevwa yon travay!',
      ar: 'تمت الموافقة على عرضك!',
    },
    body: {
      en: 'Your bid was accepted by the customer.',
      fr: 'Votre offre a été acceptée par le client.',
      es: 'Tu oferta fue aceptada por el cliente.',
      ht: 'Kliyan an te aksepte òf ou.',
      ar: 'تم قبول عرضك من قبل العميل.',
    },
  },
  payment_released: {
    title: {
      en: 'Payment released',
      fr: 'Paiement libéré',
      es: 'Pago liberado',
      ht: 'Peman an lage',
      ar: 'تم تحرير الدفع',
    },
    body: {
      en: 'Your payment has been released.',
      fr: 'Votre paiement a été libéré.',
      es: 'Tu pago ha sido liberado.',
      ht: 'Peman ou fin lage.',
      ar: 'تم تحرير دفعتك.',
    },
  },
  payment_receipt: {
    title: {
      en: 'Payment receipt',
      fr: 'Reçu de paiement',
      es: 'Recibo de pago',
      ht: 'Resi peman',
      ar: 'إيصال الدفع',
    },
    body: {
      en: 'Your job payment was completed successfully.',
      fr: 'Le paiement de votre mission a été effectué avec succès.',
      es: 'El pago de tu trabajo se completó correctamente.',
      ht: 'Peman travay ou a fèt avèk siksè.',
      ar: 'اكتمل دفع مهمتك بنجاح.',
    },
  },
  payout_requested: {
    title: {
      en: 'Payout requested',
      fr: 'Paiement demandé',
      es: 'Pago solicitado',
      ht: 'Peman mande',
      ar: 'تم طلب الدفع',
    },
    body: {
      en: 'Your payout request was received and is awaiting review.',
      fr: 'Votre demande de paiement a été reçue et est en cours d\u2019examen.',
      es: 'Tu solicitud de pago fue recibida y está en revisión.',
      ht: 'Yo resevwa demann peman ou an epi y ap egzamine li.',
      ar: 'تم استلام طلب الدفع الخاص بك وهو قيد المراجعة.',
    },
  },
  payout_approved: {
    title: {
      en: 'Payout approved',
      fr: 'Paiement approuvé',
      es: 'Pago aprobado',
      ht: 'Peman apwouve',
      ar: 'تمت الموافقة على الدفع',
    },
    body: {
      en: 'Your payout was approved and is on its way.',
      fr: 'Votre paiement a été approuvé et est en cours d\u2019envoi.',
      es: 'Tu pago fue aprobado y está en camino.',
      ht: 'Peman ou an apwouve epi li sou wout li.',
      ar: 'تمت الموافقة على دفعتك وهي في طريقها إليك.',
    },
  },
  // Group 9 partials Wave 2 Batch L (451, G9-A8): the driver hears when
  // ops approves their profile and when a payout is approved or paid.
  driver_approved: {
    title: {
      en: 'Driver profile approved',
      fr: 'Profil de chauffeur approuvé',
      es: 'Perfil de conductor aprobado',
      ht: 'Pwofil chofè apwouve',
      ar: 'تمت الموافقة على ملف السائق',
    },
    body: {
      en: 'Your driver profile was approved. You can now claim deliveries.',
      fr: 'Votre profil de chauffeur a été approuvé. Vous pouvez maintenant accepter des livraisons.',
      es: 'Tu perfil de conductor fue aprobado. Ya puedes reclamar entregas.',
      ht: 'Pwofil chofè ou an apwouve. Ou ka reklame livrezon kounye a.',
      ar: 'تمت الموافقة على ملف السائق الخاص بك. يمكنك الآن استلام التوصيلات.',
    },
  },
  driver_payout_approved: {
    title: {
      en: 'Driver payout approved',
      fr: 'Paiement chauffeur approuvé',
      es: 'Pago de conductor aprobado',
      ht: 'Peman chofè apwouve',
      ar: 'تمت الموافقة على دفعة السائق',
    },
    body: {
      en: 'Your delivery payout was approved and is on its way to being paid.',
      fr: 'Votre paiement de livraison a été approuvé et sera bientôt versé.',
      es: 'Tu pago de entrega fue aprobado y está en camino de pagarse.',
      ht: 'Peman livrezon ou an apwouve epi y ap peye li byento.',
      ar: 'تمت الموافقة على دفعة التوصيل الخاصة بك وهي في طريقها للدفع.',
    },
  },
  driver_payout_paid: {
    title: {
      en: 'Driver payout paid',
      fr: 'Paiement chauffeur versé',
      es: 'Pago de conductor realizado',
      ht: 'Peman chofè peye',
      ar: 'تم دفع دفعة السائق',
    },
    body: {
      en: 'Your delivery payout was paid. Check your payout history for the details.',
      fr: 'Votre paiement de livraison a été versé. Consultez votre historique de paiements pour les détails.',
      es: 'Tu pago de entrega fue realizado. Revisa tu historial de pagos para ver los detalles.',
      ht: 'Yo peye peman livrezon ou an. Gade istwa peman ou pou detay yo.',
      ar: 'تم دفع دفعة التوصيل الخاصة بك. تحقق من سجل الدفعات للاطلاع على التفاصيل.',
    },
  },
  // Group 9 partials Wave 2 Batch M (456, G9-A9): the periodic new-offer
  // digest. The body interpolates {count} from data.params in the
  // recipient's language.
  delivery_offer_digest: {
    title: {
      en: 'New delivery offers',
      fr: 'Nouvelles offres de livraison',
      es: 'Nuevas ofertas de entrega',
      ht: 'Nouvo òf livrezon',
      ar: 'عروض توصيل جديدة',
    },
    body: {
      en: '{count} new delivery offers are waiting in your service area. Open Driving to see them.',
      fr: '{count} nouvelles offres de livraison vous attendent dans votre zone de service. Ouvrez Conduite pour les voir.',
      es: '{count} nuevas ofertas de entrega te esperan en tu área de servicio. Abre Conducción para verlas.',
      ht: '{count} nouvo òf livrezon ap tann ou nan zòn sèvis ou an. Louvri Kondwi pou wè yo.',
      ar: 'هناك {count} من عروض التوصيل الجديدة بانتظارك في منطقة خدمتك. افتح قسم القيادة لعرضها.',
    },
  },
  payout_failed: {
    title: {
      en: 'Payout failed',
      fr: 'Paiement échoué',
      es: 'Pago fallido',
      ht: 'Peman an echwe',
      ar: 'فشل الدفع',
    },
    body: {
      en: 'Your payout could not be completed. Check the payout details for the reason.',
      fr: 'Votre paiement n’a pas pu être effectué. Consultez les détails du paiement pour en connaître la raison.',
      es: 'No se pudo completar tu pago. Revisa los detalles del pago para ver el motivo.',
      ht: 'Peman ou an pa t ka fini. Gade detay peman an pou rezon an.',
      ar: 'تعذّر إكمال دفعتك. تحقق من تفاصيل الدفع لمعرفة السبب.',
    },
  },
  payout_rejected: {
    title: {
      en: 'Payout rejected',
      fr: 'Paiement refusé',
      es: 'Pago rechazado',
      ht: 'Peman refize',
      ar: 'تم رفض الدفع',
    },
    body: {
      en: 'Your payout request was rejected. Check the review note for details.',
      fr: 'Votre demande de paiement a été refusée. Consultez la note d\u2019examen pour plus de détails.',
      es: 'Tu solicitud de pago fue rechazada. Revisa la nota de revisión para más detalles.',
      ht: 'Yo refize demann peman ou an. Gade nòt revizyon an pou plis detay.',
      ar: 'تم رفض طلب الدفع الخاص بك. تحقق من ملاحظة المراجعة لمزيد من التفاصيل.',
    },
  },
  // G7-13: these three payout notices arrived blank (tNotif returns empty
  // title/body for a missing entry, and the NULL title then fails the
  // notifications insert, so the owner heard nothing at all). The audit
  // misread payout_deposited's email button-text line as a title/body
  // entry; it had none either.
  payout_draft_created: {
    title: {
      en: 'Payout draft created',
      fr: 'Brouillon de paiement créé',
      es: 'Borrador de pago creado',
      ht: 'Bouyon peman kreye',
      ar: 'تم إنشاء مسودة دفع',
    },
    body: {
      en: 'A payout draft was created and is awaiting owner confirmation.',
      fr: 'Un brouillon de paiement a été créé et attend la confirmation du propriétaire.',
      es: 'Se creó un borrador de pago que está a la espera de la confirmación del propietario.',
      ht: 'Yo kreye yon bouyon peman k ap tann konfimasyon pwopriyetè a.',
      ar: 'تم إنشاء مسودة دفع وهي بانتظار تأكيد المالك.',
    },
  },
  payout_deposited: {
    title: {
      en: 'Payout deposited',
      fr: 'Paiement déposé',
      es: 'Pago depositado',
      ht: 'Peman depoze',
      ar: 'تم إيداع الدفع',
    },
    body: {
      en: 'Your payout was deposited to your connected account.',
      fr: 'Votre paiement a été déposé sur votre compte connecté.',
      es: 'Tu pago fue depositado en tu cuenta conectada.',
      ht: 'Peman ou an te depoze nan kont konekte ou an.',
      ar: 'تم إيداع دفعتك في حسابك المتصل.',
    },
  },
  payout_reversed: {
    title: {
      en: 'Payout reversed',
      fr: 'Paiement annulé',
      es: 'Pago revertido',
      ht: 'Peman an anile',
      ar: 'تم عكس الدفع',
    },
    body: {
      en: 'Your payout was reversed by the payment provider. The amount is being returned to your restaurant balance.',
      fr: 'Votre paiement a été annulé par le prestataire de paiement. Le montant est en cours de retour sur le solde de votre restaurant.',
      es: 'Tu pago fue revertido por el proveedor de pagos. El importe se está devolviendo al saldo de tu restaurante.',
      ht: 'Prestataire peman an te anile peman ou an. Yo ap remèt lajan an nan balans restoran ou an.',
      ar: 'تم عكس دفعتك من قبل مزود الدفع. ويجري إرجاع المبلغ إلى رصيد مطعمك.',
    },
  },
  refund: {
    title: {
      en: 'Refund processed', fr: 'Remboursement traité', es: 'Reembolso procesado',
      ht: 'Ranbousman trete', ar: 'تمت معالجة الاسترداد',
    },
    body: {
      en: 'Your payment refund has been processed.',
      fr: 'Le remboursement de votre paiement a été traité.',
      es: 'Se procesó el reembolso de tu pago.',
      ht: 'Ranbousman peman ou a trete.',
      ar: 'تمت معالجة استرداد دفعتك.',
    },
  },
  refund_failed: {
    title: {
      en: 'Refund needs attention', fr: 'Remboursement à vérifier', es: 'Reembolso requiere atención',
      ht: 'Ranbousman bezwen atansyon', ar: 'يحتاج الاسترداد إلى مراجعة',
    },
    body: {
      en: 'Your payment refund could not be completed automatically. Please review the job or contact support.',
      fr: 'Votre remboursement n’a pas pu être effectué automatiquement. Consultez la mission ou contactez le support.',
      es: 'No se pudo completar automáticamente el reembolso. Revisa el trabajo o contacta con soporte.',
      ht: 'Ranbousman peman ou pa t ka fini otomatikman. Revize travay la oswa kontakte sipò.',
      ar: 'تعذر إكمال استرداد دفعتك تلقائيًا. راجع المهمة أو اتصل بالدعم.',
    },
  },
  oxsteed_credit_transaction: {
    title: {
      en: 'OxSteed Credit activity',
      fr: 'Activité OxSteed Credit',
      es: 'Actividad de OxSteed Credit',
      ht: 'Aktivite OxSteed Credit',
      ar: 'نشاط OxSteed Credit',
    },
    body: {
      en: 'Review your OxSteed Credit activity.',
      fr: 'Consultez votre activité OxSteed Credit.',
      es: 'Revisa tu actividad de OxSteed Credit.',
      ht: 'Revize aktivite OxSteed Credit ou.',
      ar: 'راجع نشاط OxSteed Credit الخاص بك.',
    },
  },
  credit_identity_verification_requested: {
    title: { en: 'Identity review requested', es: 'Solicitud de revisión de identidad', fr: 'Demande de vérification d’identité', ht: 'Demann verifikasyon idantite', ar: 'تم طلب مراجعة الهوية' },
    body: { en: 'Your identity review request is in the compliance queue.', es: 'Tu solicitud de revisión de identidad está en la cola de cumplimiento.', fr: 'Votre demande de vérification d’identité est dans la file de conformité.', ht: 'Demann verifikasyon idantite ou nan ke konformite a.', ar: 'طلب مراجعة هويتك في قائمة الامتثال.' },
  },
  credit_identity_verification_approved: {
    title: { en: 'Identity verification approved', es: 'Verificación de identidad aprobada', fr: 'Vérification d’identité approuvée', ht: 'Verifikasyon idantite apwouve', ar: 'تمت الموافقة على التحقق من الهوية' },
    body: { en: 'Your identity verification was approved.', es: 'Tu verificación de identidad fue aprobada.', fr: 'Votre vérification d’identité a été approuvée.', ht: 'Yo apwouve verifikasyon idantite ou.', ar: 'تمت الموافقة على التحقق من هويتك.' },
  },
  credit_identity_verification_rejected: {
    title: { en: 'Identity verification needs attention', es: 'La verificación de identidad requiere atención', fr: 'La vérification d’identité nécessite votre attention', ht: 'Verifikasyon idantite bezwen atansyon', ar: 'يحتاج التحقق من الهوية إلى مراجعة' },
    body: { en: 'Your identity verification was not approved. Review the reason and submit a new request.', es: 'Tu verificación de identidad no fue aprobada. Revisa el motivo y envía una nueva solicitud.', fr: 'Votre vérification d’identité n’a pas été approuvée. Consultez le motif et envoyez une nouvelle demande.', ht: 'Yo pa apwouve verifikasyon idantite ou. Revize rezon an epi voye yon nouvo demann.', ar: 'لم تتم الموافقة على التحقق من هويتك. راجع السبب وأرسل طلبًا جديدًا.' },
  },
  credit_identity_verification_appeal_submitted: {
    title: { en: 'Identity appeal submitted', es: 'Apelación de identidad enviada', fr: 'Appel d’identité envoyé', ht: 'Apèl idantite soumèt', ar: 'تم إرسال استئناف الهوية' },
    body: { en: 'Your appeal was submitted for compliance review.', es: 'Tu apelación fue enviada para revisión de cumplimiento.', fr: 'Votre appel a été envoyé pour vérification de conformité.', ht: 'Yo soumèt apèl ou pou revizyon konformite.', ar: 'تم إرسال استئنافك لمراجعة الامتثال.' },
  },
  credit_identity_verification_appeal_approved: {
    title: { en: 'Identity appeal accepted', es: 'Apelación de identidad aceptada', fr: 'Appel d’identité accepté', ht: 'Yo aksepte apèl idantite a', ar: 'تم قبول استئناف الهوية' },
    body: { en: 'Your appeal was accepted and your identity review is back in the compliance queue.', es: 'Tu apelación fue aceptada y tu revisión de identidad volvió a la cola de cumplimiento.', fr: 'Votre appel a été accepté et votre vérification est de nouveau dans la file de conformité.', ht: 'Yo aksepte apèl ou epi yo mete revizyon idantite a nan ke konformite a ankò.', ar: 'تم قبول استئنافك وأعيدت مراجعة هويتك إلى قائمة الامتثال.' },
  },
  credit_identity_verification_appeal_rejected: {
    title: { en: 'Identity appeal not approved', es: 'Apelación de identidad no aprobada', fr: 'Appel d’identité non approuvé', ht: 'Yo pa apwouve apèl idantite a', ar: 'لم تتم الموافقة على استئناف الهوية' },
    body: { en: 'Your identity verification appeal was not approved.', es: 'Tu apelación de verificación de identidad no fue aprobada.', fr: 'Votre appel de vérification d’identité n’a pas été approuvé.', ht: 'Yo pa apwouve apèl verifikasyon idantite ou a.', ar: 'لم تتم الموافقة على استئناف التحقق من هويتك.' },
  },
  credit_identity_verification_expired: {
    title: { en: 'Identity verification expired', es: 'Verificación de identidad vencida', fr: 'Vérification d’identité expirée', ht: 'Verifikasyon idantite ekspire', ar: 'انتهت صلاحية التحقق من الهوية' },
    body: { en: 'Your identity verification has expired. Submit a new request to restore your verification tier.', es: 'Tu verificación de identidad ha vencido. Envía una nueva solicitud para recuperar tu nivel de verificación.', fr: 'Votre vérification d’identité a expiré. Envoyez une nouvelle demande pour restaurer votre niveau de vérification.', ht: 'Verifikasyon idantite ou ekspire. Voye yon nouvo demann pou repran nivo verifikasyon ou.', ar: 'انتهت صلاحية التحقق من هويتك. أرسل طلبًا جديدًا لاستعادة مستوى التحقق الخاص بك.' },
  },
  credit_identity_verification_expiring: {
    title: { en: 'Identity verification expiring soon', es: 'La verificación de identidad vence pronto', fr: 'Vérification d’identité bientôt expirée', ht: 'Verifikasyon idantite prèt pou ekspire', ar: 'سينتهي التحقق من الهوية قريبًا' },
    body: { en: 'Your identity verification expires soon. Submit a new request now to avoid losing your verification tier.', es: 'Tu verificación de identidad vence pronto. Envía una nueva solicitud ahora para no perder tu nivel de verificación.', fr: 'Votre vérification d’identité expire bientôt. Envoyez une nouvelle demande maintenant pour ne pas perdre votre niveau de vérification.', ht: 'Verifikasyon idantite ou prèt pou ekspire. Voye yon nouvo demann kounye a pou pa pèdi nivo verifikasyon ou.', ar: 'سينتهي التحقق من هويتك قريبًا. أرسل طلبًا جديدًا الآن لتجنب فقدان مستوى التحقق الخاص بك.' },
  },
  credit_sanctions_review_required: {
    title: { en: 'Compliance review required', es: 'Se requiere una revisión de cumplimiento', fr: 'Vérification de conformité requise', ht: 'Revizyon konformite obligatwa', ar: 'مراجعة الامتثال مطلوبة' },
    body: { en: 'Credit activity is paused while a compliance review is completed.', es: 'La actividad de crédito está pausada mientras se completa una revisión de cumplimiento.', fr: 'L’activité de crédit est suspendue pendant la vérification de conformité.', ht: 'Aktivite kredi a kanpe pandan revizyon konformite a ap fèt.', ar: 'تم إيقاف نشاط الائتمان حتى اكتمال مراجعة الامتثال.' },
  },
  credit_sanctions_cleared: {
    title: { en: 'Compliance review cleared', es: 'Revisión de cumplimiento aprobada', fr: 'Vérification de conformité levée', ht: 'Revizyon konformite otorize', ar: 'تمت الموافقة على مراجعة الامتثال' },
    body: { en: 'Your compliance review was cleared. Credit activity may resume if other requirements are met.', es: 'Tu revisión de cumplimiento fue aprobada. La actividad de crédito puede reanudarse si se cumplen los demás requisitos.', fr: 'Votre vérification de conformité a été levée. L’activité de crédit peut reprendre si les autres conditions sont remplies.', ht: 'Yo otorize revizyon konformite ou. Aktivite kredi ka rekòmanse si lòt kondisyon yo ranpli.', ar: 'تمت الموافقة على مراجعة الامتثال. يمكن استئناف نشاط الائتمان إذا استوفيت المتطلبات الأخرى.' },
  },
  credit_sanctions_confirmed: {
    title: { en: 'Compliance review remains open', es: 'La revisión de cumplimiento sigue abierta', fr: 'La vérification de conformité reste ouverte', ht: 'Revizyon konformite a toujou ouvè', ar: 'لا تزال مراجعة الامتثال مفتوحة' },
    body: { en: 'Your compliance review remains open while the case is investigated.', es: 'Tu revisión de cumplimiento sigue abierta mientras se investiga el caso.', fr: 'Votre vérification de conformité reste ouverte pendant l’enquête.', ht: 'Revizyon konformite ou toujou ouvè pandan y ap envestige ka a.', ar: 'لا تزال مراجعة الامتثال مفتوحة أثناء التحقيق في الحالة.' },
  },
  // Monthly statement issuance (workstream 1). The body is intentionally free
  // of amounts, balances and digits: the email carries only an
  // authenticated link; figures live behind the login.
  statement_ready: {
    title: {
      en: 'Your statement is ready',
      fr: 'Votre relevé est prêt',
      es: 'Tu estado de cuenta está listo',
      ht: 'Releve ou pare',
      ar: 'كشف حسابك جاهز',
    },
    body: {
      en: 'Your monthly statement is ready. Sign in to your account to view and download it.',
      fr: 'Votre relevé mensuel est prêt. Connectez-vous à votre compte pour le consulter et le télécharger.',
      es: 'Tu estado de cuenta mensual está listo. Inicia sesión en tu cuenta para verlo y descargarlo.',
      ht: 'Releve mansyèl ou pare. Konekte sou kont ou pou wè li epi telechaje li.',
      ar: 'كشف حسابك الشهري جاهز. سجّل الدخول إلى حسابك لعرضه وتنزيله.',
    },
  },
  // Statement amendment publication (workstream 3). Like statement_ready, the
  // body carries no amounts, balances or digits: the email carries only an
  // authenticated link; figures live behind the login.
  statement_amended: {
    title: {
      en: 'A corrected statement is ready',
      fr: 'Une version corrigée de votre relevé est prête',
      es: 'Una versión corregida de tu estado de cuenta está lista',
      ht: 'Yon vèsyon korije releve ou pare',
      ar: 'نسخة مصححة من كشف حسابك جاهزة',
    },
    body: {
      en: 'A correction was approved for one of your statements. Sign in to your account to view and download the corrected version.',
      fr: 'Une correction a été approuvée pour l’un de vos relevés. Connectez-vous à votre compte pour consulter et télécharger la version corrigée.',
      es: 'Se aprobó una corrección para uno de tus estados de cuenta. Inicia sesión en tu cuenta para ver y descargar la versión corregida.',
      ht: 'Yo apwouve yon koreksyon pou youn nan releve ou yo. Konekte sou kont ou pou wè epi telechaje vèsyon korije a.',
      ar: 'تمت الموافقة على تصحيح لأحد كشوفات حسابك. سجّل الدخول إلى حسابك لعرض النسخة المصححة وتنزيلها.',
    },
  },
  // Group 14 Slice 5d (716, D-430): a new audit request reaches the
  // bookkeeper/admin queue. The body carries no amounts or figures.
  audit_request_received: {
    title: {
      en: 'New audit request',
      fr: 'Nouvelle demande d’audit',
      es: 'Nueva solicitud de auditoría',
      ht: 'Nouvo demann odit',
      ar: 'طلب تدقيق جديد',
    },
    body: {
      en: 'A new audit request was filed. Open the audit queue to review it.',
      fr: 'Une nouvelle demande d’audit a été déposée. Ouvrez la file d’audit pour l’examiner.',
      es: 'Se presentó una nueva solicitud de auditoría. Abre la cola de auditoría para revisarla.',
      ht: 'Yo te depoze yon nouvo demann odit. Louvri ke odit la pou revize li.',
      ar: 'تم تقديم طلب تدقيق جديد. افتح قائمة التدقيق لمراجعته.',
    },
  },
  food_order_accepted: {
    title: {
      en: 'Order confirmed',
      fr: 'Commande confirmée',
      es: 'Pedido confirmado',
      ht: 'Kòmand lan konfime',
      ar: 'تم تأكيد الطلب',
    },
    body: {
      en: 'The restaurant confirmed your order and will start preparing it.',
      fr: 'Le restaurant a confirmé votre commande et va commencer à la préparer.',
      es: 'El restaurante confirmó tu pedido y comenzará a prepararlo.',
      ht: 'Restoran an konfime kòmand ou epi pral kòmanse prepare li.',
      ar: 'أكّد المطعم طلبك وسيبدأ في تحضيره.',
    },
  },
  food_order_preparing: {
    title: {
      en: 'Your food is being prepared',
      fr: 'Votre repas est en préparation',
      es: 'Tu comida se está preparando',
      ht: 'Y ap prepare manje ou',
      ar: 'يتم تحضير طعامك الآن',
    },
    body: {
      en: 'The kitchen started working on your order.',
      fr: 'La cuisine a commencé à préparer votre commande.',
      es: 'La cocina comenzó a preparar tu pedido.',
      ht: 'Kwizin nan kòmanse travay sou kòmand ou.',
      ar: 'بدأ المطبخ في تحضير طلبك.',
    },
  },
  cart_recovery: {
    title: {
      en: 'Your order is still waiting',
      fr: 'Votre commande vous attend',
      es: 'Tu pedido sigue esperando',
      ht: 'Kòmand ou ap tann ou toujou',
      ar: 'طلبك ما زال بانتظارك',
    },
    body: {
      en: 'You left items in your cart. Tap to pick up right where you left off.',
      fr: 'Vous avez laissé des articles dans votre panier. Touchez pour reprendre où vous vous étiez arrêté.',
      es: 'Dejaste artículos en tu carrito. Toca para continuar donde lo dejaste.',
      ht: 'Ou te kite atik nan panye ou. Peze pou kontinye kote ou te ye a.',
      ar: 'تركت عناصر في سلتك. اضغط للمتابعة من حيث توقفت.',
    },
  },
  draft_recovery: {
    title: {
      en: 'Finish posting your job',
      fr: 'Terminez la publication de votre annonce',
      es: 'Termina de publicar tu trabajo',
      ht: 'Fini pibliye djòb ou',
      ar: 'أكمل نشر وظيفتك',
    },
    body: {
      en: 'Your draft is saved. Finish posting to start receiving bids.',
      fr: 'Votre brouillon est enregistré. Terminez la publication pour recevoir des offres.',
      es: 'Tu borrador está guardado. Termina de publicarlo para recibir ofertas.',
      ht: 'Bouyon ou an sove. Fini pibliye li pou kòmanse resevwa òf.',
      ar: 'مسودتك محفوظة. أكمل النشر لبدء تلقي العروض.',
    },
  },
  new_login_detected: {
    title: {
      en: 'New login detected on your account',
      fr: 'Nouvelle connexion détectée sur votre compte',
      es: 'Nuevo inicio de sesión detectado en tu cuenta',
      ht: 'Yon nouvo koneksyon idantifye sou kont ou',
      ar: 'تم اكتشاف تسجيل دخول جديد لحسابك',
    },
    body: {
      en: 'We detected a login from a new device or location.',
      fr: 'Nous avons détecté une connexion à partir d’un nouvel appareil ou d’un nouvel emplacement.',
      es: 'Hemos detectado un inicio de sesión desde un nuevo dispositivo o ubicación.',
      ht: 'Nou detekte yon koneksyon ki soti nan yon nouvo aparèy oswa kote.',
      ar: 'تم اكتشاف تسجيل دخول من جهاز جديد أو موقع جديد.',
    },
  },
  job_alert: {
    title: {
      en: 'New Job Alert',
      fr: 'Nouvelle annonce',
      es: 'Nueva alerta de trabajo',
      ht: 'Nouvo avètisman travay',
      ar: 'تنبيه عمل جديد',
    },
    body: {
      en: 'A new job matches your saved search.',
      fr: 'Une nouvelle annonce correspond à votre recherche enregistrée.',
      es: 'Un nuevo trabajo coincide con tu búsqueda guardada.',
      ht: 'Yon nouvo travay matche ak rechèch ki anrejistre ou a.',
      ar: 'يوجد وظيفة جديدة تتطابق مع بحثك المحفوظ.',
    },
  },
  helper_alert: {
    title: {
      en: 'New Helper Alert',
      fr: 'Nouvelle alerte aidant',
      es: 'Nueva alerta de ayudante',
      ht: 'Nouvo avètisman edè',
      ar: 'تنبيه مساعد جديد',
    },
    body: {
      en: 'A new helper matches your saved search.',
      fr: 'Un nouvel aidant correspond à votre recherche enregistrée.',
      es: 'Un nuevo ayudante coincide con tu búsqueda guardada.',
      ht: 'Yon nouvo edè matche ak rechèch ki anrejistre ou a.',
      ar: 'يوجد مساعد جديد يتطابق مع بحثك المحفوظ.',
    },
  },
  tool_alert: {
    title: {
      en: 'New Tool Alert',
      fr: 'Nouvelle alerte outil',
      es: 'Nueva alerta de herramienta',
      ht: 'Nouvo avètisman zouti',
      ar: 'تنبيه أداة جديد',
    },
    body: {
      en: 'A new tool matches your saved search.',
      fr: 'Un nouvel outil correspond à votre recherche enregistrée.',
      es: 'Una nueva herramienta coincide con tu búsqueda guardada.',
      ht: 'Yon nouvo zouti matche ak rechèch ki anrejistre ou a.',
      ar: 'توجد أداة جديدة تتطابق مع بحثك المحفوظ.',
    },
  },
  invoice_resend: {
    title: {
      en: 'Invoice',
      fr: 'Facture',
      es: 'Factura',
      ht: 'Bòdwo',
      ar: 'فاتورة',
    },
    body: {
      en: 'Your invoice',
      fr: 'Votre facture',
      es: 'Tu factura',
      ht: 'Bòdwo ou',
      ar: 'فاتورتك',
    },
  },
  intake_request_received: {
    title: {
      en: 'New intake request',
      fr: 'Nouvelle demande d\u2019admission',
      es: 'Nueva solicitud de admisión',
      ht: 'Nouvo demann admisyon',
      ar: 'طلب استلام جديد',
    },
    body: {
      en: 'A new intake request needs triage. Open your operations tab to review it.',
      fr: 'Une nouvelle demande d\u2019admission doit \u00eatre tri\u00e9e. Ouvrez votre onglet op\u00e9rations pour l\u2019examiner.',
      es: 'Una nueva solicitud de admisión necesita clasificación. Abre tu pestaña de operaciones para revisarla.',
      ht: 'Yon nouvo demann admisyon bezwen triyaj. Louvri onglet operasyon ou a pou verifye li.',
      ar: 'طلب استلام جديد يحتاج إلى فرز. افتح علامة تبويب العمليات لمراجعته.',
    },
  },
  maintenance_request_assigned: {
    title: {
      en: 'Maintenance request assigned to you',
      fr: 'Demande de maintenance assignée',
      es: 'Solicitud de mantenimiento asignada',
      ht: 'Demann antretyen asiyen ba ou',
      ar: 'تم إسناد طلب صيانة إليك',
    },
    body: {
      en: 'A maintenance request was assigned to you. Open your assigned queue to review it.',
      fr: 'Une demande de maintenance vous a été assignée. Ouvrez votre file assignée pour l\u2019examiner.',
      es: 'Se te asignó una solicitud de mantenimiento. Abre tu cola de asignaciones para revisarla.',
      ht: 'Yo asiyen yon demann antretyen ba ou. Louvri lis asiyen ou a pou verifye li.',
      ar: 'تم إسناد طلب صيانة إليك. افتح قائمة المهام المسندة لمراجعته.',
    },
  },
  job_recurring_posted: {
    title: {
      en: 'Recurring job reposted',
      fr: 'Offre récurrente republiée',
      es: 'Trabajo recurrente republicado',
      ht: 'Travay repibliye regilyèman',
      ar: 'تم نشر الوظيفة المتكررة مرة أخرى',
    },
    body: {
      en: 'One of your recurring jobs was reposted.',
      fr: 'L’un de vos travaux récurrents a été republié.',
      es: 'Uno de tus trabajos recurrentes se publicó nuevamente.',
      ht: 'Yonn nan travay ou yo ki repete yo te repibliye.',
      ar: 'تم إعادة نشر أحد وظائفك المتكررة.',
    },
  },
  reengagement_nudge: {
    title: {
      en: 'Need help again?',
      fr: 'Besoin d’aide à nouveau ?',
      es: '¿Necesitas ayuda de nuevo?',
      ht: 'Ou bezwen èd ankò?',
      ar: 'هل تحتاج مساعدة مرة أخرى؟',
    },
    body: {
      en: 'It has been a while — we have helpers ready for your next task.',
      fr: 'Cela fait un moment — nous avons des experts prêts pour votre prochaine mission.',
      es: 'Ha pasado un tiempo; tenemos ayudantes listos para tu próxima tarea.',
      ht: 'Sa fè yon tan — nou gen èd pou pwochen travay ou a.',
      ar: 'لقد مضى بعض الوقت — لدينا مساعدون جاهزون لمهمتك التالية.',
    },
  },
  booking_confirmation: {
    title: {
      en: 'Booking Confirmation',
      fr: 'Confirmation de réservation',
      es: 'Confirmación de reserva',
      ht: 'Konfimasyon rezèvasyon',
      ar: 'تأكيد الحجز',
    },
    body: {
      en: 'Your booking for %{toolName} has been submitted and is pending owner approval.',
      fr: 'Votre réservation pour %{toolName} a été soumise et attend l\'approbation du propriétaire.',
      es: 'Tu reserva para %{toolName} se ha enviado y está pendiente de aprobación del propietario.',
      ht: 'Rezèvasyon ou pou %{toolName} deja soumèt epi li rete tann apwobasyon pwopriyetè a.',
      ar: 'تم تقديم حجزك لـ%{toolName} وهو بانتظار موافقة المالك.',
    },
  },
  booking_request_new: {
    title: {
      en: 'New Booking Request',
      fr: 'Nouvelle demande de réservation',
      es: 'Nueva solicitud de reserva',
      ht: 'Nouvo demann rezèvasyon',
      ar: 'طلب حجز جديد',
    },
    body: {
      en: '%{customerName} has requested to book your %{toolName}.',
      fr: '%{customerName} a demandé à réserver votre %{toolName}.',
      es: '%{customerName} solicitó reservar tu %{toolName}.',
      ht: '%{customerName} mande pou lwe %{toolName} ou a.',
      ar: 'طلب %{customerName} حجز %{toolName} الخاص بك.',
    },
  },
  booking_accepted: {
    title: {
      en: 'Booking Request Accepted',
      fr: 'Demande de réservation acceptée',
      es: 'Solicitud de reserva aceptada',
      ht: 'Demann rezèvasyon an aksepte',
      ar: 'تم قبول طلب الحجز',
    },
    body: {
      en: 'Your request has been accepted.',
      fr: 'Votre demande a été acceptée.',
      es: 'Tu solicitud ha sido aceptada.',
      ht: 'Demann ou anseye.',
      ar: 'تم قبول طلبك.',
    },
  },
  // Group 1, item 14: booking-level reschedule proposals. The body
  // carries the proposed window; the booking itself moves only on accept.
  booking_reschedule_proposed: {
    title: {
      en: 'Reschedule Proposed',
      fr: 'Nouvel horaire proposé',
      es: 'Cambio de horario propuesto',
      ht: 'Yo pwopoze yon lòt lè',
      ar: 'اقتراح موعد جديد',
    },
    body: {
      en: 'A new time was proposed for your booking. Review it and accept or decline.',
      fr: 'Un nouvel horaire a été proposé pour votre réservation. Examinez-le et acceptez ou refusez.',
      es: 'Se propuso una nueva hora para tu reserva. Revísala y acepta o rechaza.',
      ht: 'Yo pwopoze yon lòt lè pou rezervasyon ou an. Gade li epi aksepte oswa refize li.',
      ar: 'تم اقتراح موعد جديد لحجزك. راجعه واقبل أو ارفض.',
    },
  },
  booking_reschedule_accepted: {
    title: {
      en: 'Reschedule Accepted',
      fr: 'Nouvel horaire accepté',
      es: 'Cambio de horario aceptado',
      ht: 'Yo aksepte lòt lè a',
      ar: 'تم قبول الموعد الجديد',
    },
    body: {
      en: 'The rescheduled time was accepted. Your booking has moved to the new time.',
      fr: 'Le nouvel horaire a été accepté. Votre réservation a été déplacée.',
      es: 'El nuevo horario fue aceptado. Tu reserva se movió a la nueva hora.',
      ht: 'Yo aksepte lòt lè a. Rezèvasyon ou an deplase nan nouvo lè a.',
      ar: 'تم قبول الموعد الجديد. تم نقل حجزك إلى الموعد الجديد.',
    },
  },
  booking_reschedule_declined: {
    title: {
      en: 'Reschedule Declined',
      fr: 'Nouvel horaire refusé',
      es: 'Cambio de horario rechazado',
      ht: 'Yo refize lòt lè a',
      ar: 'تم رفض الموعد الجديد',
    },
    body: {
      en: 'The proposed new time was declined. Your booking stays at its original time.',
      fr: 'Le nouvel horaire proposé a été refusé. Votre réservation reste à son horaire initial.',
      es: 'La nueva hora propuesta fue rechazada. Tu reserva se mantiene en su hora original.',
      ht: 'Yo refize lòt lè yo te pwopoze a. Rezèvasyon ou an rete nan lè orijinal li.',
      ar: 'تم رفض الموعد الجديد المقترح. يبقى حجزك في موعده الأصلي.',
    },
  },
  // Group 1, item 10: the customer set a response deadline and it passed
  // with the request still unquoted.
  quote_deadline_passed: {
    title: {
      en: 'Quote Deadline Passed',
      fr: 'Délai de devis dépassé',
      es: 'Plazo de cotización vencido',
      ht: 'Dat limit pou devis la pase',
      ar: 'انتهت مهلة عرض السعر',
    },
    body: {
      en: 'The response deadline on your quote request has passed with no quote yet.',
      fr: 'Le délai de réponse de votre demande de devis est dépassé sans devis reçu.',
      es: 'El plazo de respuesta de tu solicitud de cotización venció sin recibir cotización.',
      ht: 'Dat limit pou repons demann devis ou an pase san ou pa resevwa devis.',
      ar: 'انتهت مهلة الرد على طلب عرض السعر الخاص بك دون تلقي عرض سعر بعد.',
    },
  },
  // Group 4 Slice C (166-170): counterparty notices for the helper-quote
  // negotiation flow. Bodies stay generic (no names or amounts); the
  // job and quote ride in data with an action_url to the job page.
  helper_quote_received: {
    title: {
      en: 'New quote on your job',
      fr: 'Nouveau devis sur votre annonce',
      es: 'Nueva cotización en tu trabajo',
      ht: 'Yon nouvo estimasyon sou travay ou',
      ar: 'عرض سعر جديد على وظيفتك',
    },
    body: {
      en: 'A helper sent an itemized quote for your job.',
      fr: 'Un prestataire a envoyé un devis détaillé pour votre annonce.',
      es: 'Un ayudante envió una cotización detallada para tu trabajo.',
      ht: 'Yon asistan voye yon estimasyon detaye pou travay ou.',
      ar: 'أرسل أحد المساعدين عرض سعر مفصل لوظيفتك.',
    },
  },
  helper_quote_revised: {
    title: {
      en: 'A quote was revised',
      fr: 'Un devis a été révisé',
      es: 'Se revisó una cotización',
      ht: 'Yo revize yon estimasyon',
      ar: 'تمت مراجعة عرض سعر',
    },
    body: {
      en: 'A helper updated their itemized quote for your job.',
      fr: 'Un prestataire a mis à jour son devis détaillé pour votre annonce.',
      es: 'Un ayudante actualizó su cotización detallada para tu trabajo.',
      ht: 'Yon asistan mete estimasyon detaye li pou travay ou a ajou.',
      ar: 'قام أحد المساعدين بتحديث عرض السعر المفصل لوظيفتك.',
    },
  },
  helper_quote_counter_proposed: {
    title: {
      en: 'New counteroffer on your quote',
      fr: 'Nouvelle contre-offre sur votre devis',
      es: 'Nueva contraoferta en tu cotización',
      ht: 'Yon nouvo kont-òf sou estimasyon ou',
      ar: 'عرض مضاد جديد على عرض السعر الخاص بك',
    },
    body: {
      en: 'The customer proposed a counteroffer on your quote.',
      fr: 'Le client a proposé une contre-offre sur votre devis.',
      es: 'El cliente propuso una contraoferta en tu cotización.',
      ht: 'Kliyan an te pwopoze yon kont-òf sou estimasyon ou.',
      ar: 'اقترح العميل عرضا مضادا على عرض السعر الخاص بك.',
    },
  },
  helper_quote_counter_accepted: {
    title: {
      en: 'Counteroffer accepted',
      fr: 'Contre-offre acceptée',
      es: 'Contraoferta aceptada',
      ht: 'Yo aksepte kont-òf la',
      ar: 'تم قبول العرض المضاد',
    },
    body: {
      en: 'The helper accepted your counteroffer and issued a revised quote.',
      fr: 'Le prestataire a accepté votre contre-offre et émis un devis révisé.',
      es: 'El ayudante aceptó tu contraoferta y emitió una cotización revisada.',
      ht: 'Asistan an te aksepte kont-òf ou epi li voye yon estimasyon revize.',
      ar: 'قبل المساعد عرضك المضاد وأصدر عرض سعر منقحا.',
    },
  },
  helper_quote_counter_declined: {
    title: {
      en: 'Counteroffer declined',
      fr: 'Contre-offre refusée',
      es: 'Contraoferta rechazada',
      ht: 'Yo refize kont-òf la',
      ar: 'تم رفض العرض المضاد',
    },
    body: {
      en: 'The helper declined your counteroffer. The original quote still stands.',
      fr: 'Le prestataire a refusé votre contre-offre. Le devis initial reste valable.',
      es: 'El ayudante rechazó tu contraoferta. La cotización original sigue vigente.',
      ht: 'Asistan an te refize kont-òf ou. Estimasyon orijinal la toujou valab.',
      ar: 'رفض المساعد عرضك المضاد. عرض السعر الأصلي ما زال قائما.',
    },
  },
  helper_quote_accepted: {
    title: {
      en: 'Your quote was accepted',
      fr: 'Votre devis a été accepté',
      es: 'Tu cotización fue aceptada',
      ht: 'Yo aksepte estimasyon ou',
      ar: 'تم قبول عرض السعر الخاص بك',
    },
    body: {
      en: 'The customer accepted your quote.',
      fr: 'Le client a accepté votre devis.',
      es: 'El cliente aceptó tu cotización.',
      ht: 'Kliyan an te aksepte estimasyon ou.',
      ar: 'قبل العميل عرض السعر الخاص بك.',
    },
  },
  helper_quote_declined: {
    title: {
      en: 'Your quote was declined',
      fr: 'Votre devis a été refusé',
      es: 'Tu cotización fue rechazada',
      ht: 'Yo refize estimasyon ou',
      ar: 'تم رفض عرض السعر الخاص بك',
    },
    body: {
      en: 'The customer declined your quote.',
      fr: 'Le client a refusé votre devis.',
      es: 'El cliente rechazó tu cotización.',
      ht: 'Kliyan an te refize estimasyon ou.',
      ar: 'رفض العميل عرض السعر الخاص بك.',
    },
  },
  // Group 4 Slice B (164): the helper's pending bid expires within 24 hours.
  // The body carries no hour count (the server catalog has no plural
  // forms); the exact deadline is shown on /my-bids by BidDeadlineNotice.
  bid_deadline_reminder: {
    title: {
      en: 'Your bid expires soon',
      fr: 'Votre offre expire bientôt',
      es: 'Tu oferta vence pronto',
      ht: 'Òf ou a prèt pou ekspire',
      ar: 'عرضك ينتهي قريبًا',
    },
    body: {
      en: 'Your bid on "{jobTitle}" expires within 24 hours. Review it before the deadline.',
      fr: 'Votre offre sur « {jobTitle} » expire dans moins de 24 heures. Vérifiez-la avant la date limite.',
      es: 'Tu oferta en "{jobTitle}" vence en menos de 24 horas. Revísala antes de la fecha límite.',
      ht: 'Òf ou sou "{jobTitle}" ap ekspire nan mwens pase 24 èdtan. Revize li anvan dat limit la.',
      ar: 'عرضك على "{jobTitle}" ينتهي خلال أقل من 24 ساعة. راجعه قبل الموعد النهائي.',
    },
  },
  // Group 12 Slice 3e (625): a franchise standard was updated to a new
  // version; the member has not yet acknowledged it.
  franchise_standard_updated: {
    title: {
      en: 'A franchise standard changed',
      fr: 'Un standard de franchise a changé',
      es: 'Un estándar de franquicia cambió',
      ht: 'Yon estanda franchiz chanje',
      ar: 'تغيّر أحد معايير الامتياز',
    },
    body: {
      en: '"{standardTitle}" was updated to version {version}. Please review and acknowledge it.',
      fr: '« {standardTitle} » a été mis à jour vers la version {version}. Veuillez le relire et le confirmer.',
      es: '«{standardTitle}» se actualizó a la versión {version}. Revísalo y confírmalo, por favor.',
      ht: '«{standardTitle}» te mete ajou nan vèsyon {version}. Tanpri reli li epi konfime li.',
      ar: 'تم تحديث «{standardTitle}» إلى الإصدار {version}. يُرجى مراجعته وتأكيده.',
    },
  },
  // G-6/G-7: book-for-another invite, site-contact status link, and the
  // booker's notice that the recipient responded.
  booking_recipient_invite: {
    title: {
      en: 'Booking for You',
      fr: 'Réservation pour vous',
      es: 'Reserva para ti',
      ht: 'Rezèvasyon pou ou',
      ar: 'حجز لك',
    },
    body: {
      en: 'A booking was made for you. Review it and accept or decline.',
      fr: 'Une réservation a été faite pour vous. Examinez-la et acceptez ou refusez.',
      es: 'Se hizo una reserva para ti. Revísala y acepta o rechaza.',
      ht: 'Yo fè yon rezervasyon pou ou. Gade li epi aksepte oswa refize li.',
      ar: 'تم إجراء حجز لك. راجعه واقبل أو ارفض.',
    },
  },
  booking_site_contact_link: {
    title: {
      en: 'Booking Status Link',
      fr: 'Lien de suivi de réservation',
      es: 'Enlace de estado de reserva',
      ht: 'Lyen pou swiv rezervasyon an',
      ar: 'رابط حالة الحجز',
    },
    body: {
      en: 'You are the site contact for a booking. Follow the link for status and arrival time.',
      fr: 'Vous êtes le contact sur place pour une réservation. Suivez le lien pour le statut et l’heure d’arrivée.',
      es: 'Eres el contacto en el lugar de una reserva. Sigue el enlace para ver el estado y la hora de llegada.',
      ht: 'Ou se kontak sou plas pou yon rezervasyon. Swiv lyen an pou wè estati a ak lè yo pral rive.',
      ar: 'أنت جهة الاتصال في الموقع لحجز ما. اتبع الرابط لمعرفة الحالة ووقت الوصول.',
    },
  },
  booking_recipient_response: {
    title: {
      en: 'Recipient Responded',
      fr: 'Réponse du destinataire',
      es: 'El destinatario respondió',
      ht: 'Moun k ap resevwa a te reponn',
      ar: 'ردّ المستلم',
    },
    body: {
      en: 'The recipient responded to the booking.',
      fr: 'Le destinataire a répondu à la réservation.',
      es: 'El destinatario respondió a la reserva.',
      ht: 'Moun k ap resevwa a te reponn rezervasyon an.',
      ar: 'ردّ المستلم على الحجز.',
    },
  },
  // Group 3 (Recipient and sponsor): visit reminders, arrival, completion,
  // site actions, sponsorship, link renewal, contact removal, care notes.
  booking_visit_reminder: {
    title: {
      en: 'Visit Tomorrow',
      fr: 'Visite demain',
      es: 'Visita mañana',
      ht: 'Vizit demen',
      ar: 'زيارة غداً',
    },
    body: {
      en: 'Your visit is tomorrow. Review the time and site details.',
      fr: 'Votre visite a lieu demain. Vérifiez l’heure et les détails du lieu.',
      es: 'Tu visita es mañana. Revisa la hora y los detalles del lugar.',
      ht: 'Vizit ou a se demen. Verifye lè a ak detay kote a.',
      ar: 'زيارتك غداً. راجع الوقت وتفاصيل الموقع.',
    },
  },
  booking_visit_completed: {
    title: {
      en: 'Visit Complete',
      fr: 'Visite terminée',
      es: 'Visita completada',
      ht: 'Vizit la fini',
      ar: 'اكتملت الزيارة',
    },
    body: {
      en: 'The visit is complete.',
      fr: 'La visite est terminée.',
      es: 'La visita está completada.',
      ht: 'Vizit la fini.',
      ar: 'اكتملت الزيارة.',
    },
  },
  booking_provider_arrived: {
    title: {
      en: 'Provider Arrived',
      fr: 'Prestataire arrivé',
      es: 'El proveedor llegó',
      ht: 'Pwofesyonèl la rive',
      ar: 'وصل مقدم الخدمة',
    },
    body: {
      en: 'The provider has arrived for the visit.',
      fr: 'Le prestataire est arrivé pour la visite.',
      es: 'El proveedor llegó para la visita.',
      ht: 'Pwofesyonèl la rive pou vizit la.',
      ar: 'وصل مقدم الخدمة للزيارة.',
    },
  },
  booking_site_action: {
    title: {
      en: 'Visit Update',
      fr: 'Mise à jour de la visite',
      es: 'Actualización de la visita',
      ht: 'Mizajou vizit la',
      ar: 'تحديث الزيارة',
    },
    body: {
      en: 'There is an update on the visit.',
      fr: 'Il y a une mise à jour de la visite.',
      es: 'Hay una actualización de la visita.',
      ht: 'Gen yon mizajou sou vizit la.',
      ar: 'يوجد تحديث على الزيارة.',
    },
  },
  booking_sponsor_invite: {
    title: {
      en: 'Sponsor a Visit',
      fr: 'Parrainer une visite',
      es: 'Patrocina una visita',
      ht: 'Patwone yon vizit',
      ar: 'رعاية زيارة',
    },
    body: {
      en: 'You are invited to sponsor a visit. Review the amount and deadline.',
      fr: 'Vous êtes invité à parrainer une visite. Vérifiez le montant et la date limite.',
      es: 'Te invitaron a patrocinar una visita. Revisa el monto y la fecha límite.',
      ht: 'Yo envite ou pou patwone yon vizit. Verifye montan an ak dat limit la.',
      ar: 'أنت مدعو لرعاية زيارة. راجع المبلغ والموعد النهائي.',
    },
  },
  booking_sponsor_update: {
    title: {
      en: 'Sponsorship Update',
      fr: 'Mise à jour du parrainage',
      es: 'Actualización del patrocinio',
      ht: 'Mizajou patwonaj la',
      ar: 'تحديث الرعاية',
    },
    body: {
      en: 'There is an update on the sponsorship.',
      fr: 'Il y a une mise à jour du parrainage.',
      es: 'Hay una actualización del patrocinio.',
      ht: 'Gen yon mizajou sou patwonaj la.',
      ar: 'يوجد تحديث على الرعاية.',
    },
  },
  booking_link_renewal_requested: {
    title: {
      en: 'Link Renewal Requested',
      fr: 'Renouvellement de lien demandé',
      es: 'Renovación de enlace solicitada',
      ht: 'Yo mande pou renouvle lyen an',
      ar: 'طُلب تجديد الرابط',
    },
    body: {
      en: 'Someone asked to renew the visit status link.',
      fr: 'Quelqu’un a demandé le renouvellement du lien de suivi de visite.',
      es: 'Alguien pidió renovar el enlace de estado de la visita.',
      ht: 'Yon moun mande pou renouvle lyen pou swiv vizit la.',
      ar: 'طلب شخص ما تجديد رابط حالة الزيارة.',
    },
  },
  booking_contact_removed: {
    title: {
      en: 'Visit Access Removed',
      fr: 'Accès à la visite retiré',
      es: 'Acceso a la visita eliminado',
      ht: 'Yo retire aksè vizit ou',
      ar: 'تمت إزالة الوصول إلى الزيارة',
    },
    body: {
      en: 'Your access to the visit was removed by the booker.',
      fr: 'Votre accès à la visite a été retiré par le demandeur.',
      es: 'El solicitante eliminó tu acceso a la visita.',
      ht: 'Moun ki fè rezervasyon an retire aksè ou nan vizit la.',
      ar: 'أزال صاحب الحجز وصولك إلى الزيارة.',
    },
  },
  booking_care_instructions: {
    title: {
      en: 'Care Instructions',
      fr: 'Consignes d’entretien',
      es: 'Instrucciones de cuidado',
      ht: 'Enstriksyon pou swen',
      ar: 'تعليمات العناية',
    },
    body: {
      en: 'Care instructions were shared for the visit.',
      fr: 'Des consignes d’entretien ont été partagées pour la visite.',
      es: 'Se compartieron instrucciones de cuidado para la visita.',
      ht: 'Yo pataje enstriksyon pou swen pou vizit la.',
      ar: 'تمت مشاركة تعليمات العناية للزيارة.',
    },
  },
  // Group 2: household delegate invite, delegation updates, spending
  // requests, and visit updates (reminders, replacement, unavailability,
  // emergency fallback, document forwarding).
  household_delegate_invite: {
    title: {
      en: 'Household Delegate Invite',
      fr: 'Invitation de délégué du foyer',
      es: 'Invitación de delegado del hogar',
      ht: 'Envitasyon pou delege kay la',
      ar: 'دعوة مندوب الأسرة',
    },
    body: {
      en: 'You were invited to help manage a household. Review the scope and accept or decline.',
      fr: 'Vous êtes invité à aider à gérer un foyer. Examinez le périmètre puis acceptez ou refusez.',
      es: 'Te invitaron a ayudar a gestionar un hogar. Revisa el alcance y acepta o rechaza.',
      ht: 'Yo envite ou pou ede jere yon kay. Gade sa ou ka fè epi aksepte oswa refize.',
      ar: 'تمت دعوتك للمساعدة في إدارة أسرة. راجع النطاق واقبل أو ارفض.',
    },
  },
  household_delegation_update: {
    title: {
      en: 'Household Delegation Update',
      fr: 'Mise à jour de la délégation du foyer',
      es: 'Actualización de delegación del hogar',
      ht: 'Mizajou sou delegasyon kay la',
      ar: 'تحديث تفويض الأسرة',
    },
    body: {
      en: 'A household delegation changed. Open the household page for details.',
      fr: 'Une délégation du foyer a changé. Ouvrez la page du foyer pour plus de détails.',
      es: 'Una delegación del hogar cambió. Abre la página del hogar para ver los detalles.',
      ht: 'Yon delegasyon kay la chanje. Louvri paj kay la pou detay yo.',
      ar: 'تغيّر تفويض أسرة. افتح صفحة الأسرة للتفاصيل.',
    },
  },
  household_spending_request: {
    title: {
      en: 'Spending Approval Request',
      fr: 'Demande d’approbation de dépense',
      es: 'Solicitud de aprobación de gasto',
      ht: 'Demann apwobasyon pou depans',
      ar: 'طلب الموافقة على الإنفاق',
    },
    body: {
      en: 'A household spending request needs a decision.',
      fr: 'Une demande de dépense du foyer attend une décision.',
      es: 'Una solicitud de gasto del hogar necesita una decisión.',
      ht: 'Yon demann depans kay la bezwen yon desizyon.',
      ar: 'طلب إنفاق أسرة يحتاج إلى قرار.',
    },
  },
  household_visit_update: {
    title: {
      en: 'Household Visit Update',
      fr: 'Mise à jour de visite du foyer',
      es: 'Actualización de visita del hogar',
      ht: 'Mizajou sou vizit kay la',
      ar: 'تحديث زيارة الأسرة',
    },
    body: {
      en: 'Something changed about a household visit. Open the household page for details.',
      fr: 'Quelque chose a changé pour une visite du foyer. Ouvrez la page du foyer pour plus de détails.',
      es: 'Algo cambió en una visita del hogar. Abre la página del hogar para ver los detalles.',
      ht: 'Gen yon bagay ki chanje pou yon vizit kay la. Louvri paj kay la pou detay yo.',
      ar: 'تغيّر شيء ما بشأن زيارة أسرة. افتح صفحة الأسرة للتفاصيل.',
    },
  },
  booking_approved: {
    title: {
      en: 'Booking Approved',
      fr: 'Réservation approuvée',
      es: 'Reserva aprobada',
      ht: 'Rezèvasyon an apwouve',
      ar: 'تمت الموافقة على الحجز',
    },
    body: {
      en: 'Great news! Your booking for %{toolName} has been approved.',
      fr: 'Bonne nouvelle ! Votre réservation pour %{toolName} a été approuvée.',
      es: '¡Buenas noticias! Tu reserva para %{toolName} ha sido aprobada.',
      ht: 'Bon nouvèl! Yo apwouve rezèvasyon ou pou %{toolName}.',
      ar: 'خبر رائع! تمت الموافقة على حجزك لـ%{toolName}.',
    },
  },
  booking_declined: {
    title: {
      en: 'Booking Declined',
      fr: 'Réservation refusée',
      es: 'Reserva rechazada',
      ht: 'Rezèvasyon rejte',
      ar: 'تم رفض الحجز',
    },
    body: {
      en: 'Unfortunately, your booking request for %{toolName} has been declined.',
      fr: 'Malheureusement, votre demande de réservation pour %{toolName} a été refusée.',
      es: 'Desafortunadamente, tu solicitud de reserva para %{toolName} ha sido rechazada.',
      ht: 'Malerezman, demann rezèvasyon ou pou %{toolName} rejte.',
      ar: 'للأسف، تم رفض طلب حجزك لـ%{toolName}.',
    },
  },
  // G-37: the provider changed on an accepted booking. The deposit and
  // appointment are unchanged; only the provider moves.
  booking_transferred: {
    title: {
      en: 'Booking Transferred',
      fr: 'Réservation transférée',
      es: 'Reserva transferida',
      ht: 'Rezèvasyon an transfere',
      ar: 'تم تحويل الحجز',
    },
    body: {
      en: 'Your booking has been transferred to another provider.',
      fr: 'Votre réservation a été transférée à un autre prestataire.',
      es: 'Tu reserva ha sido transferida a otro proveedor.',
      ht: 'Yo transfere rezèvasyon ou a yon lòt prestatè.',
      ar: 'تم تحويل حجزك إلى مزود آخر.',
    },
  },
  booking_dispatched: {
    title: {
      en: 'Booking Assigned to You',
      fr: 'Réservation assignée',
      es: 'Reserva asignada a ti',
      ht: 'Yo asiyen yon rezèvasyon ba ou',
      ar: 'تم إسناد حجز إليك',
    },
    body: {
      en: 'A booking has been assigned to you. Confirm it to add it to your calendar.',
      fr: 'Une réservation vous a été assignée. Confirmez-la pour l’ajouter à votre calendrier.',
      es: 'Se te asignó una reserva. Confírmala para añadirla a tu calendario.',
      ht: 'Yo asiyen yon rezèvasyon ba ou. Konfime li pou ajoute li nan kalandriye ou.',
      ar: 'تم إسناد حجز إليك. أكّده لإضافته إلى تقويمك.',
    },
  },
  vortex_approval_requested: {
    title: {
      en: 'Approval needed',
      fr: 'Approbation requise',
      es: 'Se necesita aprobación',
      ht: 'Apwobasyon nesesè',
      ar: 'مطلوب الموافقة',
    },
    body: {
      en: 'Someone redeemed an access code and is waiting for your approval.',
      fr: "Quelqu'un a utilisé un code d'accès et attend votre approbation.",
      es: 'Alguien canjeó un código de acceso y está esperando tu aprobación.',
      ht: 'Yon moun itilize yon kòd aksè epi l ap tann apwobasyon ou.',
      ar: 'شخص ما استخدم رمز وصول وينتظر موافقتك.',
    },
  },
  vortex_member_joined: {
    title: {
      en: 'New team member',
      fr: "Nouveau membre de l'équipe",
      es: 'Nuevo miembro del equipo',
      ht: 'Nouvo manm ekip',
      ar: 'عضو جديد في الفريق',
    },
    body: {
      en: 'A new member joined your business via an access code.',
      fr: "Un nouveau membre a rejoint votre entreprise grâce à un code d'accès.",
      es: 'Un nuevo miembro se unió a tu negocio con un código de acceso.',
      ht: 'Yon nouvo manm rantre nan biznis ou ak yon kòd aksè.',
      ar: 'انضم عضو جديد إلى نشاطك التجاري عبر رمز وصول.',
    },
  },
  vortex_membership_approved: {
    title: {
      en: 'You were approved',
      fr: 'Votre demande a été approuvée',
      es: 'Tu solicitud fue aprobada',
      ht: 'Yo apwouve ou',
      ar: 'تمت الموافقة عليك',
    },
    body: {
      en: 'Your request to join the business was approved.',
      fr: "Votre demande pour rejoindre l'entreprise a été approuvée.",
      es: 'Se aprobó tu solicitud para unirte al negocio.',
      ht: 'Yo apwouve demann ou pou rantre nan biznis la.',
      ar: 'تمت الموافقة على طلبك للانضمام إلى النشاط التجاري.',
    },
  },
  vortex_membership_denied: {
    title: {
      en: 'Request denied',
      fr: 'Demande refusée',
      es: 'Solicitud rechazada',
      ht: 'Demann rejte',
      ar: 'تم رفض الطلب',
    },
    body: {
      en: 'Your request to join the business was not approved.',
      fr: "Votre demande pour rejoindre l'entreprise n'a pas été approuvée.",
      es: 'Tu solicitud para unirte al negocio no fue aprobada.',
      ht: 'Yo pa apwouve demann ou pou rantre nan biznis la.',
      ar: 'لم تتم الموافقة على طلبك للانضمام إلى النشاط التجاري.',
    },
  },
  vortex_membership_removed: {
    title: {
      en: 'Removed from team',
      fr: "Retiré de l'équipe",
      es: 'Eliminado del equipo',
      ht: 'Yo retire ou nan ekip la',
      ar: 'تمت إزالتك من الفريق',
    },
    body: {
      en: 'You were removed from the business team.',
      fr: "Vous avez été retiré de l'équipe de l'entreprise.",
      es: 'Fuiste eliminado del equipo del negocio.',
      ht: 'Yo retire ou nan ekip biznis la.',
      ar: 'تمت إزالتك من فريق النشاط التجاري.',
    },
  },
  booking_cancelled: {
    title: {
      en: 'Booking Cancelled',
      fr: 'Réservation annulée',
      es: 'Reserva cancelada',
      ht: 'Rezèvasyon anile',
      ar: 'تم إلغاء الحجز',
    },
    body: {
      en: 'This booking request has been cancelled.',
      fr: 'Cette demande de réservation a été annulée.',
      es: 'Esta solicitud de reserva ha sido cancelada.',
      ht: 'Demann rezèvasyon sa a anile.',
      ar: 'تم إلغاء طلب الحجز هذا.',
    },
  },
  booking_auto_completed: {
    title: {
      en: 'Booking Completed',
      fr: 'Réservation terminée',
      es: 'Reserva completada',
      ht: 'Rezèvasyon an fini',
      ar: 'اكتمل الحجز',
    },
    body: {
      en: 'The visit was completed.',
      fr: 'La visite est terminée.',
      es: 'La visita se completó.',
      ht: 'Vizit la fini.',
      ar: 'اكتملت الزيارة.',
    },
  },
  booking_auto_released: {
    title: {
      en: 'Booking Auto Released',
      fr: 'Réservation libérée automatiquement',
      es: 'Reserva liberada automáticamente',
      ht: 'Rezèvasyon lage otomatikman',
      ar: 'تم تحرير الحجز تلقائيًا',
    },
    body: {
      en: 'A booking request has expired or auto-released.',
      fr: 'Une demande de réservation a expiré ou a été libérée automatiquement.',
      es: 'Una solicitud de reserva ha expirado o se ha liberado automáticamente.',
      ht: 'Yon demann rezèvasyon ekspire oswa li te lage otomatikman.',
      ar: 'لقد انتهت صلاحية طلب حجز أو تم تحريره تلقائيًا.',
    },
  },
  consulting_session_scheduled: {
    title: {
      en: 'New consulting session scheduled',
      fr: 'Nouvelle séance de consultation planifiée',
      es: 'Nueva sesión de consultoría programada',
      ht: 'Nouvo sesyon konsiltasyon pwograme',
      ar: 'تمت جدولة جلسة استشارية جديدة',
    },
    body: {
      en: 'A client scheduled a consulting session with you. Open your contractor dashboard to see the details and prepare.',
      fr: 'Un client a planifié une séance de consultation avec vous. Ouvrez votre tableau de bord pour voir les détails et vous préparer.',
      es: 'Un cliente programó una sesión de consultoría contigo. Abre tu panel para ver los detalles y prepararte.',
      ht: 'Yon kliyan pwograme yon sesyon konsiltasyon avè ou. Louvri tablodbò ou pou wè detay yo epi prepare ou.',
      ar: 'جدول عميل جلسة استشارية معك. افتح لوحة التحكم لعرض التفاصيل والاستعداد.',
    },
  },
  // G10-1: consultant payout leg (OxSteed Credit settlement on completion).
  consultant_payout_paid: {
    title: {
      en: 'Your consulting payout was paid',
      fr: 'Votre paiement de consultation a été versé',
      es: 'Tu pago de consultoría fue enviado',
      ht: 'Peman konsiltasyon ou an te peye',
      ar: 'تم دفع مستحقاتك الاستشارية',
    },
    body: {
      en: 'OxSteed paid {amount} in OxSteed Credit for {business}. Open your contractor dashboard to see the payout.',
      fr: 'OxSteed a versé {amount} en crédit OxSteed pour {business}. Ouvrez votre tableau de bord pour voir le paiement.',
      es: 'OxSteed pagó {amount} en crédito OxSteed por {business}. Abre tu panel para ver el pago.',
      ht: 'OxSteed te peye {amount} an kredi OxSteed pou {business}. Louvri tablodbò ou pou wè peman an.',
      ar: 'دفع OxSteed مبلغ {amount} برصيد OxSteed عن {business}. افتح لوحة التحكم لعرض الدفعة.',
    },
  },
  consultant_payout_parked: {
    title: {
      en: 'Your consulting payout is waiting',
      fr: 'Votre paiement de consultation est en attente',
      es: 'Tu pago de consultoría está en espera',
      ht: 'Peman konsiltasyon ou an ap tann',
      ar: 'مستحقاتك الاستشارية قيد الانتظار',
    },
    body: {
      en: 'Your payout of {amount} in OxSteed Credit for {business} is waiting because the Credit rail is not available right now. It will be retried automatically; no action is needed.',
      fr: 'Votre paiement de {amount} en crédit OxSteed pour {business} est en attente car le rail de crédit n’est pas disponible pour le moment. Il sera réessayé automatiquement ; aucune action n’est requise.',
      es: 'Tu pago de {amount} en crédito OxSteed por {business} está en espera porque el rail de crédito no está disponible ahora mismo. Se reintentará automáticamente; no necesitas hacer nada.',
      ht: 'Peman {amount} an kredi OxSteed pou {business} ap tann paske ray kredi a pa disponib kounye a. Y ap eseye l ankò otomatikman; ou pa bezwen fè anyen.',
      ar: 'دفعتك البالغة {amount} برصيد OxSteed عن {business} قيد الانتظار لأن مسار الائتمان غير متاح حاليا. ستتم إعادة المحاولة تلقائيا؛ لا يلزم اتخاذ أي إجراء.',
    },
  },
  consultant_payout_failed: {
    title: {
      en: 'Your consulting payout needs attention',
      fr: 'Votre paiement de consultation nécessite votre attention',
      es: 'Tu pago de consultoría necesita atención',
      ht: 'Peman konsiltasyon ou an bezwen atansyon',
      ar: 'مستحقاتك الاستشارية تحتاج إلى انتباه',
    },
    body: {
      en: 'Your payout of {amount} in OxSteed Credit for {business} could not be completed. It will be retried automatically; if it keeps failing, contact support.',
      fr: 'Votre paiement de {amount} en crédit OxSteed pour {business} n’a pas pu être effectué. Il sera réessayé automatiquement ; s’il continue d’échouer, contactez l’assistance.',
      es: 'Tu pago de {amount} en crédito OxSteed por {business} no pudo completarse. Se reintentará automáticamente; si sigue fallando, contacta con soporte.',
      ht: 'Peman {amount} an kredi OxSteed pou {business} pa t ka fini. Y ap eseye l ankò otomatikman; si l kontinye echwe, kontakte sipò.',
      ar: 'تعذّر إكمال دفعتك البالغة {amount} برصيد OxSteed عن {business}. ستتم إعادة المحاولة تلقائيا؛ وإذا استمر الفشل، تواصل مع الدعم.',
    },
  },
  appointment_requested: {
    title: {
      en: 'New appointment request',
      fr: 'Nouvelle demande de rendez-vous',
      es: 'Nueva solicitud de cita',
      ht: 'Nouvo demann randevou',
      ar: 'طلب موعد جديد',
    },
    body: {
      en: 'Hi %{recipientName},\n\n%{otherName} has requested an appointment for %{service} on %{when}. %{locationLine}Please reply to your OxSteed dashboard to review details.',
      fr: 'Bonjour %{recipientName},\n\n%{otherName} a demandé un rendez-vous pour %{service} le %{when}. %{locationLine}Veuillez consulter votre tableau de bord OxSteed pour revoir les détails.',
      es: 'Hola %{recipientName},\n\n%{otherName} ha solicitado una cita para %{service} el %{when}. %{locationLine}Revise su panel de OxSteed para confirmar los detalles.',
      ht: 'Bonjou %{recipientName},\n\n%{otherName} mande ou yon randevou pou %{service} sou %{when}. %{locationLine}Tanpri tcheke tablodbò OxSteed ou pou w revize detay yo.',
      ar: 'مرحبًا %{recipientName}،\n\n%{otherName} قد طلب موعدًا لـ%{service} في %{when}. %{locationLine}يرجى مراجعة لوحة التحكم في OxSteed لمتابعة التفاصيل.',
    },
  },
  appointment_confirmed: {
    title: {
      en: 'Appointment confirmed',
      fr: 'Rendez-vous confirmé',
      es: 'Cita confirmada',
      ht: 'Randevou konfime',
      ar: 'تم تأكيد الموعد',
    },
    body: {
      en: 'Hi %{recipientName},\n\nGreat news — your appointment on %{when} has been confirmed.',
      fr: 'Bonjour %{recipientName},\n\nBonne nouvelle — votre rendez-vous du %{when} a été confirmé.',
      es: 'Hola %{recipientName},\n\n¡Buenas noticias! Su cita del %{when} ha sido confirmada.',
      ht: 'Bonjou %{recipientName},\n\nBèl nouvèl — randevou ou nan %{when} lan konfime deja.',
      ar: 'مرحبًا %{recipientName}،\n\nأخبار جيدة — تم تأكيد موعدك في %{when}.',
    },
  },
  appointment_cancelled: {
    title: {
      en: 'Appointment cancelled',
      fr: 'Rendez-vous annulé',
      es: 'Cita cancelada',
      ht: 'Randevou anile',
      ar: 'تم إلغاء الموعد',
    },
    body: {
      en: 'Hi %{recipientName},\n\nThe appointment scheduled for %{when} has been cancelled.',
      fr: 'Bonjour %{recipientName},\n\nLe rendez-vous prévu le %{when} a été annulé.',
      es: 'Hola %{recipientName},\n\nLa cita prevista para %{when} ha sido cancelada.',
      ht: 'Bonjou %{recipientName},\n\nRandevou ki te pwograme pou %{when} lan anile.',
      ar: 'مرحبًا %{recipientName}،\n\nتم إلغاء الموعد المقرر في %{when}.',
    },
  },
  appointment_rescheduled: {
    title: {
      en: 'Appointment time changed',
      fr: 'Horaire du rendez-vous modifié',
      es: 'Cambio de hora de la cita',
      ht: 'Lè randevou a chanje',
      ar: 'تم تغيير وقت الموعد',
    },
    body: {
      en: 'Hi %{recipientName},\n\nAn appointment time has changed. Please review the updated details in your OxSteed dashboard.',
      fr: 'Bonjour %{recipientName},\n\nL’horaire d’un rendez-vous a changé. Veuillez consulter les détails mis à jour dans votre tableau de bord OxSteed.',
      es: 'Hola %{recipientName},\n\nLa hora de una cita ha cambiado. Revisa los detalles actualizados en tu panel de OxSteed.',
      ht: 'Bonjou %{recipientName},\n\nLè yon randevou chanje. Tanpri revize detay ki ajou yo nan tablodbò OxSteed ou.',
      ar: 'مرحبًا %{recipientName}،\n\nتم تغيير وقت أحد المواعيد. يرجى مراجعة التفاصيل المحدثة في لوحة تحكم OxSteed.',
    },
  },
  reminder_24h: {
    title: {
      en: 'Reminder: appointment tomorrow',
      fr: 'Rappel : votre rendez-vous demain',
      es: 'Recordatorio: cita mañana',
      ht: 'Rappel: randevou demen',
      ar: 'تذكير: موعدك غدًا',
    },
    body: {
      en: 'Hi %{recipientName},\n\nThis is a reminder: your appointment is tomorrow at %{when}.',
      fr: 'Bonjour %{recipientName},\n\nRappel : votre rendez-vous est prévu demain à %{when}.',
      es: 'Hola %{recipientName},\n\nRecordatorio: tu cita es mañana a las %{when}.',
      ht: 'Bonjou %{recipientName},\n\nSa se yon rapèl: randevou ou demen a %{when}.',
      ar: 'مرحبًا %{recipientName}،\n\nهذا تذكير: موعدك غدًا الساعة %{when}.',
    },
  },
  reminder_2h: {
    title: {
      en: 'Your appointment in 2 hours',
      fr: 'Votre rendez-vous dans 2 heures',
      es: 'Tu cita en 2 horas',
      ht: 'Randevou ou nan 2 èdtan',
      ar: 'موعدك بعد ساعتين',
    },
    body: {
      en: 'Hi %{recipientName},\n\nReminder — your appointment is about to start at %{when}.',
      fr: 'Bonjour %{recipientName},\n\nRappel — votre rendez-vous doit commencer à %{when}.',
      es: 'Hola %{recipientName},\n\nRecordatorio: tu cita comenzará a las %{when}.',
      ht: 'Bonjou %{recipientName},\n\nRappel — randevou ou ap kòmanse nan %{when}.',
      ar: 'مرحبًا %{recipientName}،\n\nتذكير — سيبدأ موعدك في %{when}.',
    },
  },
  reminder_same_day: {
    title: {
      en: 'Reminder: appointment today',
      fr: 'Rappel : rendez-vous aujourd\'hui',
      es: 'Recordatorio: cita hoy',
      ht: 'Rappel: randevou jodi a',
      ar: 'تذكير: موعدك اليوم',
    },
    body: {
      en: 'Hi %{recipientName},\n\nJust a reminder — your appointment is today at %{when}.',
      fr: 'Bonjour %{recipientName},\n\nSimple rappel — votre rendez-vous est aujourd\'hui à %{when}.',
      es: 'Hola %{recipientName},\n\nSolo un recordatorio: tu cita es hoy a las %{when}.',
      ht: 'Bonjou %{recipientName},\n\nRappel senp — randevou ou jodi a a %{when}.',
      ar: 'مرحبًا %{recipientName}،\n\nمجرد تذكير — موعدك اليوم في %{when}.',
    },
  },
  appointment_completed: {
    title: {
      en: 'Appointment completed',
      fr: 'Rendez-vous terminé',
      es: 'Cita completada',
      ht: 'Randevou fini',
      ar: 'تم اكتمال الموعد',
    },
    body: {
      en: 'Hi %{recipientName},\n\nYour appointment has been marked as complete.',
      fr: 'Bonjour %{recipientName},\n\nVotre rendez-vous a été marqué comme terminé.',
      es: 'Hola %{recipientName},\n\nTu cita se ha marcado como completada.',
      ht: 'Bonjou %{recipientName},\n\nYo make randevou ou kòm konplè.',
      ar: 'مرحبًا %{recipientName}،\n\nتم وضع علامة على موعدك كمكتمل.',
    },
  },
  background_check_passed: {
    title: {
      en: 'Background check passed!',
      fr: 'Vérification des antécédents réussie !',
      es: '¡Verificación de antecedentes aprobada!',
      ht: 'Verifikasyon background ou pase!',
      ar: 'اجتزت فحص الخلفية!',
    },
    body: {
      en: 'Your Verified badge is now live on your profile.',
      fr: 'Votre badge Vérifié est désormais actif sur votre profil.',
      es: 'Tu insignia Verificado ya está activa en tu perfil.',
      ht: 'Badj Verifye ou aktif kounye a sou pwofil ou.',
      ar: 'شارة "تم التحقق" نشطة الآن على ملفك الشخصي.',
    },
  },
  background_check_failed: {
    title: {
      en: 'Background check update',
      fr: 'Mise à jour de la vérification des antécédents',
      es: 'Actualización de verificación de antecedentes',
      ht: 'Mizajou verifikasyon background',
      ar: 'تحديث فحص الخلفية',
    },
    body: {
      en: 'Action required on your account. Please check your email.',
      fr: 'Une action est requise sur votre compte. Veuillez vérifier votre e-mail.',
      es: 'Se requiere acción en tu cuenta. Por favor revisa tu correo electrónico.',
      ht: 'Aksyon obligatwa sou kont ou. Tanpri tcheke imèl ou.',
      ar: 'مطلوب إجراء على حسابك. يرجى مراجعة بريدك الإلكتروني.',
    },
  },
  health_alert_no_recent_reviews: {
    title: {
      en: 'No recent reviews',
      fr: 'Aucun avis récent',
      es: 'Sin reseñas recientes',
      ht: 'Pa gen evalyasyon resan',
      ar: 'لا توجد تقييمات حديثة',
    },
    body: {
      en: 'You have not received any reviews in the past 30 days. Consider sending review requests to recent customers.',
      fr: "Vous n'avez reçu aucun avis au cours des 30 derniers jours. Envisagez d'envoyer des demandes d'avis à vos clients récents.",
      es: 'No has recibido ninguna reseña en los últimos 30 días. Considera enviar solicitudes de reseña a clientes recientes.',
      ht: 'Ou pa resevwa okenn evalyasyon nan 30 dènye jou yo. Konsidere voye demann evalyasyon bay kliyan resan yo.',
      ar: 'لم تتلقَّ أي تقييمات خلال الـ 30 يومًا الماضية. فكر في إرسال طلبات تقييم إلى عملائك الأخيرين.',
    },
  },
  health_alert_low_rating: {
    title: {
      en: 'Low average rating',
      fr: 'Note moyenne faible',
      es: 'Calificación promedio baja',
      ht: 'Nòt mwayen ba',
      ar: 'متوسط تقييم منخفض',
    },
    body: {
      en: 'Your average rating is below 3.5. Respond to reviews and improve service quality.',
      fr: 'Votre note moyenne est inférieure à 3,5. Répondez aux avis et améliorez la qualité du service.',
      es: 'Tu calificación promedio está por debajo de 3.5. Responde a las reseñas y mejora la calidad del servicio.',
      ht: 'Nòt mwayen ou anba 3,5. Repon evalyasyon yo epi amelyore kalite sèvis la.',
      ar: 'متوسط تقييمك أقل من 3.5. استجب للتقييمات وحسّن جودة الخدمة.',
    },
  },
  health_alert_overdue_invoices: {
    title: {
      en: 'Overdue invoices',
      fr: 'Factures en retard',
      es: 'Facturas vencidas',
      ht: 'Faktè an reta',
      ar: 'فواتير متأخرة',
    },
    body: {
      en: 'You have overdue invoice(s). Follow up with customers to collect payment.',
      fr: 'Vous avez des factures en retard. Relancez vos clients pour percevoir le paiement.',
      es: 'Tienes facturas vencidas. Haz un seguimiento con los clientes para cobrar.',
      ht: 'Ou gen faktè ki an reta. Kontakte kliyan yo pou kolekte peman.',
      ar: 'لديك فواتير متأخرة. تابع مع العملاء لتحصيل الدفع.',
    },
  },
};

const EMAIL_TEMPLATES = {
  button_text: {
    affiliate_payout_processed: {
      en: 'View Earnings',
      fr: 'Voir les gains',
      es: 'Ver ganancias',
      ht: 'Gade benefis',
      ar: 'عرض الأرباح',
    },
    affiliate_payout_voided: {
      en: 'View Earnings',
      fr: 'Voir les gains',
      es: 'Ver ganancias',
      ht: 'Gade benefis',
      ar: 'عرض الأرباح',
    },
    bid_accepted: {
      en: 'View Job',
      fr: 'Voir l\'offre',
      es: 'Ver trabajo',
      ht: 'Gade Travay',
      ar: 'عرض المهمة',
    },
    reengagement_nudge: {
      en: 'Post a New Job',
      fr: 'Publier un nouveau travail',
      es: 'Publicar un nuevo trabajo',
      ht: 'Pibliye yon nouvo travay',
      ar: 'انشر مهمة جديدة',
    },
    payment_released: {
      en: 'View Earnings',
      fr: 'Voir les gains',
      es: 'Ver ganancias',
      ht: 'Gade benefis',
      ar: 'عرض الأرباح',
    },
    payment_receipt: {
      en: 'View Job',
      fr: 'Voir la mission',
      es: 'Ver trabajo',
      ht: 'Gade travay la',
      ar: 'عرض المهمة',
    },
    refund: {
      en: 'View Job', fr: 'Voir la mission', es: 'Ver trabajo', ht: 'Gade travay la', ar: 'عرض المهمة',
    },
    refund_failed: {
      en: 'Review Refund', fr: 'Vérifier le remboursement', es: 'Revisar reembolso', ht: 'Revize ranbousman', ar: 'مراجعة الاسترداد',
    },
    subscription_renewed: {
      en: 'View Billing',
      fr: 'Voir la facturation',
      es: 'Ver facturación',
      ht: 'Gade peman',
      ar: 'عرض الفواتير',
    },
    subscription_cancelled: {
      en: 'Renew Plan',
      fr: 'Renouveler le plan',
      es: 'Renovar plan',
      ht: 'Renouvle plan an',
      ar: 'تجديد الخطة',
    },
    subscription_past_due: {
      en: 'Update Payment',
      fr: 'Mettre à jour le paiement',
      es: 'Actualizar pago',
      ht: 'Mete ajou peman an',
      ar: 'تحديث الدفع',
    },
    dispute_update: {
      en: 'View Dispute',
      fr: 'Voir le litige',
      es: 'Ver disputa',
      ht: 'Gade dosi diskisyon an',
      ar: 'عرض النزاع',
    },
    dispute_opened_against: {
      en: 'View Dispute', fr: 'Voir le litige', es: 'Ver disputa', ht: 'Gade dosi diskisyon an', ar: 'عرض النزاع',
    },
    dispute_under_review: {
      en: 'View Dispute', fr: 'Voir le litige', es: 'Ver disputa', ht: 'Gade dosi diskisyon an', ar: 'عرض النزاع',
    },
    dispute_resolved: {
      en: 'View Dispute', fr: 'Voir le litige', es: 'Ver disputa', ht: 'Gade dosi diskisyon an', ar: 'عرض النزاع',
    },
    payout_released: {
      en: 'View Earnings',
      fr: 'Voir les gains',
      es: 'Ver ganancias',
      ht: 'Gade benefis',
      ar: 'عرض الأرباح',
    },
    payout_deposited: {
      en: 'View Earnings',
      fr: 'Voir les gains',
      es: 'Ver ganancias',
      ht: 'Gade benefis',
      ar: 'عرض الأرباح',
    },
    payout_draft_created: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    payout_requested: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    payout_approved: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    driver_approved: {
      en: 'View Driving',
      fr: 'Voir la conduite',
      es: 'Ver conducción',
      ht: 'Gade kondwi',
      ar: 'عرض القيادة',
    },
    driver_payout_approved: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    driver_payout_paid: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    delivery_offer_digest: {
      en: 'View Driving',
      fr: 'Voir la conduite',
      es: 'Ver conducción',
      ht: 'Gade kondwi',
      ar: 'عرض القيادة',
    },
    payout_failed: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    payout_rejected: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    payout_reversed: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    bid_received: {
      en: 'View Job',
      fr: 'Voir l\'offre',
      es: 'Ver trabajo',
      ht: 'Gade Travay',
      ar: 'عرض المهمة',
    },
    booking_request_new: {
      en: 'View Booking Request',
      fr: 'Voir la demande de réservation',
      es: 'Ver solicitud de reserva',
      ht: 'Gade demann rezèvasyon an',
      ar: 'عرض طلب الحجز',
    },
    booking_recipient_invite: {
      en: 'View Booking',
      fr: 'Voir la réservation',
      es: 'Ver reserva',
      ht: 'Gade rezervasyon an',
      ar: 'عرض الحجز',
    },
    booking_site_contact_link: {
      en: 'View Booking Status',
      fr: 'Voir le statut de la réservation',
      es: 'Ver estado de la reserva',
      ht: 'Gade estati rezervasyon an',
      ar: 'عرض حالة الحجز',
    },
    booking_recipient_response: {
      en: 'View Bookings',
      fr: 'Voir les réservations',
      es: 'Ver reservas',
      ht: 'Gade rezervasyon yo',
      ar: 'عرض الحجوزات',
    },
    household_delegate_invite: {
      en: 'View Household',
      fr: 'Voir le foyer',
      es: 'Ver hogar',
      ht: 'Gade kay la',
      ar: 'عرض الأسرة',
    },
    household_delegation_update: {
      en: 'View Household',
      fr: 'Voir le foyer',
      es: 'Ver hogar',
      ht: 'Gade kay la',
      ar: 'عرض الأسرة',
    },
    household_spending_request: {
      en: 'View Household',
      fr: 'Voir le foyer',
      es: 'Ver hogar',
      ht: 'Gade kay la',
      ar: 'عرض الأسرة',
    },
    household_visit_update: {
      en: 'View Household',
      fr: 'Voir le foyer',
      es: 'Ver hogar',
      ht: 'Gade kay la',
      ar: 'عرض الأسرة',
    },
    booking_accepted: {
      en: 'View Calendar',
      fr: 'Voir le calendrier',
      es: 'Ver calendario',
      ht: 'Gade kalandriye a',
      ar: 'عرض الجدول الزمني',
    },
    booking_declined: {
      en: 'Post as Job',
      fr: 'Publier comme annonce',
      es: 'Publicar como trabajo',
      ht: 'Pibliye kòm travay',
      ar: 'نشر كوظيفة',
    },
    booking_cancelled: {
      en: 'View Bookings',
      fr: 'Voir les réservations',
      es: 'Ver reservas',
      ht: 'Gade randevou yo',
      ar: 'عرض الحجوزات',
    },
    booking_transferred: {
      en: 'View Bookings',
      fr: 'Voir les réservations',
      es: 'Ver reservas',
      ht: 'Gade rezèvasyon yo',
      ar: 'عرض الحجوزات',
    },
    booking_dispatched: {
      en: 'View Bookings',
      fr: 'Voir les réservations',
      es: 'Ver reservas',
      ht: 'Gade rezèvasyon yo',
      ar: 'عرض الحجوزات',
    },
    consulting_session_scheduled: {
      en: 'View Sessions',
      fr: 'Voir les séances',
      es: 'Ver sesiones',
      ht: 'Gade sesyon yo',
      ar: 'عرض الجلسات',
    },
    // G10-1: consultant payout leg.
    consultant_payout_paid: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    consultant_payout_parked: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
    consultant_payout_failed: {
      en: 'View Payouts',
      fr: 'Voir les paiements',
      es: 'Ver pagos',
      ht: 'Gade peman yo',
      ar: 'عرض المدفوعات',
    },
  booking_auto_completed: {
    title: {
      en: 'Booking Completed',
      fr: 'Réservation terminée',
      es: 'Reserva completada',
      ht: 'Rezèvasyon an fini',
      ar: 'اكتمل الحجز',
    },
    body: {
      en: 'The visit was completed.',
      fr: 'La visite est terminée.',
      es: 'La visita se completó.',
      ht: 'Vizit la fini.',
      ar: 'اكتملت الزيارة.',
    },
  },
  booking_auto_released: {
    title: {
      en: 'Booking Request Expired',
      fr: 'Demande de réservation expirée',
      es: 'La solicitud de reserva expiró',
      ht: 'Demann rezèvasyon an ekspire',
      ar: 'انتهت صلاحية طلب الحجز',
    },
    body: {
      en: 'The booking request expired without a response.',
      fr: 'La demande de réservation a expiré sans réponse.',
      es: 'La solicitud de reserva expiró sin respuesta.',
      ht: 'Demann rezèvasyon an ekspire san okenn repons.',
      ar: 'انتهت صلاحية طلب الحجز دون تلقي أي رد.',
    },
  },
  booking_request_expired: {
    en: 'Post as Job',
    fr: 'Publier comme annonce',
    es: 'Publicar como trabajo',
    ht: 'Pibliye kòm travay',
    ar: 'نشر كوظيفة',
  },
    account_banned: {
      en: 'Contact Support',
      fr: 'Contacter le support',
      es: 'Contactar soporte',
      ht: 'Rele sipò a',
      ar: 'الاتصال بالدعم',
    },
    account_restored: {
      en: 'Sign In',
      fr: 'Se connecter',
      es: 'Iniciar sesión',
      ht: 'Konekte',
      ar: 'تسجيل الدخول',
    },
    account_suspended: {
      en: 'Contact Support',
      fr: 'Contacter le support',
      es: 'Contactar soporte',
      ht: 'Rele sipò a',
      ar: 'الاتصال بالدعم',
    },
    account_restricted: {
      en: 'Contact Support',
      fr: 'Contacter le support',
      es: 'Contactar soporte',
      ht: 'Rele sipò a',
      ar: 'الاتصال بالدعم',
    },
    account_deletion_scheduled: {
      en: 'Contact Support',
      fr: 'Contacter le support',
      es: 'Contactar soporte',
      ht: 'Rele sipò a',
      ar: 'الاتصال بالدعم',
    },
    admin_warning: {
      en: 'Contact Support',
      fr: 'Contacter le support',
      es: 'Contactar soporte',
      ht: 'Rele sipò a',
      ar: 'الاتصال بالدعم',
    },
    default: {
      en: 'View Dashboard',
      fr: 'Voir le tableau de bord',
      es: 'Ver panel',
      ht: 'Gade tablodbò a',
      ar: 'عرض لوحة التحكم',
    },
    statement_ready: {
      en: 'View Statement',
      fr: 'Voir le relevé',
      es: 'Ver estado de cuenta',
      ht: 'Gade releve a',
      ar: 'عرض كشف الحساب',
    },
    statement_amended: {
      en: 'View Corrected Statement',
      fr: 'Voir le relevé corrigé',
      es: 'Ver estado de cuenta corregido',
      ht: 'Gade releve korije a',
      ar: 'عرض كشف الحساب المصحح',
    },
    audit_request_received: {
      en: 'View Audit Queue',
      fr: 'Voir la file d’audit',
      es: 'Ver cola de auditoría',
      ht: 'Gade ke odit la',
      ar: 'عرض قائمة التدقيق',
    },
    appointment_requested: {
      title: {
        en: 'New appointment request',
        fr: 'Nouvelle demande de rendez-vous',
        es: 'Nueva solicitud de cita',
        ht: 'Nouvo demann randevou',
        ar: 'طلب موعد جديد',
      },
      body: {
        en: 'Hi %{recipientName},\n\n%{otherName} has requested an appointment for %{service} on %{when}. %{locationLine}Please reply to your OxSteed dashboard to review details.',
        fr: 'Bonjour %{recipientName},\n\n%{otherName} a demandé un rendez-vous pour %{service} le %{when}. %{locationLine}Veuillez consulter votre tableau de bord OxSteed pour revoir les détails.',
        es: 'Hola %{recipientName},\n\n%{otherName} ha solicitado una cita para %{service} el %{when}. %{locationLine}Revise su panel de OxSteed para confirmar los detalles.',
        ht: 'Bonjou %{recipientName},\n\n%{otherName} mande ou yon randevou pou %{service} sou %{when}. %{locationLine}Tanpri tcheke tablodbò OxSteed ou pou w revize detay yo.',
        ar: 'مرحبًا %{recipientName}،\n\n%{otherName} قد طلب موعدًا لـ%{service} في %{when}. %{locationLine}يرجى مراجعة لوحة التحكم في OxSteed لمتابعة التفاصيل.',
      },
    },
    appointment_confirmed: {
      title: {
        en: 'Appointment confirmed',
        fr: 'Rendez-vous confirmé',
        es: 'Cita confirmada',
        ht: 'Randevou konfime',
        ar: 'تم تأكيد الموعد',
      },
      body: {
        en: 'Hi %{recipientName},\n\nGreat news — your appointment on %{when} has been confirmed.',
        fr: 'Bonjour %{recipientName},\n\nBonne nouvelle — votre rendez-vous du %{when} a été confirmé.',
        es: 'Hola %{recipientName},\n\n¡Buenas noticias! Su cita del %{when} ha sido confirmada.',
        ht: 'Bonjou %{recipientName},\n\nBèl nouvèl — randevou ou nan %{when} lan konfime deja.',
        ar: 'مرحبًا %{recipientName}،\n\nأخبار جيدة — تم تأكيد موعدك في %{when}.',
      },
    },
    appointment_cancelled: {
      title: {
        en: 'Appointment cancelled',
        fr: 'Rendez-vous annulé',
        es: 'Cita cancelada',
        ht: 'Randevou anile',
        ar: 'تم إلغاء الموعد',
      },
      body: {
        en: 'Hi %{recipientName},\n\nThe appointment scheduled for %{when} has been cancelled.',
        fr: 'Bonjour %{recipientName},\n\nLe rendez-vous prévu le %{when} a été annulé.',
        es: 'Hola %{recipientName},\n\nLa cita prevista para %{when} ha sido cancelada.',
        ht: 'Bonjou %{recipientName},\n\nRandevou ki te pwograme pou %{when} lan anile.',
        ar: 'مرحبًا %{recipientName}،\n\nتم إلغاء الموعد المقرر في %{when}.',
      },
    },
    reminder_24h: {
      title: {
        en: 'Reminder: appointment tomorrow',
        fr: 'Rappel : votre rendez-vous demain',
        es: 'Recordatorio: cita mañana',
        ht: 'Rappel: randevou demen',
        ar: 'تذكير: موعدك غدًا',
      },
      body: {
        en: 'Hi %{recipientName},\n\nThis is a reminder: your appointment is tomorrow at %{when}.',
        fr: 'Bonjour %{recipientName},\n\nRappel : votre rendez-vous est prévu demain à %{when}.',
        es: 'Hola %{recipientName},\n\nRecordatorio: tu cita es mañana a las %{when}.',
        ht: 'Bonjou %{recipientName},\n\nSa se yon rapèl: randevou ou demen a %{when}.',
        ar: 'مرحبًا %{recipientName}،\n\nهذا تذكير: موعدك غدًا الساعة %{when}.',
      },
    },
    reminder_2h: {
      title: {
        en: 'Your appointment in 2 hours',
        fr: 'Votre rendez-vous dans 2 heures',
        es: 'Tu cita en 2 horas',
        ht: 'Randevou ou nan 2 èdtan',
        ar: 'موعدك بعد ساعتين',
      },
      body: {
        en: 'Hi %{recipientName},\n\nReminder — your appointment is about to start at %{when}.',
        fr: 'Bonjour %{recipientName},\n\nRappel — votre rendez-vous doit commencer à %{when}.',
        es: 'Hola %{recipientName},\n\nRecordatorio: tu cita comenzará a las %{when}.',
        ht: 'Bonjou %{recipientName},\n\nRappel — randevou ou ap kòmanse nan %{when}.',
        ar: 'مرحبًا %{recipientName}،\n\nتذكير — سيبدأ موعدك في %{when}.',
      },
    },
    reminder_same_day: {
      title: {
        en: 'Reminder: appointment today',
        fr: 'Rappel : rendez-vous aujourd\'hui',
        es: 'Recordatorio: cita hoy',
        ht: 'Rappel: randevou jodi a',
        ar: 'تذكير: موعدك اليوم',
      },
      body: {
        en: 'Hi %{recipientName},\n\nJust a reminder — your appointment is today at %{when}.',
        fr: 'Bonjour %{recipientName},\n\nSimple rappel — votre rendez-vous est aujourd\'hui à %{when}.',
        es: 'Hola %{recipientName},\n\nSolo un recordatorio: tu cita es hoy a las %{when}.',
        ht: 'Bonjou %{recipientName},\n\nRappel senp — randevou ou jodi a a %{when}.',
        ar: 'مرحبًا %{recipientName}،\n\nمجرد تذكير — موعدك اليوم في %{when}.',
      },
    },
    appointment_completed: {
      title: {
        en: 'Appointment completed',
        fr: 'Rendez-vous terminé',
        es: 'Cita completada',
        ht: 'Randevou fini',
        ar: 'تم اكتمال الموعد',
      },
      body: {
        en: 'Hi %{recipientName},\n\nYour appointment has been marked as complete.',
        fr: 'Bonjour %{recipientName},\n\nVotre rendez-vous a été marqué comme terminé.',
        es: 'Hola %{recipientName},\n\nTu cita se ha marcado como completada.',
        ht: 'Bonjou %{recipientName},\n\nYo make randevou ou kòm konplè.',
        ar: 'مرحبًا %{recipientName}،\n\nتم وضع علامة على موعدك كمكتمل.',
      },
    },
  },
  email_common: {
    notification_footer_prefix: {
      en: "You're receiving this because you have an OxSteed account.",
      fr: 'Vous recevez ce message parce que vous avez un compte OxSteed.',
      es: 'Recibes esto porque tienes una cuenta de OxSteed.',
      ht: 'Ou ap resevwa sa paske ou gen yon kont OxSteed.',
      ar: 'تتلقى هذا لأنك تمتلك حساب OxSteed.',
    },
    manage_notifications: {
      en: 'Manage notifications',
      fr: 'Gérer les notifications',
      es: 'Gestionar notificaciones',
      ht: 'Jere notifikasyon yo',
      ar: 'إدارة الإشعارات',
    },
    unsubscribe: {
      en: 'Unsubscribe',
      fr: "Se désabonner",
      es: 'Cancelar suscripción',
      ht: 'Dekonekte',
      ar: 'إلغاء الاشتراك',
  },
    no_account_footer: {
      en: 'You received this notification from OxSteed.',
      fr: 'Vous avez reçu cette notification de la part d\'OxSteed.',
      es: 'Has recibido esta notificación de OxSteed.',
      ht: 'Ou resevwa notifikasyon sa a nan men OxSteed.',
      ar: 'لقد تلقيت هذا الإشعار من OxSteed.',
    },
  },
};

const DEFAULT_LANG = 'en';
const ALLOWED = new Set(['en', 'es', 'fr', 'ht', 'ar', 'zh', 'ko', 'sw', 'pt', 'hi', 'vi', 'ru', 'ja', 'de', 'id', 'ur', 'bn', 'it', 'tr', 'th']);

function normalizeLang(lang) {
  const parsed = String(lang || DEFAULT_LANG)
    .split(',')[0]
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();
  return ALLOWED.has(parsed) ? parsed : DEFAULT_LANG;
}

function resolve(entry, lang, fallback = '') {
  if (!entry) return fallback;
  if (typeof entry === 'string') {
    return entry;
  }
  if (!entry) return fallback;
  return entry[normalizeLang(lang)] || entry[DEFAULT_LANG] || fallback;
}

function translate(entry, lang, fallback) {
  return resolve(entry, lang, fallback);
}

// Backwards-compatible translator API.
// - t(key, lang, fallback): get a single translated scalar (e.g. 'title')
exports.t = (key, lang = DEFAULT_LANG, fallback = '') => resolve(T[key], lang, fallback);

// New helper for notification payloads with title/body pairs.
// S-19: optional params interpolate {placeholders} in the resolved copy.
function interpolatePlaceholders(text, params) {
  if (!text || !params) return text || '';
  return String(text).replace(/\{(\w+)\}/g, (m, key) =>
    params[key] === undefined || params[key] === null ? m : String(params[key])
  );
}

exports.tNotif = (key, lang = DEFAULT_LANG, params = null) => {
  const entry = T[key];
  if (!entry) return { title: '', body: '' };
  return {
    title: interpolatePlaceholders(resolve(entry.title, lang, ''), params),
    body: interpolatePlaceholders(resolve(entry.body, lang, ''), params),
  };
};

exports.tNotifEmail = (type, lang = DEFAULT_LANG) => {
  const button = EMAIL_TEMPLATES.button_text[type] || EMAIL_TEMPLATES.button_text.default;
  return {
    buttonText: translate(button, lang, translate(EMAIL_TEMPLATES.button_text.default, lang, 'View Dashboard')),
    footerPrefix: translate(EMAIL_TEMPLATES.email_common.notification_footer_prefix, lang, 'You are receiving this because you have an OxSteed account.'),
    manageNotificationsText: translate(EMAIL_TEMPLATES.email_common.manage_notifications, lang, 'Manage notifications'),
    unsubscribeText: translate(EMAIL_TEMPLATES.email_common.unsubscribe, lang, 'Unsubscribe'),
    footerFallbackText: translate(EMAIL_TEMPLATES.email_common.no_account_footer, lang, 'You received this notification from OxSteed.'),
  };
};
