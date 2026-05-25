import Foundation

struct OneAuthUser: Codable {
    let id: Int?
    let email: String?
    let defaultMode: String?
}

struct OneSavedSession: Codable {
    let token: String
    let user: OneAuthUser?
}

struct OneLoginRequest: Encodable {
    let email: String
    let password: String
}

struct OneAuthResponse: Decodable {
    let token: String?
    let user: OneAuthUser?
}

struct OneDataEnvelope<T: Decodable>: Decodable {
    let data: T
}
