import SwiftUI

// MARK: - QuoteBuilderView

struct QuoteBuilderView: View {
    let jobId: String
    let jobTitle: String
    var onSent: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @State private var lineItems: [QuoteLineItem] = [
        QuoteLineItem(description: "", type: "labor", quantity: 1, unit_price_cents: 0)
    ]
    @State private var taxRatePct: Double = 0    // 0–30 percent slider
    @State private var notes: String = ""
    @State private var validDays: Int = 7
    @State private var isSending = false
    @State private var errorMsg: String?
    @State private var showSuccess = false

    private var subtotalCents: Int {
        lineItems.reduce(0) { $0 + $1.subtotal_cents }
    }
    private var taxCents: Int {
        Int((Double(subtotalCents) * taxRatePct / 100.0).rounded())
    }
    private var totalCents: Int { subtotalCents + taxCents }

    private func dollars(_ cents: Int) -> String {
        localization.formatCents(cents)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {

                    // Job context banner
                    HStack(spacing: 10) {
                        Image(systemName: "briefcase.fill")
                            .foregroundStyle(Theme.accent)
                        Text(jobTitle)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(2)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))

                    // Line items
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text("Line Items").sectionTitle()
                            Spacer()
                            Button {
                                lineItems.append(QuoteLineItem(
                                    description: "", type: "labor", quantity: 1, unit_price_cents: 0
                                ))
                            } label: {
                                Label("common.add", systemImage: "plus.circle.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Theme.accent)
                            }
                        }

                        ForEach($lineItems) { $item in
                            LineItemRow(item: $item) {
                                lineItems.removeAll { $0.id == item.id }
                            }
                        }
                    }

                    // Tax
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Tax Rate").font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                            Spacer()
                            Text(String(format: "%.1f%%", taxRatePct))
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(Theme.textPrimary)
                        }
                        Slider(value: $taxRatePct, in: 0...30, step: 0.5)
                            .tint(Theme.accent)
                    }
                    .cardStyle()

                    // Totals summary
                    VStack(spacing: 8) {
                        totalRow("Subtotal", value: dollars(subtotalCents))
                        if taxCents > 0 {
                            totalRow("Tax (\(String(format: "%.1f", taxRatePct))%)", value: dollars(taxCents))
                        }
                        Divider()
                        HStack {
                            Text("Total").font(.system(size: 16, weight: .heavy))
                                .foregroundStyle(Theme.textPrimary)
                            Spacer()
                            Text(dollars(totalCents))
                                .font(.system(size: 18, weight: .heavy))
                                .foregroundStyle(Theme.accent)
                        }
                    }
                    .cardStyle()

                    // Valid for
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Quote Valid For").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                        Picker(LocalizedStringKey("picker.valid_for"), selection: $validDays) {
                            Text("3 days").tag(3)
                            Text("7 days").tag(7)
                            Text("14 days").tag(14)
                            Text("30 days").tag(30)
                        }
                        .pickerStyle(.segmented)
                    }
                    .cardStyle()

                    // Notes
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Notes (optional)").font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Theme.textSecondary)
                        TextEditor(text: $notes)
                            .frame(minHeight: 80)
                            .font(.system(size: 14))
                            .foregroundStyle(Theme.textPrimary)
                            .scrollContentBackground(.hidden)
                            .padding(8)
                            .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 10))
                    }
                    .cardStyle()

                    if let err = errorMsg {
                        Text(err)
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.danger)
                            .padding(.horizontal, 4)
                    }

                    // Send button
                    Button {
                        Task { await sendQuote() }
                    } label: {
                        HStack(spacing: 8) {
                            if isSending {
                                ProgressView().tint(.white)
                            } else {
                                Image(systemName: "paperplane.fill")
                                Text(localization.format("Send Quote — %@", dollars(totalCents)))
                                    .font(.system(size: 15, weight: .bold))
                            }
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(
                            canSend ? Theme.accent : Theme.textTertiary,
                            in: RoundedRectangle(cornerRadius: 14)
                        )
                    }
                    .disabled(!canSend || isSending)
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Build a Quote")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("common.cancel") { dismiss() }
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
        }
        .overlay(alignment: .top) {
            if showSuccess {
                Text("Quote sent!")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Theme.success, in: Capsule())
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }

    // MARK: - Helpers

    private var canSend: Bool {
        totalCents > 0 && lineItems.allSatisfy { !$0.description.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    private func sendQuote() async {
        isSending = true; errorMsg = nil
        let req = QuotesService.CreateRequest(
            job_id: jobId,
            line_items: lineItems,
            tax_rate: taxRatePct / 100.0,
            notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes,
            valid_days: validDays
        )
        do {
            _ = try await QuotesService.send(req)
            withAnimation { showSuccess = true }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            onSent?()
            dismiss()
        } catch {
            errorMsg = "Could not send quote. Check your connection and try again."
        }
        isSending = false
    }

    @ViewBuilder
    private func totalRow(_ label: String, value: String) -> some View {
        HStack {
            Text(label).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
            Spacer()
            Text(value).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
        }
    }
}

// MARK: - Line item row editor

private struct LineItemRow: View {
    @Binding var item: QuoteLineItem
    let onRemove: () -> Void
    @EnvironmentObject private var localization: LocalizationManager

    // Local string buffers so keyboard doesn't fight with Int binding
    @State private var priceBuf: String = ""
    @State private var qtyBuf: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                // Type badge picker
                Menu {
                    Button("quote.labor")    { item.type = "labor" }
                    Button("quote.material") { item.type = "material" }
                    Button("quote.other")    { item.type = "other" }
                } label: {
                    Text(localization.localized("quote.\(item.type)"))
                        .font(.system(size: 11, weight: .bold))
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .background(typeBadgeColor.opacity(0.16), in: Capsule())
                        .foregroundStyle(typeBadgeColor)
                }

                Spacer()

                Button(action: onRemove) {
                    Image(systemName: "minus.circle.fill")
                        .foregroundStyle(Theme.danger.opacity(0.7))
                }
            }

            TextField("Description (e.g. 2 hrs electrical work)", text: $item.description)
                .font(.system(size: 14))
                .foregroundStyle(Theme.textPrimary)
                .padding(10)
                .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))

            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Qty").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    TextField("1", text: $qtyBuf)
                        .keyboardType(.decimalPad)
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 60)
                        .padding(8)
                        .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))
                        .onChange(of: qtyBuf) { _, v in
                            if let d = Double(v), d > 0 { item.quantity = d }
                        }
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Unit price").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    HStack(spacing: 4) {
                        Text(localization.currencySymbol()).font(.system(size: 14)).foregroundStyle(Theme.textSecondary)
                        TextField("0.00", text: $priceBuf)
                            .keyboardType(.decimalPad)
                            .font(.system(size: 14, weight: .semibold))
                            .onChange(of: priceBuf) { _, v in
                                if let d = Double(v), d >= 0 {
                                    item.unit_price_cents = Int((d * 100).rounded())
                                }
                            }
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Theme.surfaceElevated, in: RoundedRectangle(cornerRadius: 9))
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text("Subtotal").font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
                    Text(localization.formatCents(item.subtotal_cents))
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Theme.accent)
                        .padding(8)
                }
            }
        }
        .padding(12)
        .background(Theme.cardBackground, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Theme.stroke, lineWidth: 1))
        .onAppear {
            priceBuf = item.unit_price_cents > 0 ? String(format: "%.2f", Double(item.unit_price_cents) / 100.0) : ""
            qtyBuf   = item.quantity != 1 ? String(item.quantity) : ""
        }
    }

    private var typeBadgeColor: Color {
        switch item.type {
        case "labor":    return Theme.pillarHome
        case "material": return Theme.pillarMoney
        default:         return Theme.accent
        }
    }
}

