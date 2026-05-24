import SwiftUI

enum AppTheme {
    static let background = LinearGradient(
        colors: [
            Color(red: 0.98, green: 0.95, blue: 0.88),
            Color(red: 0.89, green: 0.96, blue: 0.94),
            Color(red: 0.94, green: 0.95, blue: 1.0)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let heroGradient = LinearGradient(
        colors: [
            Color(red: 0.08, green: 0.17, blue: 0.25),
            Color(red: 0.11, green: 0.31, blue: 0.36)
        ],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let card = Color.white.opacity(0.78)
    static let gold = Color(red: 0.96, green: 0.62, blue: 0.18)
}
