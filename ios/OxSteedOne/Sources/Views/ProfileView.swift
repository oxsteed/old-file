import SwiftUI

struct ProfileView: View {
    @Environment(OneStore.self) private var store
    @Environment(\.dismiss) private var dismiss

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
                        Picker("Sub-role", selection: Binding(
                            get: { store.personaContext.businessSubRole },
                            set: { store.setBusinessSubRole($0) }
                        )) {
                            ForEach(BusinessSubRole.allCases) { role in
                                Text(role.label).tag(role)
                            }
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

                Section("App API") {
                    Text("Base URL: https://app.oxsteed.com/api")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
