import SwiftUI
import UIKit

// OxSteed Restaurants — shared design system.
//
// This file is the single source of visual truth for every OxSteed
// Restaurants surface (Customer, Manager, POS, Kitchen, Kiosk, Crew,
// Inventory, Runner). It is kept
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
    static let teal    = Color(red: 0.16, green: 0.70, blue: 0.74)  // crew / training

    /// Fixed dark header used by dedicated role-app shells.
    static let shellNavy = Color(red: 0.05, green: 0.06, blue: 0.11)
    static let shellInk  = Color.white
    static let shellMuted = Color.white.opacity(0.62)

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

    static func accent(for seed: String, brandHex: String?) -> Color {
        if let brandHex, let parsed = color(fromHex: brandHex) { return parsed }
        return accent(for: seed)
    }

    static func accent(for seed: Int64, brandHex: String?) -> Color {
        accent(for: String(seed), brandHex: brandHex)
    }

    private static func color(fromHex hex: String) -> Color? {
        var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") { cleaned.removeFirst() }
        guard cleaned.count == 6, let value = UInt64(cleaned, radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        return Color(red: r, green: g, blue: b)
    }

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

// MARK: - Shared role shell components

struct FoodPriorityCard: View {
    let eyebrow: String
    let title: String
    let detail: String
    let tint: Color
    var icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(tint.opacity(0.16))
                    Image(systemName: icon)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(tint)
                }
                .frame(width: 38, height: 38)

                Spacer()

                Text(eyebrow.uppercased())
                    .font(.foodMicro)
                    .foregroundStyle(tint)
            }

            Text(title)
                .font(.foodSubhead)
                .foregroundStyle(FoodTheme.ink)
                .lineLimit(2)

            Text(detail)
                .font(.foodCaption)
                .foregroundStyle(FoodTheme.muted)
                .lineLimit(3)
        }
        .frame(width: 196, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .fill(FoodTheme.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(tint.opacity(0.22), lineWidth: 1)
        )
        .foodShadow(.soft)
    }
}

struct FoodOperationalStat: View {
    let label: String
    let value: String
    let detail: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.foodMicro)
                .foregroundStyle(tint)
            Text(value)
                .font(.system(size: 28, weight: .black, design: .rounded))
                .foregroundStyle(FoodTheme.ink)
            Text(detail)
                .font(.foodCaption)
                .foregroundStyle(FoodTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FoodTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
    }
}

struct FoodModeCard: View {
    let title: String
    let detail: String
    let icon: String
    let tint: Color
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .bold))
                Spacer()
                if isSelected {
                    Text("NOW")
                        .font(.foodMicro)
                }
            }

            Text(title)
                .font(.foodSubhead)
                .lineLimit(2)

            Text(detail)
                .font(.foodCaption)
                .lineLimit(3)
        }
        .foregroundStyle(isSelected ? Color.white : FoodTheme.ink)
        .frame(width: 188, alignment: .leading)
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .fill(isSelected ? AnyShapeStyle(LinearGradient(colors: [tint.opacity(0.9), tint], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(FoodTheme.surface))
        )
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(isSelected ? tint : FoodTheme.line, lineWidth: 1)
        )
        .foodShadow(isSelected ? .medium : .soft)
    }
}

