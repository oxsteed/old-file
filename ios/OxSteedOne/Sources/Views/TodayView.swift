import SwiftUI

struct TodayView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        GoScreen(title: "Home", showsTitle: false) {
            header

            GoCard {
                Text("Universal Search")
                    .font(.headline)
                TextField("Search jobs, helpers, tools, training, financing", text: Binding(
                    get: { store.universalSearchQuery },
                    set: { store.universalSearchQuery = $0 }
                ))
                .padding(10)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text("Saved search alerts and map overlays are next implementation step.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                Text("Discovery Views")
                    .font(.headline)
                Text("Feed, Map, and List are unified by persona-aware search context.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                HStack {
                    labelPill("Feed")
                    labelPill("Map")
                    labelPill("List")
                    labelPill("Alerts")
                }
                Text("Saved alert example: plumber under $150 in Springfield")
                    .font(.caption2)
                    .foregroundStyle(OneTheme.muted)
            }

            VStack(alignment: .leading, spacing: 16) {
                ForEach(store.homeSections) { section in
                    GoCard {
                        Text(section.title)
                            .font(.headline)

                        ForEach(section.cards) { card in
                            HStack(alignment: .top, spacing: 12) {
                                Image(systemName: card.symbolName)
                                    .foregroundStyle(OneTheme.amber)
                                    .frame(width: 26)
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack {
                                        Text(card.title)
                                            .font(.subheadline.weight(.semibold))
                                        Spacer()
                                        Text(card.value)
                                            .font(.subheadline.weight(.bold))
                                    }
                                    Text(card.detail)
                                        .font(.caption)
                                        .foregroundStyle(OneTheme.muted)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
            .id(store.homeReloadToken)
        }
        .sheet(isPresented: Binding(
            get: { store.showPersonaSheet },
            set: { store.showPersonaSheet = $0 }
        )) {
            ProfileView()
                .environment(store)
        }
        .sheet(isPresented: Binding(
            get: { store.showBusinessPicker },
            set: { store.showBusinessPicker = $0 }
        )) {
            businessPickerSheet
        }
    }

    private func labelPill(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(OneTheme.amber.opacity(0.18), in: Capsule())
    }

    private var header: some View {
        GoCard {
            HStack(alignment: .center, spacing: 14) {
                OxSteedOneMark(size: 62)

                VStack(alignment: .leading, spacing: 6) {
                    Text("OxSteed One")
                        .font(.title2.weight(.bold))
                    Text("One account. Many personas. Home updates instantly.")
                        .font(.footnote)
                        .foregroundStyle(OneTheme.muted)
                    Text("Active: \(store.activePersonaLabel)")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OneTheme.amber)
                }

                Spacer()

                Button("Persona") {
                    store.showPersonaSheet = true
                }
                .buttonStyle(GoAccentButtonStyle())
            }
        }
    }

    private var businessPickerSheet: some View {
        NavigationStack {
            List(store.availableBusinesses) { business in
                Button {
                    store.selectBusiness(business)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(business.name)
                            .font(.headline)
                        Text(business.id)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Select Business")
        }
    }
}
