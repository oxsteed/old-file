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
    targets: [
        .target(name: "OxSteedRestaurantsCustomerUI"),
        .target(name: "OxSteedRestaurantsManagerUI"),
        .target(name: "OxSteedRestaurantsPOSUI"),
        .target(name: "OxSteedRestaurantsKitchenUI"),
        .target(name: "OxSteedRestaurantsKioskUI"),
        .target(name: "OxSteedRestaurantsCrewUI"),
        .target(name: "OxSteedRestaurantsInventoryUI"),
        .target(name: "OxSteedRestaurantsRunnerUI"),
    ]
)