struct FoodBrandMessageCard: View {
    let title: String
    let detail: String
    let tint: Color
    var icon: String = "storefront.fill"

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: FoodTheme.Radius.md, style: .continuous)
                    .fill(tint.opacity(0.14))
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(tint)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.foodSubhead)
                    .foregroundStyle(FoodTheme.ink)
                Text(detail)
                    .font(.foodCaption)
                    .foregroundStyle(FoodTheme.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(FoodTheme.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
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

// MARK: - Operational primitives (production shared kit)
//
// These are additive, used across the operational apps (KDS, POS, Kiosk,
// Manager, Inventory, Runner) to keep live-status, counts, urgency and
// empty states consistent and production-grade. None of them replace an
// existing token, so they cannot break call sites that predate them.

/// Connectivity / freshness states for an always-on operational surface.
enum FoodLiveState: Equatable {
    case live          // real feed, fresh
    case syncing       // connecting / reconnecting
    case offline       // no live feed; using cached/sample data

    var label: String {
        switch self {
        case .live: return "LIVE"
        case .syncing: return "SYNCING"
        case .offline: return "OFFLINE"
        }
    }

    var tint: Color {
        switch self {
        case .live: return FoodTheme.basil
        case .syncing: return FoodTheme.saffron
        case .offline: return FoodTheme.coral
        }
    }

    var icon: String {
        switch self {
        case .live: return "dot.radiowaves.left.and.right"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .offline: return "wifi.slash"
        }
    }
}

/// Small pulsing live/sync/offline badge for operational headers.
struct FoodLiveBadge: View {
    let state: FoodLiveState
    var detail: String? = nil
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(state.tint)
                .frame(width: 7, height: 7)
                .scaleEffect(state == .live && pulse ? 1.5 : 1)
                .opacity(state == .live && pulse ? 0.4 : 1)
                .animation(state == .live ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
            Text(detail.map { "\(state.label) · \($0)" } ?? state.label)
                .font(.foodMicro)
                .foregroundStyle(state.tint)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Capsule(style: .continuous).fill(state.tint.opacity(0.14)))
        .overlay(Capsule(style: .continuous).stroke(state.tint.opacity(0.30), lineWidth: 1))
        .onAppear { pulse = true }
    }

    static func from(_ text: String) -> FoodLiveState {
        let lower = text.lowercased()
        if lower.contains("live") { return .live }
        if lower.contains("recon") || lower.contains("sync") || lower.contains("connect") { return .syncing }
        return .offline
    }
}

/// A big count chip — used for KDS columns, queue counters, alert counts.
struct FoodCountChip: View {
    let count: Int
    let label: String
    var tint: Color = FoodTheme.flame

    var body: some View {
        HStack(spacing: 8) {
            Text("\(count)")
                .font(.system(size: 22, weight: .black, design: .rounded))
                .foregroundStyle(tint)
                .contentTransition(.numericText())
            Text(label.uppercased())
                .font(.foodMicro)
                .foregroundStyle(FoodTheme.muted)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(FoodTheme.surfaceRaised)
        .clipShape(Capsule(style: .continuous))
        .overlay(Capsule(style: .continuous).stroke(tint.opacity(0.20), lineWidth: 1))
    }
}

/// Time-based urgency tiers for live tickets / tasks / stock risk.
/// On-time → warning → late, with an explicit colour + short label.
enum FoodUrgency: Equatable {
    case onTime
    case warning
    case late

    var tint: Color {
        switch self {
        case .onTime: return FoodTheme.basil
        case .warning: return FoodTheme.saffron
        case .late: return FoodTheme.coral
        }
    }

    var label: String {
        switch self {
        case .onTime: return "On time"
        case .warning: return "Watch"
        case .late: return "Late"
        }
    }

    /// Derive urgency from elapsed minutes against soft/hard thresholds,
    /// or directly from a promised-time breach.
    static func tier(elapsedMinutes: Double, warnAfter: Double, lateAfter: Double, promisedPassed: Bool = false) -> FoodUrgency {
        if promisedPassed || elapsedMinutes >= lateAfter { return .late }
        if elapsedMinutes >= warnAfter { return .warning }
        return .onTime
    }
}

/// Consistent, non-demo empty state. Production apps need a confident
/// "you're caught up" rather than a stray "Nothing here" string.
struct FoodEmptyState: View {
    let icon: String
    let title: String
    var detail: String? = nil
    var tint: Color = FoodTheme.basil

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle().fill(tint.opacity(0.14))
                Image(systemName: icon)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(tint)
            }
            .frame(width: 56, height: 56)
            Text(title)
                .font(.foodSubhead)
                .foregroundStyle(FoodTheme.ink)
                .multilineTextAlignment(.center)
            if let detail {
                Text(detail)
                    .font(.foodCaption)
                    .foregroundStyle(FoodTheme.muted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 28)
        .padding(.horizontal, 20)
    }
}

/// "Powered by OxSteed" network footnote — reinforces that the restaurant
/// owns its brand and OxSteed is the enabling network, not the owner.
struct FoodNetworkFootnote: View {
    var leading: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "bolt.horizontal.circle.fill")
                .font(.system(size: 11, weight: .bold))
            Text(leading.map { "\($0) · Powered by OxSteed Restaurants" } ?? "Powered by OxSteed Restaurants")
                .font(.foodMicro)
        }
        .foregroundStyle(FoodTheme.faint)
    }
}

/// A circular brand mark — uses the restaurant logo when available, otherwise a monogram.
struct FoodBrandMark: View {
    let name: String
    var logoURL: String? = nil
    var accent: Color = FoodTheme.flame
    var size: CGFloat = 46

    private var monogram: String {
        let words = name.split(separator: " ").prefix(2)
        let letters = words.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "OX" : letters.uppercased()
    }

    var body: some View {
        Group {
            if let logoURL, !logoURL.isEmpty {
                RemoteFoodImage(logoURL, icon: "fork.knife", tint: accent)
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                            .stroke(accent.opacity(0.25), lineWidth: 1)
                    )
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: size * 0.3, style: .continuous)
                        .fill(
                            LinearGradient(colors: [accent.opacity(0.95), accent.opacity(0.7)],
                                           startPoint: .topLeading, endPoint: .bottomTrailing)
                        )
                    Text(monogram)
                        .font(.system(size: size * 0.42, weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                }
                .frame(width: size, height: size)
                .foodShadow(.soft)
            }
        }
    }
}

// MARK: - Dedicated role-app shell (mockup-grade chrome)

/// True when this binary is locked to a single workspace (dedicated App Store app).
enum FoodAppShell {
    static var isDedicated: Bool {
        let allowed = Bundle.main.object(forInfoDictionaryKey: "OX_ALLOWED_WORKSPACES") as? [String] ?? []
        return allowed.count == 1
    }
}

/// One tab in the floating bottom bar.
struct FoodTabDescriptor<ID: Hashable>: Identifiable {
    let id: ID
    let title: String
    let icon: String
}

