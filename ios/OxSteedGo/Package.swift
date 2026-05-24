// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OxSteedGo",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .executable(name: "OxSteedGo", targets: ["OxSteedGo"])
    ],
    targets: [
        .executableTarget(
            name: "OxSteedGo",
            path: "Sources"
        )
    ]
)
