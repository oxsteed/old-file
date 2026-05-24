// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OxSteedCommand",
    defaultLocalization: "en",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "OxSteedCommand", targets: ["OxSteedCommand"])
    ],
    targets: [
        .executableTarget(
            name: "OxSteedCommand",
            path: "Sources"
        )
    ]
)
