import SwiftUI

struct ProfileView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        NavigationStack {
            Form {
                Section("Active Persona") {
                    Picker("Persona", selection: Binding(
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
                    Section("Business") {
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

                        Button("Choose Business") {
                            store.showBusinessPicker = true
                        }
                    }
                }

                Section("Language & Localization") {
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

                Section("Display & Privacy") {
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
                    Toggle("Biometric lock", isOn: Binding(
                        get: { store.biometricEnabled },
                        set: { store.setBiometricEnabled($0) }
                    ))
                }

                Section("Communication") {
                    Toggle("Auto-translate inbox previews", isOn: Binding(
                        get: { store.autoTranslateEnabled },
                        set: { store.setAutoTranslate($0) }
                    ))
                }

                Section("Notification Preferences by Persona") {
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

                Section("Availability Manager") {
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

                Section("Account Recovery & Export") {
                    Text(store.accountRecoveryReady ? "Recovery snapshot ready for restore on new device." : "Recovery snapshot not ready.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Request Data Export") {
                        store.requestDataExport()
                    }
                    if store.dataExportRequested {
                        Text("Export request queued.")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                    Button("Request Account Deletion") {
                        store.requestAccountDeletion()
                    }
                    .foregroundStyle(.red)
                    if store.accountDeletionRequested {
                        Text("Account deletion request submitted.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("App API") {
                    Text("Base URL: https://app.oxsteed.com/api")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section {
                    Button("Sign Out", role: .destructive) {
                        store.logout()
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }
}
