import SwiftUI

/// Tiny helper namespace for localized keys. Lets us write `L10n.tab(.home)`
/// instead of remembering raw key strings, with compile-time safety.
///
/// All values return `LocalizedStringKey` so SwiftUI looks them up via the
/// environment's `\.locale`, which we override from `LocalizationManager`.
enum L10n {

    // MARK: - Tabs

    enum TabKey: String {
        case home, life, growth, learn
        var key: LocalizedStringKey { LocalizedStringKey("tab.\(rawValue)") }
    }

    static func tab(_ t: TabKey) -> LocalizedStringKey { t.key }

    // MARK: - App

    static let appName: LocalizedStringKey = "app.name"

    static var greeting: LocalizedStringKey {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12:  return "app.greeting.morning"
        case 12..<18: return "app.greeting.afternoon"
        default:      return "app.greeting.evening"
        }
    }

    // MARK: - Persona

    enum PersonaKey {
        static let actingAs: LocalizedStringKey = "persona.acting_as"
        static let switchAction: LocalizedStringKey = "persona.switch"
        static let title: LocalizedStringKey = "persona.title"
        static let subtitle: LocalizedStringKey = "persona.subtitle"

        static func name(for persona: Persona) -> LocalizedStringKey {
            switch persona {
            case .customer:   return "persona.customer"
            case .helper:     return "persona.helper"
            case .business:   return "persona.business"
            case .consultant: return "persona.consultant"
            case .toolOwner:  return "persona.tool_owner"
            case .franchise:  return "persona.franchise"
            case .investor:   return "persona.investor"
            }
        }
    }

    // MARK: - Settings

    enum SettingsKey {
        static let title: LocalizedStringKey = "settings.title"
        static let language: LocalizedStringKey = "settings.language"
        static let languageSubtitle: LocalizedStringKey = "settings.language.subtitle"
        static let done: LocalizedStringKey = "settings.done"
        static let appearance: LocalizedStringKey = "settings.appearance"
        static let notifications: LocalizedStringKey = "settings.notifications"
        static let privacy: LocalizedStringKey = "settings.privacy"
    }

    // MARK: - Common

    enum CommonKey {
        static let cancel: LocalizedStringKey = "common.cancel"
        static let save: LocalizedStringKey = "common.save"
        static let seeAll: LocalizedStringKey = "common.see_all"
        static let search: LocalizedStringKey = "common.search"
        static let bid: LocalizedStringKey = "common.bid"
    }

    // MARK: - Section headers

    enum SectionKey {
        static let yourJobs: LocalizedStringKey = "section.your_jobs"
        static let messages: LocalizedStringKey = "section.messages"
        static let availableNearYou: LocalizedStringKey = "section.available_near_you"
        static let yourTeam: LocalizedStringKey = "section.your_team"
        static let urgencyQueue: LocalizedStringKey = "section.urgency_queue"
        static let sixPillars: LocalizedStringKey = "section.six_pillars"
        static let yourLadder: LocalizedStringKey = "section.your_ladder"
        static let programsForYou: LocalizedStringKey = "section.programs_for_you"
        static let communityWholesale: LocalizedStringKey = "section.community_wholesale"
        static let startHere: LocalizedStringKey = "section.start_here"
        static let trendingArea: LocalizedStringKey = "section.trending_area"
    }

    // MARK: - Customer hero

    enum CustomerKey {
        static let eyebrow: LocalizedStringKey = "customer.eyebrow"
        static let headline: LocalizedStringKey = "customer.headline"
        static let subhead: LocalizedStringKey = "customer.subhead"
        static let postJob: LocalizedStringKey = "customer.post_job"
        static let browseHelpers: LocalizedStringKey = "customer.browse_helpers"
    }

    // MARK: - Stat tile labels

    enum StatKey {
        static let activeJobs: LocalizedStringKey = "stat.active_jobs"
        static let openQuotes: LocalizedStringKey = "stat.open_quotes"
        static let earnedThisMonth: LocalizedStringKey = "stat.earned_this_month"
        static let jobsNearby: LocalizedStringKey = "stat.jobs_nearby"
        static let activeBids: LocalizedStringKey = "stat.active_bids"
        static let rating: LocalizedStringKey = "stat.rating"
        static let teamOnline: LocalizedStringKey = "stat.team_online"
        static let invoicesPending: LocalizedStringKey = "stat.invoices_pending"
        static let inIntake: LocalizedStringKey = "stat.in_intake"
        static let thisWeek: LocalizedStringKey = "stat.this_week"
        static let toolsOut: LocalizedStringKey = "stat.tools_out"
        static let depositsHeld: LocalizedStringKey = "stat.deposits_held"
        static let subfranchisees: LocalizedStringKey = "stat.subfranchisees"
        static let compliance: LocalizedStringKey = "stat.compliance"
        static let portfolio: LocalizedStringKey = "stat.portfolio"
        static let helpersFunded: LocalizedStringKey = "stat.helpers_funded"
    }

    // MARK: - Business

    enum BusinessKey {
        static let revenueWeek: LocalizedStringKey = "business.revenue_week"
        static let weekRange: LocalizedStringKey = "business.week_range"
        static let cashappTitle: LocalizedStringKey = "business.cashapp_title"
        static let cashappShare: LocalizedStringKey = "business.cashapp_share"
    }

    // MARK: - Empty states

    enum ConsultantKey {
        static let emptyTitle: LocalizedStringKey = "consultant.empty.title"
        static let emptyMessage: LocalizedStringKey = "consultant.empty.message"
        static let emptyCta: LocalizedStringKey = "consultant.empty.cta"
    }
    enum ToolOwnerKey {
        static let emptyTitle: LocalizedStringKey = "toolowner.empty.title"
        static let emptyMessage: LocalizedStringKey = "toolowner.empty.message"
        static let emptyCta: LocalizedStringKey = "toolowner.empty.cta"
    }
    enum FranchiseKey {
        static let emptyTitle: LocalizedStringKey = "franchise.empty.title"
        static let emptyMessage: LocalizedStringKey = "franchise.empty.message"
        static let emptyCta: LocalizedStringKey = "franchise.empty.cta"
    }
    enum InvestorKey {
        static let emptyTitle: LocalizedStringKey = "investor.empty.title"
        static let emptyMessage: LocalizedStringKey = "investor.empty.message"
        static let emptyCta: LocalizedStringKey = "investor.empty.cta"
    }

    // MARK: - Life / Growth / Learn

    enum LifeKey {
        static let eyebrow: LocalizedStringKey = "life.eyebrow"
        static let title: LocalizedStringKey = "life.title"
        static let pulseLabel: LocalizedStringKey = "life.pulse_label"
        static let onTrack: LocalizedStringKey = "life.legend.ontrack"
        static let slipping: LocalizedStringKey = "life.legend.slipping"
        static let critical: LocalizedStringKey = "life.legend.critical"
    }

    enum GrowthKey {
        static let eyebrow: LocalizedStringKey = "growth.eyebrow"
        static let title: LocalizedStringKey = "growth.title"

        static let ascensionTitle: LocalizedStringKey = "growth.program.ascension.title"
        static let ascensionSubtitle: LocalizedStringKey = "growth.program.ascension.subtitle"
        static let ascensionCta: LocalizedStringKey = "growth.program.ascension.cta"

        static let loanTitle: LocalizedStringKey = "growth.program.loan.title"
        static let loanSubtitle: LocalizedStringKey = "growth.program.loan.subtitle"
        static let loanCta: LocalizedStringKey = "growth.program.loan.cta"

        static let grantsTitle: LocalizedStringKey = "growth.program.grants.title"
        static let grantsSubtitle: LocalizedStringKey = "growth.program.grants.subtitle"
        static let grantsCta: LocalizedStringKey = "growth.program.grants.cta"

        static let washerTitle: LocalizedStringKey = "growth.wholesale.washer.title"
        static let washerSaving: LocalizedStringKey = "growth.wholesale.washer.saving"
        static let washerJoined: LocalizedStringKey = "growth.wholesale.washer.joined"

        static let cleaningTitle: LocalizedStringKey = "growth.wholesale.cleaning.title"
        static let cleaningSaving: LocalizedStringKey = "growth.wholesale.cleaning.saving"
        static let cleaningJoined: LocalizedStringKey = "growth.wholesale.cleaning.joined"
    }

    enum LearnKey {
        static let eyebrow: LocalizedStringKey = "learn.eyebrow"
        static let title: LocalizedStringKey = "learn.title"
        static let heroEyebrow: LocalizedStringKey = "learn.hero.eyebrow"
        static let heroTitle: LocalizedStringKey = "learn.hero.title"
        static let heroSubtitle: LocalizedStringKey = "learn.hero.subtitle"
        static let step1: LocalizedStringKey = "learn.step.1"
        static let step2: LocalizedStringKey = "learn.step.2"
        static let step3: LocalizedStringKey = "learn.step.3"
        static let step4: LocalizedStringKey = "learn.step.4"
        static let searchPlaceholder: LocalizedStringKey = "learn.search.placeholder"
    }
}
