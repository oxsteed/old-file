import SwiftUI
import UIKit

struct SettingsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var localization: LocalizationManager
    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var socket: OxSocketManager
    @AppStorage("ox.security.require_biometrics") private var requireBiometrics = false
    @AppStorage("ox.appearance") private var appearancePref = "system"
    @AppStorage("ox.fontSizeCategory") private var fontSizeCategory = "medium"

    @State private var showNotifPrefs = false
    @State private var showVortexJoin = false
    @State private var showExportSheet = false
    @State private var exportItems: [Any] = []
    @State private var showDeleteConfirm = false
    @State private var exportError: String?
    @State private var isExporting = false
    @State private var languageSaveTask: Task<Void, Never>?
    @State private var deleteError: String?
    @State private var isDeletingAccount = false
    @State private var deleteConfirmationText = ""

    private enum Destination: Hashable {
        case privacy
        case report
        case verifyIdentity
        case taxDocuments
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let user = auth.user {
                        accountCard(user: user)
                    }

                    HStack(spacing: 10) {
                        Circle()
                            .fill(socket.isConnected ? Theme.success : Theme.danger)
                            .frame(width: 8, height: 8)
                        Text(LocalizedStringKey(socket.isConnected ? L10n.SettingsKey.socketConnected : L10n.SettingsKey.socketOffline))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .padding(.horizontal, 4)

                    languageCard

                    if auth.user != nil {
                        Button { showNotifPrefs = true } label: {
                            settingsRow(icon: "bell.fill", title: L10n.SettingsKey.notifications, color: Theme.pillarHome)
                        }
                        .buttonStyle(.plain)

                        Button { showVortexJoin = true } label: {
                            settingsRow(icon: "qrcode.viewfinder", title: "Join a workspace", color: Theme.accent)
                        }
                        .buttonStyle(.plain)
                    }

                    appLockCard
                    appearanceCard
                    textSizeCard

                    NavigationLink(value: Destination.privacy) {
                        settingsRow(icon: "lock.shield.fill", title: L10n.SettingsKey.privacy, color: Theme.pillarMoney)
                    }
                    .buttonStyle(.plain)

                    if auth.user != nil {
                        NavigationLink(value: Destination.report) {
                            settingsRow(icon: "ladybug.fill", title: L10n.SettingsKey.reportProblem, color: Theme.warning)
                        }
                        .buttonStyle(.plain)

                        NavigationLink(value: Destination.verifyIdentity) {
                            settingsRow(
                                icon: "checkmark.shield.fill",
                                title: L10n.SettingsKey.verifyIdentity,
                                color: Theme.success,
                                trailing: auth.user?.id_verified == true || auth.user?.didit_status == "approved" ? localization.localized("settings.identity_verified") : nil
                            )
                        }
                        .buttonStyle(.plain)

                        NavigationLink(value: Destination.taxDocuments) {
                            settingsRow(icon: "doc.text.fill", title: L10n.SettingsKey.taxDocuments, color: Theme.pillarMoney)
                        }
                        .buttonStyle(.plain)

                        Button { exportProfileData() } label: {
                            settingsRow(
                                icon: isExporting ? "arrow.triangle.2.circlepath" : "square.and.arrow.up.fill",
                                title: isExporting ? L10n.SettingsKey.preparingExport : L10n.SettingsKey.exportMyData,
                                color: Theme.pillarGoals
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isExporting)

                        destructiveActions
                    }

                    if let exportError {
                        Text(exportError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }

                    if let deleteError {
                        Text(deleteError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.danger)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 30)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text(LocalizedStringKey(L10n.SettingsKey.title)))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Text(LocalizedStringKey(L10n.SettingsKey.done))
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .navigationDestination(for: Destination.self) { destination in
                switch destination {
                case .privacy:
                    PrivacySafetyView()
                case .report:
                    ReportProblemView()
                case .verifyIdentity:
                    VerifyIdentityView()
                case .taxDocuments:
                    TaxDocumentsView()
                }
            }
            .onChange(of: localization.language) { _, language in
                persistLanguagePreference(language)
            }
        }
        .sheet(isPresented: $showNotifPrefs) {
            NotificationPrefsView()
                .presentationDetents([.medium])
                .presentationBackground(Theme.background)
        }
        .sheet(isPresented: $showVortexJoin) {
            VortexJoinView()
        }
        .sheet(isPresented: $showExportSheet) {
            ActivityShareSheet(items: exportItems)
                .presentationDetents([.medium])
        }
        .sheet(isPresented: $showDeleteConfirm) {
            DeleteAccountConfirmSheet(
                confirmationText: $deleteConfirmationText,
                isDeleting: isDeletingAccount,
                error: deleteError,
                onCancel: {
                    deleteConfirmationText = ""
                    showDeleteConfirm = false
                },
                onDelete: {
                    Task { await deleteAccount() }
                }
            )
            .presentationDetents([.medium])
            .presentationDragIndicator(.visible)
            .presentationBackground(Theme.background)
        }
    }

    // MARK: - Account

    private func accountCard(user: APIUser) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle().fill(Theme.accentSoft)
                Text(initials(for: user)).font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.accent)
            }.frame(width: 48, height: 48)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName).font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                Text(user.email).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
        }
        .cardStyle()
    }

    private func initials(for user: APIUser) -> String {
        let a = user.first_name?.first.map { String($0) } ?? ""
        let b = user.last_name?.first.map { String($0) } ?? ""
        let s = (a + b).uppercased()
        return s.isEmpty ? String(user.email.prefix(1)).uppercased() : s
    }

    // MARK: - Language

    private var languageCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "globe")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(width: 36, height: 36)
                    .background(Theme.accent.opacity(0.16), in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(L10n.SettingsKey.language))
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(LocalizedStringKey(L10n.SettingsKey.languageSubtitle))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }

            VStack(spacing: 8) {
                ForEach(AppLanguage.allCases) { lang in
                    languageRow(lang)
                }
            }
        }
        .cardStyle()
    }

    private func languageRow(_ lang: AppLanguage) -> some View {
        let isSelected = localization.language == lang
        return Button {
            withAnimation(.easeInOut(duration: 0.22)) {
                localization.language = lang
            }
        } label: {
            HStack(spacing: 12) {
                if lang == .system {
                    Image(systemName: lang.flag)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 32, height: 32)
                } else {
                    Text(lang.flag)
                        .font(.system(size: 22))
                        .frame(width: 32, height: 32)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(localization.localized(lang.displayName))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                    if let autonym = lang.autonym,
                       autonym != localization.localized(lang.displayName) {
                        Text(autonym)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(Theme.accent)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(isSelected ? Theme.accent.opacity(0.14) : Theme.surfaceElevated)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(isSelected ? Theme.accent.opacity(0.4) : Theme.stroke, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Preferences

    private var appLockCard: some View {
        HStack(spacing: 12) {
            rowIcon("faceid", color: Theme.pillarMoney)
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(L10n.SettingsKey.appLock))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(LocalizedStringKey(L10n.SettingsKey.appLockDescription))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
            }
            Spacer()
            Toggle("", isOn: $requireBiometrics)
                .labelsHidden()
                .tint(Theme.accent)
        }
        .cardStyle()
    }

    private var appearanceCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                rowIcon("circle.lefthalf.filled", color: Theme.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(L10n.SettingsKey.appearance))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(LocalizedStringKey(L10n.SettingsKey.appearanceDescription))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }

            Picker(LocalizedStringKey(L10n.SettingsKey.appearance), selection: $appearancePref) {
                Text(LocalizedStringKey(L10n.SettingsKey.appearanceSystem)).tag("system")
                Text(LocalizedStringKey(L10n.SettingsKey.appearanceLight)).tag("light")
                Text(LocalizedStringKey(L10n.SettingsKey.appearanceDark)).tag("dark")
            }
            .pickerStyle(.segmented)
        }
        .cardStyle()
    }

    private var textSizeCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                rowIcon("textformat.size", color: Theme.pillarPersonal)
                VStack(alignment: .leading, spacing: 2) {
                    Text(LocalizedStringKey(L10n.SettingsKey.textSize))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                    Text(LocalizedStringKey(L10n.SettingsKey.textSizeDescription))
                        .font(.system(size: 12))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer()
            }

            Picker(LocalizedStringKey(L10n.SettingsKey.textSize), selection: $fontSizeCategory) {
                Text(LocalizedStringKey(L10n.SettingsKey.textSizeSmall)).tag("small")
                Text(LocalizedStringKey(L10n.SettingsKey.textSizeDefault)).tag("medium")
                Text(LocalizedStringKey(L10n.SettingsKey.textSizeLarge)).tag("large")
                Text(LocalizedStringKey(L10n.SettingsKey.textSizeXLarge)).tag("xlarge")
            }
            .pickerStyle(.segmented)
        }
        .cardStyle()
    }

    private var destructiveActions: some View {
        VStack(spacing: 12) {
            Button {
                Task {
                    await auth.logout()
                    dismiss()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                    Text(LocalizedStringKey(L10n.SettingsKey.signOut)).font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.danger.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }

            Button(role: .destructive) {
                showDeleteConfirm = true
            } label: {
                HStack(spacing: 8) {
                    if isDeletingAccount {
                        ProgressView().tint(Theme.danger).scaleEffect(0.8)
                    } else {
                        Image(systemName: "trash.fill")
                    }
                    Text(LocalizedStringKey(L10n.SettingsKey.deleteAccount)).font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.danger.opacity(0.10), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(isDeletingAccount)
        }
        .padding(.top, 8)
    }

    // MARK: - Rows

    private func settingsRow(
        icon: String,
        title: String,
        color: Color,
        trailing: String? = nil
    ) -> some View {
        HStack(spacing: 12) {
            rowIcon(icon, color: color)
            Text(LocalizedStringKey(title))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            if let trailing {
                Text(trailing)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
        }
        .cardStyle()
    }

    private func rowIcon(_ icon: String, color: Color) -> some View {
        Image(systemName: icon)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(color)
            .frame(width: 36, height: 36)
            .background(color.opacity(0.16), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: - Account actions

    private func exportProfileData() {
        guard !isExporting else { return }
        isExporting = true
        exportError = nil
        Task {
            do {
                let data = try await SettingsService.exportAccountData()
                let filename = "oxsteed-data-export-\(Int(Date().timeIntervalSince1970)).json"
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
                try data.write(to: url, options: [.atomic])
                await MainActor.run {
                    exportItems = [url]
                    showExportSheet = true
                    isExporting = false
                }
            } catch {
                await MainActor.run {
                    exportError = (error as? APIError)?.errorDescription ?? localization.localized(L10n.SettingsKey.exportFailed)
                    isExporting = false
                }
            }
        }
    }

    private func persistLanguagePreference(_ language: AppLanguage) {
        guard auth.user != nil else { return }
        languageSaveTask?.cancel()
        languageSaveTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            do {
                let updated = try await AuthService.updateProfile(preferredLanguage: language.bcp47)
                await MainActor.run { auth.user = updated }
            } catch {
                OXLog.error("language preference save failed: \(String(describing: error))", category: "settings")
            }
        }
    }

    @MainActor
    private func deleteAccount() async {
        guard !isDeletingAccount else { return }
        let confirmation = deleteConfirmationText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard confirmation == "DELETE MY ACCOUNT" else {
            deleteError = localization.localized(L10n.SettingsKey.deleteConfirmBlocked)
            return
        }
        isDeletingAccount = true
        deleteError = nil
        defer { isDeletingAccount = false }

        do {
            _ = try await AuthService.deleteAccount(confirmation: confirmation)
            await auth.logout()
            deleteConfirmationText = ""
            showDeleteConfirm = false
            dismiss()
        } catch {
            deleteError = localization.localized(L10n.SettingsKey.deleteConfirmBody)
        }
    }
}

private struct DeleteAccountConfirmSheet: View {
    @Binding var confirmationText: String
    let isDeleting: Bool
    let error: String?
    let onCancel: () -> Void
    let onDelete: () -> Void

    private var canDelete: Bool {
        confirmationText.trimmingCharacters(in: .whitespacesAndNewlines) == "DELETE MY ACCOUNT"
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(LocalizedStringKey(L10n.SettingsKey.deleteConfirmTitle))
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(LocalizedStringKey(L10n.SettingsKey.deleteConfirmBody))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(2)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(LocalizedStringKey(L10n.SettingsKey.deleteConfirmButton))
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(Theme.textTertiary)
                        .textCase(.uppercase)
                    TextField(LocalizedStringKey(L10n.SettingsKey.deleteConfirmPlaceholder), text: $confirmationText)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .padding(12)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                }

                if let error {
                    Text(error)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.danger)
                }

                Button(role: .destructive, action: onDelete) {
                    HStack(spacing: 8) {
                        if isDeleting { ProgressView().tint(.white).scaleEffect(0.85) }
                        Text(LocalizedStringKey(isDeleting ? L10n.SettingsKey.deleteInProgress : L10n.SettingsKey.deleteAccount))
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canDelete ? Theme.danger : Theme.stroke, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(!canDelete || isDeleting)

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.SettingsKey.deleteAccount))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(LocalizedStringKey(L10n.CommonKey.cancel), action: onCancel)
                        .foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }
}

private struct ActivityShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct PrivacySafetyView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var disclosures: SettingsService.PrivacyDisclosures?
    @State private var allowGuestContact = true
    @State private var allowBooking = true
    @State private var allowScheduling = true
    @State private var allowLiveChat = true
    @State private var savingKey: String?
    @State private var error: String?

    private var isHelper: Bool {
        guard let role = auth.user?.role?.lowercased() else { return false }
        return ["helper", "helper_pro", "broker"].contains(role)
    }

    var body: some View {
        List {
            Section {
                Label("App Lock protects the app on this device.", systemImage: "faceid")
                Label("Identity verification helps build trust across jobs.", systemImage: "checkmark.shield.fill")
                Label("Exports are served from OxSteed's privacy export endpoint.", systemImage: "square.and.arrow.up")
            }

            if isHelper {
                Section(LocalizedStringKey(L10n.SettingsKey.helperPrivacy)) {
                    privacyToggle(L10n.SettingsKey.guestContact, detail: L10n.SettingsKey.guestContactDetail, key: "allow_guest_contact", value: $allowGuestContact)
                    privacyToggle(L10n.SettingsKey.booking, detail: L10n.SettingsKey.bookingDetail, key: "allow_booking", value: $allowBooking)
                    privacyToggle(L10n.SettingsKey.scheduling, detail: L10n.SettingsKey.schedulingDetail, key: "allow_scheduling", value: $allowScheduling)
                    privacyToggle(L10n.SettingsKey.liveChat, detail: L10n.SettingsKey.liveChatDetail, key: "allow_live_chat", value: $allowLiveChat)
                }
            }

            if let disclosures {
                Section(LocalizedStringKey(L10n.SettingsKey.dataCategories)) {
                    ForEach(disclosures.categories) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.category).font(.system(size: 14, weight: .bold))
                            Text(item.examples).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            Text(item.purpose).font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section(LocalizedStringKey(L10n.SettingsKey.thirdParties)) {
                    ForEach(disclosures.thirdParties) { item in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.name).font(.system(size: 14, weight: .bold))
                            Text(item.purpose).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            Text(item.dataShared).font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            if let error {
                Section {
                    Text(error)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.danger)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
        .foregroundStyle(Theme.textPrimary)
        .navigationTitle(LocalizedStringKey(L10n.SettingsKey.privacy))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task {
            syncPrivacyStateFromUser()
            do {
                disclosures = try await SettingsService.privacyDisclosures()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? localization.localized("Privacy disclosures could not be loaded.")
            }
        }
    }

    private func privacyToggle(_ title: String, detail: String, key: String, value: Binding<Bool>) -> some View {
        Toggle(isOn: Binding(
            get: { value.wrappedValue },
            set: { newValue in
                value.wrappedValue = newValue
                Task { await savePrivacySetting(key, newValue) }
            }
        )) {
            VStack(alignment: .leading, spacing: 3) {
                Text(LocalizedStringKey(title))
                Text(LocalizedStringKey(detail)).font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
            }
        }
        .disabled(savingKey == key)
    }

    private func syncPrivacyStateFromUser() {
        allowGuestContact = auth.user?.allow_guest_contact ?? true
        allowBooking = auth.user?.allow_booking ?? true
        allowScheduling = auth.user?.allow_scheduling ?? true
        allowLiveChat = auth.user?.allow_live_chat ?? true
    }

    @MainActor
    private func savePrivacySetting(_ key: String, _ value: Bool) async {
        guard savingKey == nil else { return }
        savingKey = key
        error = nil
        let patch = SettingsService.PrivacySettingsPatch(
            allow_guest_contact: key == "allow_guest_contact" ? value : nil,
            allow_booking: key == "allow_booking" ? value : nil,
            allow_scheduling: key == "allow_scheduling" ? value : nil,
            allow_live_chat: key == "allow_live_chat" ? value : nil
        )
        do {
            _ = try await SettingsService.updatePrivacySettings(patch)
            auth.user = try? await AuthService.me()
            syncPrivacyStateFromUser()
        } catch {
            syncPrivacyStateFromUser()
            self.error = (error as? APIError)?.errorDescription ?? localization.localized("Privacy setting could not be saved.")
        }
        savingKey = nil
    }
}

private struct ReportProblemView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var localization: LocalizationManager
    @State private var details = ""
    @State private var isSubmitting = false
    @State private var resultMessage: String?
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(LocalizedStringKey(L10n.SettingsKey.reportPrompt))
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Theme.textSecondary)
            TextEditor(text: $details)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 180)
                .padding(12)
                .background(Theme.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.stroke, lineWidth: 1))
                .foregroundStyle(Theme.textPrimary)
            Button {
                Task { await submitReport() }
            } label: {
                HStack(spacing: 8) {
                    if isSubmitting {
                        ProgressView().tint(.white).scaleEffect(0.8)
                    }
                    Text(LocalizedStringKey(isSubmitting ? L10n.SettingsKey.reportSending : L10n.SettingsKey.reportAction))
                }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .disabled(isSubmitting || details.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if let resultMessage {
                Text(resultMessage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.success)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.danger)
            }
            Spacer()
        }
        .padding(20)
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(LocalizedStringKey(L10n.SettingsKey.reportProblem))
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
    }

    @MainActor
    private func submitReport() async {
        let trimmed = details.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        resultMessage = nil
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let response = try await SettingsService.submitAppReport(details: trimmed, contactEmail: auth.user?.email)
            let ticket = response.ticket_number.map { " #\($0)" } ?? ""
            let successMessage = localization.localized(L10n.SettingsKey.reportSent)
            resultMessage = ticket.isEmpty ? successMessage : "\(successMessage)\(ticket)"
            details = ""
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? localization.localized(L10n.SettingsKey.reportError)
        }
    }
}

