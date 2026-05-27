import SwiftUI

enum Theme {
    // Backgrounds
    static let background = Color(red: 0.04, green: 0.05, blue: 0.08)        // near-black navy
    static let surface = Color(red: 0.08, green: 0.09, blue: 0.13)
    static let surfaceElevated = Color(red: 0.11, green: 0.12, blue: 0.17)
    static let stroke = Color.white.opacity(0.08)

    // Brand
    static let accent = Color(red: 1.00, green: 0.46, blue: 0.13)            // OxSteed orange
    static let accentSoft = Color(red: 1.00, green: 0.55, blue: 0.20).opacity(0.18)
    static let accentDeep = Color(red: 0.82, green: 0.34, blue: 0.06)

    // Text
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.62)
    static let textTertiary = Color.white.opacity(0.42)

    // Pulse pillar colors
    static let pillarMoney = Color(red: 0.31, green: 0.85, blue: 0.55)
    static let pillarHome = Color(red: 0.45, green: 0.72, blue: 1.00)
    static let pillarCar = Color(red: 0.98, green: 0.78, blue: 0.30)
    static let pillarPersonal = Color(red: 0.95, green: 0.45, blue: 0.78)
    static let pillarGoals = Color(red: 0.62, green: 0.50, blue: 1.00)
    static let pillarSinking = Color(red: 0.30, green: 0.86, blue: 0.86)

    // Status
    static let success = Color(red: 0.30, green: 0.84, blue: 0.55)
    static let warning = Color(red: 0.99, green: 0.74, blue: 0.27)
    static let danger = Color(red: 0.97, green: 0.36, blue: 0.36)
}

extension View {
    func cardStyle(padding: CGFloat = 16) -> some View {
        self
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Theme.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Theme.stroke, lineWidth: 1)
            )
    }

    func sectionTitle() -> some View {
        self
            .font(.system(size: 12, weight: .bold))
            .tracking(1.6)
            .foregroundStyle(Theme.accent)
            .textCase(.uppercase)
    }
}
