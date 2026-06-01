import SwiftUI

// MARK: - Adaptive color helper

private func adaptive(
    dark: (CGFloat, CGFloat, CGFloat),
    light: (CGFloat, CGFloat, CGFloat),
    alpha: CGFloat = 1
) -> Color {
    Color(UIColor { t in
        let (r, g, b) = t.userInterfaceStyle == .dark ? dark : light
        return UIColor(red: r, green: g, blue: b, alpha: alpha)
    })
}

// MARK: - Theme

enum Theme {

    // MARK: Backgrounds
    // dark: near-black navy  |  light: off-white
    static let background      = adaptive(dark: (0.04, 0.05, 0.08), light: (0.97, 0.97, 0.98))
    static let surface         = adaptive(dark: (0.08, 0.09, 0.13), light: (1.00, 1.00, 1.00))
    static let surfaceElevated = adaptive(dark: (0.11, 0.12, 0.17), light: (0.95, 0.95, 0.97))
    /// Back-compat alias used by some older screens.
    static let cardBackground  = surface
    // Hero card keeps a rich blue in both modes so white text stays legible
    static let heroSurface     = adaptive(dark: (0.02, 0.11, 0.19), light: (0.10, 0.28, 0.62))
    static let heroSurfaceDeep = adaptive(dark: (0.01, 0.06, 0.12), light: (0.06, 0.16, 0.42))

    static let stroke = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.08)
            : UIColor.black.withAlphaComponent(0.08)
    })

    // MARK: Brand (same in both modes)
    static let accent     = Color(red: 1.00, green: 0.46, blue: 0.13)   // OxSteed orange
    static let accentSoft = Color(red: 1.00, green: 0.55, blue: 0.20).opacity(0.18)
    static let accentDeep = Color(red: 0.82, green: 0.34, blue: 0.06)

    static let heroGradient = LinearGradient(
        colors: [heroSurfaceDeep, heroSurface, accentDeep.opacity(0.36)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    // MARK: Text
    static let textPrimary = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor.white
            : UIColor(red: 0.05, green: 0.05, blue: 0.10, alpha: 1)
    })

    static let textSecondary = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.62)
            : UIColor(red: 0.05, green: 0.05, blue: 0.10, alpha: 0.60)
    })

    static let textTertiary = Color(UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor.white.withAlphaComponent(0.42)
            : UIColor(red: 0.05, green: 0.05, blue: 0.10, alpha: 0.38)
    })

    // MARK: Pulse pillar colors (same in both modes)
    static let pillarMoney    = Color(red: 0.31, green: 0.85, blue: 0.55)
    static let pillarHome     = Color(red: 0.45, green: 0.72, blue: 1.00)
    static let pillarCar      = Color(red: 0.98, green: 0.78, blue: 0.30)
    static let pillarPersonal = Color(red: 0.95, green: 0.45, blue: 0.78)
    static let pillarGoals    = Color(red: 0.62, green: 0.50, blue: 1.00)
    static let pillarSinking  = Color(red: 0.30, green: 0.86, blue: 0.86)

    // MARK: Status (same in both modes)
    static let success = Color(red: 0.30, green: 0.84, blue: 0.55)
    static let warning = Color(red: 0.99, green: 0.74, blue: 0.27)
    static let danger  = Color(red: 0.97, green: 0.36, blue: 0.36)
}

// MARK: - View modifiers

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