// MARK: - Sent Quotes List (helper-side)

struct SentQuotesView: View {
    @EnvironmentObject private var localization: LocalizationManager
    @State private var quotes: [APIHelperQuote] = []
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Group {
            if isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = error {
                Text(err).font(.system(size: 14)).foregroundStyle(Theme.danger).padding(20)
            } else if quotes.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "doc.text.magnifyingglass")
                        .font(.system(size: 40)).foregroundStyle(Theme.textTertiary)
                    Text("No quotes sent yet").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(quotes) { q in
                            sentQuoteCard(q)
                        }
                    }
                    .padding(20)
                }
            }
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle("Sent Quotes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.background, for: .navigationBar)
        .task { await load() }
    }

    private func sentQuoteCard(_ q: APIHelperQuote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(q.job_title ?? localization.localized(L10n.CommonKey.jobFallback)).font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Theme.textPrimary).lineLimit(1)
                Spacer()
                Text(localization.localized(q.statusDisplay))
                    .font(.system(size: 11, weight: .bold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(q.statusColor.opacity(0.16), in: Capsule())
                    .foregroundStyle(q.statusColor)
            }
            HStack {
                Text(localization.formatCents(q.total_cents)).font(.system(size: 16, weight: .heavy)).foregroundStyle(Theme.accent)
                Spacer()
                Text(localization.formatPlural("plural.item", q.line_items.count))
                    .font(.system(size: 12)).foregroundStyle(Theme.textTertiary)
            }
            if let d = q.valid_until {
                Text(localization.format("Valid until %@", String(d.prefix(10))))
                    .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
            }
        }
        .cardStyle()
    }

    private func load() async {
        isLoading = true; error = nil
        quotes = (try? await QuotesService.sent()) ?? []
        isLoading = false
    }
}
