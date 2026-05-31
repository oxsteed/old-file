import SwiftUI

struct ProfileView: View {
    @Environment(GoStore.self) private var store
    @State private var enabledModes: Set<String> = ["Home", "Learn", "Pro"]

    var body: some View {
        @Bindable var store = store

        GoScreen(title: GoLocalization.text(.profileModes, language: store.appLanguage)) {
            ModesHeader()

            VStack(alignment: .leading, spacing: 10) {
                Text(GoLocalization.text(.profileYourModes, language: store.appLanguage))
                    .font(.caption.weight(.bold))
                    .tracking(3)
                    .foregroundStyle(GoTheme.muted)

                VStack(spacing: 0) {
                    ModeToggleRow(
                        title: GoLocalization.text(.profileHomeMode, language: store.appLanguage),
                        subtitle: GoLocalization.text(.profileHomeModeSubtitle, language: store.appLanguage),
                        symbolName: "briefcase.fill",
                        isOn: binding(for: "Home")
                    )
                    ModeToggleRow(
                        title: GoLocalization.text(.profileLearnMode, language: store.appLanguage),
                        subtitle: GoLocalization.text(.profileLearnModeSubtitle, language: store.appLanguage),
                        symbolName: "graduationcap.fill",
                        isOn: binding(for: "Learn")
                    )
                    ModeToggleRow(
                        title: GoLocalization.text(.profileToolsMode, language: store.appLanguage),
                        subtitle: GoLocalization.text(.profileToolsModeSubtitle, language: store.appLanguage),
                        symbolName: "wrench.fill",
                        isOn: binding(for: "Tools")
                    )
                    ModeToggleRow(
                        title: GoLocalization.text(.profileProMode, language: store.appLanguage),
                        subtitle: GoLocalization.text(.profileProModeSubtitle, language: store.appLanguage),
                        symbolName: "chart.line.uptrend.xyaxis",
                        isOn: binding(for: "Pro")
                    )
                }
                .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 15).stroke(GoTheme.border, lineWidth: 1))
            }

            ConnectedExperiences()

            GoCard {
                Text(store.isSignedIn ? GoLocalization.text(.profileSession, language: store.appLanguage) : GoLocalization.text(.signIn, language: store.appLanguage))
                    .font(.headline)
                if store.isSignedIn {
                    Button(GoLocalization.text(.profileSignOut, language: store.appLanguage), role: .destructive) {
                        store.signOut()
                    }
                } else {
                    TextField(GoLocalization.text(.profileEmail, language: store.appLanguage), text: $store.email)
                        .textFieldStyle(.roundedBorder)
                    SecureField(GoLocalization.text(.profilePassword, language: store.appLanguage), text: $store.password)
                        .textFieldStyle(.roundedBorder)
                    TextField(GoLocalization.text(.profileTwoFactor, language: store.appLanguage), text: $store.twoFactorCode)
                        .textFieldStyle(.roundedBorder)
                    Button(GoLocalization.text(.profileSignIn, language: store.appLanguage)) {
                        Task { await store.signIn() }
                    }
                    .buttonStyle(GoAccentButtonStyle())
                }
                if let authMessage = store.authMessage {
                    Text(authMessage)
                        .font(.footnote)
                        .foregroundStyle(GoTheme.muted)
                }
            }

            GoCard {
                Label(GoLocalization.text(.languageTranslation, language: store.appLanguage), systemImage: "globe")
                    .font(.headline)
                Text(GoLocalization.text(.profileTranslationDescription, language: store.appLanguage))
                    .font(.subheadline)
                    .foregroundStyle(GoTheme.muted)
                Picker(GoLocalization.text(.profileAppLanguage, language: store.appLanguage), selection: Binding(
                    get: { store.appLanguage },
                    set: { store.setLanguage($0) }
                )) {
                    ForEach(GoLanguage.allCases) { language in
                        Text(language.label).tag(language)
                    }
                }
                .tint(GoTheme.amber)
                Toggle(GoLocalization.text(.profileAutoTranslate, language: store.appLanguage), isOn: Binding(
                    get: { store.autoTranslateMessages },
                    set: { store.setAutoTranslateMessages($0) }
                ))
                .tint(GoTheme.amber)
                Text(store.autoTranslateMessages ? "\(GoLocalization.text(.profileOriginalMessageMode, language: store.appLanguage)) \(store.appLanguage.translatorLabel)." : GoLocalization.text(.profileOriginalMessageFallback, language: store.appLanguage))
                    .font(.footnote)
                    .foregroundStyle(GoTheme.muted)
            }

