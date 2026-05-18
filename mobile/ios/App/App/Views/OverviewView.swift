import SwiftUI

struct OverviewView: View {
    @EnvironmentObject private var router: OxSteedRouter

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    HeroHeader(
                        eyebrow: "Marketplace plus operations",
                        title: "OxSteed helps local work become organized work.",
                        subtitle: "Customers can request services. Helpers can earn and build reputation. Businesses can run calendars, profiles, clients, packages, invoices, and industry workflows from Business Hub."
                    )

                    HStack(spacing: 12) {
                        PrimaryButton(title: "Open OxSteed", systemImage: "safari") {
                            router.open(.home)
                        }
                        SecondaryButton(title: "Sign in", systemImage: "person.crop.circle") {
                            router.open(.login)
                        }
                    }

                    SectionHeader(title: "Core systems", subtitle: "The first version of the native app explains the product clearly and routes into live OxSteed workflows when action is needed.")

                    VStack(spacing: 12) {
                        ForEach(OxSteedContent.pillars) { feature in
                            WideFeatureCard(feature: feature)
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
            .navigationTitle("OxSteed")
        }
    }
}
