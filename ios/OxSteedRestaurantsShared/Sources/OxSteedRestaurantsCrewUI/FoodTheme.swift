import SwiftUI
import UIKit

// OxSteed Restaurants — shared design system.
//
// This file is the single source of visual truth for every OxSteed
// Restaurants surface (Customer, Manager, POS, Kitchen, Kiosk, Crew,
// Inventory, Runner) plus the internal OxSteedFood app. It is kept
// byte-identical across all of those targets, so a change here lifts
// every screen in every app at once.
//
// HYBRID BRANDING: the OxSteed orange + near-black navy shell is the
// constant platform identity; each restaurant gets a stable, on-brand
// ACCENT colour (FoodTheme.accent(for:)) so its storefront feels like
// its own place while still reading as part of OxSteed.
//
// COMPILE CONTRACT: every token name that existed before
// (background/surface/surfaceRaised/ink/muted/line/flame/flameDeep/
// flameSoft/basil/saffron/blue/heroGradient) and the foodCard(padding:)
// modifier are preserved with the same signatures. Everything else is
// additive. Do not rename tokens — propagate this whole file instead.

// MARK: - Adaptive colour helper

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

    // MARK: Backgrounds & surfaces
    // Warmer, deeper dark and a soft off-white light mode for a premium feel.
    static let background    = adaptiveColor(dark: (0.05, 0.06, 0.09), light: (0.96, 0.96, 0.98))
    static let surface       = adaptiveColor(dark: (0.10, 0.11, 0.15), light: (1.00, 1.00, 1.00))
    static let surfaceRaised = adaptiveColor(dark: (0.14, 0.15, 0.20), light: (0.97, 0.97, 0.99))
    static let surfaceSunken = adaptiveColor(dark: (0.03, 0.04, 0.06), light: (0.92, 0.93, 0.95))

    // MARK: Text
    static let ink      = adaptiveColor(dark: (0.99, 0.99, 1.00), light: (0.05, 0.06, 0.11))
    static let inkSoft  = adaptiveColor(dark: (0.84, 0.85, 0.89), light: (0.20, 0.21, 0.27))
    static let muted    = adaptiveColor(dark: (0.64, 0.65, 0.70), light: (0.42, 0.43, 0.48))
    static let faint    = adaptiveColor(dark: (0.46, 0.47, 0.52), light: (0.60, 0.61, 0.66))
    static let line     = Color.primary.opacity(0.08)
    static let lineSoft = Color.primary.opacity(0.05)

    // MARK: Brand — the single OxSteed orange used across all OxSteed apps.
    static let flame     = Color(red: 1.00, green: 0.46, blue: 0.13)
    static let flameDeep = Color(red: 0.82, green: 0.34, blue: 0.06)
    static let flameSoft = Color(red: 1.00, green: 0.55, blue: 0.20).opacity(0.18)
    static let ember     = Color(red: 1.00, green: 0.63, blue: 0.30)

    // MARK: Secondary accents — one family across all apps.
    static let basil   = Color(red: 0.24, green: 0.82, blue: 0.52)  // success green
    static let saffron = Color(red: 0.99, green: 0.74, blue: 0.27)  // warning amber
    static let blue    = Color(red: 0.38, green: 0.66, blue: 1.00)  // info blue
    static let grape   = Color(red: 0.62, green: 0.48, blue: 1.00)  // accent violet
    static let coral   = Color(red: 1.00, green: 0.40, blue: 0.46)  // alert / danger

    // MARK: Gradients
    static let heroGradient = LinearGradient(
        colors: [
            adaptiveColor(dark: (0.02, 0.07, 0.14), light: (0.06, 0.16, 0.42)),
            adaptiveColor(dark: (0.03, 0.12, 0.20), light: (0.10, 0.28, 0.62)),
            flameDeep.opacity(0.40),
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Warm brand gradient for primary buttons, badges and accent fills.
    static let brandGradient = LinearGradient(
        colors: [ember, flame, flameDeep],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// A soft, near-invisible top-to-bottom wash to seat content over a hero.
    static let scrim = LinearGradient(
        colors: [Color.black.opacity(0.0), Color.black.opacity(0.55)],
        startPoint: .top,
        endPoint: .bottom
    )

    // MARK: - Per-restaurant accent (hybrid branding)
    //
    // There is no brand-colour column on the restaurant record yet, so we
    // derive a stable, attractive accent from a seed (the restaurant id or
    // name). Same seed → same colour every launch, so a storefront always
    // looks like itself. All hues are pulled from a curated, on-brand
    // palette so nothing ever clashes with the OxSteed shell.
    private static let accentPalette: [Color] = [
        Color(red: 1.00, green: 0.46, blue: 0.13),  // OxSteed orange
        Color(red: 0.96, green: 0.30, blue: 0.34),  // chilli red
        Color(red: 0.24, green: 0.74, blue: 0.52),  // basil green
        Color(red: 0.20, green: 0.60, blue: 0.96),  // azure
        Color(red: 0.58, green: 0.44, blue: 0.98),  // grape
        Color(red: 0.95, green: 0.62, blue: 0.18),  // amber
        Color(red: 0.92, green: 0.36, blue: 0.62),  // berry
        Color(red: 0.16, green: 0.70, blue: 0.74),  // teal
    ]

    /// Stable accent colour for a restaurant, derived from a seed string/number.
    static func accent(for seed: String) -> Color {
        guard !seed.isEmpty else { return flame }
        var hash: UInt64 = 1469598103934665603 // FNV-1a
        for byte in seed.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 1099511628211
        }
        return accentPalette[Int(hash % UInt64(accentPalette.count))]
    }

    static func accent(for seed: Int64) -> Color { accent(for: String(seed)) }

    // MARK: - Spacing & radius scale
    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
    }

    enum Radius {
        static let sm: CGFloat = 10
        static let md: CGFloat = 16
        static let lg: CGFloat = 20
        static let xl: CGFloat = 28
        static let pill: CGFloat = 999
    }
}

