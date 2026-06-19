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
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(FoodTheme.flame.opacity(0.2))
                    .frame(width: 36, height: 36)
                Image(systemName: "hand.tap.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(FoodTheme.flame)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Tap the ticket")
                    .font(.foodSubhead)
                    .foregroundStyle(.white)
                Text("New → cooking → ready. The dining-room board follows along.")
                    .font(.foodCaption)
                    .foregroundStyle(Color.white.opacity(0.55))
            }
            Spacer(minLength: 0)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Color.white.opacity(0.45))
                    .padding(8)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                .fill(Color.white.opacity(0.07))
        )
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                .stroke(FoodTheme.flame.opacity(0.35), lineWidth: 1)
        )
        .padding(.horizontal, 16)
    }
}
