import SwiftUI

final class FoodPrototypeSession: ObservableObject {
    @Published var isComplete: Bool {
        didSet { UserDefaults.standard.set(isComplete, forKey: Self.completeKey) }
    }
    @Published var selectedLanguage: PrototypeLanguage {
        didSet { UserDefaults.standard.set(selectedLanguage.rawValue, forKey: Self.languageKey) }
    }
    @Published var selectedRole: PrototypeRole? {
        didSet { UserDefaults.standard.set(selectedRole?.rawValue, forKey: Self.roleKey) }
    }
    @Published var fullName: String
    @Published var email: String
    @Published var phone: String
    @Published var notificationPreference: PrototypeNotificationPreference
    @Published var locationPermissionGranted: Bool
    @Published var currentWorkspace: FoodWorkspace
    @Published var selectedRestaurantName: String
    @Published var selectedRestaurantCity: String
    @Published var statusNote: String?

    private static let completeKey = "ox.food.prototype.complete"
    private static let languageKey = "ox.food.prototype.language"
    private static let roleKey = "ox.food.prototype.role"
    private static let nameKey = "ox.food.prototype.name"
    private static let emailKey = "ox.food.prototype.email"
    private static let phoneKey = "ox.food.prototype.phone"
    private static let notificationsKey = "ox.food.prototype.notifications"
    private static let locationKey = "ox.food.prototype.location"
    private static let workspaceKey = "ox.food.prototype.workspace"
    private static let restaurantNameKey = "ox.food.prototype.restaurantName"
    private static let restaurantCityKey = "ox.food.prototype.restaurantCity"

    init() {
        let defaults = UserDefaults.standard
        isComplete = defaults.bool(forKey: Self.completeKey)
        selectedLanguage = PrototypeLanguage(rawValue: defaults.string(forKey: Self.languageKey) ?? "") ?? .english
        selectedRole = PrototypeRole(rawValue: defaults.string(forKey: Self.roleKey) ?? "")
        fullName = defaults.string(forKey: Self.nameKey) ?? "Jordan Oxley"
        email = defaults.string(forKey: Self.emailKey) ?? "jordan@oxsteed.com"
        phone = defaults.string(forKey: Self.phoneKey) ?? "(614) 555-0147"
        notificationPreference = PrototypeNotificationPreference(rawValue: defaults.string(forKey: Self.notificationsKey) ?? "") ?? .all
        locationPermissionGranted = defaults.object(forKey: Self.locationKey) as? Bool ?? true
        currentWorkspace = FoodWorkspace(rawValue: defaults.string(forKey: Self.workspaceKey) ?? "") ?? .customerOrdering
        selectedRestaurantName = defaults.string(forKey: Self.restaurantNameKey) ?? "Jean's Caribbean Kitchen"
        selectedRestaurantCity = defaults.string(forKey: Self.restaurantCityKey) ?? "Columbus, Ohio"
    }

    func complete(route workspace: FoodWorkspace, role: PrototypeRole?) {
        selectedRole = role
        currentWorkspace = workspace
        UserDefaults.standard.set(workspace.rawValue, forKey: Self.workspaceKey)
        isComplete = true
    }

    func persistProfile() {
        let defaults = UserDefaults.standard
        defaults.set(fullName, forKey: Self.nameKey)
        defaults.set(email, forKey: Self.emailKey)
        defaults.set(phone, forKey: Self.phoneKey)
        defaults.set(notificationPreference.rawValue, forKey: Self.notificationsKey)
        defaults.set(locationPermissionGranted, forKey: Self.locationKey)
        defaults.set(selectedRestaurantName, forKey: Self.restaurantNameKey)
        defaults.set(selectedRestaurantCity, forKey: Self.restaurantCityKey)
    }

    func reset() {
        isComplete = false
        selectedRole = nil
        currentWorkspace = .customerOrdering
        statusNote = nil
    }
}

enum PrototypeLanguage: String, CaseIterable, Identifiable {
    case english = "English"
    case spanish = "Spanish"
    case french = "French"
    case haitianCreole = "Haitian Creole"
    case arabic = "Arabic"

    var id: String { rawValue }

    var localeTag: String {
        switch self {
        case .english: return "EN"
        case .spanish: return "ES"
        case .french: return "FR"
        case .haitianCreole: return "HT"
        case .arabic: return "AR"
        }
    }
}

enum PrototypeRole: String, CaseIterable, Identifiable {
    case ordering
    case ownerManager
    case staff
    case runner
    case display

    var id: String { rawValue }

    var title: String {
        switch self {
        case .ordering: return "I'm ordering food"
        case .ownerManager: return "I own or manage a restaurant"
        case .staff: return "I work at a restaurant"
        case .runner: return "I'm delivering / running orders"
        case .display: return "I'm using a kiosk or display"
        }
    }

    var detail: String {
        switch self {
        case .ordering: return "Browse nearby brands, place orders, and track the live queue."
        case .ownerManager: return "Set up a restaurant, watch operations, and scale locations."
        case .staff: return "Join your assigned role and move straight into live work."
        case .runner: return "Pick up, route, confirm handoff, and report issues."
        case .display: return "Run kiosk ordering, queue boards, and pickup displays."
        }
    }

    var accent: Color {
        switch self {
        case .ordering: return FoodTheme.flame
        case .ownerManager: return FoodTheme.blue
        case .staff: return FoodTheme.teal
        case .runner: return FoodTheme.basil
        case .display: return FoodTheme.grape
        }
    }

    var icon: String {
        switch self {
        case .ordering: return "takeoutbag.and.cup.and.straw.fill"
        case .ownerManager: return "storefront.fill"
        case .staff: return "person.2.fill"
        case .runner: return "bicycle.circle.fill"
        case .display: return "display.2"
        }
    }
}

enum PrototypeNotificationPreference: String, CaseIterable, Identifiable {
    case all = "Everything"
    case essential = "Only important updates"
    case quiet = "Minimal notifications"

    var id: String { rawValue }
}

enum PrototypeAuthRoute {
    case signup
    case login
    case guestCustomer
}