            GoCard {
                Label(GoLocalization.text(.profileAccountChecklist, language: store.appLanguage), systemImage: "checklist")
                    .font(.headline)
                ChecklistRow(done: store.isSignedIn, title: GoLocalization.text(.profileChecklistSignIn, language: store.appLanguage))
                ChecklistRow(done: false, title: GoLocalization.text(.profileChecklistVerify, language: store.appLanguage))
                ChecklistRow(done: false, title: GoLocalization.text(.profileChecklistNotifications, language: store.appLanguage))
                ChecklistRow(done: false, title: GoLocalization.text(.profileChecklistPayment, language: store.appLanguage))
                ChecklistRow(done: false, title: GoLocalization.text(.profileChecklistCalendar, language: store.appLanguage))
            }

            ModeWorkspacePanel()
        }
    }

    private func binding(for mode: String) -> Binding<Bool> {
        Binding {
            enabledModes.contains(mode)
        } set: { newValue in
            if newValue {
                enabledModes.insert(mode)
            } else {
                enabledModes.remove(mode)
            }
        }
    }
}

private struct ModesHeader: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                Button {
                    store.selectedTab = .today
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .background(GoTheme.card, in: Circle())
                }
                .buttonStyle(.plain)

                Text(GoLocalization.text(.profileModes, language: store.appLanguage))
                    .font(.system(size: 34, weight: .heavy, design: .rounded))
                    .foregroundStyle(.white)
                    .padding(.top, 8)
                Text(GoLocalization.text(.profileModesHeaderBody, language: store.appLanguage))
                    .font(.subheadline)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            OxSteedGoMark(size: 108)
                .padding(.top, 42)
        }
    }
}

private struct ModeToggleRow: View {
    let title: String
    let subtitle: String
    let symbolName: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 14) {
            GoModeGlyph(symbolName: symbolName, size: 44)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.headline.bold())
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            Toggle(title, isOn: $isOn)
                .labelsHidden()
                .tint(GoTheme.amber)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(GoTheme.border)
                .frame(height: 1)
                .padding(.leading, 70)
        }
    }
}

private struct ConnectedExperiences: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(GoLocalization.text(.profileConnectedExperiences, language: store.appLanguage))
                .font(.caption.weight(.bold))
                .tracking(3)
                .foregroundStyle(GoTheme.muted)

            VStack(spacing: 0) {
                ConnectedRow(left: "graduationcap.fill", right: "briefcase.fill", title: GoLocalization.text(.profileLearnHireHelper, language: store.appLanguage), subtitle: GoLocalization.text(.profileLearnHireSubtitle, language: store.appLanguage))
                ConnectedRow(left: "briefcase.fill", right: "chart.line.uptrend.xyaxis", title: GoLocalization.text(.profileHomePro, language: store.appLanguage), subtitle: GoLocalization.text(.profileHomeProSubtitle, language: store.appLanguage))
                ConnectedRow(left: "graduationcap.fill", right: "wrench.fill", title: GoLocalization.text(.profileLearnRentTools, language: store.appLanguage), subtitle: GoLocalization.text(.profileLearnRentToolsSubtitle, language: store.appLanguage))
            }
            .background(GoTheme.card, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 15).stroke(GoTheme.border, lineWidth: 1))
        }
    }
}

private struct ConnectedRow: View {
    let left: String
    let right: String
    let title: String
    let subtitle: String

    var body: some View {
        HStack(spacing: 10) {
            GoModeGlyph(symbolName: left, size: 40)
            Image(systemName: "arrow.right")
                .font(.caption.bold())
                .foregroundStyle(GoTheme.muted)
            GoModeGlyph(symbolName: right, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(.white)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(GoTheme.muted)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.bold())
                .foregroundStyle(.white.opacity(0.55))
        }
        .padding(12)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(GoTheme.border)
                .frame(height: 1)
                .padding(.leading, 104)
        }
    }
}

private struct ChecklistRow: View {
    let done: Bool
    let title: String

