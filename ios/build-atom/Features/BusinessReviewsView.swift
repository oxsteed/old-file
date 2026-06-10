import SwiftUI

struct BusinessReviewsView: View {
    let businessId: Int

    @Environment(\.dismiss) private var dismiss
    @State private var reviews: [BusinessReview] = []
    @State private var avgRating: Double = 0
    @State private var total = 0
    @State private var isLoading = true
    @State private var error: String?
    @State private var replyingTo: String?
    @State private var replyText = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if total > 0 {
                        HStack(spacing: 14) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(String(format: "%.1f", avgRating)).font(.system(size: 26, weight: .heavy)).foregroundStyle(Theme.textPrimary)
                                stars(Int(avgRating.rounded()))
                            }
                            Text("\(total) review\(total == 1 ? "" : "s")").font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                        }
                        .cardStyle(padding: 14)
                    }

                    if isLoading {
                        ProgressView().tint(Theme.accent).frame(maxWidth: .infinity).padding(.top, 30)
                    } else if let error {
                        Text(error).font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.danger)
                    } else if reviews.isEmpty {
                        Text("No reviews yet.").font(.system(size: 13)).foregroundStyle(Theme.textSecondary).padding(.top, 30)
                    } else {
                        ForEach(reviews) { r in reviewCard(r) }
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Reviews")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("common.done") { dismiss() }.foregroundStyle(Theme.accent) }
            }
            .task { await load() }
        }
    }

    private func reviewCard(_ r: BusinessReview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(r.reviewer_name ?? "Anonymous").font(.system(size: 13, weight: .bold)).foregroundStyle(Theme.textPrimary)
                Spacer()
                stars(r.rating ?? 0)
            }
            if let t = r.testimonial {
                Text(t).font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
            }
            if let reply = r.replyText {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your reply").font(.system(size: 10, weight: .bold)).foregroundStyle(Theme.accent)
                    Text(reply).font(.system(size: 12)).foregroundStyle(Theme.textPrimary)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.accent.opacity(0.08), in: RoundedRectangle(cornerRadius: 10))
                Button("Remove reply", role: .destructive) {
                    act { try await BusinessHubService.deleteReviewReply(businessId: businessId, reviewId: r.id) }
                }.font(.system(size: 11, weight: .semibold))
            } else if replyingTo == r.id {
                TextField("Write a reply…", text: $replyText, axis: .vertical)
                    .lineLimit(2...4)
                    .padding(10)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Theme.stroke, lineWidth: 1))
                HStack {
                    Button("Cancel") { replyingTo = nil; replyText = "" }.font(.system(size: 12)).foregroundStyle(Theme.textSecondary)
                    Spacer()
                    Button("Post reply") {
                        let text = replyText
                        replyingTo = nil; replyText = ""
                        act { try await BusinessHubService.replyToReview(businessId: businessId, reviewId: r.id, reply: text) }
                    }
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accent)
                    .disabled(replyText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else {
                Button("Reply") { replyingTo = r.id; replyText = "" }
                    .font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.accent)
            }
        }
        .cardStyle(padding: 14)
    }

    private func stars(_ n: Int) -> some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                Image(systemName: i < n ? "star.fill" : "star")
                    .font(.system(size: 11)).foregroundStyle(Theme.warning)
            }
        }
    }

    private func load() async {
        isLoading = true; defer { isLoading = false }
        do {
            let r = try await BusinessHubService.reviews(businessId: businessId)
            reviews = r.reviews; avgRating = r.avgRating; total = r.total; error = nil
        } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }

    private func act(_ op: @escaping () async throws -> Void) {
        Task { do { try await op(); await load() } catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription } }
    }
}