private enum PrototypeStep: Int, CaseIterable {
    case splash
    case welcome
    case language
    case role
    case accountEntry
    case signup
    case login
    case verification
    case profile
    case ownerSetup
    case staffOnboarding
    case runnerSetup
    case displaySetup
    case success
}

private enum PrototypeOwnerStage: Int, CaseIterable, Identifiable {
    case profile
    case location
    case verification
    case hours
    case menu
    case staff
    case operations
    case checklist
    case success

    var id: Int { rawValue }
}

private enum PrototypeStaffStage: Int, CaseIterable, Identifiable {
    case join
    case role
    case training
    case handoff

    var id: Int { rawValue }
}

private enum PrototypeRunnerStage: Int, CaseIterable, Identifiable {
    case setup
    case route
    case ready

    var id: Int { rawValue }
}

private enum PrototypeDisplayStage: Int, CaseIterable, Identifiable {
    case mode
    case kiosk
    case ready

    var id: Int { rawValue }
}

struct FoodPrototypeFlow: View {
    @ObservedObject var session: FoodPrototypeSession
    let onComplete: (FoodWorkspace, PrototypeRole?) -> Void

    @State private var step: PrototypeStep = .splash
    @State private var authRoute: PrototypeAuthRoute = .signup
    @State private var isWorking = false
    @State private var errorText: String?
    @State private var verificationCode = ""
    @State private var accountChoice = "Continue with email"
    @State private var inviteCode = "JK-0419"
    @State private var businessPhone = "(614) 555-0190"
    @State private var businessEmail = "hello@jeanscaribbean.com"
    @State private var cuisineType = "Caribbean"
    @State private var businessOwner = "Jean Philippe"
    @State private var legalBusinessName = "Jean's Caribbean Kitchen LLC"
    @State private var address = "2750 Cleveland Ave"
    @State private var city = "Columbus"
    @State private var state = "OH"
    @State private var zip = "43224"
    @State private var serviceArea = "North Linden + Clintonville"
    @State private var hoursSummary = "Mon-Sun · 11:00 AM - 10:00 PM"
    @State private var menuMode = "Import menu"
    @State private var firstCategory = "Signature Bowls"
    @State private var firstItem = "Jerk Chicken Bowl"
    @State private var inviteManager = "Maria"
    @State private var inviteCashier = "Chris"
    @State private var inviteKitchen = "Andre"
    @State private var inviteCrew = "Sofia"
    @State private var inviteRunner = "Malik"
    @State private var ownerStage: PrototypeOwnerStage = .profile
    @State private var staffStage: PrototypeStaffStage = .join
    @State private var runnerStage: PrototypeRunnerStage = .setup
    @State private var displayStage: PrototypeDisplayStage = .mode
    @State private var selectedStaffWorkspace: FoodWorkspace = .posCounter
    @State private var selectedDeviceMode = "Queue board"
    @State private var acceptsTerms = false
    @State private var password = "Password123!"
    @State private var confirmPassword = "Password123!"

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.02, green: 0.07, blue: 0.18),
                    Color(red: 0.06, green: 0.16, blue: 0.30),
                    Color(red: 0.97, green: 0.40, blue: 0.16).opacity(0.85)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 24) {
                    prototypeHeader
                    if let errorText {
                        PrototypeInlineBanner(
                            title: "Needs attention",
                            detail: errorText,
                            tint: FoodTheme.coral
                        )
                    }
                    screenBody
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 28)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var prototypeHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(FoodTheme.flame.opacity(0.22))
                        .frame(width: 54, height: 54)
                    Image(systemName: "fork.knife.circle.fill")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(FoodTheme.flame)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("OxSteed Restaurants")
                        .font(.system(size: 26, weight: .black))
                        .foregroundStyle(Color.white)
                    Text("Franchise-grade tools for independent restaurants.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white.opacity(0.72))
                }
            }

            HStack(spacing: 10) {
                ForEach(Array(progressLabels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(progressIndex >= index ? Color.white : Color.white.opacity(0.42))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(
                            Capsule()
                                .fill(progressIndex >= index ? FoodTheme.flame.opacity(0.24) : Color.white.opacity(0.08))
                        )
                }
            }
        }
    }

    private var progressLabels: [String] {
        ["Open", "Identity", "Route", "Operate"]
    }

    private var progressIndex: Int {
        switch step {
        case .splash, .welcome:
            return 0
        case .language, .role, .accountEntry, .signup, .login, .verification, .profile:
            return 1
        case .ownerSetup, .staffOnboarding, .runnerSetup, .displaySetup:
            return 2
        case .success:
            return 3
        }
    }

    @ViewBuilder
    private var screenBody: some View {
        switch step {
        case .splash:
            PrototypeSplashScreen {
                withAnimation(.spring(response: 0.45, dampingFraction: 0.88)) { step = .welcome }
            }
        case .welcome:
            PrototypeWelcomeScreen(
                onContinue: { withAnimation(.easeInOut(duration: 0.25)) { step = .language } },
                onLogin: {
                    authRoute = .login
                    withAnimation(.easeInOut(duration: 0.25)) { step = .login }
                },
                onGuest: {
                    authRoute = .guestCustomer
                    session.selectedRole = .ordering
                    routeToWorkspace(.customerOrdering, role: .ordering)
                }
            )
        case .language:
            PrototypeLanguageScreen(selectedLanguage: $session.selectedLanguage) {
                withAnimation(.easeInOut(duration: 0.25)) { step = .role }
            }
        case .role:
            PrototypeRoleSelectionScreen(selectedRole: $session.selectedRole) {
                guard session.selectedRole != nil else {
                    errorText = "Choose which OxSteed Restaurants experience you want to feel first."
                    return
                }
                errorText = nil
                withAnimation(.easeInOut(duration: 0.25)) { step = .accountEntry }
            }
        case .accountEntry:
            PrototypeAccountEntryScreen(
                onChoice: { choice in
                    accountChoice = choice
                    errorText = nil
                    switch choice {
                    case "Log in":
                        authRoute = .login
                        step = .login
                    case "Browse as guest":
                        authRoute = .guestCustomer
                        session.selectedRole = .ordering
                        routeToWorkspace(.customerOrdering, role: .ordering)
                    default:
                        authRoute = .signup
                        step = .signup
                    }
                }
            )
        case .signup:
            PrototypeSignupScreen(
                fullName: $session.fullName,
                email: $session.email,
                phone: $session.phone,
                password: $password,
                confirmPassword: $confirmPassword,
                acceptsTerms: $acceptsTerms,
                isWorking: isWorking,
                accountChoice: accountChoice,
                onBack: { step = .accountEntry },
                onCreate: handleSignup
            )
        case .login:
            PrototypeLoginScreen(
                email: $session.email,
                password: $password,
                isWorking: isWorking,
                onBack: { step = .welcome },
                onLogin: handleLogin
            )
        case .verification:
            PrototypeVerificationScreen(
                verificationCode: $verificationCode,
                isWorking: isWorking,
                onBack: { step = authRoute == .login ? .login : .signup },
                onContinue: handleVerification,
                onResend: { session.statusNote = "New code sent to \(session.phone)." }
            )
        case .profile:
            PrototypeProfileCompletionScreen(
                fullName: $session.fullName,
                phone: $session.phone,
                selectedLanguage: $session.selectedLanguage,
                notificationPreference: $session.notificationPreference,
                locationPermissionGranted: $session.locationPermissionGranted,
                onBack: { step = .verification },
                onContinue: handleProfileRouting
            )
        case .ownerSetup:
            PrototypeOwnerSetupFlow(
                ownerStage: $ownerStage,
                selectedRestaurantName: $session.selectedRestaurantName,
                businessPhone: $businessPhone,
                businessEmail: $businessEmail,
                cuisineType: $cuisineType,
                businessOwner: $businessOwner,
                legalBusinessName: $legalBusinessName,
                address: $address,
                city: $city,
                state: $state,
                zip: $zip,
                serviceArea: $serviceArea,
                hoursSummary: $hoursSummary,
                menuMode: $menuMode,
                firstCategory: $firstCategory,
                firstItem: $firstItem,
                inviteManager: $inviteManager,
                inviteCashier: $inviteCashier,
                inviteKitchen: $inviteKitchen,
                inviteCrew: $inviteCrew,
                inviteRunner: $inviteRunner,
                onBack: { step = .profile },
                onLaunchDashboard: {
                    session.selectedRestaurantCity = "\(city), \(state)"
                    routeToWorkspace(.ownerManager, role: .ownerManager)
                },
                onPreviewCustomer: {
                    session.selectedRestaurantCity = "\(city), \(state)"
                    routeToWorkspace(.customerOrdering, role: .ownerManager)
                }
            )
        case .staffOnboarding:
            PrototypeStaffOnboardingFlow(
                staffStage: $staffStage,
                inviteCode: $inviteCode,
                selectedWorkspace: $selectedStaffWorkspace,
                onBack: { step = .profile },
                onHandoff: { routeToWorkspace(selectedStaffWorkspace, role: .staff) }
            )
        case .runnerSetup:
            PrototypeRunnerSetupFlow(
                runnerStage: $runnerStage,
                selectedRestaurantName: session.selectedRestaurantName,
                onBack: { step = .profile },
                onReady: { routeToWorkspace(.deliveryRunner, role: .runner) }
            )
        case .displaySetup:
            PrototypeDisplaySetupFlow(
                displayStage: $displayStage,
                selectedMode: $selectedDeviceMode,
                onBack: { step = .profile },
                onReady: { routeToWorkspace(.kioskQueue, role: .display) }
            )
        case .success:
            PrototypeRouteSuccessScreen(
                role: session.selectedRole,
                workspace: session.currentWorkspace,
                restaurantName: session.selectedRestaurantName,
                onOpen: { onComplete(session.currentWorkspace, session.selectedRole) }
            )
        }
    }

    private func handleSignup() {
        guard !session.fullName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !session.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !session.phone.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorText = "Fill in your name, email, and phone to create the prototype account."
            return
        }
        guard password == confirmPassword else {
            errorText = "Password and confirm password need to match."
            return
        }
        guard acceptsTerms else {
            errorText = "Accept the terms so the create-account button can move forward."
            return
        }
        errorText = nil
        simulateWork {
            step = .verification
        }
    }

    private func handleLogin() {
        guard !session.email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorText = "Enter email or phone plus password to continue."
            return
        }
        errorText = nil
        simulateWork {
            step = .verification
        }
    }

    private func handleVerification() {
        guard verificationCode.count >= 4 else {
            errorText = "Enter the 6-digit verification code to continue."
            return
        }
        errorText = nil
        simulateWork {
            step = .profile
        }
    }

    private func handleProfileRouting() {
        session.persistProfile()
        errorText = nil
        switch session.selectedRole {
        case .ordering:
            routeToWorkspace(.customerOrdering, role: .ordering)
        case .ownerManager:
            step = .ownerSetup
        case .staff:
            step = .staffOnboarding
        case .runner:
            step = .runnerSetup
        case .display:
            step = .displaySetup
        case nil:
            errorText = "Pick a role before profile completion can route you."
        }
    }

    private func routeToWorkspace(_ workspace: FoodWorkspace, role: PrototypeRole?) {
        session.complete(route: workspace, role: role)
        session.statusNote = "Routed into \(workspace.shortTitle)."
        step = .success
    }

    private func simulateWork(_ completion: @escaping () -> Void) {
        isWorking = true
        Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            await MainActor.run {
                isWorking = false
                completion()
            }
        }
    }
}

