import Foundation
import SwiftUI

struct FoodSetupStep: Identifiable, Decodable, Hashable {
    let id: String
    let title: String
    let complete: Bool
}

struct FoodSetupProgress: Decodable, Hashable {
    let steps: [FoodSetupStep]
    let readyToPublish: Bool
    let nextStepId: String?
    let menuItemCount: Int
    let locationCount: Int

    enum CodingKeys: String, CodingKey {
        case steps
        case readyToPublish
        case nextStepId
        case menuItemCount
        case locationCount
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        steps = (try? c.decode([FoodSetupStep].self, forKey: .steps)) ?? []
        readyToPublish = (try? c.decode(Bool.self, forKey: .readyToPublish)) ?? false
        nextStepId = try? c.decode(String.self, forKey: .nextStepId)
        menuItemCount = c.flexInt(.menuItemCount, default: 0)
        locationCount = c.flexInt(.locationCount, default: 0)
    }
}

struct FoodRestaurantLocation: Identifiable, Decodable, Hashable {
    let id: Int64
    let restaurantId: Int64
    var name: String
    var addressCity: String?
    var addressState: String?
    var isPrimary: Bool
    var status: String

    enum CodingKeys: String, CodingKey {
        case id
        case restaurantId = "restaurant_id"
        case name
        case addressCity = "address_city"
        case addressState = "address_state"
        case isPrimary = "is_primary"
        case status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.flexInt64(.id)
        restaurantId = try c.flexInt64(.restaurantId)
        name = c.flexString(.name) ?? "Location"
        addressCity = c.flexString(.addressCity)
        addressState = c.flexString(.addressState)
        isPrimary = c.flexBool(.isPrimary, default: false)
        status = c.flexString(.status) ?? "active"
    }
}

struct FoodSetupWizardCard: View {
    @EnvironmentObject private var store: FoodStore
    let restaurant: FoodRestaurant

    var body: some View {
        if restaurant.status != "active", let progress = store.setupProgress {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Opening checklist")
                            .font(.foodHeadline)
                            .foregroundStyle(FoodTheme.ink)
                        Text("A few scenes left before guests walk in.")
                            .font(.foodCaption)
                            .foregroundStyle(FoodTheme.muted)
                    }
                    Spacer()
                    Text("\(progress.steps.filter { $0.id != "publish" && $0.complete }.count)/4")
                        .font(.foodPrice)
                        .foregroundStyle(FoodTheme.flame)
                }
                ForEach(progress.steps.filter { $0.id != "publish" }) { step in
                    HStack(spacing: 10) {
                        Image(systemName: step.complete ? "checkmark.circle.fill" : "circle.dashed")
                            .foregroundStyle(step.complete ? FoodTheme.basil : FoodTheme.muted)
                        Text(step.title)
                            .font(.foodCallout)
                            .foregroundStyle(step.complete ? FoodTheme.muted : FoodTheme.ink)
                        Spacer()
                    }
                }
                Button("Resume opening night") {
                    store.showOwnerOnboarding = true
                }
                .buttonStyle(PrimaryActionButtonStyle())
            }
            .foodCardElevated(padding: 18)
            .task(id: restaurant.id) { await store.loadSetupProgress(restaurantId: restaurant.id) }
        } else if restaurant.status == "active",
                  !FoodOnboardingPreferences.isDeviceSetupComplete(restaurantId: restaurant.id) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Wire the floor")
                    .font(.foodHeadline)
                    .foregroundStyle(FoodTheme.ink)
                Text("Kiosk, Kitchen, queue board — four taps and you're in service.")
                    .font(.foodCaption)
                    .foregroundStyle(FoodTheme.muted)
                Button("Continue device setup") {
                    store.showOwnerOnboarding = true
                }
                .buttonStyle(PrimaryActionButtonStyle(tint: FoodTheme.teal))
            }
            .foodCardElevated(padding: 18)
        }
    }

    private func hint(for stepId: String) -> String {
        switch stepId {
        case "profile": return "Add description and cuisine tags."
        case "location": return "Set address and coordinates, or add a location."
        case "hours": return "Configure operating hours before going live."
        case "menu": return "Add at least one menu item."
        default: return "Complete remaining setup steps."
        }
    }
}

struct FoodManagerLocationDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    let location: FoodManagerLocationSummary
    let backendLocation: FoodRestaurantLocation?
    let totalNetworkSalesCents: Int
    let onViewOrders: () -> Void

    private var networkSharePercent: Int {
        Int(Double(location.salesTodayCents) / Double(max(totalNetworkSalesCents, 1)) * 100)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(location.name)
                                    .font(.system(size: 22, weight: .black))
                                    .foregroundStyle(FoodTheme.ink)
                                if !location.city.isEmpty {
                                    Label(location.city, systemImage: "mappin.and.ellipse")
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                }
                            }
                            Spacer()
                            if backendLocation?.isPrimary == true {
                                Text("Primary")
                                    .font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(FoodTheme.basil)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(FoodTheme.basil.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                        if let status = backendLocation?.status, !status.isEmpty {
                            Text(status.capitalized)
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(status == "active" ? FoodTheme.basil : FoodTheme.saffron)
                        }
                    }
                    .foodCard(padding: 16)

                    HStack(spacing: 12) {
                        FoodOperationalStat(
                            label: "Sales today",
                            value: foodMoney(location.salesTodayCents),
                            detail: "\(networkSharePercent)% of network",
                            tint: FoodTheme.basil
                        )
                        FoodOperationalStat(
                            label: "Open issues",
                            value: "\(location.openIssues)",
                            detail: location.openIssues == 0 ? "All clear" : "Needs review",
                            tint: location.openIssues > 0 ? FoodTheme.saffron : FoodTheme.blue
                        )
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Network share")
                            .font(.system(size: 16, weight: .black))
                            .foregroundStyle(FoodTheme.ink)
                        GeometryReader { proxy in
                            ZStack(alignment: .leading) {
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(FoodTheme.flame.opacity(0.12))
                                RoundedRectangle(cornerRadius: 6)
                                    .fill(FoodTheme.flame)
                                    .frame(width: max(12, proxy.size.width * CGFloat(location.salesTodayCents) / CGFloat(max(totalNetworkSalesCents, 1))))
                            }
                        }
                        .frame(height: 12)
                        Text("Compared to other locations in your current manager view.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(FoodTheme.muted)
                    }
                    .foodCard(padding: 16)

                    Button {
                        dismiss()
                        onViewOrders()
                    } label: {
                        Label("View live orders", systemImage: "bag.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.blue)
                }
                .padding(16)
            }
            .background(FoodTheme.background.ignoresSafeArea())
            .navigationTitle("Location")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
