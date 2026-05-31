const T = {
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
  return ALLOWED.has(lang) ? lang : DEFAULT_LANG;
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