// MARK: - Type scale
//
// A consistent set of fonts so weight/size stop drifting screen to screen.
// Rounded design gives the friendly, modern "big brand app" feel.
extension Font {
    static let foodDisplay   = Font.system(size: 32, weight: .heavy, design: .rounded)
    static let foodTitle     = Font.system(size: 24, weight: .bold, design: .rounded)
    static let foodHeadline  = Font.system(size: 19, weight: .bold, design: .rounded)
    static let foodSubhead   = Font.system(size: 16, weight: .semibold, design: .rounded)
    static let foodBody      = Font.system(size: 15, weight: .medium)
    static let foodCallout   = Font.system(size: 14, weight: .semibold)
    static let foodCaption   = Font.system(size: 12, weight: .semibold)
    static let foodMicro     = Font.system(size: 11, weight: .semibold)
    static let foodPrice     = Font.system(size: 16, weight: .heavy, design: .rounded)
    static let foodNumeral   = Font.system(size: 72, weight: .black, design: .rounded)
}

// MARK: - Elevation

struct FoodShadow {
    let color: Color
    let radius: CGFloat
    let y: CGFloat

    static let soft   = FoodShadow(color: Color.black.opacity(0.10), radius: 10, y: 4)
    static let medium = FoodShadow(color: Color.black.opacity(0.16), radius: 18, y: 8)
    static let lifted = FoodShadow(color: Color.black.opacity(0.22), radius: 28, y: 14)
}

extension View {
    func foodShadow(_ shadow: FoodShadow = .soft) -> some View {
        self.shadow(color: shadow.color, radius: shadow.radius, x: 0, y: shadow.y)
    }
}

// MARK: - Cards

extension View {
    /// Standard content card. Now carries a soft shadow + larger radius so
    /// every existing screen that already calls `.foodCard()` gains depth
    /// for free — no call sites need to change.
    func foodCard(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
            .foodShadow(.soft)
    }

    /// A more prominent card for hero/feature content — stronger shadow and
    /// a subtle raised surface.
    func foodCardElevated(padding: CGFloat = 18) -> some View {
        self
            .padding(padding)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.xl, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
            .foodShadow(.medium)
    }
}

// MARK: - Pills, tags & badges

/// A small rounded chip. Use for cuisine tags, statuses, filters.
struct FoodPill: View {
    let text: String
    var systemImage: String? = nil
    var tint: Color = FoodTheme.flame
    var filled: Bool = false

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 11, weight: .bold))
            }
            Text(text).font(.foodMicro)
        }
        .foregroundStyle(filled ? Color.white : tint)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule(style: .continuous)
                .fill(filled ? AnyShapeStyle(tint) : AnyShapeStyle(tint.opacity(0.14)))
        )
    }
}

