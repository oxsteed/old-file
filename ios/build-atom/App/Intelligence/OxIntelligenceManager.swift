import Foundation
import SwiftUI

// MARK: - OxIntelligenceManager
//
// Central gateway for all Apple Intelligence / Foundation Models features.
// All on-device AI requires iOS 26+ on a device with Apple Intelligence.
// Always check `isAvailable` before calling any AI feature; every caller
// must supply a non-AI fallback for unsupported devices and OS versions.

@MainActor
final class OxIntelligenceManager: ObservableObject {
    static let shared = OxIntelligenceManager()

    /// True when Foundation Models are available on this device and OS.
    @Published private(set) var isAvailable: Bool = false

    private init() {
        if #available(iOS 26, *) {
            isAvailable = true
        }
    }

    // MARK: - Availability badge view

    /// A small "AI" pill to show next to AI-powered features.
    static func availabilityBadge(available: Bool) -> some View {
        Group {
            if available {
                Label("ai.on_device_badge", systemImage: "sparkles")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        LinearGradient(
                            colors: [Color.purple, Color.indigo],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        in: Capsule()
                    )
            } else {
                EmptyView()
            }
        }
    }
}

// MARK: - AI Error

enum OxAIError: LocalizedError {
    case unavailable
    case modelError(String)
    case parsingFailed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Apple Intelligence is not available on this device. Please upgrade to iOS 26+ or enable Apple Intelligence in Settings."
        case .modelError(let msg):
            return "AI couldn't complete the request: \(msg)"
        case .parsingFailed:
            return "AI returned an unexpected response. Please fill in the fields manually."
        }
    }
}