struct FoodPrototypeUtilityBar: View {
    let restaurantName: String
    let city: String
    let onLauncher: () -> Void
    let onSettings: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("OxSteed Restaurants Suite")
                    .font(.system(size: 24, weight: .black))
                    .foregroundStyle(FoodTheme.ink)
                Text("\(restaurantName) · \(city)")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(FoodTheme.muted)
            }
            Spacer()
            Button(action: onLauncher) {
                Label("Apps", systemImage: "square.grid.2x2.fill")
                    .font(.system(size: 13, weight: .bold))
            }
            .buttonStyle(.borderedProminent)
            .tint(FoodTheme.flame)
            Button(action: onSettings) {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 15, weight: .bold))
                    .padding(11)
                    .background(FoodTheme.surface)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(FoodTheme.line))
            }
            .buttonStyle(.plain)
        }
    }
}

struct FoodPrototypeAppLauncherSheet: View {
    @Binding var workspace: FoodWorkspace
    let role: PrototypeRole?
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    PrototypeInlineBanner(
                        title: "Role-aware app launcher",
                        detail: launcherHint,
                        tint: FoodTheme.blue
                    )

                    ForEach(FoodWorkspace.allCases) { item in
                        Button {
                            workspace = item
                            onClose()
                        } label: {
                            HStack(spacing: 14) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .fill(item.accent.opacity(0.14))
                                        .frame(width: 52, height: 52)
                                    Image(systemName: item.icon)
                                        .font(.system(size: 22, weight: .bold))
                                        .foregroundStyle(item.accent)
                                }
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(item.shortTitle)
                                        .font(.system(size: 18, weight: .black))
                                        .foregroundStyle(FoodTheme.ink)
                                    Text(item.shellSubtitle)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(FoodTheme.muted)
                                }
                                Spacer()
                                if item == workspace {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(item.accent)
                                }
                            }
                            .padding(16)
                            .background(FoodTheme.surface)
                            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 20, style: .continuous)
                                    .stroke(item == workspace ? item.accent.opacity(0.35) : FoodTheme.line, lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(FoodTheme.background.ignoresSafeArea())
            .navigationTitle("App Launcher")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done", action: onClose)
                }
            }
        }
    }

    private var launcherHint: String {
        switch role {
        case .ordering:
            return "Customers normally stay in Restaurants, but this prototype can jump across all 8 experiences."
        case .ownerManager:
            return "Managers can preview every restaurant-facing experience from one launcher."
        case .staff:
            return "Staff usually land in one assigned app. The launcher lets you inspect the rest of the suite."
        case .runner:
            return "Runner routing is last-mile first, but the prototype can tour the whole operating system."
        case .display:
            return "Display devices are role-locked in production. The prototype keeps all surfaces one tap away."
        case nil:
            return "This launcher is the shared OxSteed system switcher across all 8 prototype apps."
        }
    }
}

