import Foundation

enum GoCopyKey {
    case today
    case hire
    case shop
    case inbox
    case me
    case fastActions
    case needsAttention
    case signIn
    case languageTranslation
    case profileModes
    case profileModesHeaderBody
    case profileYourModes
    case profileHomeMode
    case profileLearnMode
    case profileToolsMode
    case profileProMode
    case profileHomeModeSubtitle
    case profileLearnModeSubtitle
    case profileToolsModeSubtitle
    case profileProModeSubtitle
    case profileSession
    case profileSignOut
    case profileEmail
    case profilePassword
    case profileTwoFactor
    case profileSignIn
    case profileTranslationDescription
    case profileAppLanguage
    case profileAutoTranslate
    case profileOriginalMessageMode
    case profileAccountChecklist
    case profileChecklistSignIn
    case profileChecklistVerify
    case profileChecklistNotifications
    case profileChecklistPayment
    case profileChecklistCalendar
    case profileConnectedExperiences
    case profileLearnHireHelper
    case profileLearnHireSubtitle
    case profileHomePro
    case profileHomeProSubtitle
    case profileLearnRentTools
    case profileLearnRentToolsSubtitle
    case profileConnectedRowArrow
    case profileArrow
    case profileCustomerDashboard
    case profileCustomerDescription
    case profileHelperMode
    case profileHelperDescription
    case profileLoadHelperOpps
    case profileBusinessOwnerLite
    case profileBusinessDescription
    case profileLogisticsLite
    case profileLogisticsDescription
    case profileLoadLogistics
    case profileJobsLabel
    case profileAppointmentsLabel
    case profileBusinessesLabel
    case profileRefreshHome
    case profileSignInLoadData
    case profileSignInLoadLogistics
    case profileHelperFallback
    case profileHelperRequest
    case profileLogisticsRequest
    case shopSkillAwareShopping
    case shopDescription
    case shopSearchMarketplace
    case shopLoadProducts
    case shopLoadingProducts
    case shopRetry
    case shopUnnamedProduct
    case shopMarketplaceItem
    case shopItemLeakRepairKit
    case shopItemLeakRepairKitDescription
    case shopItemStudFinder
    case shopItemStudFinderDescription
    case shopItemMovingStraps
    case shopItemMovingStrapsDescription
    case shopItemTrashBags
    case shopItemTrashBagsDescription
    case heroGetRealWorkHandled
    case heroWinBetterLocalJobs
    case heroRunTheFrontDesk
    case heroMoveGroupBuysCleanly
    case heroSubtitleCustomer
    case heroSubtitleHelper
    case heroSubtitleBusiness
    case heroSubtitleLogistics
    case metricOpenJobs
    case metricBookings
    case metricUnread
    case metricUpcoming
    case metricLeads
    case metricProfile
    case metricAppointments
    case metricQuotes
    case metricIntakes
    case metricRequests
    case metricCampaigns
    case metricAlerts
    case actionPostAJob
    case actionPostAJobDetail
    case actionFindHelper
    case actionFindHelperDetail
    case actionShopTheList
    case actionShopTheListDetail
    case actionOpenInbox
    case actionOpenInboxDetail
    case taskNoMessagesYet
    case taskConversation
    case taskUntitledJob
    case taskAppointment
    case taskPlannedNeed
    case taskScheduled
    case taskBadgeJob
    case taskBadgeAppointment
    case taskBadgeNeed
    case taskBadgeToday
    case taskBadgeAction
    case taskBadgeImproveMatch
    case taskBadgePayment
    case taskConfirmTomorrowAppointment
    case taskConfirmTomorrowSubtitle
    case taskReviewNewBids
    case taskReviewNewBidsSubtitle
    case taskAddPhotosToRequest
    case taskAddPhotosToRequestSubtitle
    case taskPayInvoiceDraft
    case taskPayInvoiceDraftSubtitle
    case taskBadgeImprove
    case jobDraftNeedTitle
    case jobDraftValidationMessage
    case jobDraftSavedMessage
    case signInTwoFactorCode
    case sessionTokenMissing
    case conversationTitlePrefix
    case offlineSignInToSync
    case jobPosted
    case jobRetryQueued
    case notificationPayloadPreview
    case profileOriginalMessageFallback
}

