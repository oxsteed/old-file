const T = {
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
  ...require('./localDeliveryNotifications').deliveryNotifications,
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
const ALLOWED = new Set(['en', 'es', 'fr', 'ht', 'ar']);

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
exports.tNotif = (key, lang = DEFAULT_LANG) => {
  const entry = T[key];
  if (!entry) return { title: '', body: '' };
  return {
    title: resolve(entry.title, lang, ''),
    body: resolve(entry.body, lang, ''),
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
