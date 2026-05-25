import SwiftUI
import MapKit

struct TodayView: View {
    @Environment(OneStore.self) private var store
    @State private var newAlertQuery = ""
    @State private var cameraPosition: MapCameraPosition = .automatic
    @State private var reviewFromRole = "Customer"
    @State private var reviewToRole = "Helper"
    @State private var reviewRating = 5
    @State private var reviewComment = ""

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

            if !store.universalSearchQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                GoCard {
                    Text("Search Results")
                        .font(.headline)
                    if store.globalSearchResults.isEmpty {
                        Text("No matches found across Home, Life, Growth, and Learn.")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    } else {
                        ForEach(store.globalSearchResults) { result in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(result.category) · \(result.title)")
                                    .font(.subheadline.weight(.semibold))
                                Text(result.detail)
                                    .font(.caption)
                                    .foregroundStyle(OneTheme.muted)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
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

            GoCard {
                Text("Saved Search Alerts")
                    .font(.headline)
                HStack {
                    TextField("Create alert query", text: $newAlertQuery)
                        .padding(10)
                        .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Button("Add") {
                        store.addSavedAlert(newAlertQuery)
                        newAlertQuery = ""
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
                ForEach(store.savedSearchAlerts) { alert in
                    HStack {
                        Text(alert.query)
                            .font(.caption)
                        Spacer()
                        Toggle("", isOn: Binding(
                            get: { alert.enabled },
                            set: { _ in store.toggleSavedAlert(alert.id) }
                        ))
                        .labelsHidden()
                    }
                }
            }

            GoCard {
                Text("Map View")
                    .font(.headline)
                Map(position: $cameraPosition) {
                    ForEach(store.mapPoints) { point in
                        Annotation(point.title, coordinate: CLLocationCoordinate2D(latitude: point.latitude, longitude: point.longitude)) {
                            Circle()
                                .fill(OneTheme.amber)
                                .frame(width: 12, height: 12)
                        }
                    }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                Button("Refresh Map for Active Persona") {
                    store.refreshMapPointsForActivePersona()
                }
                .buttonStyle(.bordered)
            }

            GoCard {
                Text("Trust & Safety")
                    .font(.headline)
                ForEach(store.verificationBadges) { badge in
                    HStack {
                        Text(badge.title)
                            .font(.subheadline)
                        Spacer()
                        Text(badge.verified ? "Verified" : "Pending")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(badge.verified ? .green : OneTheme.amber)
                    }
                }
                HStack {
                    Button(store.safetyTimerRunning ? "Stop Safety Timer" : "Start Safety Timer") {
                        if store.safetyTimerRunning {
                            store.stopSafetyTimer()
                        } else {
                            store.startSafetyTimer()
                        }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                    Button("SOS") {
                        store.triggerSOS()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                }
                if store.sosTriggered {
                    Text("SOS triggered: location + incident log queued.")
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            }

            GoCard {
                Text("Two-Way Reviews")
                    .font(.headline)
                Picker("From", selection: $reviewFromRole) {
                    Text("Customer").tag("Customer")
                    Text("Helper").tag("Helper")
                    Text("Business Owner").tag("Business Owner")
                }
                Picker("To", selection: $reviewToRole) {
                    Text("Customer").tag("Customer")
                    Text("Helper").tag("Helper")
                    Text("Business Owner").tag("Business Owner")
                }
                Stepper("Rating: \(reviewRating)", value: $reviewRating, in: 1...5)
                TextField("Review comment", text: $reviewComment)
                    .padding(10)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button("Submit Review") {
                    store.addReview(fromRole: reviewFromRole, toRole: reviewToRole, rating: reviewRating, comment: reviewComment)
                    reviewComment = ""
                    reviewRating = 5
                }
                .buttonStyle(.borderedProminent)
                ForEach(store.reviews.prefix(4)) { review in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(review.fromRole) → \(review.toRole) · \(String(repeating: "★", count: review.rating))")
                            .font(.caption.weight(.semibold))
                        Text(review.comment)
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
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
                                        Text(masked(card.value))
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
        .onAppear {
            store.refreshMapPointsForActivePersona()
        }
    }

    private func masked(_ value: String) -> String {
        guard store.appPreferences.privacyMode else { return value }
        return String(repeating: "•", count: max(4, min(value.count, 10)))
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
