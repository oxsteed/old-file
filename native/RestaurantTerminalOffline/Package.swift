// swift-tools-version:5.9
import PackageDescription
let package = Package(
    name: "RestaurantTerminalOffline",
    platforms: [.iOS(.v16)],
    products: [.library(name: "RestaurantTerminalOffline", targets: ["RestaurantTerminalOffline"])],
    targets: [
        .binaryTarget(name: "StripeTerminal", url: "https://github.com/stripe/stripe-terminal-ios/releases/download/5.8.0/StripeTerminal.xcframework.zip",
                      checksum: "92c65013c4d92ce9dcba2310a0103651756bb65eeca409324ec54ed9896da4f7"),
        .target(name: "RestaurantTerminalOffline", dependencies: ["StripeTerminal"])
    ]
)
