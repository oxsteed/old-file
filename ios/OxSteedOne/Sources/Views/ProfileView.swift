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
                            Picker(store.localized("profile.sub_role", fallback: "Sub-role"), selection: Binding(
                                get: { store.personaContext.businessSubRole },
                                set: { store.setBusinessSubRole($0) }
                            )) {
                                ForEach(BusinessSubRole.allCases) { role in
                                    Text(role.label).tag(role)
                                }
                            }
                        } else {
                            LabeledContent(store.localized("profile.assigned_role", fallback: "Assigned Role"), value: store.resolvedBusinessSubRole.label)
                        }

                        if let selected = store.personaContext.selectedBusinessName {
                            LabeledContent(store.localized("profile.selected_business", fallback: "Selected Business"), value: selected)
                        } else {
                            Text(store.localized("profile.no_business_selected", fallback: "No business selected"))
                                .foregroundStyle(.secondary)
                        }

                        Button(store.localized("settings.choose_business", fallback: "Choose Business")) {
                            store.showBusinessPicker = true
                        }
                    }
                }

                Section(store.localized("settings.language_localization", fallback: "Language & Localization")) {
                    Picker(store.localized("settings.language", fallback: "Language"), selection: Binding(
                        get: { store.appLanguage },
                        set: { store.setLanguage($0) }
                    )) {
                        ForEach(AppLanguage.allCases) { language in
                            Text(language.label).tag(language)
                        }
                    }
                    Text("\(store.localized("profile.locale", fallback: "Locale")): \(store.activeLocale.identifier)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("\(store.localized("profile.layout_direction", fallback: "Layout direction")): \(store.appLanguage.layoutDirection == .rightToLeft ? store.localized("profile.layout_rtl", fallback: "RTL") : store.localized("profile.layout_ltr", fallback: "LTR"))")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section(store.localized("settings.display_privacy", fallback: "Display & Privacy")) {
                    Picker(store.localized("settings.appearance", fallback: "Appearance"), selection: Binding(
                        get: { store.appPreferences.appearance },
                        set: { store.setAppearance($0) }
                    )) {
                        ForEach(AppAppearance.allCases) { appearance in
                            Text(appearance.rawValue.capitalized).tag(appearance)
                        }
                    }
                    Toggle(store.localized("settings.large_text_mode", fallback: "Large text mode"), isOn: Binding(
                        get: { store.appPreferences.largeTextEnabled },
                        set: { store.setLargeTextEnabled($0) }
                    ))
                    Toggle(store.localized("settings.privacy_mode", fallback: "Privacy mode (mask sensitive values)"), isOn: Binding(
                        get: { store.appPreferences.privacyMode },
                        set: { store.setPrivacyMode($0) }
                    ))
                    Toggle(store.localized("settings.analytics_signals", fallback: "Allow analytics signals"), isOn: Binding(
                        get: { store.appPreferences.allowAnalytics },
                        set: { store.setAnalyticsEnabled($0) }
                    ))
                }

                Section(store.localized("profile.security_section", fallback: "Security")) {
                    Toggle(store.localized("profile.security", fallback: "Security") + " · Biometric lock", isOn: Binding(
                        get: { store.biometricEnabled },
                        set: { store.setBiometricEnabled($0) }
                    ))
                }

                Section(store.localized("profile.communication", fallback: "Communication")) {
                    Toggle(store.localized("profile.auto_translate_previews", fallback: "Auto-translate inbox previews"), isOn: Binding(
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
                            Toggle("\(store.localized("settings.persona", fallback: "Persona")) \(pref.persona.label) \(store.localized("settings.alerts", fallback: "alerts"))", isOn: Binding(
                                get: { pref.enabled },
                                set: { store.setNotificationEnabled(for: pref.persona, enabled: $0) }
                            ))
                            Stepper("\(store.localized("settings.radius", fallback: "Radius")): \(pref.radiusMiles) \(store.localized("settings.miles", fallback: "miles"))", value: Binding(
                                get: { pref.radiusMiles },
                                set: { store.setNotificationRadius(for: pref.persona, radiusMiles: $0) }
                            ), in: 1...100)
                            Text("\(store.localized("settings.quiet_hours", fallback: "Quiet hours")): \(pref.quietHoursStart):00-\(pref.quietHoursEnd):00")
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
                    Text(store.accountRecoveryReady ? store.localized("profile.recovery_snapshot_ready", fallback: "Recovery snapshot ready for restore on new device.") : store.localized("profile.recovery_snapshot_not_ready", fallback: "Recovery snapshot not ready."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button(store.localized("settings.request_data_export", fallback: "Request Data Export")) {
                        store.requestDataExport()
                    }
                    if store.dataExportRequested {
                        Text(store.localized("profile.export_request_queued", fallback: "Export request queued."))
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                    Button(store.localized("settings.request_account_deletion", fallback: "Request Account Deletion")) {
                        store.requestAccountDeletion()
                    }
                    .foregroundStyle(.red)
                    if store.accountDeletionRequested {
                        Text(store.localized("profile.account_deletion_submitted", fallback: "Account deletion request submitted."))
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section(store.localized("settings.app_api", fallback: "App API")) {
                    TextField(store.localized("settings.api_base_url", fallback: "API Base URL"), text: Binding(
                        get: { store.apiBaseURLString },
                        set: { store.apiBaseURLString = $0 }
                    ))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                    Text("\(store.localized("settings.active", fallback: "Active")): \(store.resolvedAPIBaseURLString)")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(store.localized("settings.save_api_url", fallback: "Save API URL")) {
                            store.saveAPIBaseURL(store.apiBaseURLString)
                        }
                        .buttonStyle(.bordered)

                        Button(store.localized("settings.test_connection", fallback: "Test Connection")) {
                            Task { await store.testAPIConnection() }
                        }
                        .buttonStyle(.bordered)
                    }
                    Button(store.localized("settings.probe_auth_endpoints", fallback: "Probe Auth Endpoints")) {
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
                    Button(store.isRefreshingCustomerData ? store.localized("settings.syncing", fallback: "Syncing...") : store.localized("settings.sync_now", fallback: "Sync Now")) {
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
