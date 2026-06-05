import SwiftUI

// MARK: - Helper availability manager

struct AvailabilityManagerView: View {
    @EnvironmentObject var auth: AuthStore
    @State private var blocks: [AvailabilityBlock] = []
    @State private var isLoading = false
    @State private var isSavingBuffer = false
    @State private var showAddSheet = false
    @State private var lastError: String?
    @State private var bufferError: String?
    @AppStorage("ox.helper.bufferMinutes") private var bufferMinutes: Int = 0

    private let bufferOptions = [0, 15, 30, 45, 60]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {

                    // ── Buffer time between jobs ──────────────────────────────
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 10) {
                            Image(systemName: "timer")
                                .font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(Theme.accent)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Buffer Between Jobs")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("Auto-block this time after each booking.")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            if isSavingBuffer {
                                ProgressView()
                                    .tint(Theme.accent)
                                    .scaleEffect(0.8)
                            }
                        }
                        HStack(spacing: 8) {
                            ForEach(bufferOptions, id: \.self) { mins in
                                Button {
                                    Task { await saveBufferMinutes(mins) }
                                } label: {
                                    Text(mins == 0 ? "None" : "\(mins) min")
                                        .font(.system(size: 12, weight: .semibold))
                                        .foregroundStyle(bufferMinutes == mins ? .white : Theme.textSecondary)
                                        .padding(.horizontal, 12).padding(.vertical, 7)
                                        .background(bufferMinutes == mins ? Theme.accent : Theme.surfaceElevated, in: Capsule())
                                        .overlay(Capsule().strokeBorder(bufferMinutes == mins ? Theme.accent : Theme.stroke, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                                .disabled(isSavingBuffer)
                            }
                        }
                        if let bufferError {
                            Text(bufferError)
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.danger)
                        }
                    }
                    .cardStyle()

                    if isLoading {
                        HStack(spacing: 10) {
                            ProgressView().tint(Theme.accent)
                            Text("Loading availability…").font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }

                    if let lastError {
                        Text(lastError)
                            .font(.system(size: 12))
                            .foregroundStyle(Theme.danger)
                    }

                    if blocks.isEmpty && !isLoading {
                        Text("No availability blocks yet.")
                            .font(.system(size: 13))
                            .foregroundStyle(Theme.textSecondary)
                            .padding(.top, 24)
                    }

                    ForEach(blocks) { b in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(b.date ?? "—")
                                    .font(.system(size: 14, weight: .semibold))
                                    .foregroundStyle(Theme.textPrimary)
                                Text("\(b.start_time ?? "—") – \(b.end_time ?? "—")")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            Spacer()
                            Text((b.is_available ?? true) ? "Available" : "Unavailable")
                                .font(.system(size: 11, weight: .bold))
                                .foregroundStyle((b.is_available ?? true) ? Theme.success : Theme.warning)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(((b.is_available ?? true) ? Theme.success : Theme.warning).opacity(0.14), in: Capsule())
                        }
                        .cardStyle(padding: 12)
                    }
                }
                .padding(20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus").foregroundStyle(Theme.accent)
                    }
                }
            }
        }
        .task {
            await loadBufferMinutes()
            await load()
        }
        .sheet(isPresented: $showAddSheet) {
            AddAvailabilityBlockView { newBlock in
                blocks.insert(newBlock, at: 0)
            }
            .presentationDetents([.medium])
            .presentationBackground(Theme.background)
        }
    }

    private func load() async {
        guard let helperId = auth.user?.id else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let (from, to) = dateRange(days: 21)
            blocks = try await CalendarService.helperAvailabilityBlocks(helperId, fromDate: from, toDate: to)
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func loadBufferMinutes() async {
        struct Profile: Decodable {
            let booking_buffer_minutes: Int?
        }
        do {
            let profile: Profile = try await APIClient.shared.request("/api/helper-profile/me")
            bufferMinutes = profile.booking_buffer_minutes ?? 0
            bufferError = nil
        } catch {
            bufferError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func saveBufferMinutes(_ minutes: Int) async {
        let previous = bufferMinutes
        bufferMinutes = minutes
        isSavingBuffer = true
        bufferError = nil
        defer { isSavingBuffer = false }
        do {
            try await HelperProfileService.updateCore(.init(
                profile_headline: nil,
                bio_long: nil,
                bio_short: nil,
                hourly_rate_min: nil,
                hourly_rate_max: nil,
                rate_preference: nil,
                service_city: nil,
                service_state: nil,
                service_zip: nil,
                service_radius_miles: nil,
                is_available_now: nil,
                ai_knowledge: nil,
                booking_buffer_minutes: minutes
            ))
            await load()
        } catch {
            bufferMinutes = previous
            bufferError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func dateRange(days: Int) -> (String, String) {
        let cal = Calendar.current
        let start = Date()
        let end = cal.date(byAdding: .day, value: days, to: start) ?? start
        return (isoDay(start), isoDay(end))
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }
}

private struct AddAvailabilityBlockView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var start = Date()
    @State private var end = Calendar.current.date(byAdding: .hour, value: 2, to: Date()) ?? Date()
    @State private var isAvailable = true
    @State private var isSaving = false
    @State private var lastError: String?

    let onCreate: (AvailabilityBlock) -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                DatePicker("Date", selection: $date, displayedComponents: [.date])
                DatePicker("Start", selection: $start, displayedComponents: [.hourAndMinute])
                DatePicker("End", selection: $end, displayedComponents: [.hourAndMinute])
                Toggle("Available", isOn: $isAvailable)

                if let lastError {
                    Text(lastError).font(.system(size: 12)).foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await save() }
                } label: {
                    HStack {
                        if isSaving { ProgressView().tint(.white) }
                        Text("feature.save_block").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                }
                .disabled(isSaving)

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("New Availability")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.cancel") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
            .toolbarBackground(Theme.background, for: .navigationBar)
        }
    }

    private func save() async {
        lastError = nil
        isSaving = true
        defer { isSaving = false }
        do {
            let b = try await CalendarService.createAvailability(
                date: isoDay(date),
                startTime: hhmm(start),
                endTime: hhmm(end),
                isAvailable: isAvailable,
                notes: nil
            )
            onCreate(b)
            dismiss()
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func isoDay(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: d)
    }

    private func hhmm(_ d: Date) -> String {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .iso8601)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "HH:mm"
        return f.string(from: d)
    }
}
