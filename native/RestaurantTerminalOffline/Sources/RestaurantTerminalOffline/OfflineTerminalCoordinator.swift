import Foundation
import StripeTerminal

/// The host POS initializes Terminal with its restaurant-bound connection-token
/// provider and connects a supported reader online before an outage. Stripe
/// alone stores card data. This module stores only opaque reconciliation IDs.
public final class OfflineTerminalCoordinator: NSObject, OfflineDelegate {
    public struct Permit: Codable {
        public let id: String
        public let orderId: Int
        public let amountCents: Int
        public let currencyCode: String
        public let stripeAccount: String
        public let expiresAt: Date
        public let captureMethod: String
        public let allowedBrands: [String]
        public let metadata: [String: String]
    }
    public static func decodePermit(_ data: Data) throws -> Permit {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { value in
            let string = try value.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: string) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: string) { return date }
            throw Failure.invalidPermit
        }
        return try decoder.decode(Permit.self, from: data)
    }
    public struct Attempt: Codable {
        public let permitId: String
        public let orderId: Int
        public var intentId: String?
        public var state: String
    }
    public enum Failure: Error { case invalidPermit, readerRequired, unresolvedAttempt, invalidIntent, persistenceFailed, unsupportedBrand }
    /// Must POST to the scoped reconcile endpoint and return only after its
    /// durable acknowledgement. A transport error retains the attempt for retry.
    public typealias Reconcile = (Attempt, @escaping (Result<Void, Error>) -> Void) -> Void
    private let storageURL: URL
    private let reconcile: Reconcile
    private var attempts: [String: Attempt]
    private var forwarding = Set<String>()
    public var onChange: ((Attempt) -> Void)?

    public init(storageURL: URL, reconcile: @escaping Reconcile) throws {
        self.storageURL = storageURL
        self.reconcile = reconcile
        if FileManager.default.fileExists(atPath: storageURL.path) {
            attempts = try JSONDecoder().decode([String: Attempt].self, from: Data(contentsOf: storageURL))
        } else { attempts = [:] }
        super.init()
        Terminal.shared.offlineDelegate = self
    }

    private func save(_ attempt: Attempt) throws {
        attempts[attempt.permitId] = attempt
        try FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(attempts)
        try data.write(to: storageURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        onChange?(attempt)
    }

    /// Only permits obtained for this checkout while online are eligible. The
    /// server reserves the store/day budget before returning a permit.
    public func collect(permit: Permit, connectedAccount: String, completion: @escaping (Result<Attempt, Error>) -> Void) {
        guard Thread.isMainThread else { DispatchQueue.main.async { self.collect(permit: permit, connectedAccount: connectedAccount, completion: completion) }; return }
        guard permit.expiresAt > Date(), permit.amountCents > 0, permit.captureMethod == "manual",
              permit.stripeAccount == connectedAccount, permit.metadata["offlineId"] == permit.id,
              permit.metadata["food_order_id"] == String(permit.orderId) else { completion(.failure(Failure.invalidPermit)); return }
        guard Terminal.shared.connectedReader != nil else { completion(.failure(Failure.readerRequired)); return }
        guard attempts[permit.id] == nil else { completion(.failure(Failure.unresolvedAttempt)); return }
        do {
            // Persist BEFORE calling the SDK. A crash or unknown create outcome
            // blocks another attempt; it must never create a second card intent.
            try save(Attempt(permitId: permit.id, orderId: permit.orderId, intentId: nil, state: "creating"))
            let parameters = try PaymentIntentParametersBuilder(amount: UInt(permit.amountCents), currency: permit.currencyCode.lowercased())
                .setCaptureMethod(.manual).setMetadata(permit.metadata).build()
            let configuration = try CreateConfigurationBuilder().setOfflineBehavior(.preferOnline).build()
            Terminal.shared.createPaymentIntent(parameters, createConfig: configuration) { [weak self] intent, error in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if let error { completion(.failure(error)); return }
                    guard let intent else { completion(.failure(Failure.invalidIntent)); return }
                    Terminal.shared.collectPaymentMethod(intent) { collected, error in
                        DispatchQueue.main.async {
                            if let error { completion(.failure(error)); return }
                            guard let collected else { completion(.failure(Failure.invalidIntent)); return }
                            let brand: String
                            switch collected.paymentMethod?.cardPresent?.brand {
                            case .visa: brand = "visa"
                            case .amex: brand = "amex"
                            case .masterCard: brand = "mastercard"
                            case .discover: brand = "discover"
                            default: brand = "unsupported"
                            }
                            guard permit.allowedBrands.contains(brand) else { completion(.failure(Failure.unsupportedBrand)); return }
                            Terminal.shared.confirmPaymentIntent(collected) { confirmed, error in
                                DispatchQueue.main.async {
                                    if let advanced = self.attempts[permit.id], ["forwarded", "forwarded_to_backend"].contains(advanced.state) {
                                        completion(error.map { .failure($0) } ?? .success(advanced)); return
                                    }
                                    let attempt = Attempt(permitId: permit.id, orderId: permit.orderId, intentId: confirmed?.stripeId, state: error == nil ? "queued_for_forwarding" : "requires_reconciliation")
                                    do { try self.save(attempt) } catch { completion(.failure(error)); return }
                                    if let error { completion(.failure(error)) } else { completion(.success(attempt)) }
                                    if attempt.intentId != nil { self.forward(attempt) }
                                }
                            }
                        }
                    }
                }
            }
        } catch { completion(.failure(error)) }
    }

    private func forward(_ attempt: Attempt) {
        guard attempt.intentId != nil, !forwarding.contains(attempt.permitId) else { return }
        forwarding.insert(attempt.permitId)
        reconcile(attempt) { [weak self] result in DispatchQueue.main.async {
            guard let self else { return }
            self.forwarding.remove(attempt.permitId)
            if case .success = result {
                var acknowledged = attempt; acknowledged.state = "forwarded_to_backend"
                try? self.save(acknowledged)
            }
        }}
    }
    public func retryReconciliation() {
        guard Thread.isMainThread else { DispatchQueue.main.async { self.retryReconciliation() }; return }
        for attempt in attempts.values where attempt.state != "forwarded_to_backend" { forward(attempt) }
    }
    public func terminal(_ terminal: Terminal, didChange offlineStatus: OfflineStatus) { retryReconciliation() }
    public func terminal(_ terminal: Terminal, didReportForwardingError error: Error) { /* SDK retains its encrypted queue. */ }
    public func terminal(_ terminal: Terminal, didForwardPaymentIntent intent: PaymentIntent, error: Error?) {
        DispatchQueue.main.async {
            guard let id = intent.metadata?["offlineId"], var attempt = self.attempts[id] else { return }
            attempt.intentId = intent.stripeId
            attempt.state = error == nil ? "forwarded" : "requires_reconciliation"
            do { try self.save(attempt) } catch { return }
            self.forward(attempt)
        }
    }
}
