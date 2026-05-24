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
}

enum GoLocalization {
    static func text(_ key: GoCopyKey, language: GoLanguage) -> String {
        switch (key, language) {
        case (.today, .spanish): "Hoy"
        case (.today, .french): "Aujourd'hui"
        case (.today, .haitianCreole): "Jodi a"
        case (.hire, .spanish): "Contratar"
        case (.hire, .french): "Embaucher"
        case (.hire, .haitianCreole): "Anboche"
        case (.shop, .spanish): "Comprar"
        case (.shop, .french): "Acheter"
        case (.shop, .haitianCreole): "Achte"
        case (.inbox, .spanish): "Mensajes"
        case (.inbox, .french): "Messages"
        case (.inbox, .haitianCreole): "Mesaj"
        case (.me, .spanish): "Yo"
        case (.me, .french): "Moi"
        case (.me, .haitianCreole): "Mwen"
        case (.fastActions, .spanish): "Acciones rápidas"
        case (.fastActions, .french): "Actions rapides"
        case (.fastActions, .haitianCreole): "Aksyon rapid"
        case (.needsAttention, .spanish): "Necesita atención"
        case (.needsAttention, .french): "À traiter"
        case (.needsAttention, .haitianCreole): "Bezwen atansyon"
        case (.signIn, .spanish): "Iniciar sesión"
        case (.signIn, .french): "Connexion"
        case (.signIn, .haitianCreole): "Konekte"
        case (.languageTranslation, .spanish): "Idioma y traducción"
        case (.languageTranslation, .french): "Langue et traduction"
        case (.languageTranslation, .haitianCreole): "Lang ak tradiksyon"
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
        }
    }
}
