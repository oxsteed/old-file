import Foundation

#if canImport(SocketIO)
import SocketIO

/// Full Socket.IO implementation — active when SocketIO package is resolved.
@MainActor
final class OxSocketManager: ObservableObject {
    static let shared = OxSocketManager()
    @Published var isConnected = false

    private var manager: SocketManager?
    private var socket: SocketIOClient?

    init() {}

    func connect(token: String) {
        disconnect()
        manager = SocketManager(
            socketURL: APIConfig.socketURL,
            config: [.secure(true), .reconnects(true), .reconnectAttempts(10), .reconnectWait(3), .log(false)]
        )
        socket = manager?.defaultSocket
        socket?.on(clientEvent: .connect) { [weak self] _, _ in
            Task { @MainActor in
                self?.socket?.emit("authenticate", ["token": token])
                self?.isConnected = true
                NSLog("[Socket] connected")
            }
        }
        socket?.on(clientEvent: .disconnect) { [weak self] _, _ in
            Task { @MainActor in self?.isConnected = false }
        }
        registerHandlers()
        socket?.connect()
    }

    func disconnect() {
        socket?.disconnect(); socket?.removeAllHandlers()
        socket = nil; manager = nil; isConnected = false
    }

    func emit(_ event: String, data: [String: Any] = [:]) { socket?.emit(event, data) }

    private func registerHandlers() {
        let events = [
            "message:new","message:read","message:deleted",
            "bid:received","bid:accepted","bid:rejected",
            "appointment:created","appointment:updated","appointment:cancelled",
            "job:created","job:updated","job:completed","job:cancelled",
            "notification:new","notification:dismissed"
        ]
        events.forEach { ev in
            socket?.on(ev) { data, _ in
                NotificationCenter.default.post(name: .oxSocketMessage, object: nil,
                                                userInfo: ["event": ev, "data": data])
            }
        }
    }
}

#else

/// Stub used when SocketIO package is not yet resolved (e.g. first build).
/// The real implementation above compiles once the package resolves.
@MainActor
final class OxSocketManager: ObservableObject {
    static let shared = OxSocketManager()
    @Published var isConnected = false

    init() {}

    func connect(token: String) {
        NSLog("[Socket] SocketIO package not resolved — real-time events disabled.")
    }

    func disconnect() { isConnected = false }

    func emit(_ event: String, data: [String: Any] = [:]) {}
}

#endif
