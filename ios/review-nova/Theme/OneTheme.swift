import SwiftUI

/// Centralised design tokens for OxSteed One.
/// Warm, premium, earthy palette with a teal-leaning accent — built to feel
/// trustworthy across many personas (customer, helper, business owner, etc.).
enum OneTheme {
    // Brand
    static let accent       = Color(red: 0.13, green: 0.56, blue: 0.55)   // deep teal
    static let accentSoft   = Color(red: 0.40, green: 0.78, blue: 0.74)   // mint highlight
    static let ember        = Color(red: 0.95, green: 0.55, blue: 0.20)   // warm CTA
    static let plum         = Color(red: 0.49, green: 0.32, blue: 0.62)   // growth
    static let sky          = Color(red: 0.31, green: 0.55, blue: 0.92)   // info
    static let success      = Color(red: 0.27, green: 0.70, blue: 0.45)
    static let warning      = Color(red: 0.95, green: 0.74, blue: 0.20)
    static let danger       = Color(red: 0.88, green: 0.33, blue: 0.33)

    // Surfaces
    static let canvas       = Color("Canvas", bundle: nil, fallback: Color(.systemBackground))
    static let card         = Color("Card",   bundle: nil, fallback: Color(.secondarySystemBackground))
    static let subtle       = Color("Subtle", bundle: nil, fallback: Color(.tertiarySystemBackground))

    // Typography helpers
    static func title(_ text: String) -> Text {
        Text(text).font(.system(.title2, design: .rounded, weight: .bold))
    }

    static func sectionHeader(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.semibold))
            .tracking(0.8)
            .foregroundStyle(.secondary)
    }

    /// Soft gradient used in hero / header surfaces.
    static let heroGradient = LinearGradient(
        colors: [
            Color(red: 0.13, green: 0.56, blue: 0.55),
            Color(red: 0.31, green: 0.74, blue: 0.66),
            Color(red: 0.95, green: 0.74, blue: 0.45)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

// Color asset fallback helper — keeps things resilient if assets aren't yet defined.
extension Color {
    init(_ name: String, bundle: Bundle?, fallback: Color) {
        if let ui = UIColor(named: name, in: bundle, compatibleWith: nil) {
            self = Color(ui)
        } else {
            self = fallback
        }
    }
}