struct FoodPrototypeSettingsSheet: View {
    @ObservedObject var session: FoodPrototypeSession
    @Binding var workspace: FoodWorkspace
    let onLogout: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    settingsSection("Account") {
                        PrototypeDetailRow(title: "Name", value: session.fullName)
                        PrototypeDetailRow(title: "Email", value: session.email)
                        PrototypeDetailRow(title: "Phone", value: session.phone)
                    }

                    settingsSection("Language") {
                        Picker("Language", selection: $session.selectedLanguage) {
                            ForEach(PrototypeLanguage.allCases) { language in
                                Text(language.rawValue).tag(language)
                            }
                        }
                        .pickerStyle(.menu)
                    }

                    settingsSection("Notifications") {
                        Picker("Notifications", selection: $session.notificationPreference) {
                            ForEach(PrototypeNotificationPreference.allCases) { preference in
                                Text(preference.rawValue).tag(preference)
                            }
                        }
                        .pickerStyle(.segmented)
                    }

                    settingsSection("Restaurant / Location") {
                        PrototypeDetailRow(title: "Restaurant", value: session.selectedRestaurantName)
                        PrototypeDetailRow(title: "Location", value: session.selectedRestaurantCity)
                        PrototypeDetailRow(title: "Current app", value: workspace.shortTitle)
                    }

                    settingsSection("Permissions") {
                        PrototypeDetailRow(title: "Assigned role", value: session.selectedRole?.title ?? "Prototype visitor")
                        Toggle("Location permission", isOn: $session.locationPermissionGranted)
                            .tint(FoodTheme.flame)
                    }

                    Button(role: .destructive, action: onLogout) {
                        Text("Log out and restart prototype")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.coral)
                }
                .padding(16)
            }
            .background(FoodTheme.background.ignoresSafeArea())
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .onDisappear { session.persistProfile() }
        }
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 17, weight: .black))
                .foregroundStyle(FoodTheme.ink)
            VStack(alignment: .leading, spacing: 12) {
                content()
            }
            .padding(16)
            .background(FoodTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(FoodTheme.line, lineWidth: 1)
            )
        }
    }
}

private struct PrototypeDetailRow: View {
    let title: String
    let value: String

    var body: some View {
        HStack {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(FoodTheme.muted)
            Spacer()
            Text(value)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(FoodTheme.ink)
        }
    }
}

private struct PrototypeSplashScreen: View {
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            Spacer(minLength: 40)
            ZStack {
                RoundedRectangle(cornerRadius: 36, style: .continuous)
                    .fill(Color.white.opacity(0.12))
                    .frame(width: 132, height: 132)
                Image(systemName: "fork.knife.circle.fill")
                    .font(.system(size: 68, weight: .black))
                    .foregroundStyle(FoodTheme.flame)
            }
            Text("Franchise-grade tools for independent restaurants.")
                .font(.system(size: 36, weight: .black))
                .foregroundStyle(Color.white)
            Text("Shared network. Independent brand. One operating system across ordering, kitchen, queue, crew, inventory, and delivery.")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.74))
            Button("Enter the prototype", action: onContinue)
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
            Spacer(minLength: 8)
        }
    }
}

private struct PrototypeWelcomeScreen: View {
    let onContinue: () -> Void
    let onLogin: () -> Void
    let onGuest: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PrototypeSceneCard(
                eyebrow: "Welcome",
                title: "OxSteed Restaurants is a shared restaurant operating system.",
                detail: "Independent restaurants keep their own name, menu, location, and customer relationship. OxSteed provides the shared tools, workflow system, and app ecosystem."
            )

