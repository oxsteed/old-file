# OxSteed Restaurants iOS Prototype Map

Last updated: 2026-06-19

## Prototype host

The interactive suite prototype currently runs through the `OxSteedRestaurantsManager` wrapper app, which is configured as a multi-workspace host for all 8 restaurant experiences.

Host path:
- `ios/OxSteedRestaurantsManager/OxSteedRestaurantsManager/Info.plist`
- `ios/OxSteedRestaurantsShared/Sources/OxSteedRestaurantsManagerUI/FoodRootView.swift`
- `ios/OxSteedRestaurantsShared/Sources/OxSteedRestaurantsManagerUI/FoodPrototypeFlow.swift`

## First-open flow

The prototype now starts from first open and routes through:

1. Splash
2. Welcome
3. Language selection
4. Role selection
5. Account entry
6. Sign up or log in
7. Verification
8. Profile completion
9. Role-based routing

Role routes:
- Customer: `Restaurants`
- Owner / manager: `Owner setup` -> `Manager`
- Staff: `Join restaurant` -> `Role confirm` -> `Training` -> assigned app
- Runner: `Runner setup` -> `Runner`
- Kiosk / display: `Device setup` -> `Display`

## Owner onboarding map

Owner setup screens in the prototype:

1. Restaurant profile
2. Location setup
3. Business verification
4. Hours setup
5. Menu setup
6. Staff setup
7. Operations setup
8. Launch checklist
9. Success

Success actions:
- `Go to Manager Dashboard`
- `Preview Customer App`

## App map

The live prototype launcher can switch between all 8 workspaces:

1. `OxSteed Restaurants`
2. `OxSteed Manager`
3. `OxSteed POS`
4. `OxSteed Kitchen`
5. `OxSteed Display`
6. `OxSteed Crew`
7. `OxSteed Inventory`
8. `OxSteed Runner`

Each workspace still uses its existing role-specific UI inside the shared restaurant package.

## Shared navigation

The prototype host adds:

- `Apps` launcher sheet
- `Settings` sheet
- shared restaurant/location context line
- persisted role/language/profile state
- logout/reset path back to first open

Settings sections:
- Account
- Language
- Notifications
- Restaurant / Location
- Permissions
- Logout / restart prototype

## Accent guide

- Restaurants: orange / `FoodTheme.flame`
- Manager: blue / `FoodTheme.blue`
- POS: green / `FoodTheme.basil`
- Kitchen: red / `FoodTheme.coral`
- Display: purple / `FoodTheme.grape`
- Crew: teal / `FoodTheme.teal`
- Inventory: orange-gold foundation via existing `FoodTheme.flame`
- Runner: movement green via existing `FoodTheme.basil`

## Audience boundaries

Customer-facing:
- Restaurants
- customer checkout / tracking
- kiosk guest ordering
- queue / pickup display

Staff-facing:
- POS
- Kitchen
- Crew
- Inventory
- Runner

Manager-facing:
- Manager
- owner setup
- multi-location visibility
- launch checklist

Device-facing:
- Display
- kiosk mode
- queue board
- pickup board

## Current verification

Verified on 2026-06-19:

- `OxSteedRestaurantsManager` Debug simulator build succeeded on `iPhone 17 Pro` simulator `B3145305-585E-4A45-BE2E-FEDBBE8AC2CC`.
- The prototype host launched to the new first-open splash / onboarding entry screen.

Runtime evidence:
- Screenshot captured from Simulator after launch showing the new first-open screen.

