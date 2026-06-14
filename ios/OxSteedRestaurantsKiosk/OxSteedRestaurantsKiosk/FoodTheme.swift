import SwiftUI
import UIKit

// OxSteed Restaurants shared theme.
//
// Color tokens are aligned to the flagship OxSteed app (`build-atom`
// Design/Theme.swift) so every OxSteed surface — Network, Marketplace,
// Restaurants — reads as one brand: same OxSteed orange accent, the same
// near-black navy backgrounds, and the same 18pt rounded cards.
//
// The token NAMES (background/surface/surfaceRaised/ink/muted/line/flame/…)
// and the foodCard() modifier are unchanged, so existing restaurant screens
// keep compiling — only the underlying values were brought in line with the
// flagship. Keep this file identical across OxSteedFood + every
// OxSteedRestaurants* app (or, ideally, extract it into a shared Swift package).

private func adaptiveColor(
    dark: (CGFloat, CGFloat, CGFloat),
    light: (CGFloat, CGFloat, CGFloat),
    alpha: CGFloat = 1
) -> Color {
    Color(UIColor { traits in
        let rgb = traits.userInterfaceStyle == .dark ? dark : light
        return UIColor(red: rgb.0, green: rgb.1, blue: rgb.2, alpha: alpha)
    })
}

enum FoodTheme {
    // Backgrounds — matched to flagship Theme (near-black navy / off-white).
    static let background    = adaptiveColor(dark: (0.04, 0.05, 0.08), light: (0.97, 0.97, 0.98))
    static let surface       = adaptiveColor(dark: (0.08, 0.09, 0.13), light: (1.00, 1.00, 1.00))
    static let surfaceRaised = adaptiveColor(dark: (0.11, 0.12, 0.17), light: (0.95, 0.95, 0.97))

    // Text — matched to flagship textPrimary / textSecondary.
    static let ink   = adaptiveColor(dark: (1.00, 1.00, 1.00), light: (0.05, 0.05, 0.10))
    static let muted = adaptiveColor(dark: (0.62, 0.63, 0.66), light: (0.42, 0.42, 0.46))
    static let line  = Color.primary.opacity(0.08)

    // Brand — the single OxSteed orange used across all OxSteed apps.
    static let flame = Color(red: 1.00, green: 0.46, blue: 0.13)   // OxSteed accent
    static let flameDeep = Color(red: 0.82, green: 0.34, blue: 0.06)
    static let flameSoft = Color(red: 1.00, green: 0.55, blue: 0.20).opacity(0.18)

    // Secondary accents — aligned to the flagship status/pillar palette so
    // greens/yellows/blues read as the same family across apps.
    static let basil   = Color(red: 0.30, green: 0.84, blue: 0.55)  // success green
    static let saffron = Color(red: 0.99, green: 0.74, blue: 0.27)  // warning amber
    static let blue    = Color(red: 0.45, green: 0.72, blue: 1.00)  // info blue

    // Hero gradient — same deep-blue → orange wash as the flagship hero.
    static let heroGradient = LinearGradient(
        colors: [
            adaptiveColor(dark: (0.01, 0.06, 0.12), light: (0.06, 0.16, 0.42)),
            adaptiveColor(dark: (0.02, 0.11, 0.19), light: (0.10, 0.28, 0.62)),
            flameDeep.opacity(0.36),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

extension View {
    func foodCard(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
    }
}
