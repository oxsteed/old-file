import SwiftUI
import CoreLocation
import Speech
import AVFoundation
import Translation

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Voice locale mapping
// ─────────────────────────────────────────────────────────────────────────────

/// Converts a BCP-47 language code (e.g. "ar", "ht") into the best Apple
/// SFSpeechRecognizer locale. Apple does not support every language; we fall
/// back gracefully so the mic button never crashes.
///
/// Supported Apple speech locales as of iOS 17:
///   en → en-US   es → es-US (better for US Latinos than es-ES)
///   fr → fr-FR   ar → ar-SA   ht → fr-HT is not supported → fall back to fr-FR
func speechLocale(for bcp47: String) -> String {
    switch bcp47.lowercased() {
    case "en":         return "en-US"
    case "es":         return "es-US"    // US Spanish, better recognition for diaspora speakers
    case "fr":         return "fr-FR"
    case "ar":         return "ar-SA"
    case "ht":         return "fr-FR"    // Haitian Creole unsupported; French is closest
    default:
        // For any other code try appending -US and let the recognizer reject it gracefully
        return "\(bcp47)-US"
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Message Translation
// Strategy: Apple Translation framework (on-device, offline, fast) → server fallback
// ─────────────────────────────────────────────────────────────────────────────

enum TranslationService {
    struct Req: Encodable {
        let text: String
        let target_language: String
    }
    struct Resp: Decodable { let translated: String }

    /// Translate text using Apple's on-device Translation framework when available,
    /// falling back to the OxSteed server endpoint on older OS versions.
    @MainActor
    static func translate(_ text: String, to lang: String) async throws -> String {
        if #available(iOS 26.0, *) {
            if let result = try? await appleTranslate(text, to: lang) {
                return result
            }
        }
        // Server fallback
        let resp = try await APIClient.shared.request(
            "/api/translate",
            method: .POST,
            body: Req(text: text, target_language: lang),
            as: Resp.self
        )
        return resp.translated
    }

    @available(iOS 26.0, *)
    private static func appleTranslate(_ text: String, to targetBCP47: String) async throws -> String {
        // Map our BCP-47 to Locale.Language
        let target = Locale.Language(identifier: targetBCP47)
        let source = Locale.Language(identifier: "en") // assume source is English for now
        let session = TranslationSession(installedSource: source, target: target)
        let response = try await session.translate(text)
        return response.targetText
    }
}

/// A small button shown under a chat bubble to toggle a translated version.
/// Uses Apple Translation when available, server endpoint as fallback.
struct TranslateButton: View {
    let messageId: String
    let text: String
    @Binding var translations: [String: String]
    @Binding var loading: Set<String>

    @EnvironmentObject var localization: LocalizationManager
    // Translation session config for the `.translationTask` modifier approach
    @State private var translationConfig: TranslationSession.Configuration? = nil

    var body: some View {
        let isLoading      = loading.contains(messageId)
        let hasTranslation = translations[messageId] != nil

        Button {
            if hasTranslation {
                translations.removeValue(forKey: messageId)
            } else {
                Task { await translate() }
            }
        } label: {
            HStack(spacing: 4) {
                if isLoading {
                    ProgressView().scaleEffect(0.6).tint(Theme.textTertiary)
                } else {
                    Image(systemName: hasTranslation ? "globe.slash" : "globe")
                        .font(.system(size: 10, weight: .semibold))
                }
                Text(hasTranslation ? "Original" : "Translate")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(Theme.textTertiary)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(Theme.surfaceElevated, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }

    private func translate() async {
        loading.insert(messageId)
        defer { loading.remove(messageId) }
        let target = localization.bcp47
        guard let result = try? await TranslationService.translate(text, to: target) else { return }
        translations[messageId] = result
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Voice Input (Speech-to-text, multilingual)
// ─────────────────────────────────────────────────────────────────────────────

/// Wraps SFSpeechRecognizer for live dictation into a text field.
@MainActor
final class VoiceInputManager: ObservableObject {
    @Published var isRecording = false
    @Published var permissionDenied = false

    private var recognizer: SFSpeechRecognizer?
    private var audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var onResult: ((String) -> Void)?

    /// Call this passing the current app language locale string (e.g. "en-US", "es-MX").
    func start(locale: String, appending target: Binding<String>, onResult: @escaping (String) -> Void) {
        self.onResult = onResult
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self else { return }
                if status != .authorized {
                    self.permissionDenied = true
                    return
                }
                self.beginRecording(locale: locale, target: target)
            }
        }
    }

    func stop() {
        audioEngine.stop()
        request?.endAudio()
        task?.cancel()
        isRecording = false
    }

    private func beginRecording(locale: String, target: Binding<String>) {
        recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale))
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        self.request = req

        let node = audioEngine.inputNode
        let format = node.outputFormat(forBus: 0)
        node.installTap(onBus: 0, bufferSize: 1024, format: format) { buf, _ in
            req.append(buf)
        }

        do {
            try AVAudioSession.sharedInstance().setCategory(.record, mode: .measurement, options: .duckOthers)
            try AVAudioSession.sharedInstance().setActive(true, options: .notifyOthersOnDeactivation)
            try audioEngine.start()
        } catch {
            return
        }

        isRecording = true
        task = recognizer?.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let res = result {
                DispatchQueue.main.async {
                    let transcribed = res.bestTranscription.formattedString
                    self.onResult?(transcribed)
                }
            }
            if error != nil || result?.isFinal == true {
                DispatchQueue.main.async { self.stop() }
            }
        }
    }
}

/// A mic button that initiates speech-to-text and appends the result to a Binding<String>.
struct VoiceMicButton: View {
    @Binding var text: String
    let locale: String          // e.g. "en-US", "es-MX"
    @StateObject private var vm = VoiceInputManager()

    var body: some View {
        Button {
            if vm.isRecording {
                vm.stop()
            } else {
                vm.start(locale: locale, appending: $text) { transcribed in
                    text = transcribed
                }
            }
        } label: {
            Image(systemName: vm.isRecording ? "mic.fill" : "mic")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(vm.isRecording ? Theme.danger : Theme.accent)
                .frame(width: 38, height: 38)
                .background(
                    (vm.isRecording ? Theme.danger : Theme.accent).opacity(0.12),
                    in: Circle()
                )
                .overlay(
                    vm.isRecording
                        ? Circle().strokeBorder(Theme.danger.opacity(0.4), lineWidth: 1.5)
                        : nil
                )
        }
        .buttonStyle(.plain)
        .alert(Text("voice.mic_access.title"), isPresented: $vm.permissionDenied) {
            Button("settings.title") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            Button(L10n.CommonKey.cancel, role: .cancel) {}
        } message: {
            Text("voice.mic_access.message")
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - Safety Timer + SOS
// ─────────────────────────────────────────────────────────────────────────────

/// Full-screen safety timer for high-risk local jobs.
/// The user sets a duration; if it expires without being dismissed, an SOS alert fires.
struct SafetyTimerView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var localization: LocalizationManager
    @StateObject private var vm = SafetyTimerViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {

                    // Header
                    VStack(spacing: 8) {
                        Image(systemName: "shield.fill")
                            .font(.system(size: 42, weight: .bold))
                            .foregroundStyle(vm.isRunning ? Theme.success : Theme.accent)
                        Text("safety.timer.title")
                            .font(.system(size: 22, weight: .heavy)).foregroundStyle(Theme.textPrimary)
                        Text("safety.timer.subtitle")
                            .font(.system(size: 13)).foregroundStyle(Theme.textSecondary)
                            .multilineTextAlignment(.center).padding(.horizontal, 24)
                    }
                    .padding(.top, 16)

                    // Timer ring
                    ZStack {
                        Circle().stroke(Theme.surfaceElevated, lineWidth: 14)
                        Circle()
                            .trim(from: 0, to: vm.progress)
                            .stroke(vm.isExpired ? Theme.danger : Theme.success,
                                    style: StrokeStyle(lineWidth: 14, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 1), value: vm.progress)
                        VStack(spacing: 4) {
                            Text(vm.timeString)
                                .font(.system(size: 36, weight: .heavy, design: .monospaced))
                                .foregroundStyle(vm.isExpired ? Theme.danger : Theme.textPrimary)
                            Text(vm.isExpired
                                 ? "safety.timer.status.check_in_now"
                                 : (vm.isRunning ? "safety.timer.status.remaining" : "safety.timer.status.timer"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .frame(width: 180, height: 180)

                    // Duration picker (only when stopped)
                    if !vm.isRunning {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("safety.timer.duration").sectionTitle()
                            Picker("", selection: $vm.selectedMinutes) {
                                ForEach([15, 30, 45, 60, 90, 120], id: \.self) {
                                    Text(localization.format("%d min", $0)).tag($0)
                                }
                            }
                            .pickerStyle(.segmented)
                        }
                        .cardStyle()
                    }

                    // Emergency contact
                    VStack(alignment: .leading, spacing: 10) {
                        Text("safety.timer.emergency_contact").sectionTitle()
                        OxTextField(title: "Name", text: $vm.contactName)
                        OxTextField(title: "Phone", text: $vm.contactPhone, keyboard: .phonePad)
                        if vm.locationEnabled {
                            HStack(spacing: 6) {
                                Image(systemName: "location.fill").foregroundStyle(Theme.success).font(.system(size: 12))
                                Text("safety.timer.location_sharing_active").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.success)
                            }
                        }
                    }
                    .cardStyle()

                    // Action buttons
                    VStack(spacing: 12) {
                        if vm.isRunning {
                            Button { vm.checkIn() } label: {
                                Label("safety.timer.check_in", systemImage: "checkmark.shield.fill")
                                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                                    .background(Theme.success, in: RoundedRectangle(cornerRadius: 14))
                            }
                            Button(role: .destructive) { vm.triggerSOS() } label: {
                                Label("safety.timer.send_sos_now", systemImage: "sos")
                                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                                    .background(Theme.danger, in: RoundedRectangle(cornerRadius: 14))
                            }
                        } else {
                            Button { vm.start() } label: {
                                Label("safety.timer.start", systemImage: "timer")
                                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                    .frame(maxWidth: .infinity).padding(.vertical, 16)
                                    .background(Theme.accent, in: RoundedRectangle(cornerRadius: 14))
                            }
                            .disabled(vm.contactName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                    }
                    .padding(.bottom, 24)
                }
                .padding(.horizontal, 20)
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text("safety.timer.title"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Theme.background, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("common.close") { vm.stop(); dismiss() }.foregroundStyle(Theme.accent)
                }
            }
        }
        .alert(Text("safety.timer.expired.title"), isPresented: $vm.showExpiredAlert) {
            Button("safety.timer.i_am_safe") { vm.checkIn() }
            Button("safety.timer.send_sos", role: .destructive) { vm.triggerSOS() }
        } message: {
            Text("safety.timer.expired.message")
        }
        .alert(Text("safety.timer.sos_sent.title"), isPresented: $vm.showSOSConfirmation) {
            Button("common.ok", role: .cancel) {}
        } message: {
            Text(localization.format("safety.timer.sos_sent.message_format", vm.contactName))
        }
    }
}

@MainActor
final class SafetyTimerViewModel: ObservableObject {
    @Published var selectedMinutes: Int = 60

    // Persisted emergency contact — survives app restarts
    @Published var contactName: String {
        didSet { UserDefaults.standard.set(contactName, forKey: "ox.safety.contactName") }
    }
    @Published var contactPhone: String {
        didSet { UserDefaults.standard.set(contactPhone, forKey: "ox.safety.contactPhone") }
    }

    @Published var isRunning: Bool = false
    @Published var isExpired: Bool = false
    @Published var progress: Double = 1.0
    @Published var locationEnabled: Bool = false
    @Published var showExpiredAlert: Bool = false
    @Published var showSOSConfirmation: Bool = false

    private var total: TimeInterval = 0
    private var remaining: TimeInterval = 0
    private var timer: Timer?
    private let locationManager = CLLocationManager()
    private var lastLocation: CLLocation?

    init() {
        contactName  = UserDefaults.standard.string(forKey: "ox.safety.contactName")  ?? ""
        contactPhone = UserDefaults.standard.string(forKey: "ox.safety.contactPhone") ?? ""
    }

    var timeString: String {
        let m = Int(remaining) / 60
        let s = Int(remaining) % 60
        return String(format: "%02d:%02d", m, s)
    }

    func start() {
        total     = TimeInterval(selectedMinutes * 60)
        remaining = total
        isRunning = true
        isExpired = false
        progress  = 1.0
        requestLocation()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
    }

    func stop() {
        timer?.invalidate(); timer = nil
        isRunning = false
    }

    func checkIn() {
        stop()
        isExpired = false
        progress  = 1.0
        showExpiredAlert = false
    }

    func triggerSOS() {
        stop()
        showExpiredAlert = false
        // Post to server so backend can trigger SMS/email to the emergency contact.
        Task {
            struct Req: Encodable {
                let contact_name: String
                let contact_phone: String
                let latitude: Double?
                let longitude: Double?
            }
            let req = Req(
                contact_name: contactName,
                contact_phone: contactPhone,
                latitude: lastLocation?.coordinate.latitude,
                longitude: lastLocation?.coordinate.longitude
            )
            _ = try? await APIClient.shared.request(
                "/api/safety/sos",
                method: .POST,
                body: req,
                as: OkResponse.self
            )
        }
        showSOSConfirmation = true
    }

    private func tick() {
        remaining -= 1
        progress = max(0, remaining / total)
        if remaining <= 0 {
            timer?.invalidate(); timer = nil
            isExpired = true
            showExpiredAlert = true
        }
    }

    private func requestLocation() {
        locationManager.requestWhenInUseAuthorization()
        locationEnabled = locationManager.authorizationStatus == .authorizedWhenInUse
                       || locationManager.authorizationStatus == .authorizedAlways
    }
}

/// A compact shield button shown in job detail & chat nav bar to open the safety timer.
struct SafetyTimerButton: View {
    @State private var show = false
    var body: some View {
        Button { show = true } label: {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.success)
        }
        .sheet(isPresented: $show) {
            SafetyTimerView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
                .presentationBackground(Theme.background)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK: - ID Verification Badge Row
// ─────────────────────────────────────────────────────────────────────────────

/// Shows a row of trust badges on a helper profile.
struct IDVerificationBadges: View {
    /// Model populated from the helper's profile detail.
    struct Badges {
        var backgroundCheck: Bool = false
        var idVerified: Bool      = false
        var licenseVerified: Bool = false
        var insuranceVerified: Bool = false
    }
    let badges: Badges

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Verified credentials").sectionTitle()
            HStack(spacing: 10) {
                badge("ID", "person.badge.shield.checkmark.fill",
                      active: badges.idVerified)
                badge("Background", "checkmark.seal.fill",
                      active: badges.backgroundCheck)
                badge("License", "doc.badge.gearshape.fill",
                      active: badges.licenseVerified)
                badge("Insured", "umbrella.fill",
                      active: badges.insuranceVerified)
            }
        }
        .cardStyle()
    }

    private func badge(_ label: String, _ icon: String, active: Bool) -> some View {
        VStack(spacing: 5) {
            Image(systemName: icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(active ? Theme.success : Theme.textTertiary)
                .frame(width: 40, height: 40)
                .background(
                    (active ? Theme.success : Theme.surfaceElevated).opacity(0.18),
                    in: RoundedRectangle(cornerRadius: 12)
                )
            Text(label)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(active ? Theme.success : Theme.textTertiary)
                .textCase(.uppercase)
                .tracking(0.5)
        }
        .frame(maxWidth: .infinity)
    }
}

// Safety alert uses `POST /api/safety/sos` directly from the view model.