/// Dark header + white sheet body — the production shell for dedicated apps.
struct FoodRoleAppShell<Content: View>: View {
    let appName: String
    let roleTitle: String
    let roleSubtitle: String
    let accent: Color
    var logoURL: String? = nil
    var contextLine: String? = nil
    var liveState: FoodLiveState? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        ZStack {
            FoodTheme.shellNavy.ignoresSafeArea()

            VStack(spacing: 0) {
                header
                accentRule
                sheetBody
            }
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            FoodBrandMark(name: appName, logoURL: logoURL, accent: FoodTheme.flame, size: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text(roleTitle)
                    .font(.system(size: 22, weight: .black, design: .rounded))
                    .foregroundStyle(FoodTheme.shellInk)
                    .lineLimit(1)
                Text(roleSubtitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.shellMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            if let liveState {
                FoodLiveBadge(state: liveState)
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 14)
    }

    private var accentRule: some View {
        Rectangle()
            .fill(accent)
            .frame(height: 3)
    }

    private var sheetBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let contextLine, !contextLine.isEmpty {
                Text(contextLine)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(FoodTheme.muted)
                    .padding(.horizontal, 20)
                    .padding(.top, 18)
                    .padding(.bottom, 4)
            }

            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(FoodTheme.surface)
        .clipShape(
            UnevenRoundedRectangle(
                topLeadingRadius: FoodTheme.Radius.xl,
                bottomLeadingRadius: 0,
                bottomTrailingRadius: 0,
                topTrailingRadius: FoodTheme.Radius.xl,
                style: .continuous
            )
        )
        .ignoresSafeArea(edges: .bottom)
    }
}

/// Floating pill tab bar for dedicated role apps.
struct FoodFloatingTabBar<ID: Hashable>: View {
    @Binding var selection: ID
    let accent: Color
    let items: [FoodTabDescriptor<ID>]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(items) { item in
                let selected = selection == item.id
                Button {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                        selection = item.id
                    }
                } label: {
                    VStack(spacing: 5) {
                        ZStack {
                            Circle()
                                .fill(selected ? accent : FoodTheme.surfaceRaised)
                                .frame(width: 34, height: 34)
                            Image(systemName: item.icon)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(selected ? Color.white : FoodTheme.muted)
                        }
                        Text(item.title)
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(selected ? accent : FoodTheme.muted)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .background(
            Capsule(style: .continuous)
                .fill(FoodTheme.surface)
                .foodShadow(.medium)
        )
        .overlay(
            Capsule(style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
    }
}

extension View {
    /// Attach the floating tab bar when running as a dedicated single-role app.
    @ViewBuilder
    func foodDedicatedTabBar<ID: Hashable>(
        selection: Binding<ID>,
        accent: Color,
        items: [FoodTabDescriptor<ID>]
    ) -> some View {
        if FoodAppShell.isDedicated {
            safeAreaInset(edge: .bottom, spacing: 0) {
                FoodFloatingTabBar(selection: selection, accent: accent, items: items)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
            }
        } else {
            self
        }
    }

    /// Extra bottom padding when dedicated tabs are pinned.
    @ViewBuilder
    func foodDedicatedScrollPadding() -> some View {
        if FoodAppShell.isDedicated {
            padding(.bottom, 4)
        } else {
            self
        }
    }
}

/// Wide attention banner with left accent bar — matches mockup "Needs attention" rows.
struct FoodAttentionBanner: View {
    let title: String
    var detail: String? = nil
    let tint: Color
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(tint)
                .frame(width: 5)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.foodSubhead)
                    .foregroundStyle(FoodTheme.ink)
                    .lineLimit(2)
                if let detail {
                    Text(detail)
                        .font(.foodCaption)
                        .foregroundStyle(FoodTheme.muted)
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 8)

            if let actionTitle, let action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 10)
                        .background(Capsule(style: .continuous).fill(tint))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .background(FoodTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
        .foodShadow(.soft)
    }
}

/// Compact KPI tile for 2×2 summary grids.
struct FoodKPITile: View {
    let value: String
    let label: String
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(value)
                .font(.system(size: 26, weight: .black, design: .rounded))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(label)
                .font(.foodCaption)
                .foregroundStyle(FoodTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(FoodTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                .stroke(FoodTheme.line, lineWidth: 1)
        )
    }
}

/// 2×2 KPI grid helper.
struct FoodKPIGrid: View {
    let tiles: [(value: String, label: String, tint: Color)]

    var body: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            ForEach(Array(tiles.enumerated()), id: \.offset) { _, tile in
                FoodKPITile(value: tile.value, label: tile.label, tint: tile.tint)
            }
        }
    }
}

/// Quick-action row with chevron — mockup-style navigation list item.
struct FoodQuickActionRow: View {
    let title: String
    let detail: String
    let tint: Color
    var action: (() -> Void)? = nil

    var body: some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.foodSubhead)
                        .foregroundStyle(FoodTheme.ink)
                    Text(detail)
                        .font(.foodCaption)
                        .foregroundStyle(FoodTheme.muted)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(tint)
            }
            .padding(16)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: FoodTheme.Radius.lg, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
    }
}