enum GoLocalization {
    static func text(_ key: GoCopyKey, language: GoLanguage) -> String {
        switch (key, language) {
        case (.today, .spanish): "Hoy"
        case (.today, .french): "Aujourd'hui"
        case (.today, .haitianCreole): "Jodi a"
        case (.today, .arabic): "اليوم"
        case (.hire, .spanish): "Contratar"
        case (.hire, .french): "Embaucher"
        case (.hire, .haitianCreole): "Anboche"
        case (.hire, .arabic): "استئجار"
        case (.shop, .spanish): "Comprar"
        case (.shop, .french): "Acheter"
        case (.shop, .haitianCreole): "Achte"
        case (.shop, .arabic): "تسوق"
        case (.inbox, .spanish): "Mensajes"
        case (.inbox, .french): "Messages"
        case (.inbox, .haitianCreole): "Mesaj"
        case (.inbox, .arabic): "الرسائل"
        case (.me, .spanish): "Yo"
        case (.me, .french): "Moi"
        case (.me, .haitianCreole): "Mwen"
        case (.me, .arabic): "أنا"
        case (.fastActions, .spanish): "Acciones rápidas"
        case (.fastActions, .french): "Actions rapides"
        case (.fastActions, .haitianCreole): "Aksyon rapid"
        case (.fastActions, .arabic): "إجراءات سريعة"
        case (.needsAttention, .spanish): "Necesita atención"
        case (.needsAttention, .french): "À traiter"
        case (.needsAttention, .haitianCreole): "Bezwen atansyon"
        case (.needsAttention, .arabic): "يحتاج اهتمامًا"
        case (.signIn, .spanish): "Iniciar sesión"
        case (.signIn, .french): "Connexion"
        case (.signIn, .haitianCreole): "Konekte"
        case (.signIn, .arabic): "تسجيل الدخول"
        case (.languageTranslation, .spanish): "Idioma y traducción"
        case (.languageTranslation, .french): "Langue et traduction"
        case (.languageTranslation, .haitianCreole): "Lang ak tradiksyon"
        case (.languageTranslation, .arabic): "اللغة والترجمة"
        case (.profileModes, .spanish): "Modos"
        case (.profileModes, .french): "Modes"
        case (.profileModes, .haitianCreole): "Mòd"
        case (.profileModes, .arabic): "الوضعيات"
        case (.profileModesHeaderBody, .spanish): "Activa las experiencias que quieras.\nCada modo funciona de forma independiente."
        case (.profileModesHeaderBody, .french): "Activez les expériences que vous voulez.\nChaque mode fonctionne de manière indépendante."
        case (.profileModesHeaderBody, .haitianCreole): "Aktive eksperyans ou vle yo.\nChak mòd travay endepandan."
        case (.profileModesHeaderBody, .arabic): "قم بتمكين التجارب التي تريدها.\nيعمل كل وضع بشكل مستقل."
        case (.profileYourModes, .spanish): "TUS MODOS"
        case (.profileYourModes, .french): "VOS MODES"
        case (.profileYourModes, .haitianCreole): "KAY MOD"
        case (.profileYourModes, .arabic): "وضعياتك"
        case (.profileHomeMode, .spanish): "Inicio"
        case (.profileHomeMode, .french): "Accueil"
        case (.profileHomeMode, .haitianCreole): "Kay"
        case (.profileHomeMode, .arabic): "الرئيسية"
        case (.profileLearnMode, .spanish): "Aprender"
        case (.profileLearnMode, .french): "Apprendre"
        case (.profileLearnMode, .haitianCreole): "Aprann"
        case (.profileLearnMode, .arabic): "تعلم"
        case (.profileToolsMode, .spanish): "Herramientas"
        case (.profileToolsMode, .french): "Outils"
        case (.profileToolsMode, .haitianCreole): "Zouti"
        case (.profileToolsMode, .arabic): "أدوات"
        case (.profileProMode, .spanish): "Pro"
        case (.profileProMode, .french): "Pro"
        case (.profileProMode, .haitianCreole): "Pro"
        case (.profileProMode, .arabic): "احترافي"
        case (.profileHomeModeSubtitle, .spanish): "Trabajos del mercado y contratación"
        case (.profileHomeModeSubtitle, .french): "Jobs de marketplace et recrutement"
        case (.profileHomeModeSubtitle, .haitianCreole): "Travay mache ak anboche"
        case (.profileHomeModeSubtitle, .arabic): "وظائف السوق والتوظيف"
        case (.profileLearnModeSubtitle, .spanish): "Videos DIY y guías paso a paso"
        case (.profileLearnModeSubtitle, .french): "Vidéos DIY et guides pas à pas"
        case (.profileLearnModeSubtitle, .haitianCreole): "Videyo DIY ak gid etap-pa-etap"
        case (.profileLearnModeSubtitle, .arabic): "مقاطع فيديو تعليمية ودلائل خطوة بخطوة"
        case (.profileToolsModeSubtitle, .spanish): "Alquiler de herramientas y equipos"
        case (.profileToolsModeSubtitle, .french): "Location d'outils et équipement"
        case (.profileToolsModeSubtitle, .haitianCreole): "Lwaye zouti ak ekipman"
        case (.profileToolsModeSubtitle, .arabic): "تأجير الأدوات والمعدات"
        case (.profileProModeSubtitle, .spanish): "Clientes, facturas y programación"
        case (.profileProModeSubtitle, .french): "Clients, factures et planification"
        case (.profileProModeSubtitle, .haitianCreole): "Kliyan, faktirasyon ak orè"
        case (.profileProModeSubtitle, .arabic): "العملاء والفواتير والجدولة"
        case (.profileSession, .spanish): "Sesión"
        case (.profileSession, .french): "Session"
        case (.profileSession, .haitianCreole): "Sesyon"
        case (.profileSession, .arabic): "الجلسة"
        case (.profileSignOut, .spanish): "Cerrar sesión"
        case (.profileSignOut, .french): "Se déconnecter"
        case (.profileSignOut, .haitianCreole): "Dekonekte"
        case (.profileSignOut, .arabic): "تسجيل الخروج"
        case (.profileEmail, .spanish): "Correo electrónico"
        case (.profileEmail, .french): "E-mail"
        case (.profileEmail, .haitianCreole): "Imel"
        case (.profileEmail, .arabic): "البريد الإلكتروني"
        case (.profilePassword, .spanish): "Contraseña"
        case (.profilePassword, .french): "Mot de passe"
        case (.profilePassword, .haitianCreole): "Modpas"
        case (.profilePassword, .arabic): "كلمة المرور"
        case (.profileTwoFactor, .spanish): "Código 2FA si es necesario"
        case (.profileTwoFactor, .french): "Code 2FA si nécessaire"
        case (.profileTwoFactor, .haitianCreole): "Kòd 2FA si sa nesesè"
        case (.profileTwoFactor, .arabic): "رمز 2FA إذا لزم الأمر"
        case (.profileSignIn, .spanish): "Iniciar sesión"
        case (.profileSignIn, .french): "Se connecter"
        case (.profileSignIn, .haitianCreole): "Konekte"
        case (.profileSignIn, .arabic): "تسجيل الدخول"
        case (.profileTranslationDescription, .spanish): "OxSteed Go admite inglés, español, francés y criollo haitiano, con traducción automática de mensajes activada por defecto."
        case (.profileTranslationDescription, .french): "OxSteed Go prend en charge l'anglais, l'espagnol, le français et le créole haïtien, avec la traduction inter-langue activée par défaut."
        case (.profileTranslationDescription, .haitianCreole): "OxSteed Go sipòte lang angle, panyòl, franse ak kreyòl ayisyen, ak tradiksyon mesaj atravè lang aktiv sou default."
        case (.profileTranslationDescription, .arabic): "يدعم OxSteed Go اللغة الإنجليزية والإسبانية والفرنسية والكريول الهايتي، مع تفعيل ترجمة الرسائل بين اللغات افتراضياً."
        case (.profileAppLanguage, .spanish): "Idioma de la aplicación"
        case (.profileAppLanguage, .french): "Langue de l'application"
        case (.profileAppLanguage, .haitianCreole): "Lang aplikasyon an"
        case (.profileAppLanguage, .arabic): "لغة التطبيق"
        case (.profileAutoTranslate, .spanish): "Auto-traducir mensajes"
        case (.profileAutoTranslate, .french): "Traduire les messages automatiquement"
        case (.profileAutoTranslate, .haitianCreole): "Ototraduire mesaj yo"
        case (.profileAutoTranslate, .arabic): "الترجمة التلقائية للرسائل"
        case (.profileOriginalMessageMode, .spanish): "Los mensajes se traducirán al"
        case (.profileOriginalMessageMode, .french): "Les messages sont traduits en"
        case (.profileOriginalMessageMode, .haitianCreole): "Mesaj yo pral tradui an"
        case (.profileOriginalMessageMode, .arabic): "تُترجم الرسائل إلى"
        case (.profileAccountChecklist, .spanish): "Lista de verificación de cuenta"
        case (.profileAccountChecklist, .french): "Liste de contrôle du compte"
        case (.profileAccountChecklist, .haitianCreole): "Lis verifikasyon kont"
        case (.profileAccountChecklist, .arabic): "قائمة التحقق للحساب"
        case (.profileChecklistSignIn, .spanish): "Iniciar sesión"
        case (.profileChecklistSignIn, .french): "Se connecter"
        case (.profileChecklistSignIn, .haitianCreole): "Konekte"
        case (.profileChecklistSignIn, .arabic): "تسجيل الدخول"
        case (.profileChecklistVerify, .spanish): "Verificar identidad"
        case (.profileChecklistVerify, .french): "Vérifier l'identité"
        case (.profileChecklistVerify, .haitianCreole): "Verifye idantite"
        case (.profileChecklistVerify, .arabic): "التحقق من الهوية"
        case (.profileChecklistNotifications, .spanish): "Activar notificaciones"
        case (.profileChecklistNotifications, .french): "Activer les notifications"
        case (.profileChecklistNotifications, .haitianCreole): "Aktive notifikasyon"
        case (.profileChecklistNotifications, .arabic): "تفعيل الإشعارات"
        case (.profileChecklistPayment, .spanish): "Conectar métodos de pago"
        case (.profileChecklistPayment, .french): "Connecter les méthodes de paiement"
        case (.profileChecklistPayment, .haitianCreole): "Konekte metòd peman"
        case (.profileChecklistPayment, .arabic): "ربط طرق الدفع"
        case (.profileChecklistCalendar, .spanish): "Habilitar sincronización de calendario"
        case (.profileChecklistCalendar, .french): "Activer la synchronisation du calendrier"
        case (.profileChecklistCalendar, .haitianCreole): "Aktive senkronizasyon kalandriye"
        case (.profileChecklistCalendar, .arabic): "تفعيل مزامنة التقويم"
        case (.profileConnectedExperiences, .spanish): "EXPERIENCIAS CONECTADAS"
        case (.profileConnectedExperiences, .french): "EXPÉRIENCES CONNECTÉES"
        case (.profileConnectedExperiences, .haitianCreole): "EKSPERYANS KONEKTE"
        case (.profileConnectedExperiences, .arabic): "التجارب المترابطة"
        case (.profileLearnHireHelper, .spanish): "Aprender → Contratar un asistente"
        case (.profileLearnHireHelper, .french): "Apprendre → Engager un assistant"
        case (.profileLearnHireHelper, .haitianCreole): "Aprann → Anboche yon èd"
        case (.profileLearnHireHelper, .arabic): "تعلم → توظيف مساعد"
        case (.profileLearnHireSubtitle, .spanish): "Aprende o hazlo tú mismo"
        case (.profileLearnHireSubtitle, .french): "Apprenez-le ou faites-le vous-même"
        case (.profileLearnHireSubtitle, .haitianCreole): "Aprann li oswa fè l ou menm"
        case (.profileLearnHireSubtitle, .arabic): "تعلمه أو قم به بنفسك"
        case (.profileHomePro, .spanish): "Inicio → Abrir en Pro"
        case (.profileHomePro, .french): "Accueil → Ouvrir en Pro"
        case (.profileHomePro, .haitianCreole): "Kay → Louvri nan Pro"
        case (.profileHomePro, .arabic): "الرئيسية → فتح في Pro"
        case (.profileHomeProSubtitle, .spanish): "Gestiona trabajos en tu negocio"
        case (.profileHomeProSubtitle, .french): "Gérez les missions dans votre activité"
        case (.profileHomeProSubtitle, .haitianCreole): "Jere travay nan biznis ou"
        case (.profileHomeProSubtitle, .arabic): "إدارة الوظائف في عملك"
        case (.profileLearnRentTools, .spanish): "Aprender → Alquilar herramientas"
        case (.profileLearnRentTools, .french): "Apprendre → Louer des outils"
        case (.profileLearnRentTools, .haitianCreole): "Aprann → Lwe zouti"
        case (.profileLearnRentTools, .arabic): "تعلم → استئجار الأدوات"
        case (.profileLearnRentToolsSubtitle, .spanish): "Consigue las herramientas que necesitas"
        case (.profileLearnRentToolsSubtitle, .french): "Obtenez les outils dont vous avez besoin"
        case (.profileLearnRentToolsSubtitle, .haitianCreole): "Jwenn zouti ou bezwen an"
        case (.profileLearnRentToolsSubtitle, .arabic): "احصل على الأدوات التي تحتاجها"
        case (.profileConnectedRowArrow, .spanish): "→"
        case (.profileConnectedRowArrow, .french): "→"
        case (.profileConnectedRowArrow, .haitianCreole): "→"
        case (.profileConnectedRowArrow, .arabic): "→"
        case (.profileArrow, .spanish): "→"
        case (.profileArrow, .french): "→"
        case (.profileArrow, .haitianCreole): "→"
        case (.profileArrow, .arabic): "→"
        case (.profileCustomerDashboard, .spanish): "Panel de cliente"
        case (.profileCustomerDashboard, .french): "Tableau de bord client"
        case (.profileCustomerDashboard, .haitianCreole): "Panèl kliyan"
        case (.profileCustomerDashboard, .arabic): "لوحة العميل"
        case (.profileCustomerDescription, .spanish): "Las ofertas, pujas, citas, necesidades planificadas, facturas, pedidos y disputas deberían estar disponibles sin abrir el sitio web."
        case (.profileCustomerDescription, .french): "Les offres, enchères, rendez-vous, besoins planifiés, factures, commandes et litiges doivent être accessibles sans ouvrir le site web."
        case (.profileCustomerDescription, .haitianCreole): "Òf, òf, randevou, bezwen planifye, fakti, kòmann, ak konfli ta dwe aksesib san ou pa louvri sit entènèt la."
        case (.profileCustomerDescription, .arabic): "يجب أن تكون الوظائف والعروض والمواعيد والاحتياجات المخطط لها والفواتير والطلبات والنزاعات متاحة دون فتح الموقع الإلكتروني."
        case (.profileHelperMode, .spanish): "Modo de ayudante"
        case (.profileHelperMode, .french): "Mode assistant"
        case (.profileHelperMode, .haitianCreole): "Mòd ede"
        case (.profileHelperMode, .arabic): "وضع المساعد"
        case (.profileHelperDescription, .spanish): "Ofertas disponibles, postulación, reserva de trabajos, disponibilidad de calendario, edición de perfil, ingresos y Stripe Connect están aquí."
        case (.profileHelperDescription, .french): "Travaux disponibles, offres, acceptation/refus de réservation, disponibilité calendrier, modification de profil, revenus et Stripe Connect sont ici."
        case (.profileHelperDescription, .haitianCreole): "Travay disponib, òf, aksepte/refize rezèvasyon, disponiblite kalandriye, edisyon pwofil, revni, ak Stripe Connect yo viv isit la."
        case (.profileHelperDescription, .arabic): "الوظائف المتاحة والعروض وقبول/رفض الحجوزات وتوفر التقويم وتعديلات الملف الشخصي والأرباح و Stripe Connect متاحة هنا."
        case (.profileLoadHelperOpps, .spanish): "Cargar oportunidades de ayudantes cercanas"
        case (.profileLoadHelperOpps, .french): "Charger les opportunités proches"
        case (.profileLoadHelperOpps, .haitianCreole): "Chaje opòtinite èd toupre"
        case (.profileLoadHelperOpps, .arabic): "تحميل الفرص القريبة من المساعد"
        case (.profileBusinessOwnerLite, .spanish): "Propietario de negocio lite"
        case (.profileBusinessOwnerLite, .french): "Propriétaire d'entreprise allégé"
        case (.profileBusinessOwnerLite, .haitianCreole): "Mèt biznis ki limyè"
        case (.profileBusinessOwnerLite, .arabic): "مالك عمل خفيف"
        case (.profileBusinessDescription, .spanish): "Citas, mensajes, servicios, cotizaciones, facturas, productos y solicitudes de ingreso de equipos deben manejarse aquí."
        case (.profileBusinessDescription, .french): "Les rendez-vous, messages, services, devis, factures, produits et demandes d'entrée d'équipe doivent être gérés ici."
        case (.profileBusinessDescription, .haitianCreole): "Randevou, mesaj, sèvis, ofri pri, fakti, pwodwi, ak demann antant ekip yo jere isit la."
        case (.profileBusinessDescription, .arabic): "المواعيد والرسائل والخدمات والعروض والفواتير والمنتجات وطلبات استقبال العملاء يمكن إدارتها من هنا."
        case (.profileLogisticsLite, .spanish): "Logística lite"
        case (.profileLogisticsLite, .french): "Logistique légère"
        case (.profileLogisticsLite, .haitianCreole): "Logistik limyè"
        case (.profileLogisticsLite, .arabic): "الخدمات اللوجستية الخفيفة"
        case (.profileLogisticsDescription, .spanish): "Solicitudes de abastecimiento, campañas, etapas de envío, reclamos y alertas de compradores se pueden gestionar desde la app ligera."
        case (.profileLogisticsDescription, .french): "Les demandes d'approvisionnement, campagnes, étapes d'expédition, réclamations et alertes clients peuvent être gérées depuis l'application légère."
        case (.profileLogisticsDescription, .haitianCreole): "Demann sous-enfòmasyon, kanpay, etap livrezon, reklamasyon ak avètisman achtè yo ka jere nan aplikasyon an limyè."
        case (.profileLogisticsDescription, .arabic): "طلبات التوريد والحملات ومراحل الشحن والدعاوى وتنبيهات المشتري يمكن إدارتها من التطبيق الخفيف."
        case (.profileLoadLogistics, .spanish): "Cargar solicitudes logísticas"
        case (.profileLoadLogistics, .french): "Charger les demandes logistiques"
        case (.profileLoadLogistics, .haitianCreole): "Chaje demann lojistik"
        case (.profileLoadLogistics, .arabic): "تحميل طلبات الخدمات اللوجستية"
        case (.profileJobsLabel, .spanish): "Trabajos"
        case (.profileJobsLabel, .french): "Travaux"
        case (.profileJobsLabel, .haitianCreole): "Travay"
        case (.profileJobsLabel, .arabic): "وظائف"
        case (.profileAppointmentsLabel, .spanish): "Citas"
        case (.profileAppointmentsLabel, .french): "Rendez-vous"
        case (.profileAppointmentsLabel, .haitianCreole): "Randevou"
        case (.profileAppointmentsLabel, .arabic): "مواعيد"
        case (.profileBusinessesLabel, .spanish): "Empresas"
        case (.profileBusinessesLabel, .french): "Entreprises"
        case (.profileBusinessesLabel, .haitianCreole): "Biznis"
        case (.profileBusinessesLabel, .arabic): "الشركات"
        case (.profileRefreshHome, .spanish): "Actualizar Home para cargar datos del cliente en vivo."
        case (.profileRefreshHome, .french): "Actualiser l'accueil pour charger les données client en direct."
        case (.profileRefreshHome, .haitianCreole): "Renouvle Kay pou chaje done kliyan an an dirèk."
        case (.profileRefreshHome, .arabic): "قم بتحديث الرئيسية لتحميل بيانات العميل المباشرة."
        case (.profileSignInLoadData, .spanish): "Inicia sesión para cargar datos del cliente en vivo."
        case (.profileSignInLoadData, .french): "Connectez-vous pour charger les données client en direct."
        case (.profileSignInLoadData, .haitianCreole): "Konekte pou chaje done kliyan an an dirèk."
        case (.profileSignInLoadData, .arabic): "سجّل الدخول لتحميل بيانات العميل المباشرة."
        case (.profileSignInLoadLogistics, .spanish): "Inicia sesión para cargar solicitudes de logística."
        case (.profileSignInLoadLogistics, .french): "Connectez-vous pour charger les demandes logistiques."
        case (.profileSignInLoadLogistics, .haitianCreole): "Konekte pou chaje demann lojistik."
        case (.profileSignInLoadLogistics, .arabic): "سجّل الدخول لتحميل طلبات الخدمات اللوجستية."
        case (.profileHelperRequest, .spanish): "Solicitud #\(\$0.id)"
        case (.profileHelperRequest, .french): "Demande #\(\$0.id)"
        case (.profileHelperRequest, .haitianCreole): "Demann #\(\$0.id)"
        case (.profileHelperRequest, .arabic): "طلب #\(\$0.id)"
        case (.profileLogisticsRequest, .spanish): "Solicitud #\(\$0.id)"
        case (.profileLogisticsRequest, .french): "Demande #\(\$0.id)"
        case (.profileLogisticsRequest, .haitianCreole): "Demann #\(\$0.id)"
        case (.profileLogisticsRequest, .arabic): "طلب #\(\$0.id)"
        case (.shopSkillAwareShopping, .spanish): "Compras conscientes de habilidades"
        case (.shopSkillAwareShopping, .french): "Shopping adapté aux compétences"
        case (.shopSkillAwareShopping, .haitianCreole): "Acha ki konsyan de ladrès"
        case (.shopSkillAwareShopping, .arabic): "تسوق واعٍ بالمهارات"
        case (.shopDescription, .spanish): "Una interfaz de usuario más simple para el mercado: suministros, herramientas, alquileres y listas recomendadas vinculadas a un borrador de trabajo."
        case (.shopDescription, .french): "Une surface utilisateur plus simple pour le marché : fournitures, outils, locations et listes recommandées liées à un brouillon de mission."
        case (.shopDescription, .haitianCreole): "Yon entèfas itilizatè pi senp pou mache a: pwodwi, zouti, lwe, ak lis rekòmande ki lye ak yon pwojè travay."
        case (.shopDescription, .arabic): "واجهة استخدام أبسط لسوق العمل: مستلزمات وأدوات وتأجير وقوائم مخصصة مرتبطة بمسودة عمل."
        case (.shopSearchMarketplace, .spanish): "Buscar en el mercado"
        case (.shopSearchMarketplace, .french): "Rechercher sur la marketplace"
        case (.shopSearchMarketplace, .haitianCreole): "Chèche nan mache a"
        case (.shopSearchMarketplace, .arabic): "البحث في السوق"
        case (.shopLoadProducts, .spanish): "Cargar productos"
        case (.shopLoadProducts, .french): "Charger les produits"
        case (.shopLoadProducts, .haitianCreole): "Chaje pwodwi yo"
        case (.shopLoadProducts, .arabic): "تحميل المنتجات"
        case (.shopLoadingProducts, .spanish): "Cargando productos"
        case (.shopLoadingProducts, .french): "Chargement des produits"
        case (.shopLoadingProducts, .haitianCreole): "L ap chaje pwodwi yo"
        case (.shopLoadingProducts, .arabic): "جارٍ تحميل المنتجات"
        case (.shopRetry, .spanish): "Reintentar"
        case (.shopRetry, .french): "Réessayer"
        case (.shopRetry, .haitianCreole): "Eseye ankò"
        case (.shopRetry, .arabic): "إعادة المحاولة"
        case (.shopUnnamedProduct, .spanish): "Producto sin nombre"
        case (.shopUnnamedProduct, .french): "Produit sans nom"
        case (.shopUnnamedProduct, .haitianCreole): "Pwodwi san non"
        case (.shopUnnamedProduct, .arabic): "منتج بدون اسم"
        case (.shopMarketplaceItem, .spanish): "Artículo de marketplace"
        case (.shopMarketplaceItem, .french): "Article du marketplace"
        case (.shopMarketplaceItem, .haitianCreole): "Atik mache a"
        case (.shopMarketplaceItem, .arabic): "عنصر من السوق"
        case (.shopItemLeakRepairKit, .spanish): "Kit de reparación de fugas"
        case (.shopItemLeakRepairKit, .french): "Kit de réparation des fuites"
        case (.shopItemLeakRepairKit, .haitianCreole): "Kite reparasyon ti koule"
        case (.shopItemLeakRepairKit, .arabic): "طقم إصلاح التسرب"
        case (.shopItemLeakRepairKitDescription, .spanish): "Para lavabos, grifos y pequeñas reparaciones de tuberías"
        case (.shopItemLeakRepairKitDescription, .french): "Pour évier, robinet et petites réparations de tuyaux"
        case (.shopItemLeakRepairKitDescription, .haitianCreole): "Pou asyèt, kran e ti repa tiyo"
        case (.shopItemLeakRepairKitDescription, .arabic): "للأحواض، الصنابير وإصلاحات الأنابيب الصغيرة"
        case (.shopItemStudFinder, .spanish): "Buscador de montantes"
        case (.shopItemStudFinder, .french): "Détecteur de montants"
        case (.shopItemStudFinder, .haitianCreole): "Detektè etajè"
        case (.shopItemStudFinder, .arabic): "كاشف العوارض"
        case (.shopItemStudFinderDescription, .spanish): "Útil para estanterías, montajes y gabinetes"
        case (.shopItemStudFinderDescription, .french): "Utile pour étagères, montages et armoires"
        case (.shopItemStudFinderDescription, .haitianCreole): "Utile pou etajè, monti, ak kabinè"
        case (.shopItemStudFinderDescription, .arabic): "مفيد للرفوف والحاملات والخزائن"
        case (.shopItemMovingStraps, .spanish): "Cintas de transporte"
        case (.shopItemMovingStraps, .french): "Sangles de déménagement"
        case (.shopItemMovingStraps, .haitianCreole): "Salyab pote chaj"
        case (.shopItemMovingStraps, .arabic): "أشرطة التحريك"
        case (.shopItemMovingStrapsDescription, .spanish): "Asistente de logística para alquileres"
        case (.shopItemMovingStrapsDescription, .french): "Assistant logistique adapté à la location"
        case (.shopItemMovingStrapsDescription, .haitianCreole): "Èd lojistik pou lwe"
        case (.shopItemMovingStrapsDescription, .arabic): "مساعد لوجستي مناسب للإيجار"
        case (.shopItemTrashBags, .spanish): "Bols de basura para contratistas"
        case (.shopItemTrashBags, .french): "Sacs d'ordures pour entrepreneurs"
        case (.shopItemTrashBags, .haitianCreole): "Sak fatra pou kontraktè yo"
        case (.shopItemTrashBags, .arabic): "أكياس نفايات المقاولين"
        case (.shopItemTrashBagsDescription, .spanish): "Complemento frecuente para trabajos de limpieza"
        case (.shopItemTrashBagsDescription, .french): "Ajouter couramment pour les travaux de nettoyage"
        case (.shopItemTrashBagsDescription, .haitianCreole): "Konpleman ki souvan itil pou travay netwayaj"
        case (.shopItemTrashBagsDescription, .arabic): "إضافة شائعة لمهام التنظيف"
        default:
            english(key)
        }
    }