            VStack(alignment: .leading, spacing: 12) {
                Text("What this prototype covers")
                    .font(.system(size: 17, weight: .black))
                    .foregroundStyle(Color.white)
                ForEach([
                    "First open, onboarding, signup, login, and verification",
                    "Owner setup from blank profile to launch checklist",
                    "Role-specific routing across all 8 iOS app experiences"
                ], id: \.self) { point in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(FoodTheme.flame)
                        Text(point)
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Color.white.opacity(0.86))
                    }
                }
            }

            Button("Continue", action: onContinue)
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
            Button("Log in", action: onLogin)
                .buttonStyle(.bordered)
                .tint(.white)
            Button("Browse as guest", action: onGuest)
                .buttonStyle(.plain)
                .foregroundStyle(Color.white.opacity(0.78))
        }
    }
}

private struct PrototypeLanguageScreen: View {
    @Binding var selectedLanguage: PrototypeLanguage
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Language",
                title: "Choose the language you want the suite to speak first.",
                detail: "Customer, kiosk, and guest-facing moments should feel native from the first tap."
            )

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(PrototypeLanguage.allCases) { language in
                    Button {
                        selectedLanguage = language
                    } label: {
                        HStack {
                            Text(language.localeTag)
                                .font(.system(size: 12, weight: .black))
                            Text(language.rawValue)
                                .font(.system(size: 15, weight: .bold))
                            Spacer()
                            if selectedLanguage == language {
                                Image(systemName: "checkmark.circle.fill")
                            }
                        }
                        .foregroundStyle(selectedLanguage == language ? Color.white : Color.white.opacity(0.84))
                        .padding(14)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(selectedLanguage == language ? FoodTheme.flame : Color.white.opacity(0.08))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }

            Button("Continue", action: onContinue)
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
        }
    }
}

private struct PrototypeRoleSelectionScreen: View {
    @Binding var selectedRole: PrototypeRole?
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Choose experience",
                title: "Who are you in the restaurant system today?",
                detail: "Each route lands in a purpose-built app experience with its own next action."
            )

            ForEach(PrototypeRole.allCases) { role in
                Button {
                    selectedRole = role
                } label: {
                    HStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .fill(role.accent.opacity(0.18))
                                .frame(width: 52, height: 52)
                            Image(systemName: role.icon)
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(role.accent)
                        }
                        VStack(alignment: .leading, spacing: 4) {
                            Text(role.title)
                                .font(.system(size: 17, weight: .black))
                            Text(role.detail)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(Color.white.opacity(0.66))
                        }
                        Spacer()
                        if selectedRole == role {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(role.accent)
                        }
                    }
                    .foregroundStyle(Color.white)
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .fill(Color.white.opacity(selectedRole == role ? 0.16 : 0.08))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 22, style: .continuous)
                            .stroke(selectedRole == role ? role.accent.opacity(0.5) : Color.white.opacity(0.08), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
            }

            Button("Continue", action: onContinue)
                .buttonStyle(.borderedProminent)
                .tint(selectedRole?.accent ?? FoodTheme.flame)
        }
    }
}

private struct PrototypeAccountEntryScreen: View {
    let onChoice: (String) -> Void

    private let choices = [
        "Continue with Apple",
        "Continue with Google",
        "Continue with email",
        "Log in",
        "Browse as guest"
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Account entry",
                title: "Pick the fastest way into OxSteed.",
                detail: "Customer guest mode stays customer-only. Every other role continues into identity verification."
            )
            ForEach(choices, id: \.self) { choice in
                accountButton(choice)
            }
        }
    }

    @ViewBuilder
    private func accountButton(_ choice: String) -> some View {
        if choice == "Browse as guest" {
            Button(choice) { onChoice(choice) }
                .buttonStyle(.bordered)
                .tint(.white)
        } else {
            Button(choice) { onChoice(choice) }
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
        }
    }
}

private struct PrototypeSignupScreen: View {
    @Binding var fullName: String
    @Binding var email: String
    @Binding var phone: String
    @Binding var password: String
    @Binding var confirmPassword: String
    @Binding var acceptsTerms: Bool
    let isWorking: Bool
    let accountChoice: String
    let onBack: () -> Void
    let onCreate: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Create account",
                title: accountChoice,
                detail: "This prototype simulates an end-to-end account setup, including validation and verification."
            )
            PrototypeFormField(title: "Full name", text: $fullName)
            PrototypeFormField(title: "Email", text: $email)
            PrototypeFormField(title: "Phone", text: $phone)
            PrototypeSecureField(title: "Password", text: $password)
            PrototypeSecureField(title: "Confirm password", text: $confirmPassword)
            Toggle("I accept the terms and privacy expectations", isOn: $acceptsTerms)
                .tint(FoodTheme.flame)
                .foregroundStyle(Color.white)
            PrototypeActionRow(primaryTitle: isWorking ? "Creating..." : "Create account", onPrimary: onCreate, secondaryTitle: "Back", onSecondary: onBack)
        }
    }
}

private struct PrototypeLoginScreen: View {
    @Binding var email: String
    @Binding var password: String
    let isWorking: Bool
    let onBack: () -> Void
    let onLogin: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Log in",
                title: "Welcome back to OxSteed Restaurants.",
                detail: "Use email or phone, password, or a federated identity route."
            )
            PrototypeFormField(title: "Email or phone", text: $email)
            PrototypeSecureField(title: "Password", text: $password)
            HStack {
                Button("Forgot password?") {}
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.white.opacity(0.78))
                Spacer()
                Button("Continue with Apple") {}
                    .buttonStyle(.bordered)
                Button("Continue with Google") {}
                    .buttonStyle(.bordered)
            }
            PrototypeActionRow(primaryTitle: isWorking ? "Logging in..." : "Log in", onPrimary: onLogin, secondaryTitle: "Back", onSecondary: onBack)
        }
    }
}

private struct PrototypeVerificationScreen: View {
    @Binding var verificationCode: String
    let isWorking: Bool
    let onBack: () -> Void
    let onContinue: () -> Void
    let onResend: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Verification",
                title: "Confirm the account before routing into the suite.",
                detail: "Email and phone verification protects guest communications, kitchen alerts, and role assignments."
            )
            PrototypeFormField(title: "Verification code", text: $verificationCode)
            HStack {
                Button("Resend code", action: onResend)
                    .buttonStyle(.bordered)
                Spacer()
            }
            PrototypeActionRow(primaryTitle: isWorking ? "Checking..." : "Continue", onPrimary: onContinue, secondaryTitle: "Back", onSecondary: onBack)
        }
    }
}

