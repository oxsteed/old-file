// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "OxSteedNative",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .executable(name: "OxSteedNative", targets: ["OxSteedNative"])
    ],
    targets: [
        .executableTarget(
            name: "OxSteedNative",
            path: "Sources"
        )
    ]
)
