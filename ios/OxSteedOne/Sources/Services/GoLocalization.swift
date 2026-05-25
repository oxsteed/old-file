import Foundation

enum OneLocalization {
    static func appName() -> String { "OxSteed One" }

    static func localized(_ key: String, language: AppLanguage, fallback: String) -> String {
        table[language]?[key] ?? table[.english]?[key] ?? fallback
    }

    private static let table: [AppLanguage: [String: String]] = [
        .english: [
            "auth.title": "One Account. Many Roles.",
            "auth.subtitle": "Sign in to load your personas, messages, and transactions.",
            "auth.sign_in": "Sign In",
            "auth.create_account": "Create Account",
            "auth.welcome_back": "Welcome Back",
            "auth.full_legal_name": "Full legal name",
            "auth.accept_terms": "I agree to Terms of Service and Privacy Policy",
            "auth.create_account_title": "Create Account",
            "auth.primary_persona": "Primary Persona",
            "profile.settings": "Settings",
            "profile.security": "Security",
            "profile.communication": "Communication",
            "profile.push_title": "Push Notifications",
            "profile.push_enable": "Enable Push Notifications",
            "profile.push_authorized": "Authorized",
            "profile.push_denied": "Denied in system settings",
            "profile.push_not_determined": "Not requested yet",
            "profile.push_unknown": "Unknown",
            "profile.sign_out": "Sign Out",
            "force_update.title": "Update Required",
            "force_update.body": "Please update OxSteed One to continue.",
            "lock.title": "OxSteed One Locked",
            "lock.button": "Unlock with Face ID / Touch ID",
            "sync.offline": "Offline Mode",
            "sync.pending": "Sync Queue Pending",
            "sync.offline_detail": "Changes are saved locally and will sync when connection returns.",
            "sync.button": "Sync"
        ],
        .spanish: [
            "auth.title": "Una cuenta. Muchos roles.",
            "auth.subtitle": "Inicia sesión para cargar tus perfiles, mensajes y transacciones.",
            "auth.sign_in": "Iniciar sesión",
            "auth.create_account": "Crear cuenta",
            "profile.settings": "Configuración",
            "profile.security": "Seguridad",
            "profile.communication": "Comunicación",
            "profile.push_title": "Notificaciones Push",
            "profile.push_enable": "Activar notificaciones Push",
            "profile.sign_out": "Cerrar sesión",
            "force_update.title": "Actualización requerida",
            "force_update.body": "Actualiza OxSteed One para continuar.",
            "lock.title": "OxSteed One bloqueado",
            "lock.button": "Desbloquear con Face ID / Touch ID",
            "sync.offline": "Modo sin conexión",
            "sync.pending": "Sincronización pendiente",
            "sync.button": "Sincronizar"
        ],
        .french: [
            "auth.title": "Un compte. Plusieurs rôles.",
            "auth.subtitle": "Connectez-vous pour charger vos profils, messages et transactions.",
            "auth.sign_in": "Se connecter",
            "auth.create_account": "Créer un compte",
            "profile.settings": "Paramètres",
            "profile.security": "Sécurité",
            "profile.communication": "Communication",
            "profile.push_title": "Notifications Push",
            "profile.push_enable": "Activer les notifications Push",
            "profile.sign_out": "Se déconnecter",
            "force_update.title": "Mise à jour requise",
            "force_update.body": "Veuillez mettre à jour OxSteed One pour continuer.",
            "lock.title": "OxSteed One verrouillé",
            "lock.button": "Déverrouiller avec Face ID / Touch ID",
            "sync.offline": "Mode hors ligne",
            "sync.pending": "Synchronisation en attente",
            "sync.button": "Synchroniser"
        ],
        .haitianCreole: [
            "auth.title": "Yon kont. Anpil wòl.",
            "auth.subtitle": "Konekte pou chaje pwofil, mesaj, ak tranzaksyon ou yo.",
            "auth.sign_in": "Konekte",
            "auth.create_account": "Kreye kont",
            "profile.settings": "Paramèt",
            "profile.security": "Sekirite",
            "profile.communication": "Kominikasyon",
            "profile.push_title": "Notifikasyon Push",
            "profile.push_enable": "Aktive notifikasyon Push",
            "profile.sign_out": "Dekonekte",
            "force_update.title": "Mizajou obligatwa",
            "force_update.body": "Tanpri mete ajou OxSteed One pou kontinye.",
            "lock.title": "OxSteed One fèmen",
            "lock.button": "Degaje ak Face ID / Touch ID",
            "sync.offline": "Mòd offline",
            "sync.pending": "Senkronizasyon an atant",
            "sync.button": "Senkronize"
        ]
    ]
}