    var body: some View {
        Label(title, systemImage: done ? "checkmark.circle.fill" : "circle")
            .foregroundStyle(done ? .green : GoTheme.muted)
    }
}

private struct ModeWorkspacePanel: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.mode {
        case .customer:
            GoCard {
                Label(GoLocalization.text(.profileCustomerDashboard, language: store.appLanguage), systemImage: "house.and.flag")
                    .font(.headline)
                Text(GoLocalization.text(.profileCustomerDescription, language: store.appLanguage))
                    .foregroundStyle(GoTheme.muted)
                LiveFeedSummary()
            }
        case .helper:
            GoCard {
                Label(GoLocalization.text(.profileHelperMode, language: store.appLanguage), systemImage: "briefcase.fill")
                    .font(.headline)
                Text(GoLocalization.text(.profileHelperDescription, language: store.appLanguage))
                    .foregroundStyle(GoTheme.muted)
                Button(GoLocalization.text(.profileLoadHelperOpps, language: store.appLanguage)) {
                    Task { await store.loadHelpers() }
                }
                .buttonStyle(GoAccentButtonStyle())
                HelperPreviewList()
            }
        case .business:
            GoCard {
                Label(GoLocalization.text(.profileBusinessOwnerLite, language: store.appLanguage), systemImage: "building.2.fill")
                    .font(.headline)
                Text(GoLocalization.text(.profileBusinessDescription, language: store.appLanguage))
                    .foregroundStyle(GoTheme.muted)
                LiveFeedSummary()
            }
        case .logistics:
            GoCard {
                Label(GoLocalization.text(.profileLogisticsLite, language: store.appLanguage), systemImage: "shippingbox.fill")
                    .font(.headline)
                Text(GoLocalization.text(.profileLogisticsDescription, language: store.appLanguage))
                    .foregroundStyle(GoTheme.muted)
                Button(GoLocalization.text(.profileLoadLogistics, language: store.appLanguage)) {
                    Task { await store.loadLogisticsRequests() }
                }
                .buttonStyle(GoAccentButtonStyle())
                LogisticsPreviewList()
            }
        }
    }
}

private struct LiveFeedSummary: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        if case .loaded(let feed) = store.mobileFeed {
            Text("\(GoLocalization.text(.profileJobsLabel, language: store.appLanguage)): \(feed.jobs?.mine?.count ?? 0) · \(GoLocalization.text(.profileAppointmentsLabel, language: store.appLanguage)): \(feed.appointments?.count ?? 0) · \(GoLocalization.text(.profileBusinessesLabel, language: store.appLanguage)): \(feed.businesses?.count ?? 0)" )
                .font(.footnote.weight(.semibold))
                .foregroundStyle(GoTheme.amber)
        } else {
            Text(store.isSignedIn ? GoLocalization.text(.profileRefreshHome, language: store.appLanguage) : GoLocalization.text(.profileSignInLoadData, language: store.appLanguage))
                .font(.footnote)
                .foregroundStyle(GoTheme.muted)
        }
    }
}

private struct HelperPreviewList: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.nearbyHelpers {
        case .loaded(let helpers):
            ForEach(helpers.prefix(3)) { helper in
                Text(helper.ownerName ?? helper.profileHeadline ?? "\(GoLocalization.text(.profileHelperFallback, language: store.appLanguage))\(helper.id)")
                    .font(.subheadline.weight(.semibold))
            }
        case .loading:
            ProgressView()
        case .failed(let message):
            Text(message)
                .font(.footnote)
                .foregroundStyle(.red)
        case .idle:
            EmptyView()
        }
    }
}

private struct LogisticsPreviewList: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        switch store.logisticsRequests {
        case .loaded(let requests):
            ForEach(requests.prefix(3)) { request in
                Text(request.title ?? request.reference ?? "\(GoLocalization.text(.profileLogisticsFallback, language: store.appLanguage))\(request.id)")
                    .font(.subheadline.weight(.semibold))
            }
        case .loading:
            ProgressView()
        case .failed(let message):
            Text(store.isSignedIn ? message : GoLocalization.text(.profileSignInLoadLogistics, language: store.appLanguage))
                .font(.footnote)
                .foregroundStyle(store.isSignedIn ? .red : GoTheme.muted)
        case .idle:
            EmptyView()
        }
    }
}
