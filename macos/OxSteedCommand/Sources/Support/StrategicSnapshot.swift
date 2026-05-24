import Foundation

enum StrategicSnapshot {
    static let bootstrap: [CommandInitiative] = [
        CommandInitiative(
            section: .internalWorkspaces,
            title: "Company-wide internal workspace routing",
            status: .complete,
            summary: "Corporate departments now have dedicated login and dashboard routes outside the logistics branch.",
            evidence: [
                "Routes now exist for Finance, HR, Legal, Technology, Executive, Data, Marketing, and Corporate Operations.",
                "Corporate department aliases were aligned to cleaner public slugs such as `/internal/hr` and `/internal/legal`.",
                "Eligibility resolves from active `corporate_assignments` while global admins remain override operators."
            ],
            nextMoves: [
                CommandTask(title: "Drive adoption", detail: "Roll out department-by-department live access and capture which dashboards are actually used in practice."),
                CommandTask(title: "Add telemetry", detail: "Instrument login success, route denials, and first-task completion so provisioning quality is measurable.")
            ],
            verification: [
                "node --check server/utils/internalWorkspaces.js server/controllers/internalWorkspacesController.js server/routes/internalWorkspaces.js",
                "esbuild client/src/pages/internal/InternalDepartmentWorkspacePage.jsx --bundle --format=esm --platform=browser"
            ]
        ),
        CommandInitiative(
            section: .logistics,
            title: "Logistics branch operating system",
            status: .complete,
            summary: "Buyer, organizer, business procurement, operations, compliance, and admin control workspaces now exist as a coherent branch.",
            evidence: [
                "Route and role hardening separate employee workspace access from broad admin identity.",
                "Public logistics surfaces share the main OxSteed chrome instead of fragmenting into standalone shells.",
                "Recurring procurement and approval-gate flows are wired into the branch-level workflow."
            ],
            nextMoves: [
                CommandTask(title: "Turn on live ops reviews", detail: "Review quote, shipment, and compliance queues with real operators until the branch usage pattern is stable."),
                CommandTask(title: "Close workflow gaps", detail: "Audit the highest-volume logistics admin flows for telemetry, empty states, and exception handling.")
            ],
            verification: [
                "node --check server/routes/logistics.js server/routes/logisticsAdmin.js server/controllers/logisticsAdminController.js",
                "esbuild client/src/pages/logistics/LogisticsHomePage.jsx --bundle --format=esm --platform=browser"
            ]
        ),
        CommandInitiative(
            section: .translationPlatform,
            title: "Translation platform foundation",
            status: .complete,
            summary: "Runtime translation moved from a single helper path to a modular platform with cache, glossary, history, jobs, and a dedicated translator workspace.",
            evidence: [
                "Structured `/api/translate` contracts now coexist with legacy batch compatibility.",
                "The translator workspace and app-shell localization are split cleanly on the frontend.",
                "Glossary CRUD and worker-polled batch jobs are now first-class."
            ],
            nextMoves: [
                CommandTask(title: "Finish copy migration", detail: "Continue the i18n audit through newer vertical workspaces that still contain hardcoded copy."),
                CommandTask(title: "Add ops visibility", detail: "Expose cache hit rate, provider health, and glossary usage in a future live macOS panel.")
            ],
            verification: [
                "node --check server/modules/translation/translationService.js server/modules/translation/translationController.js",
                "esbuild client/src/pages/TranslatorWorkspacePage.jsx --bundle --format=esm --platform=browser"
            ]
        ),
        CommandInitiative(
            section: .mobileRelease,
            title: "OxSteed One release lane",
            status: .watch,
            summary: "The replacement Expo app is packaging and uploading, but the final product decision still depends on live device validation and root-path cleanup.",
            evidence: [
                "`mobile3/` is isolated as the replacement app root with a distinct bundle id `com.oxsteed.one`.",
                "Native JS bundle embedding and signing were repaired, and TestFlight upload succeeded.",
                "Remaining work is now a product decision and device validation problem, not a basic build-system problem."
            ],
            nextMoves: [
                CommandTask(title: "Make the root-call", detail: "Choose whether `mobile3/` is the primary mobile path after final on-device verification."),
                CommandTask(title: "Prove live launch", detail: "Confirm the current TestFlight build reaches the real UI on-device without a black-screen regression.")
            ],
            verification: [
                "npm run typecheck",
                "xcodebuild -list",
                "xcodebuild -exportArchive ... Upload succeeded"
            ]
        ),
        CommandInitiative(
            section: .commandCenter,
            title: "Native super-admin command center",
            status: .active,
            summary: "A dedicated macOS app can compress strategy, release readiness, and operational oversight into one desktop-native control surface.",
            evidence: [
                "The repo already has stable backend contracts, an Apple platform foothold, and clear initiative priorities in AGENTS.md.",
                "A SwiftPM macOS workspace can ship quickly without entangling the existing web and mobile delivery lanes.",
                "Codex can run it locally through a deterministic build-and-run script."
            ],
            nextMoves: [
                CommandTask(title: "Wire live data", detail: "Replace curated snapshot data with authenticated API fetches for super-admin health, internal access, and release status."),
                CommandTask(title: "Expand desktop actions", detail: "Add real provisioning, review, and launch controls once the first live data endpoints are settled.")
            ],
            verification: [
                "./script/build_and_run.sh --verify",
                "swift build --package-path macos/OxSteedCommand"
            ]
        )
    ]
}
