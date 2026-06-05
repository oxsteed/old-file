import SwiftUI

// MARK: - Review Sheet

/// Two-way review submission after a job completes.
/// Both customer→helper and helper→customer are handled by POST /api/reviews/jobs/:jobId
/// — the backend infers the reviewer's role from the authenticated user.
struct ReviewSheet: View {
    let job: APIJob
    var onDone: () -> Void

    @EnvironmentObject var auth: AuthStore
    @EnvironmentObject var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var rating: Int = 0
    @State private var comment     = ""
    @State private var isSubmitting = false
    @State private var submitted    = false
    @State private var error: String?

    // Determine who the user is reviewing
    private var isHelper: Bool {
        guard let uid = auth.user?.id else { return false }
        if let customerId = job.customer_id { return uid == customerId }
        return false
    }

    private var revieweeName: String {
        if isHelper {
            return job.assigned_helper_name ?? localization.localized(L10n.CommonKey.yourHelper)
        } else {
            return job.customer_name ?? localization.localized(L10n.CommonKey.theCustomer)
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Handle
            Capsule()
                .fill(Theme.stroke)
                .frame(width: 40, height: 4)
                .padding(.top, 12)
                .padding(.bottom, 20)

            if submitted {
                submittedState
            } else {
                reviewForm
            }
        }
        .background(Theme.background.ignoresSafeArea())
    }

    // ── Submitted confirmation ─────────────────────────────────────────────
    private var submittedState: some View {
        VStack(spacing: 20) {
            Spacer()
            ZStack {
                Circle().fill(Theme.success.opacity(0.15))
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 36, weight: .bold))
                    .foregroundStyle(Theme.success)
            }
            .frame(width: 80, height: 80)
            Text("review.submitted_title")
                .font(.system(size: 20, weight: .heavy))
                .foregroundStyle(Theme.textPrimary)
            Text("review.submitted_message")
                .font(.system(size: 14))
                .foregroundStyle(Theme.textSecondary)
            Button("common.done") { dismiss(); onDone() }
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                .padding(.horizontal, 24)
            Spacer()
        }
    }

    // ── Review form ────────────────────────────────────────────────────────
    private var reviewForm: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                // Title
                VStack(alignment: .leading, spacing: 4) {
                    Text(localization.format("Rate %@", revieweeName))
                        .font(.system(size: 20, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(localization.format("for \"%@\"", job.title))
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.textSecondary)
                }

                // Star picker
                HStack(spacing: 8) {
                    ForEach(1...5, id: \.self) { star in
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.system(size: 32))
                            .foregroundStyle(star <= rating ? .yellow : Theme.stroke)
                            .onTapGesture { withAnimation(.spring(response: 0.2)) { rating = star } }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)

                // Comment
                VStack(alignment: .leading, spacing: 6) {
                    Text("Comment (optional)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .textCase(.uppercase)

                    TextEditor(text: $comment)
                        .font(.system(size: 14))
                        .foregroundStyle(Theme.textPrimary)
                        .frame(minHeight: 80, maxHeight: 160)
                        .padding(10)
                        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Theme.stroke, lineWidth: 1)
                        )
                }

                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.danger)
                }

                Button {
                    Task { await submitReview() }
                } label: {
                    Group {
                        if isSubmitting {
                            ProgressView().tint(.white)
                        } else {
                            Text("feature.submit_review")
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(
                        rating > 0 ? Theme.accent : Theme.stroke,
                        in: RoundedRectangle(cornerRadius: 14)
                    )
                }
                .disabled(rating == 0 || isSubmitting)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
    }

    // ── Submission ─────────────────────────────────────────────────────────
    private func submitReview() async {
        guard rating > 0 else { return }
        isSubmitting = true
        error = nil
        do {
            // Client-side moderation before submission
            if !comment.isEmpty {
                try await ContentModerator.check(comment, context: "review", locale: localization.bcp47.isEmpty ? "en" : localization.bcp47)
            }
            try await ReviewsService.submit(jobId: job.id, rating: rating,
                                            comment: comment.isEmpty ? nil : comment)
            withAnimation { submitted = true }
        } catch let modErr as ContentModerator.Error {
            if case .blocked(let reason) = modErr { self.error = reason }
        } catch {
            self.error = "Failed to submit. Please try again."
        }
        isSubmitting = false
    }
}

// MARK: - Report User Sheet

/// Reusable sheet for reporting a user or piece of content.
/// Submits to POST /api/messages/report.
struct ReportUserSheet: View {
    var userId: String?
    var contentType: String     // 'user' | 'message' | 'job' | 'review' | 'profile'
    var contentId: String?
    var onDone: () -> Void

    @State private var selectedReason = "harassment"
    @State private var description    = ""
    @State private var isSubmitting   = false
    @State private var error: String?

    private let reasons: [(key: String, label: String)] = [
        ("harassment", "Harassment or bullying"),
        ("spam",       "Spam or scam"),
        ("fraud",      "Fraud or fake listing"),
        ("inappropriate", "Inappropriate content"),
        ("other",      "Other"),
    ]

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("What's the issue?")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)

                VStack(spacing: 0) {
                    ForEach(reasons, id: \.key) { r in
                        Button { selectedReason = r.key } label: {
                            HStack {
                                Text(r.label)
                                    .font(.system(size: 15))
                                    .foregroundStyle(Theme.textPrimary)
                                Spacer()
                                if selectedReason == r.key {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(Theme.accent)
                                }
                            }
                            .padding(.vertical, 12)
                            .padding(.horizontal, 16)
                        }
                        .buttonStyle(.plain)
                        if r.key != reasons.last?.key {
                            Divider().padding(.leading, 16)
                        }
                    }
                }
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 6) {
                    Text("Additional details (optional)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.textTertiary)
                    TextEditor(text: $description)
                        .scrollContentBackground(.hidden)
                        .frame(height: 80)
                        .padding(10)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 12))
                        .foregroundStyle(Theme.textPrimary)
                }

                if let error { Text(error).font(.system(size: 12)).foregroundStyle(Theme.danger) }

                Button {
                    Task { await submit() }
                } label: {
                    Group {
                        if isSubmitting { ProgressView().tint(.white) }
                        else { Text("feature.submit_report").font(.system(size: 15, weight: .bold)).foregroundStyle(.white) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isSubmitting)

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Report")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.cancel") { onDone() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func submit() async {
        isSubmitting = true; error = nil
        defer { isSubmitting = false }
        do {
            try await MessagesService.reportContent(
                reportedUserId: userId,
                contentType: contentType,
                contentId: contentId,
                reason: selectedReason,
                description: description.isEmpty ? nil : description
            )
            onDone()
        } catch {
            self.error = "Failed to submit report. Please try again."
        }
    }
}
