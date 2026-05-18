import SwiftUI

struct AudienceView: View {
    @EnvironmentObject private var router: OxSteedRouter
    let audience: Audience
    let workflows: [OxSteedWorkflow]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    AudienceHero(audience: audience)

                    VStack(spacing: 12) {
                        ForEach(workflows) { workflow in
                            WorkflowCard(workflow: workflow) {
                                router.open(workflow.route)
                            }
                        }
                    }

                    CTAGroup(audience: audience)
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle(audience.title)
        }
    }
}

private struct CTAGroup: View {
    @EnvironmentObject private var router: OxSteedRouter
    let audience: Audience

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(title: "Get started", subtitle: startSubtitle)
            PrimaryButton(title: primaryTitle, systemImage: primarySymbol) {
                router.open(primaryRoute)
            }
            SecondaryButton(title: secondaryTitle, systemImage: secondarySymbol) {
                router.open(secondaryRoute)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var startSubtitle: String {
        switch audience {
        case .customer: return "Create an account or begin with a real service request."
        case .helper: return "Start by registering your helper profile or browsing available work."
        case .business: return "Launch with consulting support or open the operations workspace."
        }
    }

    private var primaryTitle: String {
        switch audience {
        case .customer: return "Create customer account"
        case .helper: return "Register as helper"
        case .business: return "Open Business Hub"
        }
    }

    private var primarySymbol: String {
        switch audience {
        case .customer: return "person.badge.plus"
        case .helper: return "wrench.adjustable"
        case .business: return "building.columns"
        }
    }

    private var primaryRoute: OxSteedRoute {
        switch audience {
        case .customer: return .registerCustomer
        case .helper: return .registerHelper
        case .business: return .businessHub
        }
    }

    private var secondaryTitle: String {
        switch audience {
        case .customer: return "Post a job"
        case .helper: return "Browse jobs"
        case .business: return "Launch support"
        }
    }

    private var secondarySymbol: String {
        switch audience {
        case .customer: return "square.and.pencil"
        case .helper: return "briefcase"
        case .business: return "hammer"
        }
    }

    private var secondaryRoute: OxSteedRoute {
        switch audience {
        case .customer: return .postJob
        case .helper: return .jobs
        case .business: return .consulting
        }
    }
}
