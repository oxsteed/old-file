import SwiftUI

enum GoTheme {
    static let background = LinearGradient(
        colors: [
            Color(red: 1.0, green: 0.96, blue: 0.88),
            Color(red: 0.89, green: 0.97, blue: 0.93),
            Color(red: 0.89, green: 0.94, blue: 1.0)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let ink = Color(red: 0.06, green: 0.11, blue: 0.16)
    static let navy = Color(red: 0.07, green: 0.18, blue: 0.25)
    static let sea = Color(red: 0.07, green: 0.42, blue: 0.40)
    static let amber = Color(red: 0.96, green: 0.55, blue: 0.12)
    static let card = Color.white.opacity(0.82)
}

struct GoScreen<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                content
            }
            .padding()
        }
        .background(GoTheme.background.ignoresSafeArea())
        .navigationTitle(title)
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
        .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(.white.opacity(0.65), lineWidth: 1)
        )
    }
}
