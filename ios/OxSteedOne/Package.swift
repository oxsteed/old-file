// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OxSteedOne",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .executable(name: "OxSteedOne", targets: ["OxSteedOne"])
    ],
    targets: [
        .executableTarget(
            name: "OxSteedOne",
            path: "Sources"
        )
    ]
)
