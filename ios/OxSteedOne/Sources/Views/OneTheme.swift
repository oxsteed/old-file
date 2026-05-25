import SwiftUI

enum OneTheme {
    static let background = LinearGradient(
        colors: [
            Color(red: 0.01, green: 0.05, blue: 0.09),
            Color(red: 0.02, green: 0.10, blue: 0.17),
            Color(red: 0.00, green: 0.03, blue: 0.07)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let ink = Color.white
    static let muted = Color.white.opacity(0.62)
    static let navy = Color(red: 0.02, green: 0.12, blue: 0.20)
    static let deepNavy = Color(red: 0.00, green: 0.04, blue: 0.08)
    static let sea = Color(red: 0.08, green: 0.42, blue: 0.40)
    static let amber = Color(red: 1.00, green: 0.42, blue: 0.02)
    static let amberDark = Color(red: 0.78, green: 0.20, blue: 0.00)
    static let card = Color.white.opacity(0.075)
    static let border = Color.white.opacity(0.13)
    static let darkGlass = Color(red: 0.05, green: 0.12, blue: 0.19).opacity(0.72)
}

struct GoScreen<Content: View>: View {
    let title: String
    var showsTitle = false
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if showsTitle {
                    Text(title)
                        .font(.largeTitle.bold())
                        .foregroundStyle(OneTheme.ink)
                }
                content
            }
            .padding(.horizontal, 18)
            .padding(.top, 18)
            .padding(.bottom, 110)
        }
        .background(OneTheme.background.ignoresSafeArea())
        .scrollIndicators(.hidden)
    }
}

struct GoCard<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(OneTheme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(OneTheme.border, lineWidth: 1)
        )
        .foregroundStyle(OneTheme.ink)
    }
}

struct OxSteedOneMark: View {
    var size: CGFloat = 58

    var body: some View {
        Image("OxSteedLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.23, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.23, style: .continuous)
                    .stroke(OneTheme.border, lineWidth: 1)
            )
            .shadow(color: OneTheme.amber.opacity(0.35), radius: 22, x: 0, y: 8)
            .accessibilityLabel("OxSteed logo")
    }
}

struct GoAccentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(.white)
            .padding(.vertical, 11)
            .padding(.horizontal, 18)
            .background(
                LinearGradient(
                    colors: [OneTheme.amber, Color(red: 0.93, green: 0.28, blue: 0.01)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .opacity(configuration.isPressed ? 0.78 : 1)
    }
}

struct GoModeGlyph: View {
    let symbolName: String
    var size: CGFloat = 42

    var body: some View {
        Image(systemName: symbolName)
            .font(.system(size: size * 0.44, weight: .bold))
            .foregroundStyle(OneTheme.amber)
            .frame(width: size, height: size)
            .background(OneTheme.amber.opacity(0.11), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(OneTheme.border, lineWidth: 1)
            )
    }
}
