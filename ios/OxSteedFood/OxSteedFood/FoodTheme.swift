import SwiftUI
import UIKit

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
    static let background = adaptiveColor(dark: (0.05, 0.055, 0.06), light: (0.97, 0.97, 0.96))
    static let surface = adaptiveColor(dark: (0.10, 0.105, 0.11), light: (1.00, 1.00, 1.00))
    static let surfaceRaised = adaptiveColor(dark: (0.14, 0.145, 0.15), light: (0.94, 0.95, 0.95))
    static let ink = adaptiveColor(dark: (0.97, 0.96, 0.93), light: (0.09, 0.10, 0.10))
    static let muted = adaptiveColor(dark: (0.68, 0.69, 0.66), light: (0.39, 0.42, 0.42))
    static let line = Color.primary.opacity(0.10)
    static let flame = Color(red: 0.96, green: 0.32, blue: 0.16)
    static let basil = Color(red: 0.17, green: 0.55, blue: 0.36)
    static let saffron = Color(red: 0.94, green: 0.65, blue: 0.22)
    static let blue = Color(red: 0.20, green: 0.43, blue: 0.78)
}

extension View {
    func foodCard(padding: CGFloat = 14) -> some View {
        self
            .padding(padding)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
    }
}
