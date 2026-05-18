import SwiftUI

struct IntroView: View {
    @EnvironmentObject private var router: OxSteedRouter
    @Binding var hasSeenIntro: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    HeroHeader(
                        eyebrow: "OxSteed",
                        title: "Local work, bookings, and business tools in one place.",
                        subtitle: "OxSteed connects customers, helpers, and service businesses with the practical systems needed to request, deliver, and manage local work."
                    )

                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 148), spacing: 14)], spacing: 14) {
                        ForEach(OxSteedContent.pillars) { feature in
                            FeatureCard(feature: feature)
                        }
                    }

                    VStack(spacing: 12) {
                        PrimaryButton(title: "Find help", systemImage: "magnifyingglass") {
                            hasSeenIntro = true
                            router.open(.helpers)
                        }
                        SecondaryButton(title: "Post a job", systemImage: "square.and.pencil") {
                            hasSeenIntro = true
                            router.open(.postJob)
                        }
                        SecondaryButton(title: "Continue to app", systemImage: "arrow.right") {
                            hasSeenIntro = true
                        }
                    }
                }
                .padding(20)
            }
            .background(AppTheme.background)
        }
    }
}
