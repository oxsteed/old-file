import SwiftUI
import MapKit

// MARK: - Universal Map Browse

/// Shows jobs, helpers, and tool-rental pickup points on a single map.
/// Accessible from the Home tab "Map" chip for any persona.
struct MapBrowseView: View {
    @EnvironmentObject var jobs: JobsStore
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    @State private var position: MapCameraPosition = .region(
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        )
    )

    // Filter toggles
    @State private var showJobs    = true
    @State private var showHelpers = true
    @State private var showTools   = true

    // Live data
    @State private var helpers: [APIHelper] = []
    @State private var tools: [APIToolRental] = []
    @State private var isLoading = false
    @State private var loadError: String?

    // Selection
    @State private var selectedJob: APIJob?
    @State private var selectedHelper: APIHelper?
    @State private var selectedTool: APIToolRental?

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                map

                VStack(spacing: 10) {
                    filterBar
                    mapControlRow
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)

                VStack {
                    Spacer()
                    nearbyPanel
                        .padding(.horizontal, 16)
                        .padding(.bottom, 16)
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .navigationTitle(localization.localized("Explore Map"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .task { await load() }
        .sheet(item: $selectedJob) { job in
            NavigationStack { JobDetailView(job: job) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $selectedHelper) { helper in
            NavigationStack { HelperProfileView(helper: helper) }
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
        .sheet(item: $selectedTool) { tool in
            ToolMapDetailSheet(tool: tool)
                .presentationDetents([.medium])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }

    // MARK: Map

    private var map: some View {
        Map(position: $position) {
            // Jobs — blue hammer pins
            if showJobs {
                ForEach(jobPins) { pin in
                    Annotation(pin.job.title, coordinate: pin.coord) {
                        Button { selectedJob = pin.job } label: {
                            mapPin(icon: "hammer.fill", color: Theme.accent,
                                   label: pin.job.budgetDisplay)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // Helpers — green person pins
            if showHelpers {
                ForEach(helperPins) { pin in
                    Annotation(pin.helper.displayName, coordinate: pin.coord) {
                        Button { selectedHelper = pin.helper } label: {
                            mapPin(icon: "person.fill", color: Theme.success,
                                   label: "★ \(pin.helper.rating.map { String(format: "%.1f", $0) } ?? "—")")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            // Tools — orange wrench pins
            if showTools {
                ForEach(toolPins) { pin in
                    Annotation(pin.tool.name ?? localization.localized("map.tool_rental"), coordinate: pin.coord) {
                        Button { selectedTool = pin.tool } label: {
                            mapPin(icon: "wrench.fill", color: Theme.warning, label: toolDailyRateText(pin.tool))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .onAppear { centreOnUserLocation() }
    }

    @ViewBuilder
    private func mapPin(icon: String, color: Color, label: String) -> some View {
        VStack(spacing: 3) {
            ZStack {
                Circle().fill(color)
                    .frame(width: 32, height: 32)
                    .shadow(color: color.opacity(0.4), radius: 4, y: 2)
                Image(systemName: icon)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(.white)
            }
            Text(label)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .padding(.horizontal, 7).padding(.vertical, 3)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
        }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        HStack(spacing: 8) {
            filterChip(localization.localized("Jobs"), count: jobPins.count, icon: "hammer.fill", color: Theme.accent, on: $showJobs)
            filterChip(localization.localized("Helpers"), count: helperPins.count, icon: "person.fill", color: Theme.success, on: $showHelpers)
            filterChip(localization.localized("Tools"), count: toolPins.count, icon: "wrench.fill", color: Theme.warning, on: $showTools)
            Spacer()
            if isLoading {
                ProgressView().tint(Theme.accent).scaleEffect(0.8)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke.opacity(0.5), lineWidth: 1))
        .shadow(color: .black.opacity(0.1), radius: 6, y: 2)
    }

    private func filterChip(_ label: String, count: Int, icon: String, color: Color, on: Binding<Bool>) -> some View {
        Button { withAnimation(.spring(response: 0.25)) { on.wrappedValue.toggle() } } label: {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 11, weight: .bold))
                Text(label).font(.system(size: 12, weight: .semibold))
                Text("\(count)")
                    .font(.system(size: 10, weight: .heavy))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background((on.wrappedValue ? Color.white.opacity(0.22) : Theme.stroke), in: Capsule())
            }
            .foregroundStyle(on.wrappedValue ? .white : Theme.textSecondary)
            .padding(.horizontal, 11).padding(.vertical, 7)
            .background(on.wrappedValue ? color : Theme.surfaceElevated, in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private var mapControlRow: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(localization.localized("Nearby"))
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text(localization.format("map.places_count", activePinsCount))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Button { resetMapRegion() } label: {
                Label("map.reset", systemImage: "location.fill")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Theme.surface, in: Capsule())
                    .overlay(Capsule().strokeBorder(Theme.stroke, lineWidth: 1))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke.opacity(0.5), lineWidth: 1))
    }

    private var nearbyPanel: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(localization.localized("Nearby matches"))
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Spacer()
                Text(isLoading ? localization.localized("Loading") : localization.format("map.total_count", activePinsCount))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
            }

            VStack(spacing: 8) {
                if let loadError {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(loadError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(Theme.danger)
                        Button {
                            Task { await load() }
                        } label: {
                            Label("map.refresh_data", systemImage: "arrow.clockwise")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundStyle(Theme.accent)
                        }
                        .buttonStyle(.plain)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                }

                ForEach(Array(nearbyJobPins.prefix(jobPanelLimit))) { pin in
                    nearbyRow(icon: "hammer.fill", color: Theme.accent, title: pin.job.title,
                              subtitle: pin.job.location_city ?? localization.localized("map.open_job"), trailing: pin.job.budgetDisplay) {
                        selectedJob = pin.job
                    }
                }
                ForEach(Array(nearbyHelperPins.prefix(helperPanelLimit))) { pin in
                    nearbyRow(icon: "person.fill", color: Theme.success, title: pin.helper.displayName,
                              subtitle: pin.helper.city ?? localization.localized("map.local_helper"), trailing: pin.helper.startingPriceDisplay) {
                        selectedHelper = pin.helper
                    }
                }
                ForEach(Array(nearbyToolPins.prefix(toolPanelLimit))) { pin in
                    nearbyRow(icon: "wrench.fill", color: Theme.warning, title: pin.tool.name ?? localization.localized("map.tool_rental"),
                              subtitle: pin.tool.location_city ?? pin.tool.category ?? localization.localized("map.pickup_nearby"),
                              trailing: toolDailyRateText(pin.tool)) {
                        selectedTool = pin.tool
                    }
                }

                if activePinsCount == 0 && !isLoading {
                    Text(localization.localized("Turn on a filter or try another area to see matches."))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 4)
                }
            }
        }
        .padding(14)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke.opacity(0.55), lineWidth: 1))
        .shadow(color: .black.opacity(0.14), radius: 12, y: 5)
    }

    private func nearbyRow(icon: String, color: Color, title: String, subtitle: String, trailing: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10).fill(color.opacity(0.16))
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(color)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer()
                Text(trailing)
                    .font(.system(size: 11, weight: .heavy))
                    .foregroundStyle(color)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(color.opacity(0.14), in: Capsule())
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Theme.textTertiary)
            }
            .padding(9)
            .background(Theme.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke.opacity(0.65), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: Data + pins

    private var jobPins: [JobMapPin] {
        jobs.availableJobs.compactMap { job -> JobMapPin? in
            guard let lat = job.location_lat, let lng = job.location_lng else { return nil }
            return JobMapPin(job: job, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private var helperPins: [HelperMapPin] {
        helpers.compactMap { h -> HelperMapPin? in
            guard let lat = h.location_lat, let lng = h.location_lng else { return nil }
            return HelperMapPin(helper: h, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private var toolPins: [ToolMapPin] {
        tools.compactMap { t -> ToolMapPin? in
            guard let lat = t.location_lat, let lng = t.location_lng else { return nil }
            return ToolMapPin(tool: t, coord: .init(latitude: lat, longitude: lng))
        }
    }

    private var nearbyJobPins: [JobMapPin] { showJobs ? jobPins : [] }
    private var nearbyHelperPins: [HelperMapPin] { showHelpers ? helperPins : [] }
    private var nearbyToolPins: [ToolMapPin] { showTools ? toolPins : [] }
    private var activePinsCount: Int {
        nearbyJobPins.count + nearbyHelperPins.count + nearbyToolPins.count
    }
    private var enabledFilterCount: Int {
        [showJobs, showHelpers, showTools].filter { $0 }.count
    }
    private var jobPanelLimit: Int {
        guard showJobs else { return 0 }
        return enabledFilterCount == 1 ? 3 : (enabledFilterCount == 2 ? 2 : 1)
    }
    private var helperPanelLimit: Int {
        guard showHelpers else { return 0 }
        return enabledFilterCount == 1 ? 3 : 1
    }
    private var toolPanelLimit: Int {
        guard showTools else { return 0 }
        return enabledFilterCount == 1 ? 3 : 1
    }

    private func load() async {
        isLoading = true
        defer { isLoading = false }
        loadError = nil
        await jobs.loadAvailable()
        do {
            helpers = try await HelpersService.browse(limit: 25)
        } catch {
            helpers = []
            loadError = localization.localized("map.helpers_load_failed")
        }
        do {
            tools = try await ToolRentalsService.browse(limit: 50)
        } catch {
            tools = []
            loadError = [loadError, localization.localized("map.tools_load_failed")]
                .compactMap { $0 }
                .joined(separator: " ")
        }
        if let jobsError = jobs.lastError {
            loadError = [loadError, localization.format("map.jobs_load_failed", jobsError)]
                .compactMap { $0 }
                .joined(separator: " ")
        }
    }

    private func centreOnUserLocation() {
        let lat = UserDefaults.standard.object(forKey: "ox.location.lat") as? Double
        let lng = UserDefaults.standard.object(forKey: "ox.location.lng") as? Double
        guard let lat, let lng else { return }
        position = .region(MKCoordinateRegion(
            center: .init(latitude: lat, longitude: lng),
            span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
        ))
    }

    private func resetMapRegion() {
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            centreOnUserLocation()
            if UserDefaults.standard.object(forKey: "ox.location.lat") == nil {
                position = .region(MKCoordinateRegion(
                    center: CLLocationCoordinate2D(latitude: 37.7749, longitude: -122.4194),
                    span: MKCoordinateSpan(latitudeDelta: 0.18, longitudeDelta: 0.18)
                ))
            }
        }
    }

    // Local pin models
    private struct JobMapPin: Identifiable {
        let job: APIJob; let coord: CLLocationCoordinate2D
        var id: String { job.id }
    }
    private struct HelperMapPin: Identifiable {
        let helper: APIHelper; let coord: CLLocationCoordinate2D
        var id: String { helper.id }
    }
    private struct ToolMapPin: Identifiable {
        let tool: APIToolRental; let coord: CLLocationCoordinate2D
        var id: String { tool.id }
    }

    private func toolDailyRateText(_ tool: APIToolRental) -> String {
        guard let rate = tool.daily_rate else { return "—" }
        return localization.format("map.rate_per_day", localization.formatCurrency(rate, fractionDigits: 0))
    }
}

private struct ToolMapDetailSheet: View {
    let tool: APIToolRental
    @EnvironmentObject private var localization: LocalizationManager
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 18)
                        .fill(Theme.warning.opacity(0.14))
                    Image(systemName: "wrench.and.screwdriver.fill")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Theme.warning)
                }
                .frame(height: 110)

                VStack(alignment: .leading, spacing: 8) {
                    Text(tool.name ?? localization.localized("map.tool_rental"))
                        .font(.system(size: 24, weight: .heavy))
                        .foregroundStyle(Theme.textPrimary)
                    Text(tool.description ?? localization.localized("map.tool_default_description"))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(2)
                }

                HStack(spacing: 10) {
                    toolFact(localization.localized("Rate"), toolDailyRateText, Theme.warning)
                    toolFact(localization.localized("Location"), tool.location_city ?? localization.localized("Nearby"), Theme.accent)
                }

                if let condition = tool.condition {
                    Label(localization.localized(condition.capitalized), systemImage: "checkmark.seal.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(Theme.success)
                }

                Spacer()
            }
            .padding(20)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(localization.localized("Tool Details"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.done") { dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
    }

    private func toolFact(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(Theme.textTertiary)
                .textCase(.uppercase)
            Text(value)
                .font(.system(size: 14, weight: .heavy))
                .foregroundStyle(color)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private var toolDailyRateText: String {
        guard let rate = tool.daily_rate else { return "—" }
        return localization.format("map.rate_per_day", localization.formatCurrency(rate, fractionDigits: 0))
    }
}