private struct PrototypeProfileCompletionScreen: View {
    @Binding var fullName: String
    @Binding var phone: String
    @Binding var selectedLanguage: PrototypeLanguage
    @Binding var notificationPreference: PrototypeNotificationPreference
    @Binding var locationPermissionGranted: Bool
    let onBack: () -> Void
    let onContinue: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Profile completion",
                title: "Finish the profile that follows the user across all 8 apps.",
                detail: "This captures the personal state shared across customer, operator, and field experiences."
            )
            PrototypeFormField(title: "Name", text: $fullName)
            PrototypeFormField(title: "Phone", text: $phone)
            Picker("Preferred language", selection: $selectedLanguage) {
                ForEach(PrototypeLanguage.allCases) { language in
                    Text(language.rawValue).tag(language)
                }
            }
            .pickerStyle(.menu)
            .foregroundStyle(Color.white)
            Picker("Notifications", selection: $notificationPreference) {
                ForEach(PrototypeNotificationPreference.allCases) { preference in
                    Text(preference.rawValue).tag(preference)
                }
            }
            .pickerStyle(.menu)
            .foregroundStyle(Color.white)
            Toggle("Grant location access", isOn: $locationPermissionGranted)
                .tint(FoodTheme.flame)
                .foregroundStyle(Color.white)
            PrototypeActionRow(primaryTitle: "Continue", onPrimary: onContinue, secondaryTitle: "Back", onSecondary: onBack)
        }
    }
}

private struct PrototypeOwnerSetupFlow: View {
    @Binding var ownerStage: PrototypeOwnerStage
    @Binding var selectedRestaurantName: String
    @Binding var businessPhone: String
    @Binding var businessEmail: String
    @Binding var cuisineType: String
    @Binding var businessOwner: String
    @Binding var legalBusinessName: String
    @Binding var address: String
    @Binding var city: String
    @Binding var state: String
    @Binding var zip: String
    @Binding var serviceArea: String
    @Binding var hoursSummary: String
    @Binding var menuMode: String
    @Binding var firstCategory: String
    @Binding var firstItem: String
    @Binding var inviteManager: String
    @Binding var inviteCashier: String
    @Binding var inviteKitchen: String
    @Binding var inviteCrew: String
    @Binding var inviteRunner: String
    let onBack: () -> Void
    let onLaunchDashboard: () -> Void
    let onPreviewCustomer: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Owner setup",
                title: "Bring the restaurant live from zero.",
                detail: "The manager path walks from restaurant profile to launch checklist before the dashboard takes over."
            )
            PrototypeStagePills(currentIndex: ownerStage.rawValue, labels: ["Profile", "Location", "Verify", "Hours", "Menu", "Staff", "Ops", "Launch", "Success"])

            switch ownerStage {
            case .profile:
                PrototypeFormField(title: "Restaurant name", text: $selectedRestaurantName)
                PrototypeFormField(title: "Cuisine type", text: $cuisineType)
                PrototypeFormField(title: "Business phone", text: $businessPhone)
                PrototypeFormField(title: "Business email", text: $businessEmail)
                PrototypePlaceholderCard(title: "Logo upload", detail: "JK monogram placeholder ready for a real restaurant logo.")
            case .location:
                PrototypeFormField(title: "Address", text: $address)
                PrototypeFormField(title: "City", text: $city)
                PrototypeFormField(title: "State", text: $state)
                PrototypeFormField(title: "ZIP", text: $zip)
                PrototypeFormField(title: "Service area", text: $serviceArea)
                PrototypeInlineBanner(title: "Fulfillment", detail: "Pickup, dine-in, and local delivery are enabled in this prototype.", tint: FoodTheme.blue)
            case .verification:
                PrototypeFormField(title: "Legal business name", text: $legalBusinessName)
                PrototypeFormField(title: "Owner name", text: $businessOwner)
                PrototypePlaceholderCard(title: "EIN + document upload", detail: "Verification status: pending review, with upload placeholders for license/EIN files.")
            case .hours:
                PrototypeFormField(title: "Hours summary", text: $hoursSummary)
                PrototypePlaceholderCard(title: "Holiday hours", detail: "Holiday overrides and temporary pause controls live here in the full product.")
            case .menu:
                PrototypeSegmentedChoice(title: "Menu setup", choices: ["Start from scratch", "Import menu", "Upload photo/PDF"], selection: $menuMode)
                PrototypeFormField(title: "First category", text: $firstCategory)
                PrototypeFormField(title: "First item", text: $firstItem)
            case .staff:
                PrototypeFormField(title: "Invite manager", text: $inviteManager)
                PrototypeFormField(title: "Invite cashier", text: $inviteCashier)
                PrototypeFormField(title: "Invite kitchen staff", text: $inviteKitchen)
                PrototypeFormField(title: "Invite crew", text: $inviteCrew)
                PrototypeFormField(title: "Invite runner", text: $inviteRunner)
            case .operations:
                PrototypeInlineBanner(title: "Operations setup", detail: "Opening checklist, closing checklist, par levels, prep target, and order-notification rules are configured in one operational bundle.", tint: FoodTheme.teal)
            case .checklist:
                PrototypeChecklistCard(rows: [
                    ("Restaurant profile complete", true),
                    ("Menu added", true),
                    ("Hours added", true),
                    ("Staff invited", true),
                    ("Payment setup placeholder", false),
                    ("Kitchen workflow ready", true),
                    ("Publish restaurant", false)
                ])
            case .success:
                PrototypeInlineBanner(title: "Your restaurant is ready in OxSteed", detail: "Jean's Caribbean Kitchen can now enter Manager or preview the guest ordering experience.", tint: FoodTheme.basil)
            }

            ownerActions
        }
    }

    @ViewBuilder
    private var ownerActions: some View {
        HStack(spacing: 12) {
            if ownerStage == .profile {
                Button("Back", action: onBack)
                    .buttonStyle(.bordered)
            } else {
                Button("Back") {
                    ownerStage = PrototypeOwnerStage(rawValue: max(ownerStage.rawValue - 1, 0)) ?? .profile
                }
                .buttonStyle(.bordered)
            }

            Spacer()

            if ownerStage == .success {
                Button("Preview Customer App", action: onPreviewCustomer)
                    .buttonStyle(.bordered)
                Button("Go to Manager Dashboard", action: onLaunchDashboard)
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.blue)
            } else {
                Button(ownerStage == .checklist ? "Publish restaurant" : "Continue") {
                    if ownerStage == .checklist {
                        ownerStage = .success
                    } else {
                        ownerStage = PrototypeOwnerStage(rawValue: ownerStage.rawValue + 1) ?? .success
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
            }
        }
    }
}

