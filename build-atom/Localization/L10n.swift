import SwiftUI

/// Tiny helper namespace for localized keys. Lets us write `L10n.tab(.home)`
/// instead of remembering raw key strings, with compile-time safety.
///
/// Values return key strings. Pass runtime keys through `LocalizedStringKey`
/// or `LocalizationManager.localized(_:)`; `Text(someString)` treats a
/// runtime `String` as verbatim text.
enum L10n {

    // MARK: - Tabs

    enum TabKey: String {
        case home, life, growth, learn
        /// Use string literals so SwiftUI reliably resolves keys from `Localizable.strings`.
        var key: String {
            switch self {
            case .home: return "tab.home"
            case .life: return "tab.life"
            case .growth: return "tab.growth"
            case .learn: return "tab.learn"
            }
        }
    }

    static func tab(_ t: TabKey) -> String { t.key }

    // MARK: - App

    static let appName: String = "app.name"

    static var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12:  return "app.greeting.morning"
        case 12..<18: return "app.greeting.afternoon"
        default:      return "app.greeting.evening"
        }
    }

    // MARK: - Persona

    enum PersonaKey {
        static let actingAs: String = "persona.acting_as"
        static let switchAction: String = "persona.switch"
        static let title: String = "persona.title"
        static let subtitle: String = "persona.subtitle"

        static func name(for persona: Persona) -> String {
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
        static let title: String = "settings.title"
        static let language: String = "settings.language"
        static let languageSubtitle: String = "settings.language.subtitle"
        static let done: String = "settings.done"
        static let appearance: String = "settings.appearance"
        static let appearanceDescription: String = "settings.appearance.description"
        static let notifications: String = "settings.notifications"
        static let privacy: String = "settings.privacy"
        static let signOut: String = "settings.sign_out"
        static let deleteAccount: String = "settings.delete_account"
        static let appLock: String = "settings.app_lock"
        static let appLockDescription: String = "settings.app_lock.description"
        static let appearanceSystem: String = "settings.appearance.system"
        static let appearanceLight: String = "settings.appearance.light"
        static let appearanceDark: String = "settings.appearance.dark"
        static let textSize: String = "settings.text_size"
        static let textSizeDescription: String = "settings.text_size.description"
        static let textSizeSmall: String = "settings.text_size.small"
        static let textSizeDefault: String = "settings.text_size.default"
        static let textSizeLarge: String = "settings.text_size.large"
        static let textSizeXLarge: String = "settings.text_size.xlarge"
        static let socketConnected: String = "settings.socket.connected"
        static let socketOffline: String = "settings.socket.offline"
        static let reportProblem: String = "settings.report_problem"
        static let verifyIdentity: String = "settings.verify_identity"
        static let taxDocuments: String = "settings.tax_documents"
        static let exportMyData: String = "settings.export_my_data"
        static let preparingExport: String = "settings.preparing_export"
        static let exportFailed: String = "settings.export_failed"
        static let deleteConfirmTitle: String = "settings.delete_confirm.title"
        static let deleteConfirmBody: String = "settings.delete_confirm.body"
        static let deleteConfirmBlocked: String = "settings.delete_confirm.blocked"
        static let deleteConfirmButton: String = "settings.delete_confirm.button"
        static let deleteConfirmPlaceholder: String = "settings.delete_confirm.placeholder"
        static let privacyAppLock: String = "settings.privacy.app_lock"
        static let privacyIdentity: String = "settings.privacy.identity"
        static let privacyExports: String = "settings.privacy.exports"
        static let helperPrivacy: String = "settings.privacy.helper"
        static let dataCategories: String = "settings.privacy.data_categories"
        static let thirdParties: String = "settings.privacy.third_parties"
        static let guestContact: String = "settings.privacy.guest_contact"
        static let guestContactDetail: String = "settings.privacy.guest_contact_detail"
        static let booking: String = "settings.privacy.booking"
        static let bookingDetail: String = "settings.privacy.booking_detail"
        static let scheduling: String = "settings.privacy.scheduling"
        static let schedulingDetail: String = "settings.privacy.scheduling_detail"
        static let liveChat: String = "settings.privacy.live_chat"
        static let liveChatDetail: String = "settings.privacy.live_chat_detail"
        static let reportPrompt: String = "settings.report.prompt"
        static let reportSending: String = "settings.report.sending"
        static let reportSent: String = "settings.report.sent"
        static let reportAction: String = "settings.report.send"
        static let reportError: String = "settings.report.error"
        static let notificationsEmail: String = "settings.notifications.email"
        static let notificationsPush: String = "settings.notifications.push"
        static let notificationsSms: String = "settings.notifications.sms"
        static let notificationsFrequency: String = "settings.notifications.frequency"
        static let notificationsRealtime: String = "settings.notifications.frequency.realtime"
        static let notificationsDaily: String = "settings.notifications.frequency.daily"
        static let notificationsWeekly: String = "settings.notifications.frequency.weekly"
        static let notificationsSaving: String = "settings.notifications.saving"
        static let notificationsSave: String = "settings.notifications.save"
        static let titleDelete: String = "settings.delete_account.title"
        static let titleDeleteAccount: String = "settings.delete_account.title"
        static let deleteInProgress: String = "settings.delete_account.in_progress"
    }

    // MARK: - Common

    enum CommonKey {
        static let cancel: String = "common.cancel"
        static let save: String = "common.save"
        static let seeAll: String = "common.see_all"
        static let search: String = "common.search"
        static let bid: String = "common.bid"
        static let inbox: String = "section.messages"
        static let helperFallback: String = "Helper"
        static let jobFallback: String = "Job"
        static let yourHelper: String = "your helper"
        static let theCustomer: String = "the customer"
    }

    enum NavigationKey {
        static let map: String = "map.title"
        static let alerts: String = "notifications.title"
        static let settings: String = "settings.title"
    }

    enum AuthKey {
        static let signIn: String = "auth.sign_in"
    }

    // MARK: - Section headers

    enum SectionKey {
        static let yourJobs: String = "section.your_jobs"
        static let messages: String = "section.messages"
        static let availableNearYou: String = "section.available_near_you"
        static let yourTeam: String = "section.your_team"
        static let urgencyQueue: String = "section.urgency_queue"
        static let sixPillars: String = "section.six_pillars"
        static let yourLadder: String = "section.your_ladder"
        static let programsForYou: String = "section.programs_for_you"
        static let communityWholesale: String = "section.community_wholesale"
        static let startHere: String = "section.start_here"
        static let trendingArea: String = "section.trending_area"
    }

    // MARK: - Customer hero

    enum CustomerKey {
        static let eyebrow: String = "customer.eyebrow"
        static let headline: String = "customer.headline"
        static let subhead: String = "customer.subhead"
        static let postJob: String = "customer.post_job"
        static let browseHelpers: String = "customer.browse_helpers"
    }

    // MARK: - Stat tile labels

    enum StatKey {
        static let activeJobs: String = "stat.active_jobs"
        static let openQuotes: String = "stat.open_quotes"
        static let earnedThisMonth: String = "stat.earned_this_month"
        static let jobsNearby: String = "stat.jobs_nearby"
        static let activeBids: String = "stat.active_bids"
        static let rating: String = "stat.rating"
        static let teamOnline: String = "stat.team_online"
        static let invoicesPending: String = "stat.invoices_pending"
        static let inIntake: String = "stat.in_intake"
        static let thisWeek: String = "stat.this_week"
        static let toolsOut: String = "stat.tools_out"
        static let depositsHeld: String = "stat.deposits_held"
        static let subfranchisees: String = "stat.subfranchisees"
        static let compliance: String = "stat.compliance"
        static let portfolio: String = "stat.portfolio"
        static let helpersFunded: String = "stat.helpers_funded"
    }

    // MARK: - Business

    enum BusinessKey {
        static let revenueWeek: String = "business.revenue_week"
        static let weekRange: String = "business.week_range"
        static let cashappTitle: String = "business.cashapp_title"
        static let cashappShare: String = "business.cashapp_share"
    }

    // MARK: - Empty states

    enum ConsultantKey {
        static let emptyTitle: String = "consultant.empty.title"
        static let emptyMessage: String = "consultant.empty.message"
        static let emptyCta: String = "consultant.empty.cta"
    }

    enum ConsultingPipelineKey {
        static let active: String = "consulting.pipeline.active"
        static let won: String = "consulting.pipeline.won"
        static let pipeline: String = "consulting.pipeline.pipeline"
        static let referralPipeline: String = "consulting.pipeline.referral_pipeline"
        static let update: String = "consulting.pipeline.update"
        static let noteFormat: String = "consulting.pipeline.note_format"
        static let followUpDateFormat: String = "consulting.pipeline.follow_up_date_format"
        static let client: String = "consulting.pipeline.client"
        static let status: String = "consulting.pipeline.status"
        static let notes: String = "consulting.pipeline.notes"
        static let setFollowUpDate: String = "consulting.pipeline.set_follow_up_date"
        static let followUp: String = "consulting.pipeline.follow_up"
        static let updateReferral: String = "consulting.pipeline.update_referral"
        static let urgencyExploring: String = "consulting.intake.urgency.exploring"
        static let urgencyTwoWeeks: String = "consulting.intake.urgency.two_weeks"
        static let urgencyASAP: String = "consulting.intake.urgency.asap"
        static let allItems: String = "consulting.intake.confirmation.all_items"
    }

    enum ConsultingIntakeKey {
        static let title: String = "consulting.intake.title"
        static let navigationDone: String = "consulting.intake.navigation.cancel"
        static let navigationBack: String = "consulting.intake.navigation.back"
        static let stepLabel1: String = "consulting.intake.step1.title"
        static let stepLabel2: String = "consulting.intake.step2.title"
        static let stepLabel3: String = "consulting.intake.step3.title"
        static let stepLabel4: String = "consulting.intake.step4.title"
        static let stepLabel5: String = "consulting.intake.step5.title"
        static let subtitle1: String = "consulting.intake.step1.subtitle"
        static let subtitle2: String = "consulting.intake.step2.subtitle"
        static let subtitle3: String = "consulting.intake.step3.subtitle"
        static let subtitle4: String = "consulting.intake.step4.subtitle"
        static let subtitle5: String = "consulting.intake.step5.subtitle"
        static let description1: String = "consulting.intake.step1.description"
        static let description2: String = "consulting.intake.step2.description"
        static let description3: String = "consulting.intake.step3.description"
        static let description4: String = "consulting.intake.step4.description"
        static let description5: String = "consulting.intake.step5.description"
        static let emailLabel: String = "consulting.intake.labels.email"
        static let emailPlaceholder: String = "consulting.intake.placeholder.email"
        static let firstNameLabel: String = "consulting.intake.labels.first_name"
        static let firstNamePlaceholder: String = "consulting.intake.placeholder.first_name"
        static let lastNameLabel: String = "consulting.intake.labels.last_name"
        static let lastNamePlaceholder: String = "consulting.intake.placeholder.last_name"
        static let phoneLabel: String = "consulting.intake.labels.phone"
        static let phonePlaceholder: String = "consulting.intake.placeholder.phone"
        static let referralLabel: String = "consulting.intake.labels.referral_source"
        static let fieldReferralSource: String = "consulting.intake.referral_source"
        static let contactSourceMarketplace: String = "consulting.intake.referral.marketplace"
        static let contactSourceGoogle: String = "consulting.intake.referral.google"
        static let contactSourceReferral: String = "consulting.intake.referral.referral"
        static let contactSourceSocial: String = "consulting.intake.referral.social"
        static let contactSourceOther: String = "consulting.intake.referral.other"
        static let skillLabel: String = "consulting.intake.labels.skill"
        static let skillPlaceholder: String = "consulting.intake.placeholder.skill"
        static let skillPickerPlaceholder: String = "consulting.intake.picker.skill"
        static let targetMarketLabel: String = "consulting.intake.labels.target_market"
        static let targetMarketPlaceholder: String = "consulting.intake.placeholder.target_market"
        static let revenueLabel: String = "consulting.intake.labels.has_revenue"
        static let revenueNone: String = "consulting.intake.revenue.no"
        static let revenueInformal: String = "consulting.intake.revenue.informal"
        static let revenueFormal: String = "consulting.intake.revenue.formal"
        static let businessNameLabel: String = "consulting.intake.labels.business_name_decided"
        static let businessNameYes: String = "consulting.intake.business_name.yes"
        static let businessNameNo: String = "consulting.intake.business_name.no"
        static let businessNamePlaceholder: String = "consulting.intake.placeholder.business_name"
        static let countryLabel: String = "consulting.intake.labels.country"
        static let countryPickerLabel: String = "consulting.intake.picker.country"
        static let regionLabel: String = "consulting.intake.labels.region"
        static let regionPlaceholder: String = "consulting.intake.placeholder.region"
        static let phaseLabel: String = "consulting.intake.labels.phase"
        static let phasePickerLabel: String = "consulting.intake.picker.phase"
        static let phasePlaceholder: String = "consulting.intake.placeholder.phase"
        static let setupLabel: String = "consulting.intake.labels.setup_items"
        static let setupAllLabel: String = "consulting.intake.setup.select_all_label"
        static let setupAllHelper: String = "consulting.intake.setup.select_all_helper"
        static let setupTimingLabel: String = "consulting.intake.labels.urgency"
        static let urgencyExploring: String = "consulting.intake.urgency.exploring"
        static let urgencyTwoWeeks: String = "consulting.intake.urgency.two_weeks"
        static let urgencyAsap: String = "consulting.intake.urgency.asap"
        static let notesLabel: String = "consulting.intake.labels.notes"
        static let packageLabelHint: String = "consulting.intake.package_hint"
        static let mostPopularBadge: String = "consulting.intake.most_popular"
        static let packageFallback: String = "consulting.intake.package_fallback"
        static let packageDisclaimer: String = "consulting.intake.package.disclaimer"
        static let submittedHeader: String = "consulting.intake.submitted.header"
        static let submittedCopy: String = "consulting.intake.submitted.copy"
        static let submittedStep1: String = "consulting.intake.submitted.step1"
        static let submittedStep2: String = "consulting.intake.submitted.step2"
        static let submittedStep3: String = "consulting.intake.submitted.step3"
        static let submittedStep4: String = "consulting.intake.submitted.step4"
        static let sectionInfoTitle: String = "consulting.intake.section.info"
        static let sectionBusinessTitle: String = "consulting.intake.section.business"
        static let sectionPackageTitle: String = "consulting.intake.section.package"
        static let summaryHeard: String = "consulting.intake.summary.heard_about"
        static let summarySkill: String = "consulting.intake.summary.skill"
        static let summaryMarket: String = "consulting.intake.summary.market"
        static let summaryCountry: String = "consulting.intake.summary.country"
        static let summaryRegion: String = "consulting.intake.summary.region"
        static let summaryPhase: String = "consulting.intake.summary.phase"
        static let summaryPackage: String = "consulting.intake.summary.package"
        static let summaryUrgency: String = "consulting.intake.summary.urgency"
        static let summaryItems: String = "consulting.intake.summary.items"
        static let summaryNext: String = "consulting.intake.summary.next"
        static let submitError: String = "consulting.intake.error.submit"
        static let referralPrefix: String = "consulting.intake.referral_prefix"
        static let phasePrefix: String = "consulting.intake.phase_prefix"
        static let setupItemCount: String = "consulting.intake.setup_items_summary"
        static let setupItemCountWithSuffix: String = "consulting.intake.setup_items_summary_suffix"
        static let submitLabel: String = "common.submit"
        static let doneLabel: String = "common.done"
    }

    enum ToolOwnerKey {
        static let emptyTitle: String = "toolowner.empty.title"
        static let emptyMessage: String = "toolowner.empty.message"
        static let emptyCta: String = "toolowner.empty.cta"
    }
    enum FranchiseKey {
        static let emptyTitle: String = "franchise.empty.title"
        static let emptyMessage: String = "franchise.empty.message"
        static let emptyCta: String = "franchise.empty.cta"
    }
    enum InvestorKey {
        static let emptyTitle: String = "investor.empty.title"
        static let emptyMessage: String = "investor.empty.message"
        static let emptyCta: String = "investor.empty.cta"
    }

    // MARK: - Life / Growth / Learn

    enum LifeKey {
        static let eyebrow: String = "life.eyebrow"
        static let title: String = "life.title"
        static let pulseLabel: String = "life.pulse_label"
        static let onTrack: String = "life.legend.ontrack"
        static let slipping: String = "life.legend.slipping"
        static let critical: String = "life.legend.critical"
        static let needsAttention: String = "life.legend.needs_attention"
        static let syncing: String = "life.syncing"
        static let pending: String = "life.pending"
        static let saved: String = "life.saved"
    }

    enum GrowthKey {
        static let eyebrow: String = "growth.eyebrow"
        static let title: String = "growth.title"

        static let seedBusinessConsultingTitle: String = "growth.seed.business_consulting.title"
        static let seedBusinessConsultingSubtitle: String = "growth.seed.business_consulting.subtitle"
        static let seedBusinessConsultingCta: String = "growth.seed.business_consulting.cta"
        static let seedWholesaleTitle: String = "growth.seed.community_wholesale.title"
        static let seedWholesaleSubtitle: String = "growth.seed.community_wholesale.subtitle"
        static let seedWholesaleCta: String = "growth.seed.community_wholesale.cta"

        static let joinErrorTitle: String = "growth.error.join_title"
        static let joinErrorMessage: String = "growth.error.join_message"
        static let loadingErrorTitle: String = "growth.error.loading_title"
        static let loadingErrorMessage: String = "growth.error.loading"
        static let loadingRetry: String = "common.retry"

        static let sectionOpportunities: String = "growth.section.opportunities"
        static let sectionPrograms: String = "growth.section.programs_for_you"
        static let sectionFinancing: String = "growth.section.financing"
        static let sectionGrants: String = "growth.section.grants"
        static let sectionWholesale: String = "growth.section.community_wholesale"
        static let seeAll: String = "common.see_all"

        static let noOpportunities: String = "growth.no_opportunities"
        static let noPrograms: String = "growth.no_programs"
        static let noWholesale: String = "growth.no_wholesale"
        static let noProgramsMatched: String = "growth.programs.none"

        static let opportunitiesCardEmpty: String = "growth.opportunities.none"
        static let opportunitiesEmpty: String = "growth.opportunities.empty"
        static let programsEmpty: String = "growth.programs.none"

        static let guestSignInTitle: String = "growth.unlock_growth"
        static let guestSignInSubtitle: String = "growth.guest_sign_in_subtitle"
        static let guestFillPrompt: String = "growth.fill_intake_prompt"
        static let signInTitle: String = "growth.sign_in_to_continue"
        static let businessLaunchProgram: String = "growth.business_launch_program"
        static let noSectionLoad: String = "growth.section_not_available"

        static let financingTitle: String = "growth.financing.title"
        static let financingDescription: String = "growth.financing.description"
        static let financingDisclaimer: String = "growth.financing.disclaimer"
        static let financingSubmittedTitle: String = "growth.financing.submitted.title"
        static let financingSubmittedCopy: String = "growth.financing.submitted.copy"
        static let financingReferenceFormat: String = "growth.financing.reference_format"
        static let financingErrorSubmit: String = "growth.financing.error.submit"
        static let financingQuestionUse: String = "growth.financing.question.use"
        static let financingAmountNeeded: String = "growth.financing.amount_needed"
        static let financingMonthsInBusiness: String = "growth.financing.months_in_business"
        static let financingAnnualRevenue: String = "growth.financing.annual_revenue"
        static let financingCreditScore: String = "growth.financing.credit_score"
        static let financingBusinessStructure: String = "growth.financing.business_structure"
        static let financingBusinessType: String = "growth.financing.business_type"
        static let financingTerms: String = "growth.financing.terms"
        static let financingLoanEquipment: String = "growth.financing.loan.equipment"
        static let financingLoanWorkingCapital: String = "growth.financing.loan.working_capital"
        static let financingLoanVehicle: String = "growth.financing.loan.vehicle"
        static let financingLoanStartup: String = "growth.financing.loan.startup"
        static let financingBizSoleProprietor: String = "growth.financing.biz.sole_proprietor"
        static let financingBizLLC: String = "growth.financing.biz.llc"
        static let financingBizSCorp: String = "growth.financing.biz.s_corp"
        static let financingBizCCorp: String = "growth.financing.biz.c_corp"
        static let financingBizPartnership: String = "growth.financing.biz.partnership"

        static let grantsTitle: String = "growth.grants.title"
        static let grantsDescription: String = "growth.grants.description"
        static let grantsNoData: String = "growth.grants.none"

        static let noDataJoined: String = "growth.no_data"

        static let ladderStepOne: String = "growth.ladder.step1.title"
        static let ladderStepTwo: String = "growth.ladder.step2.title"
        static let ladderStepThree: String = "growth.ladder.step3.title"
        static let ladderStepFour: String = "growth.ladder.step4.title"
        static let ladderStepOneDescription: String = "growth.ladder.step1.description"
        static let ladderStepTwoDescription: String = "growth.ladder.step2.description"
        static let ladderStepThreeDescription: String = "growth.ladder.step3.description"
        static let ladderStepFourDescription: String = "growth.ladder.step4.description"

        static let newLabel: String = "growth.new_label"
        static let programLabel: String = "growth.program_label"
        static let programOpen: String = "growth.program.open"
        static let joinedLabel: String = "growth.joined"
        static let joinedGroupLabel: String = "growth.joined_group"
        static let applyOrLearnMore: String = "growth.apply_or_learn_more"
        static let preQualifyLabel: String = "growth.pre_qualify"
        static let freeMoneyLabel: String = "growth.free_money"

        static let stepOneTitle: String = "growth.ladder.step1.title"
        static let stepTwoTitle: String = "growth.ladder.step2.title"
        static let stepThreeTitle: String = "growth.ladder.step3.title"
        static let stepFourTitle: String = "growth.ladder.step4.title"
        static let stepOneDescription: String = "growth.ladder.step1.description"
        static let stepTwoDescription: String = "growth.ladder.step2.description"
        static let stepThreeDescription: String = "growth.ladder.step3.description"
        static let stepFourDescription: String = "growth.ladder.step4.description"
        static let savePrefix: String = "growth.save_prefix"
        static let joinedPrefix: String = "growth.joined_prefix"
        static let joinGroupLabelCta: String = "growth.join_group"

        static let stepCounter: String = "growth.ladder_step_counter"
    }

    enum SettingsLanguage {
        static let system: String = "settings.language.system"
        static let english: String = "settings.language.english"
        static let spanish: String = "settings.language.spanish"
        static let french: String = "settings.language.french"
        static let haitian: String = "settings.language.haitian"
        static let arabic: String = "settings.language.arabic"
    }

    enum LearnKey {
        static let eyebrow: String = "learn.eyebrow"
        static let title: String = "learn.title"
        static let heroEyebrow: String = "learn.hero.eyebrow"
        static let heroTitle: String = "learn.hero.title"
        static let heroSubtitle: String = "learn.hero.subtitle"
        static let step1: String = "learn.step.1"
        static let step2: String = "learn.step.2"
        static let step3: String = "learn.step.3"
        static let step4: String = "learn.step.4"
        static let searchPlaceholder: String = "learn.search.placeholder"

        // Persona-specific hero card content
        enum Hero {
            static func eyebrow(for persona: Persona) -> String {
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
            static func title(for persona: Persona) -> String {
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
            static func subtitle(for persona: Persona) -> String {
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