#Preview {
    SettingsSheet()
        .environmentObject(LocalizationManager())
        .environmentObject(AuthStore())
        .environmentObject(OxSocketManager.shared)
        .preferredColorScheme(.dark)
}

// MARK: - Notification Preferences

struct NotificationPrefsView: View {
    @EnvironmentObject var notifs: NotificationsStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss
    @State private var prefs: NotificationPreferences = NotificationPreferences()
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Toggle(LocalizedStringKey(L10n.SettingsKey.notificationsEmail), isOn: Binding(
                    get: { prefs.email_enabled ?? true },
                    set: { prefs.email_enabled = $0 }
                ))
                .foregroundStyle(Theme.textPrimary)
                Toggle(LocalizedStringKey(L10n.SettingsKey.notificationsPush), isOn: Binding(
                    get: { prefs.push_enabled ?? true },
                    set: { prefs.push_enabled = $0 }
                ))
                .foregroundStyle(Theme.textPrimary)
                Toggle(LocalizedStringKey(L10n.SettingsKey.notificationsSms), isOn: Binding(
                    get: { prefs.sms_enabled ?? false },
                    set: { prefs.sms_enabled = $0 }
                ))
                .foregroundStyle(Theme.textPrimary)

                Picker(LocalizedStringKey(L10n.SettingsKey.notificationsFrequency), selection: Binding(
                    get: { prefs.frequency ?? "real_time" },
                    set: { prefs.frequency = $0 }
                )) {
                    Text(LocalizedStringKey(L10n.SettingsKey.notificationsRealtime)).tag("real_time")
                    Text(LocalizedStringKey(L10n.SettingsKey.notificationsDaily)).tag("daily")
                    Text(LocalizedStringKey(L10n.SettingsKey.notificationsWeekly)).tag("weekly")
                }
                .pickerStyle(.segmented)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await savePreferences() }
                } label: {
                    HStack(spacing: 8) {
                        if isSaving { ProgressView().tint(.white).scaleEffect(0.85) }
                        Text(LocalizedStringKey(isSaving ? L10n.SettingsKey.notificationsSaving : L10n.SettingsKey.notificationsSave))
                    }
                    .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isSaving)
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(LocalizedStringKey(L10n.SettingsKey.notifications))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) {
                Button(LocalizedStringKey(L10n.SettingsKey.done)) { dismiss() }.foregroundStyle(Theme.accent)
            }}
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
        }
        .task {
            if notifs.preferences == nil { await notifs.loadPreferences() }
            if let p = notifs.preferences { prefs = p }
        }
    }

    @MainActor
    private func savePreferences() async {
        guard !isSaving else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            let updated = try await NotificationsService.updatePreferences(prefs)
            notifs.preferences = updated
            dismiss()
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? localization.localized("Notification preferences could not be saved.")
        }
    }
}
