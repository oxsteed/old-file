import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var store: OneStore
    @State private var showingPersonaSheet = false

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 20) {
                    HomeHero(persona: store.activePersona,
                             name: store.greetingName,
                             onSwitchPersona: { showingPersonaSheet = true })

                    syncBanner

                    statRow

                    pulseSection

                    urgencySection

                    opportunitiesSection

                    activitySection

                    Spacer(minLength: 32)
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
            }
            .background(Color(.systemGroupedBackground).ignoresSafeArea())
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        store.logout()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    .accessibilityLabel("Sign out")
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingPersonaSheet = true
                    } label: {
                        Image(systemName: store.activePersona.icon)
                            .font(.headline)
                            .foregroundStyle(store.activePersona.tint)
                    }
                    .accessibilityLabel("Switch persona")
                }
            }
            .sheet(isPresented: $showingPersonaSheet) {
                PersonaPickerSheet()
                    .presentationDetents([.medium, .large])
            }
        }
    }

    // MARK: Sections

    @ViewBuilder private var syncBanner: some View {
        if store.pendingSyncCount > 0 {
            HStack(spacing: 10) {
                ProgressView().scaleEffect(0.8)
                Text("Syncing \(store.pendingSyncCount) change\(store.pendingSyncCount == 1 ? "" : "s")…")
                    .font(.footnote.weight(.medium))
                Spacer()
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(OneTheme.sky.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
            .foregroundStyle(OneTheme.sky)
        }
    }

    private var statRow: some View {
        let items = store.stats(for: store.activePersona)
        return HStack(spacing: 12) {
            ForEach(items) { stat in
                StatCard(stat: stat)
            }
        }
    }

    private var pulseSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Life Pulse", action: "See all")
            PulseCard(pillars: store.pulse)
        }
    }

    private var urgencySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Needs attention", action: nil)
            let items = store.urgency(for: store.activePersona)
            if items.isEmpty {
                EmptyStateCard(
                    icon: "checkmark.seal.fill",
                    title: "You're all caught up",
                    message: "Nothing needs your attention right now — nice work."
                )
            } else {
                VStack(spacing: 10) {
                    ForEach(items) { UrgencyRow(item: $0) }
                }
            }
        }
    }

    private var opportunitiesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("For you", action: "Explore")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(store.opportunities(for: store.activePersona)) { card in
                        OpportunityTile(card: card)
                            .frame(width: 240)
                    }
                }
            }
        }
    }

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Recent activity", action: nil)
            VStack(spacing: 0) {
                ForEach(Array(store.activity(for: store.activePersona).enumerated()), id: \.element.id) { idx, ev in
                    ActivityRow(event: ev)
                    if idx < store.activity(for: store.activePersona).count - 1 {
                        Divider().padding(.leading, 56)
                    }
                }
            }
            .background(Color(.secondarySystemGroupedBackground),
                        in: RoundedRectangle(cornerRadius: 18))
        }
    }

    private func sectionHeader(_ title: String, action: String?) -> some View {
        HStack {
            Text(title)
                .font(.system(.headline, design: .rounded, weight: .semibold))
            Spacer()
            if let action {
                Button(action) {}
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OneTheme.accent)
            }
        }
    }
}

#Preview {
    HomeView().environmentObject(OneStore())
}
