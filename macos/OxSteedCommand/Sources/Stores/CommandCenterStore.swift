import Observation
import SwiftUI

@Observable
final class CommandCenterStore {
    var selectedSection: CommandSection? = .commandCenter
    var searchText = ""
    var operatorName = "Codex"
    var apiBaseURL = "https://oxsteed.com/api"
    var statusHeadline = "Ship the executive control plane without slowing the product machine."
    private(set) var initiatives = StrategicSnapshot.bootstrap

    var topMetrics: [CommandMetric] {
        [
            CommandMetric(label: "Shipped Foundations", value: "5", note: "Internal workspaces, logistics, translation, marketplace, and mobile stabilization."),
            CommandMetric(label: "Immediate Calls", value: "3", note: "Desktop control plane, mobile3 primary-root decision, and live release validation."),
            CommandMetric(label: "Primary API", value: apiBaseURL, note: "Live contract target for every native control surface.")
        ]
    }

    var visibleInitiatives: [CommandInitiative] {
        let base = initiatives.filter { initiative in
            guard let selectedSection else { return true }
            return selectedSection == .commandCenter || initiative.section == selectedSection
        }

        let trimmed = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return base }

        return base.filter { initiative in
            initiative.title.localizedCaseInsensitiveContains(trimmed) ||
            initiative.summary.localizedCaseInsensitiveContains(trimmed) ||
            initiative.evidence.contains(where: { $0.localizedCaseInsensitiveContains(trimmed) }) ||
            initiative.nextMoves.contains(where: { $0.title.localizedCaseInsensitiveContains(trimmed) || $0.detail.localizedCaseInsensitiveContains(trimmed) })
        }
    }

    var priorityMoves: [CommandTask] {
        [
            CommandTask(
                title: "Install a native executive desk",
                detail: "Use this macOS app as the place where super-admin decisions, launch blockers, and operational health live together."
            ),
            CommandTask(
                title: "Finish the mobile root migration",
                detail: "Decide whether `mobile3/` becomes the official app root once TestFlight and on-device launch are verified."
            ),
            CommandTask(
                title: "Convert completed backend passes into operating habits",
                detail: "Move internal-workspace and logistics rollouts from feature-complete to daily-use through live access, telemetry, and review loops."
            )
        ]
    }

    func refreshSnapshot() {
        initiatives = StrategicSnapshot.bootstrap
    }
}