private struct PrototypeStaffOnboardingFlow: View {
    @Binding var staffStage: PrototypeStaffStage
    @Binding var inviteCode: String
    @Binding var selectedWorkspace: FoodWorkspace
    let onBack: () -> Void
    let onHandoff: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Staff onboarding",
                title: "Join the restaurant, confirm the role, and move into the assigned app.",
                detail: "This path is built for cashiers, kitchen crew, SOP learners, inventory operators, runners, and managers."
            )
            PrototypeStagePills(currentIndex: staffStage.rawValue, labels: ["Join", "Role", "Training", "Handoff"])

            switch staffStage {
            case .join:
                PrototypeFormField(title: "Invite code", text: $inviteCode)
                PrototypePlaceholderCard(title: "Scan QR", detail: "QR scan entry point placeholder lives beside the invite-code field.")
            case .role:
                PrototypeSegmentedChoice(
                    title: "Assigned role",
                    choices: [
                        "Cashier / POS",
                        "Kitchen",
                        "Crew",
                        "Inventory",
                        "Runner",
                        "Manager"
                    ],
                    selection: Binding(
                        get: { label(for: selectedWorkspace) },
                        set: { selectedWorkspace = workspace(for: $0) }
                    )
                )
            case .training:
                PrototypeChecklistCard(rows: [
                    ("Required lessons", true),
                    ("Safety checklist", true),
                    ("Role checklist", false)
                ])
            case .handoff:
                PrototypeInlineBanner(title: "Assigned app ready", detail: "This handoff goes straight into the live \(selectedWorkspace.shortTitle) experience.", tint: selectedWorkspace.accent)
            }

            HStack {
                Button(staffStage == .join ? "Back" : "Back") {
                    if staffStage == .join {
                        onBack()
                    } else {
                        staffStage = PrototypeStaffStage(rawValue: max(staffStage.rawValue - 1, 0)) ?? .join
                    }
                }
                .buttonStyle(.bordered)
                Spacer()
                if staffStage == .handoff {
                    Button("Continue to assigned app", action: onHandoff)
                        .buttonStyle(.borderedProminent)
                        .tint(selectedWorkspace.accent)
                } else {
                    Button("Continue") {
                        staffStage = PrototypeStaffStage(rawValue: staffStage.rawValue + 1) ?? .handoff
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.teal)
                }
            }
        }
    }

    private func workspace(for label: String) -> FoodWorkspace {
        switch label {
        case "Cashier / POS": return .posCounter
        case "Kitchen": return .kitchenDisplay
        case "Crew": return .crewTraining
        case "Inventory": return .inventoryReceiving
        case "Runner": return .deliveryRunner
        default: return .ownerManager
        }
    }

    private func label(for workspace: FoodWorkspace) -> String {
        switch workspace {
        case .posCounter: return "Cashier / POS"
        case .kitchenDisplay: return "Kitchen"
        case .crewTraining: return "Crew"
        case .inventoryReceiving: return "Inventory"
        case .deliveryRunner: return "Runner"
        case .ownerManager: return "Manager"
        default: return "Cashier / POS"
        }
    }
}

private struct PrototypeRunnerSetupFlow: View {
    @Binding var runnerStage: PrototypeRunnerStage
    let selectedRestaurantName: String
    let onBack: () -> Void
    let onReady: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Runner setup",
                title: "Prepare field ops for live pickup and proof.",
                detail: "The Runner app starts with assignment expectations, route tools, and issue-reporting clarity."
            )
            PrototypeStagePills(currentIndex: runnerStage.rawValue, labels: ["Setup", "Route", "Ready"])

            switch runnerStage {
            case .setup:
                PrototypeInlineBanner(title: "Assigned restaurant", detail: "\(selectedRestaurantName) · Columbus, Ohio · local delivery enabled", tint: FoodTheme.basil)
            case .route:
                PrototypePlaceholderCard(title: "Route map", detail: "Pickup marker, drop-off marker, ETA, and call-restaurant placeholder live on the route screen.")
            case .ready:
                PrototypeChecklistCard(rows: [
                    ("Pickup checklist prepared", true),
                    ("Proof-of-delivery photo flow ready", true),
                    ("Issue escalation path visible", true)
                ])
            }

            HStack {
                Button(runnerStage == .setup ? "Back" : "Back") {
                    if runnerStage == .setup {
                        onBack()
                    } else {
                        runnerStage = PrototypeRunnerStage(rawValue: max(runnerStage.rawValue - 1, 0)) ?? .setup
                    }
                }
                .buttonStyle(.bordered)
                Spacer()
                if runnerStage == .ready {
                    Button("Open Runner", action: onReady)
                        .buttonStyle(.borderedProminent)
                        .tint(FoodTheme.basil)
                } else {
                    Button("Continue") {
                        runnerStage = PrototypeRunnerStage(rawValue: runnerStage.rawValue + 1) ?? .ready
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.basil)
                }
            }
        }
    }
}