    private static func english(_ key: GoCopyKey) -> String {
        switch key {
        case .today: "Today"
        case .hire: "Hire"
        case .shop: "Shop"
        case .inbox: "Inbox"
        case .me: "Me"
        case .fastActions: "Fast Actions"
        case .needsAttention: "Needs Attention"
        case .signIn: "Sign in"
        case .languageTranslation: "Language & Translation"
        case .profileModes: "Modes"
        case .profileModesHeaderBody: "Enable the experiences you want.\nEach mode works independently."
        case .profileYourModes: "YOUR MODES"
        case .profileHomeMode: "Home"
        case .profileLearnMode: "Learn"
        case .profileToolsMode: "Tools"
        case .profileProMode: "Pro"
        case .profileHomeModeSubtitle: "Marketplace jobs & hiring"
        case .profileLearnModeSubtitle: "DIY videos & step-by-step guides"
        case .profileToolsModeSubtitle: "Tool rentals & equipment"
        case .profileProModeSubtitle: "Clients, invoices & scheduling"
        case .profileSession: "Session"
        case .profileSignOut: "Sign Out"
        case .profileEmail: "Email"
        case .profilePassword: "Password"
        case .profileTwoFactor: "2FA code if required"
        case .profileSignIn: "Sign In"
        case .profileTranslationDescription: "OxSteed Go supports English, Spanish, French, and Haitian Creole, with cross-language message translation on by default."
        case .profileAppLanguage: "App language"
        case .profileAutoTranslate: "Auto-translate messages"
        case .profileOriginalMessageMode: "Messages are translated to"
        case .profileAccountChecklist: "Account checklist"
        case .profileChecklistSignIn: "Sign in"
        case .profileChecklistVerify: "Verify identity"
        case .profileChecklistNotifications: "Turn on notifications"
        case .profileChecklistPayment: "Connect payment methods"
        case .profileChecklistCalendar: "Enable calendar sync"
        case .profileConnectedExperiences: "CONNECTED EXPERIENCES"
        case .profileLearnHireHelper: "Learn → Hire a helper"
        case .profileLearnHireSubtitle: "Learn it or get it done"
        case .profileHomePro: "Home → Open in Pro"
        case .profileHomeProSubtitle: "Manage jobs in your business"
        case .profileLearnRentTools: "Learn → Rent tools"
        case .profileLearnRentToolsSubtitle: "Get the tools you need"
        case .profileConnectedRowArrow: "→"
        case .profileArrow: "→"
        case .profileCustomerDashboard: "Customer dashboard"
        case .profileCustomerDescription: "Jobs, bids, appointments, planned needs, invoices, orders, and disputes should be reachable without opening the website."
        case .profileHelperMode: "Helper mode"
        case .profileHelperDescription: "Available jobs, bids, booking accept/decline, calendar availability, profile edits, earnings, and Stripe Connect live here."
        case .profileLoadHelperOpps: "Load nearby helper opportunities"
        case .profileBusinessOwnerLite: "Business owner lite"
        case .profileBusinessDescription: "Appointments, messages, services, quotes, invoices, products, team basics, and intake requests should be handled here."
        case .profileLogisticsLite: "Logistics lite"
        case .profileLogisticsDescription: "Sourcing requests, campaigns, shipment milestones, claims, and buyer alerts can be handled from the lightweight app."
        case .profileLoadLogistics: "Load logistics requests"
        case .profileJobsLabel: "Jobs"
        case .profileAppointmentsLabel: "Appointments"
        case .profileBusinessesLabel: "Businesses"
        case .profileRefreshHome: "Refresh Home to load live customer data."
        case .profileSignInLoadData: "Sign in to load live customer data."
        case .profileSignInLoadLogistics: "Sign in to load logistics requests."
        case .profileHelperFallback: "Helper #"
        case .profileLogisticsFallback: "Request #"
        case .shopSkillAwareShopping: "Skill-Aware Shopping"
        case .shopDescription: "A simpler user app surface for the marketplace: supplies, tools, rentals, and recommended lists tied to a job draft."
        case .shopSearchMarketplace: "Search marketplace"
        case .shopLoadProducts: "Load Products"
        case .shopLoadingProducts: "Loading products"
        case .shopRetry: "Retry"
        case .shopUnnamedProduct: "Unnamed product"
        case .shopMarketplaceItem: "Marketplace item"
        case .shopItemLeakRepairKit: "Leak repair kit"
        case .shopItemLeakRepairKitDescription: "For sink, faucet, and small pipe fixes"
        case .shopItemStudFinder: "Stud finder"
        case .shopItemStudFinderDescription: "Useful for shelves, mounts, and cabinets"
        case .shopItemMovingStraps: "Moving straps"
        case .shopItemMovingStrapsDescription: "Rental-friendly logistics helper"
        case .shopItemTrashBags: "Contractor trash bags"
        case .shopItemTrashBagsDescription: "Common add-on for cleanup jobs"
        case .heroGetRealWorkHandled: "Get real work handled"
        case .heroWinBetterLocalJobs: "Win better local jobs"
        case .heroRunTheFrontDesk: "Run the front desk"
        case .heroMoveGroupBuysCleanly: "Move group buys cleanly"
        case .heroSubtitleCustomer: "Post a job, book a trusted pro, shop the right supplies, and keep the whole conversation in one pocket-sized command center."
        case .heroSubtitleHelper: "See nearby opportunities, incoming bookings, customer messages, earnings nudges, and profile tasks without hunting through the full platform."
        case .heroSubtitleBusiness: "Manage appointments, services, quotes, invoices, intake requests, team basics, and customer messages from a lighter business-owner view."
        case .heroSubtitleLogistics: "Track sourcing requests, campaigns, shipments, and buyer actions from the simpler OxSteed Go surface."
        case .metricOpenJobs: "Open jobs"
        case .metricBookings: "Bookings"
        case .metricUnread: "Unread"
        case .metricUpcoming: "Upcoming"
        case .metricLeads: "Leads"
        case .metricProfile: "Profile"
        case .metricAppointments: "Appointments"
        case .metricQuotes: "Quotes"
        case .metricIntakes: "Intakes"
        case .metricRequests: "Requests"
        case .metricCampaigns: "Campaigns"
        case .metricAlerts: "Alerts"
        case .actionPostAJob: "Post a job"
        case .actionPostAJobDetail: "Describe the work, location, urgency, and budget in a native quick-post flow."
        case .actionFindHelper: "Find a helper"
        case .actionFindHelperDetail: "Search trusted local helpers and start a booking or message."
        case .actionShopTheList: "Shop the list"
        case .actionShopTheListDetail: "Browse skill-aware supplies and tools for the job you are planning."
        case .actionOpenInbox: "Open inbox"
        case .actionOpenInboxDetail: "Keep job, booking, support, and business conversations together."
        case .taskNoMessagesYet: "No messages yet"
        case .taskConversation: "Conversation"
        case .taskUntitledJob: "Untitled job"
        case .taskAppointment: "Appointment"
        case .taskPlannedNeed: "Planned need"
        case .taskScheduled: "Scheduled"
        case .taskBadgeJob: "Job"
        case .taskBadgeAppointment: "Calendar"
        case .taskBadgeNeed: "Need"
        case .taskBadgeToday: "Today"
        case .taskBadgeAction: "Action"
        case .taskBadgeImproveMatch: "Improve match"
        case .taskBadgePayment: "Payment"
        case .taskConfirmTomorrowAppointment: "Confirm tomorrow's appointment"
        case .taskConfirmTomorrowSubtitle: "Sink repair with Carter Plumbing"
        case .taskReviewNewBids: "Review two new bids"
        case .taskReviewNewBidsSubtitle: "Back fence repair"
        case .taskAddPhotosToRequest: "Add photos to your request"
        case .taskAddPhotosToRequestSubtitle: "Garage shelf install"
        case .taskPayInvoiceDraft: "Pay invoice draft"
        case .taskPayInvoiceDraftSubtitle: "OxSteed invoice INV-1042"
        case .taskBadgeImprove: "Improve match"
        case .jobDraftNeedTitle: "Add a title before saving this job draft."
        case .jobDraftValidationMessage: "Add a title, city, and at least 20 characters of detail."
        case .jobDraftSavedMessage: "Saved '%@' as a native job draft."
        case .signInTwoFactorCode: "Enter your two-factor code to finish signing in."
        case .sessionTokenMissing: "OxSteed did not return a session token."
        case .conversationTitlePrefix: "Conversation"
        case .offlineSignInToSync: "Saved offline. Sign in to sync this job draft."
        case .jobPosted: "Posted '%@' to OxSteed."
        case .jobRetryQueued: "Could not post yet. Queued for retry."
        case .notificationPayloadPreview: "Route this push into the exact native screen."
        case .profileOriginalMessageFallback: "Original message text will be shown unless you turn translation back on."
        }
    }
}
