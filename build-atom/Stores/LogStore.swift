import Foundation
import os

enum OXLogLevel: String, Codable {
    case debug
    case info
    case warn
    case error
}

struct OXLogEntry: Codable, Identifiable, Hashable {
    let id: UUID
    let timestamp: Date
    let level: OXLogLevel
    let category: String
    let message: String

    init(id: UUID = UUID(), timestamp: Date = Date(), level: OXLogLevel, category: String, message: String) {
        self.id = id
        self.timestamp = timestamp
        self.level = level
        self.category = category
        self.message = message
    }
}

/// Lightweight in-app log ring buffer to make TestFlight debugging practical.
/// This is not a substitute for production crash reporting, but it gives us a
/// "sendable" report when testers hit an issue.
@MainActor
final class LogStore: ObservableObject {
    static let shared = LogStore()

    @Published private(set) var entries: [OXLogEntry] = []

    private let maxEntries = 500
    private let persistFileName = "ox_logs.json"

    private init() {
        load()
    }

    func record(_ level: OXLogLevel, category: String = "app", _ message: String) {
        let entry = OXLogEntry(level: level, category: category, message: message)
        entries.append(entry)
        if entries.count > maxEntries {
            entries.removeFirst(entries.count - maxEntries)
        }
        persistSoon()
    }

    func clear() {
        entries.removeAll()
        try? FileManager.default.removeItem(at: persistURL)
    }

    func exportText(maxLines: Int = 400) -> String {
        let df = ISO8601DateFormatter()
        let slice = entries.suffix(maxLines)
        return slice.map { e in
            "\(df.string(from: e.timestamp)) [\(e.level.rawValue.uppercased())] (\(e.category)) \(e.message)"
        }.joined(separator: "\n")
    }

    func exportJSON() -> Data? {
        try? JSONEncoder().encode(entries)
    }

    // MARK: - Persistence

    private var persistURL: URL {
        let dir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        return dir.appendingPathComponent(persistFileName)
    }

    private var pendingPersist = false

    private func persistSoon() {
        guard !pendingPersist else { return }
        pendingPersist = true
        Task { @MainActor in
            // debounce a little to avoid writing on every log line
            try? await Task.sleep(nanoseconds: 350_000_000)
            pendingPersist = false
            persistNow()
        }
    }

    private func persistNow() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        try? data.write(to: persistURL, options: [.atomic])
    }

    private func load() {
        guard let data = try? Data(contentsOf: persistURL),
              let decoded = try? JSONDecoder().decode([OXLogEntry].self, from: data)
        else { return }
        entries = decoded
    }
}

enum OXLog {
    private static let subsystem = Bundle.main.bundleIdentifier ?? "com.oxsteed.app"

    static func debug(_ message: String, category: String = "app") { log(.debug, category: category, message) }
    static func info(_ message: String, category: String = "app") { log(.info, category: category, message) }
    static func warn(_ message: String, category: String = "app") { log(.warn, category: category, message) }
    static func error(_ message: String, category: String = "app") { log(.error, category: category, message) }

    private static func log(_ level: OXLogLevel, category: String, _ message: String) {
        let logger = Logger(subsystem: subsystem, category: category)
        switch level {
        case .debug:
            logger.debug("\(message, privacy: .public)")
        case .info:
            logger.info("\(message, privacy: .public)")
        case .warn:
            logger.warning("\(message, privacy: .public)")
        case .error:
            logger.error("\(message, privacy: .public)")
        }

        // Persist a copy for testers.
        Task { @MainActor in
            LogStore.shared.record(level, category: category, message)
        }
    }
}

