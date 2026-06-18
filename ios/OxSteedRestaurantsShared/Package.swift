// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OxSteedRestaurantsShared",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(name: "OxSteedRestaurantsCustomerUI", targets: ["OxSteedRestaurantsCustomerUI"]),
        .library(name: "OxSteedRestaurantsManagerUI", targets: ["OxSteedRestaurantsManagerUI"]),
        .library(name: "OxSteedRestaurantsPOSUI", targets: ["OxSteedRestaurantsPOSUI"]),
        .library(name: "OxSteedRestaurantsKitchenUI", targets: ["OxSteedRestaurantsKitchenUI"]),
        .library(name: "OxSteedRestaurantsKioskUI", targets: ["OxSteedRestaurantsKioskUI"]),
        .library(name: "OxSteedRestaurantsCrewUI", targets: ["OxSteedRestaurantsCrewUI"]),
        .library(name: "OxSteedRestaurantsInventoryUI", targets: ["OxSteedRestaurantsInventoryUI"]),
        .library(name: "OxSteedRestaurantsRunnerUI", targets: ["OxSteedRestaurantsRunnerUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/socketio/socket.io-client-swift", from: "16.1.0"),
    ],
    targets: [
        .target(
            name: "OxSteedRestaurantsCustomerUI",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")]
        ),
        .target(
            name: "OxSteedRestaurantsManagerUI",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")]
        ),
        .target(
            name: "OxSteedRestaurantsPOSUI",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")]
        ),
        .target(
            name: "OxSteedRestaurantsKitchenUI",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")]
        ),
        .target(
            name: "OxSteedRestaurantsKioskUI",
            dependencies: [.product(name: "SocketIO", package: "socket.io-client-swift")]
        ),
        .target(name: "OxSteedRestaurantsCrewUI"),
        .target(name: "OxSteedRestaurantsInventoryUI"),
        .target(name: "OxSteedRestaurantsRunnerUI"),
    ]
)
