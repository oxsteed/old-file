import SwiftUI

struct HireView: View {
    @Environment(GoStore.self) private var store

    var body: some View {
        @Bindable var store = store

        GoScreen(title: "Hire") {
            GoCard {
                Label("Quick Job Draft", systemImage: "square.and.pencil")
                    .font(.title2.bold())
                Text("A lightweight native version of the website post-job flow. This is designed for fast capture, then the full backend contract can enrich photos, budgets, skills, and scheduling.")
                    .foregroundStyle(.secondary)
            }

            GoCard {
                TextField("What do you need done?", text: $store.draftJob.title)
                    .textFieldStyle(.roundedBorder)
                TextField("Category", text: $store.draftJob.category)
                    .textFieldStyle(.roundedBorder)
                TextField("City", text: $store.draftJob.city)
                    .textFieldStyle(.roundedBorder)
                HStack {
                    TextField("State", text: $store.draftJob.state)
                        .textFieldStyle(.roundedBorder)
                    TextField("ZIP", text: $store.draftJob.zip)
                        .textFieldStyle(.roundedBorder)
                }
                Picker("Urgency", selection: $store.draftJob.urgency) {
                    Text("Flexible").tag("Flexible")
                    Text("This week").tag("This week")
                    Text("ASAP").tag("ASAP")
                }
                .pickerStyle(.segmented)
                Picker("Budget", selection: $store.draftJob.budgetType) {
                    Text("Open").tag("open")
                    Text("Fixed").tag("fixed")
                    Text("Hourly").tag("hourly")
                }
                .pickerStyle(.segmented)
                HStack {
                    TextField("Min budget", text: $store.draftJob.budgetMin)
                        .textFieldStyle(.roundedBorder)
                    TextField("Max budget", text: $store.draftJob.budgetMax)
                        .textFieldStyle(.roundedBorder)
                }
                TextField("Required skill", text: $store.draftJob.requiredSkill)
                    .textFieldStyle(.roundedBorder)
                TextField("Preferred helper ID", text: $store.draftJob.preferredHelperId)
                    .textFieldStyle(.roundedBorder)
                TextField("Scheduled date YYYY-MM-DD", text: $store.draftJob.scheduledDate)
                    .textFieldStyle(.roundedBorder)
                TextField("Photo note or upload reminder", text: $store.draftJob.photoNote)
                    .textFieldStyle(.roundedBorder)
                TextField("Describe the work", text: $store.draftJob.details, axis: .vertical)
                    .lineLimit(4...8)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task {
                        await store.submitJobOrQueue()
                    }
                } label: {
                    Label(store.isSignedIn ? "Post Job" : "Save Offline Draft", systemImage: store.isSignedIn ? "paperplane.fill" : "tray.and.arrow.down")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(GoTheme.amber)

                if let message = store.savedJobMessage {
                    Text(message)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(message.hasPrefix("Saved") ? .green : .red)
                }
            }

            GoCard {
                Label("Suggested next", systemImage: "sparkles")
                    .font(.headline)
                Text("This native flow now captures the core website post-job fields: category, location, urgency, budget, skill hint, preferred helper, schedule, and media reminder.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}
