import SwiftUI

struct ProfileView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        NavigationStack {
            Form {
                Section(store.localized("settings.active_persona", fallback: "Active Persona")) {
                    Picker(store.localized("settings.persona", fallback: "Persona"), selection: Binding(
                        get: { store.activePersona },
                        set: { store.selectPersona($0) }
                    )) {
                        ForEach(store.personaOptions) { persona in
                            Text(persona.label).tag(persona)
                        }
                    }
                    .pickerStyle(.menu)
                }

                if store.activePersona == .businessOwner {
                    Section(store.localized("settings.business", fallback: "Business")) {
                        if store.canOverrideBusinessSubRole {
                            Picker("Sub-role", selection: Binding(
                                get: { store.personaContext.businessSubRole },
                                set: { store.setBusinessSubRole($0) }
                            )) {
                                ForEach(BusinessSubRole.allCases) { role in
                                    Text(role.label).tag(role)
                                }
                            }
                        } else {
                            LabeledContent("Assigned Role", value: store.resolvedBusinessSubRole.label)
                        }

                        if let selected = store.personaContext.selectedBusinessName {
                            LabeledContent("Selected Business", value: selected)
                        } else {
                            Text("No business selected")
                                .foregroundStyle(.secondary)
                        }

                        Button(store.localized("settings.choose_business", fallback: "Choose Business")) {
                            store.showBusinessPicker = true
                        }
                    }
                }

                Section(store.localized("settings.language_localization", fallback: "Language & Localization")) {
                    Picker("Language", selection: Binding(
                        get: { store.appLanguage },
                        set: { store.setLanguage($0) }
                    )) {
                        ForEach(AppLanguage.allCases) { language in
                            Text(language.label).tag(language)
                        }
                    }
                    Text("Locale: \(store.activeLocale.identifier)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Layout direction: \(store.appLanguage.layoutDirection == .rightToLeft ? "RTL" : "LTR")")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section(store.localized("settings.display_privacy", fallback: "Display & Privacy")) {
                    Picker("Appearance", selection: Binding(
                        get: { store.appPreferences.appearance },
                        set: { store.setAppearance($0) }
                    )) {
                        ForEach(AppAppearance.allCases) { appearance in
                            Text(appearance.rawValue.capitalized).tag(appearance)
                        }
                    }
                    Toggle("Large text mode", isOn: Binding(
                        get: { store.appPreferences.largeTextEnabled },
                        set: { store.setLargeTextEnabled($0) }
                    ))
                    Toggle("Privacy mode (mask sensitive values)", isOn: Binding(
                        get: { store.appPreferences.privacyMode },
                        set: { store.setPrivacyMode($0) }
                    ))
                    Toggle("Allow analytics signals", isOn: Binding(
                        get: { store.appPreferences.allowAnalytics },
                        set: { store.setAnalyticsEnabled($0) }
                    ))
                }

                Section("Security") {
                    Toggle(store.localized("profile.security", fallback: "Security") + " · Biometric lock", isOn: Binding(
                        get: { store.biometricEnabled },
                        set: { store.setBiometricEnabled($0) }
                    ))
                }

                Section(store.localized("profile.communication", fallback: "Communication")) {
                    Toggle("Auto-translate inbox previews", isOn: Binding(
                        get: { store.autoTranslateEnabled },
                        set: { store.setAutoTranslate($0) }
                    ))

                    VStack(alignment: .leading, spacing: 8) {
                        Text(store.localized("profile.push_title", fallback: "Push Notifications"))
                            .font(.subheadline.weight(.semibold))
                        Text(pushStatusLabel)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Button(store.localized("profile.push_enable", fallback: "Enable Push Notifications")) {
                            Task { await store.requestPushNotificationAuthorization() }
                        }
                        .buttonStyle(.bordered)
                    }
                }

                Section(store.localized("settings.notification_preferences_persona", fallback: "Notification Preferences by Persona")) {
                    ForEach(store.notificationPreferences) { pref in
                        VStack(alignment: .leading, spacing: 8) {
                            Toggle("\(pref.persona.label) alerts", isOn: Binding(
                                get: { pref.enabled },
                                set: { store.setNotificationEnabled(for: pref.persona, enabled: $0) }
                            ))
                            Stepper("Radius: \(pref.radiusMiles) miles", value: Binding(
                                get: { pref.radiusMiles },
                                set: { store.setNotificationRadius(for: pref.persona, radiusMiles: $0) }
                            ), in: 1...100)
                            Text("Quiet hours: \(pref.quietHoursStart):00-\(pref.quietHoursEnd):00")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section(store.localized("settings.availability_manager", fallback: "Availability Manager")) {
                    ForEach(store.availabilityBlocks) { block in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(block.label)
                                    .font(.subheadline.weight(.semibold))
                                Text("\(block.days) · \(block.startHour):00-\(block.endHour):00")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Toggle("", isOn: Binding(
                                get: { block.enabled },
                                set: { _ in store.toggleAvailability(block.id) }
                            ))
                            .labelsHidden()
                        }
                    }
                }

                Section(store.localized("settings.account_recovery_export", fallback: "Account Recovery & Export")) {
                    Text(store.accountRecoveryReady ? "Recovery snapshot ready for restore on new device." : "Recovery snapshot not ready.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(store.localized("settings.request_data_export", fallback: "Request Data Export")) {
                        store.requestDataExport()
                    }
                    if store.dataExportRequested {
                        Text("Export request queued.")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                    Button(store.localized("settings.request_account_deletion", fallback: "Request Account Deletion")) {
                        store.requestAccountDeletion()
                    }
                    .foregroundStyle(.red)
                    if store.accountDeletionRequested {
                        Text("Account deletion request submitted.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section(store.localized("settings.app_api", fallback: "App API")) {
                    TextField("API Base URL", text: Binding(
                        get: { store.apiBaseURLString },
                        set: { store.apiBaseURLString = $0 }
                    ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    Text("Active: \(store.resolvedAPIBaseURLString)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Save API URL") {
                            store.saveAPIBaseURL(store.apiBaseURLString)
                        }
                        .buttonStyle(.bordered)

                        Button("Test Connection") {
                            Task { await store.testAPIConnection() }
                        }
                        .buttonStyle(.bordered)
                    }
                    Button("Probe Auth Endpoints") {
                        Task { await store.probeAuthEndpoints() }
                    }
                    .buttonStyle(.bordered)
                    if let message = store.apiConnectivityMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let message = store.authEndpointProbeMessage {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Button(store.isRefreshingCustomerData ? "Syncing..." : "Sync Now") {
                        Task {
                            await store.refreshCustomerTransactionData()
                            await store.syncPendingChanges()
                        }
                    }
                    .disabled(store.isRefreshingCustomerData)
                    .buttonStyle(.bordered)
                }

                Section {
                    Button(store.localized("profile.sign_out", fallback: "Sign Out"), role: .destructive) {
                        store.logout()
                    }
                }
            }
            .navigationTitle(store.localized("profile.settings", fallback: "Settings"))
            .task {
                await store.refreshPushNotificationStatus()
            }
        }
    }

    private var pushStatusLabel: String {
        switch store.pushAuthorizationStatus {
        case "authorized":
            return store.localized("profile.push_authorized", fallback: "Authorized")
        case "denied":
            return store.localized("profile.push_denied", fallback: "Denied in system settings")
        case "not_determined":
            return store.localized("profile.push_not_determined", fallback: "Not requested yet")
        default:
            return store.localized("profile.push_unknown", fallback: "Unknown")
        }
    }
}