/// A neutral tag chip for allergens / metadata.
struct FoodTag: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.foodMicro)
            .foregroundStyle(FoodTheme.muted)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(Capsule(style: .continuous).fill(FoodTheme.surfaceRaised))
            .overlay(Capsule(style: .continuous).stroke(FoodTheme.line, lineWidth: 1))
    }
}

// MARK: - Section heading

extension View {
    /// Standard left-aligned section title styling.
    func sectionHeading() -> some View {
        self.font(.foodHeadline).foregroundStyle(FoodTheme.ink)
    }
}

/// A section header row with an optional trailing accessory.
struct FoodSectionHeader<Trailing: View>: View {
    let title: String
    var subtitle: String? = nil
    var accent: Color = FoodTheme.flame
    @ViewBuilder var trailing: () -> Trailing

    var body: some View {
        HStack(alignment: .center) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(accent)
                .frame(width: 4, height: 22)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.foodHeadline).foregroundStyle(FoodTheme.ink)
                if let subtitle {
                    Text(subtitle).font(.foodCaption).foregroundStyle(FoodTheme.muted)
                }
            }
            Spacer(minLength: 8)
            trailing()
        }
    }
}

extension FoodSectionHeader where Trailing == EmptyView {
    init(_ title: String, subtitle: String? = nil, accent: Color = FoodTheme.flame) {
        self.init(title: title, subtitle: subtitle, accent: accent) { EmptyView() }
    }
}

// MARK: - Button styles

/// Filled, gradient primary action button — the main call to action.
struct PrimaryActionButtonStyle: ButtonStyle {
    var tint: Color = FoodTheme.flame
    var fullWidth: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.foodSubhead)
            .foregroundStyle(.white)
            .padding(.vertical, 15)
            .padding(.horizontal, 22)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [tint.opacity(0.92), tint],
                            startPoint: .top, endPoint: .bottom
                        )
                    )
            )
            .foodShadow(FoodShadow(color: tint.opacity(0.35), radius: 14, y: 8))
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/// Outlined, tinted secondary button.
struct SecondaryActionButtonStyle: ButtonStyle {
    var tint: Color = FoodTheme.flame
    var fullWidth: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.foodCallout)
            .foregroundStyle(tint)
            .padding(.vertical, 12)
            .padding(.horizontal, 18)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .background(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                    .fill(tint.opacity(0.12))
            )
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                    .stroke(tint.opacity(0.30), lineWidth: 1)
            )
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

// MARK: - Remote image
//
// The apps never loaded real cover/menu photos before — they showed SF
// Symbols. This wrapper renders a real image when a URL is present and
// falls back to a tasteful gradient + icon placeholder otherwise, so a
// missing photo never looks broken.
struct RemoteFoodImage<Placeholder: View>: View {
    let urlString: String?
    var contentMode: ContentMode = .fill
    @ViewBuilder var placeholder: () -> Placeholder

    var body: some View {
        if let urlString, let url = URL(string: urlString), !urlString.isEmpty {
            AsyncImage(url: url, transaction: Transaction(animation: .easeInOut(duration: 0.25))) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: contentMode)
                case .empty:
                    ZStack { FoodTheme.surfaceRaised; ProgressView().controlSize(.small) }
                case .failure:
                    placeholder()
                @unknown default:
                    placeholder()
                }
            }
        } else {
            placeholder()
        }
    }
}

extension RemoteFoodImage where Placeholder == FoodImagePlaceholder {
    init(_ urlString: String?, contentMode: ContentMode = .fill, icon: String = "fork.knife", tint: Color = FoodTheme.flame) {
        self.urlString = urlString
        self.contentMode = contentMode
        self.placeholder = { FoodImagePlaceholder(icon: icon, tint: tint) }
    }
}

/// Default gradient + icon placeholder used when a photo is missing.
struct FoodImagePlaceholder: View {
    var icon: String = "fork.knife"
    var tint: Color = FoodTheme.flame

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [tint.opacity(0.30), tint.opacity(0.10)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Image(systemName: icon)
                .font(.system(size: 26, weight: .semibold))
                .foregroundStyle(tint.opacity(0.85))
        }
    }
}
