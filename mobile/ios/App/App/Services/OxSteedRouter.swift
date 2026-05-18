import Foundation
import UIKit

final class OxSteedRouter: ObservableObject {
    @Published var presentedRoute: OxSteedRoute?

    func open(_ route: OxSteedRoute) {
        presentedRoute = route
    }

    func handleIncoming(_ url: URL) {
        guard let route = route(from: url) else { return }
        open(route)
    }

    private func route(from url: URL) -> OxSteedRoute? {
        if url.scheme == "oxsteed" {
            let path = "/" + ([url.host, url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: "/"))
            return OxSteedRoute(id: url.absoluteString, path: path == "/" ? "/" : path)
        }

        guard ["oxsteed.com", "www.oxsteed.com"].contains(url.host ?? "") else {
            UIApplication.shared.open(url)
            return nil
        }

        let path = url.path.isEmpty ? "/" : url.path
        let query = url.query.map { "?\($0)" } ?? ""
        let fragment = url.fragment.map { "#\($0)" } ?? ""
        return OxSteedRoute(id: url.absoluteString, path: "\(path)\(query)\(fragment)")
    }
}