private struct PrototypeDisplaySetupFlow: View {
    @Binding var displayStage: PrototypeDisplayStage
    @Binding var selectedMode: String
    let onBack: () -> Void
    let onReady: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PrototypeSceneCard(
                eyebrow: "Device setup",
                title: "Choose which public-facing display the hardware should become.",
                detail: "Queue board, kiosk ordering, and pickup display all share one device shell in the prototype."
            )
            PrototypeStagePills(currentIndex: displayStage.rawValue, labels: ["Mode", "Kiosk", "Ready"])

            switch displayStage {
            case .mode:
                PrototypeSegmentedChoice(title: "Display mode", choices: ["Queue board", "Kiosk order", "Pickup display"], selection: $selectedMode)
                PrototypePlaceholderCard(title: "Language selector", detail: "English, Spanish, French, Haitian Creole, and Arabic stay visible from public screens.")
            case .kiosk:
                PrototypeInlineBanner(title: "Kiosk welcome", detail: "Restaurant name, start-order CTA, accessibility option, and timed return-to-welcome are ready.", tint: FoodTheme.grape)
            case .ready:
                PrototypeChecklistCard(rows: [
                    ("Queue board configured", true),
                    ("Kiosk flow loaded", true),
                    ("Pickup display ready", true)
                ])
            }

            HStack {
                Button(displayStage == .mode ? "Back" : "Back") {
                    if displayStage == .mode {
                        onBack()
                    } else {
                        displayStage = PrototypeDisplayStage(rawValue: max(displayStage.rawValue - 1, 0)) ?? .mode
                    }
                }
                .buttonStyle(.bordered)
                Spacer()
                if displayStage == .ready {
                    Button("Open Display", action: onReady)
                        .buttonStyle(.borderedProminent)
                        .tint(FoodTheme.grape)
                } else {
                    Button("Continue") {
                        displayStage = PrototypeDisplayStage(rawValue: displayStage.rawValue + 1) ?? .ready
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(FoodTheme.grape)
                }
            }
        }
    }
}

private struct PrototypeRouteSuccessScreen: View {
    let role: PrototypeRole?
    let workspace: FoodWorkspace
    let restaurantName: String
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            PrototypeInlineBanner(
                title: "Routing complete",
                detail: "The prototype finished onboarding and is ready to open the \(workspace.shortTitle) experience.",
                tint: workspace.accent
            )

            PrototypeChecklistCard(rows: [
                ("First-open flow completed", true),
                ("Identity and verification simulated", true),
                ("Role-aware routing selected", true),
                ("\(restaurantName) loaded as sample brand", true)
            ])

            PrototypeSceneCard(
                eyebrow: "What opens next",
                title: workspace.shellSubtitle,
                detail: role == .ownerManager
                    ? "You'll land in the operator dashboard with alerts, reports, menu control, and multi-location context."
                    : "You'll land in the dedicated \(workspace.shortTitle) workflow with app-specific UI, tasks, and status states."
            )

            Button("Open \(workspace.shortTitle)", action: onOpen)
                .buttonStyle(.borderedProminent)
                .tint(workspace.accent)
        }
    }
}

private struct PrototypeSceneCard: View {
    let eyebrow: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(eyebrow.uppercased())
                .font(.system(size: 12, weight: .black))
                .tracking(1.2)
                .foregroundStyle(FoodTheme.flame)
            Text(title)
                .font(.system(size: 28, weight: .black))
                .foregroundStyle(Color.white)
            Text(detail)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.75))
        }
        .padding(20)
        .background(Color.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .stroke(Color.white.opacity(0.10), lineWidth: 1)
        )
    }
}

private struct PrototypeInlineBanner: View {
    let title: String
    let detail: String
    let tint: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Circle()
                .fill(tint)
                .frame(width: 10, height: 10)
                .padding(.top, 6)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 16, weight: .black))
                    .foregroundStyle(Color.white)
                Text(detail)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.white.opacity(0.76))
            }
        }
        .padding(16)
        .background(tint.opacity(0.14))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

private struct PrototypeFormField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.72))
            TextField("", text: $text)
                .textInputAutocapitalization(.words)
                .padding(14)
                .background(Color.white.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .foregroundStyle(Color.white)
        }
    }
}

private struct PrototypeSecureField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.72))
            SecureField("", text: $text)
                .padding(14)
                .background(Color.white.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .foregroundStyle(Color.white)
        }
    }
}

private struct PrototypePlaceholderCard: View {
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 15, weight: .black))
                .foregroundStyle(Color.white)
            Text(detail)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.74))
        }
        .padding(16)
        .background(Color.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct PrototypeChecklistCard: View {
    let rows: [(String, Bool)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 10) {
                    Image(systemName: row.1 ? "checkmark.circle.fill" : "circle.dashed")
                        .foregroundStyle(row.1 ? FoodTheme.basil : Color.white.opacity(0.58))
                    Text(row.0)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.white)
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(Color.white.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

private struct PrototypeSegmentedChoice: View {
    let title: String
    let choices: [String]
    @Binding var selection: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(Color.white.opacity(0.72))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(choices, id: \.self) { choice in
                        Button(choice) { selection = choice }
                            .buttonStyle(.borderedProminent)
                            .tint(selection == choice ? FoodTheme.flame : Color.white.opacity(0.18))
                            .foregroundStyle(selection == choice ? Color.white : Color.white.opacity(0.76))
                    }
                }
            }
        }
    }
}

private struct PrototypeActionRow: View {
    let primaryTitle: String
    let onPrimary: () -> Void
    let secondaryTitle: String
    let onSecondary: () -> Void

    var body: some View {
        HStack {
            Button(secondaryTitle, action: onSecondary)
                .buttonStyle(.bordered)
                .tint(.white)
            Spacer()
            Button(primaryTitle, action: onPrimary)
                .buttonStyle(.borderedProminent)
                .tint(FoodTheme.flame)
        }
    }
}

private struct PrototypeStagePills: View {
    let currentIndex: Int
    let labels: [String]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(labels.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.system(size: 11, weight: .black))
                        .foregroundStyle(index <= currentIndex ? Color.white : Color.white.opacity(0.4))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(
                            Capsule()
                                .fill(index <= currentIndex ? FoodTheme.flame.opacity(0.20) : Color.white.opacity(0.08))
                        )
                }
            }
        }
    }
}
