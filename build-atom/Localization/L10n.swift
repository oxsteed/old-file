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
        /// Use string literals so SwiftUI reliably resolves keys from `Localizable.strings`.
        var key: LocalizedStringKey {
            switch self {
            case .home: return "tab.home"
            case .life: return "tab.life"
            case .growth: return "tab.growth"
            case .learn: return "tab.learn"
            }
        }
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
        static let inbox: LocalizedStringKey = "section.messages"
        static let helperFallback: String = "Helper"
        static let jobFallback: String = "Job"
        static let yourHelper: String = "your helper"
        static let theCustomer: String = "the customer"
    }

    enum NavigationKey {
        static let map: LocalizedStringKey = "map.title"
        static let alerts: LocalizedStringKey = "notifications.title"
        static let settings: LocalizedStringKey = "settings.title"
    }

    enum AuthKey {
        static let signIn: LocalizedStringKey = "auth.sign_in"
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

    enum ConsultingPipelineKey {
        static let active: String = "Active"
        static let won: String = "Won"
        static let pipeline: String = "Pipeline"
        static let referralPipeline: String = "Referral Pipeline"
        static let update: String = "Update"
        static let noteFormat: String = "Note: %@"
        static let followUpDateFormat: String = "Follow up: %@"
        static let client: String = "Client"
        static let status: String = "Status"
        static let notes: String = "Notes"
        static let setFollowUpDate: String = "Set follow-up date"
        static let followUp: String = "Follow up"
        static let updateReferral: String = "Update Referral"
        static let urgencyExploring: String = "Just exploring"
        static let urgencyTwoWeeks: String = "Ready to start within 2 weeks"
        static let urgencyASAP: String = "I need this done as soon as possible"
        static let allItems: String = "All items"
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
        static let needsAttention: LocalizedStringKey = "Needs attention"
        static let syncing: String = "Syncing…"
        static let pending: String = "Pending"
        static let saved: String = "Saved"
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

        // Persona-specific hero card content
        enum Hero {
            static func eyebrow(for persona: Persona) -> LocalizedStringKey {
                switch persona {
                case .helper:     return "learn.hero.helper.eyebrow"
                case .business:   return "learn.hero.business.eyebrow"
                case .investor:   return "learn.hero.investor.eyebrow"
                case .customer:   return "learn.hero.customer.eyebrow"
                case .consultant: return "learn.hero.consultant.eyebrow"
                case .toolOwner:  return "learn.hero.toolowner.eyebrow"
                case .franchise:  return "learn.hero.franchise.eyebrow"
                }
            }
            static func title(for persona: Persona) -> LocalizedStringKey {
                switch persona {
                case .helper:     return "learn.hero.helper.title"
                case .business:   return "learn.hero.business.title"
                case .investor:   return "learn.hero.investor.title"
                case .customer:   return "learn.hero.customer.title"
                case .consultant: return "learn.hero.consultant.title"
                case .toolOwner:  return "learn.hero.toolowner.title"
                case .franchise:  return "learn.hero.franchise.title"
                }
            }
            static func subtitle(for persona: Persona) -> LocalizedStringKey {
                switch persona {
                case .helper:     return "learn.hero.helper.subtitle"
                case .business:   return "learn.hero.business.subtitle"
                case .investor:   return "learn.hero.investor.subtitle"
                case .customer:   return "learn.hero.customer.subtitle"
                case .consultant: return "learn.hero.consultant.subtitle"
                case .toolOwner:  return "learn.hero.toolowner.subtitle"
                case .franchise:  return "learn.hero.franchise.subtitle"
                }
            }
        }
    }
}
