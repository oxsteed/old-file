import SwiftUI

enum FoodKitchenOnboardingPreferences {
    static func isHintDismissed() -> Bool {
        UserDefaults.standard.bool(forKey: "ox.food.onboarding.kitchenHintDismissed")
    }

    static func dismissHint() {
        UserDefaults.standard.set(true, forKey: "ox.food.onboarding.kitchenHintDismissed")
    }
}

struct FoodKitchenOnboardingHint: View {
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Kitchen quick start")
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(.white)
                Spacer()
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.gray)
                }
                .buttonStyle(.plain)
            }
            Text("New orders appear in New. Tap a ticket to move it Preparing, tap again for Ready. The waiting-area queue board updates automatically.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.gray)
        }
        .padding(14)
        .background(Color.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 16)
    }
}
