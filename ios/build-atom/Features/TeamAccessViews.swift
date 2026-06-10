import SwiftUI

// MARK: - Vortex join (redeem an access code to join a business workspace)

/// Entry point for joining a business as a manager / representative / employee /
/// support agent by entering a shared "Vortex" access code.
struct VortexJoinView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var workspace: BusinessWorkspaceStore

    @State private var code = ""
    @State private var preview: VortexPreview?
    @State private var isWorking = false
    @State private var error: String?
    @State private var joinedStatus: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Enter a workspace code")
                        .font(.system(size: 20, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text("Ask the business owner or a manager for their join code (looks like VRTX-XXXXX-XXXXX).")
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)

                    TextField("VRTX-XXXXX-XXXXX", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(size: 16, weight: .semibold, design: .monospaced))
                        .padding(14)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
                        .onChange(of: code) { _, _ in preview = nil; error = nil }

                    if let preview {
                        previewCard(preview)
                    }

                    if let joinedStatus {
                        successCard(joinedStatus)
                    } else if let error {
                        Text(error)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Theme.danger)
                    }

                    Button(action: primaryAction) {
                        HStack {
                            if isWorking { ProgressView().tint(.white) }
                            Text(preview == nil ? "Preview code" : "Join workspace")
                                .font(.system(size: 15, weight: .bold))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(canSubmit ? Theme.accent : Theme.accent.opacity(0.4),
                                    in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(.white)
                    }
                    .disabled(!canSubmit || isWorking || joinedStatus != nil)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Join a workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private var canSubmit: Bool {
        code.trimmingCharacters(in: .whitespaces).count >= 5
    }

    private func previewCard(_ p: VortexPreview) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(p.business_name)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
            HStack(spacing: 8) {
                Image(systemName: "person.badge.key.fill").foregroundStyle(Theme.accent)
                Text("You'll join as \(TeamRole.label(for: p.role))")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            if p.requires_approval {
                Text("This workspace requires owner approval — you'll be pending until approved.")
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.warning)
            }
        }
        .cardStyle(padding: 14)
    }

    private func successCard(_ status: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success)
            Text(status == "pending"
                 ? "Request sent — waiting for owner approval."
                 : "You're in! Switch to this workspace from the Business tab.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Theme.textPrimary)
        }
        .cardStyle(padding: 14)
    }

    private func primaryAction() {
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        error = nil
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                if preview == nil {
                    preview = try await TeamService.previewCode(trimmed)
                } else {
                    let result = try await TeamService.redeemCode(trimmed)
                    joinedStatus = result.status ?? "active"
                    // Refresh the workspace switcher so the new business appears.
                    await workspace.loadWorkspace()
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}

// MARK: - Team management (roster, approvals, roles, access codes)

struct TeamManagementView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var me: BusinessMembershipMe?
    @State private var members: [BusinessMember] = []
    @State private var codes: [BusinessAccessCode] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var showCreateCode = false

    private var canManage: Bool { me?.isOwner == true || me?.can("team.invite") == true }
    private var isOwner: Bool { me?.isOwner == true }
    private var pending: [BusinessMember] { members.filter { $0.isPending } }
    private var active: [BusinessMember] { members.filter { !$0.isPending } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        if let error {
                            Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                        }

                        if !pending.isEmpty {
                            section("Pending approvals") {
                                ForEach(pending) { m in memberRow(m) }
                            }
                        }

                        section("Team (\(active.count))") {
                            if active.isEmpty {
                                Text("No team members yet.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                            } else {
                                ForEach(active) { m in memberRow(m) }
                            }
                        }

                        if canManage {
                            section("Join codes") {
                                if codes.isEmpty {
                                    Text("No active codes. Create one to invite teammates.")
                                        .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                                } else {
                                    ForEach(codes) { c in codeRow(c) }
                                }
                                Button { showCreateCode = true } label: {
                                    Label("Create a join code", systemImage: "plus.circle.fill")
                                        .font(.system(size: 14, weight: .bold))
                                        .foregroundStyle(Theme.accent)
                                }
                                .padding(.top, 4)
                            }
                        }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Team")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .sheet(isPresented: $showCreateCode) {
                CreateAccessCodeView(businessId: businessId) { await load() }
            }
            .task { await load() }
        }
    }

    @ViewBuilder
    private func section(_ title: String, @ViewBuilder _ content: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).sectionTitle()
            VStack(alignment: .leading, spacing: 10) { content() }
        }
    }

    private func memberRow(_ m: BusinessMember) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "person.crop.circle.fill")
                .font(.system(size: 30))
                .foregroundStyle(Theme.textTertiary)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.displayName).font(.system(size: 14, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Text(TeamRole.label(for: m.role) + (m.isPending ? " · pending" : ""))
                    .font(.system(size: 11))
                    .foregroundStyle(m.isPending ? Theme.warning : Theme.textSecondary)
            }
            Spacer()
            if m.isPending && canManage {
                Button { act { try await TeamService.approve(businessId: businessId, membershipId: m.id) } } label: {
                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.success).font(.system(size: 22))
                }
                Button { act { try await TeamService.deny(businessId: businessId, membershipId: m.id) } } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger).font(.system(size: 22))
                }
            } else if isOwner && m.role != "owner" {
                Menu {
                    ForEach(TeamRole.allCases) { r in
                        Button(r.label) {
                            act { try await TeamService.changeRole(businessId: businessId, membershipId: m.id, role: r.rawValue) }
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").foregroundStyle(Theme.textSecondary).font(.system(size: 20))
                }
            }
        }
        .cardStyle(padding: 12)
    }

    private func codeRow(_ c: BusinessAccessCode) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(c.code).font(.system(size: 14, weight: .bold, design: .monospaced)).foregroundStyle(Theme.textPrimary)
                Text(TeamRole.label(for: c.role) + (c.label.map { " · \($0)" } ?? ""))
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            ShareLink(item: c.code) {
                Image(systemName: "square.and.arrow.up").foregroundStyle(Theme.accent)
            }
            Button { act { try await TeamService.revokeAccessCode(businessId: businessId, codeId: c.id) } } label: {
                Image(systemName: "trash").foregroundStyle(Theme.danger)
            }
        }
        .cardStyle(padding: 12)
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let meReq = TeamService.myMembership(businessId: businessId)
            async let membersReq = TeamService.memberships(businessId: businessId)
            me = try await meReq
            members = try await membersReq
            if me?.isOwner == true || me?.can("team.invite") == true {
                codes = (try? await TeamService.accessCodes(businessId: businessId)) ?? []
            }
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func act(_ op: @escaping () async throws -> Void) {
        Task {
            do { try await op(); await load() }
            catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}

// MARK: - Create access code

private struct CreateAccessCodeView: View {
    let businessId: Int
    let onCreated: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var role: TeamRole = .employee
    @State private var label = ""
    @State private var requiresApproval = true
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Role") {
                    Picker("Role", selection: $role) {
                        ForEach(TeamRole.allCases) { r in Text(r.label).tag(r) }
                    }
                }
                Section("Label (optional)") {
                    TextField("e.g. Front desk staff", text: $label)
                }
                Section {
                    Toggle("Require owner approval", isOn: $requiresApproval)
                }
                if let error {
                    Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("New join code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { create() }.disabled(isWorking)
                }
            }
        }
    }

    private func create() {
        isWorking = true
        Task {
            defer { isWorking = false }
            do {
                _ = try await TeamService.createAccessCode(
                    businessId: businessId,
                    role: role.rawValue,
                    label: label.isEmpty ? nil : label,
                    maxUses: nil,
                    expiresInDays: nil,
                    requiresApproval: requiresApproval
                )
                await onCreated()
                dismiss()
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
        }
    }
}
