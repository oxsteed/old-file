import Foundation

enum FoodDisplaySocketOrigin {
    /// Socket.IO server origin (scheme + host, no `/api` path).
    static var url: URL {
        if let raw = Bundle.main.object(forInfoDictionaryKey: "OX_API_BASE_URL") as? String,
           let parsed = URL(string: raw),
           raw.hasPrefix("http") {
            var components = URLComponents(url: parsed, resolvingAgainstBaseURL: false)
            if components?.path == "/api" || components?.path.hasSuffix("/api") == true {
                components?.path = ""
            }
            if let cleaned = components?.url { return cleaned }
            return parsed
        }
        return URL(string: "https://api.oxsteed.com")!
    }
}

#if canImport(SocketIO)
import SocketIO

/// Public, read-only Socket.IO client for in-store restaurant displays.
/// Mirrors `client/src/api/restaurantDisplaySocket.js` — polling remains the floor.
@MainActor
final class RestaurantDisplaySubscriber {
    private var manager: SocketManager?
    private var socket: SocketIOClient?
    private let restaurantId: Int64
    private let onChange: () -> Void

    init(restaurantId: Int64, onChange: @escaping () -> Void) {
        self.restaurantId = restaurantId
        self.onChange = onChange
    }

    func connect() {
        disconnect()
        manager = SocketManager(
            socketURL: FoodDisplaySocketOrigin.url,
            config: [
                .forceWebsockets(true),
                .reconnects(true),
                .reconnectAttempts(30),
                .reconnectWait(1),
                .log(false),
            ]
        )
        socket = manager?.socket(forNamespace: "/restaurant-display")
        socket?.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in self?.joinRoom() }
        }
        socket?.on("food:display:changed") { [weak self] _, _ in
            Task { @MainActor in self?.onChange() }
        }
        joinRoom()
        socket?.connect()
    }

    func disconnect() {
        socket?.emit("display:leave", Int(restaurantId))
        socket?.disconnect()
        socket?.removeAllHandlers()
        socket = nil
        manager = nil
    }

    private func joinRoom() {
        socket?.emit("display:join", Int(restaurantId))
    }
}

#else

@MainActor
final class RestaurantDisplaySubscriber {
    init(restaurantId: Int64, onChange: @escaping () -> Void) {}
    func connect() {}
    func disconnect() {}
}

#endif

/// Poll on an interval and refetch immediately on display-socket pings.
@MainActor
enum RestaurantDisplayRefresh {
    static func run(
        restaurantId: Int64,
        intervalSeconds: UInt64 = 5,
        refresh: @escaping () async -> Void
    ) async {
        let subscriber = RestaurantDisplaySubscriber(restaurantId: restaurantId) {
            Task { await refresh() }
        }
        subscriber.connect()
        defer { subscriber.disconnect() }

        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: intervalSeconds * 1_000_000_000)
        }
    }
}
