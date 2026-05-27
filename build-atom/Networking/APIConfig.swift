import Foundation

enum APIConfig {
    static let baseURL = URL(string: "https://api.oxsteed.com")!
    static let socketURL = URL(string: "https://api.oxsteed.com")!
    static let defaultTimeout: TimeInterval = 30
    static let uploadTimeout: TimeInterval = 60
}

enum HTTPMethod: String {
    case GET, POST, PUT, PATCH, DELETE
}
