import SwiftUI

struct ShopView: View {
    @Environment(OneStore.self) private var store

    var body: some View {
        GoScreen(title: "Growth", showsTitle: true) {
            GoCard {
                Text("Economic Mobility Ladder")
                    .font(.headline)
                Text("Skill → Side Income → Licensed Business → Scaled Operation")
                    .font(.footnote)
                    .foregroundStyle(OneTheme.muted)
            }

            GoCard {
                growthItem("Business Ascension", "Apply to move from side work to licensed operation.", "arrow.up.right.circle.fill")
                growthItem("Community Wholesale Groups", "Join neighborhood bulk-buy campaigns.", "person.3.fill")
                growthItem("Financing Pre-Qualification", "Micro-loans, equipment, and startup financing pathways.", "banknote.fill")
                growthItem("Grants & Subsidies", "Location-aware opportunities for your trade.", "doc.badge.gearshape.fill")
            }

            GoCard {
                Text("Progress Tracker")
                    .font(.headline)
                HStack {
                    ForEach(["Skill", "Side Income", "Licensed Business", "Scaled Operation"], id: \.self) { step in
                        Text(step)
                            .font(.caption.weight(step == store.growthProgressStep ? .bold : .regular))
                            .foregroundStyle(step == store.growthProgressStep ? OneTheme.amber : OneTheme.muted)
                    }
                }
                Picker("Current Step", selection: Binding(
                    get: { store.growthProgressStep },
                    set: { store.growthProgressStep = $0 }
                )) {
                    Text("Skill").tag("Skill")
                    Text("Side Income").tag("Side Income")
                    Text("Licensed Business").tag("Licensed Business")
                    Text("Scaled Operation").tag("Scaled Operation")
                }
            }

            GoCard {
                Text("Tax Document Center")
                    .font(.headline)
                Text("Annual 1099-style summary and deductible tracking.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
                ForEach(store.taxDocuments) { doc in
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Tax Year \(doc.year)")
                            .font(.subheadline.weight(.semibold))
                        Text("Gross: \(currency(doc.grossIncome)) · Deductions: \(currency(doc.deductibleExpenses))")
                            .font(.caption)
                            .foregroundStyle(OneTheme.muted)
                    }
                    .padding(.vertical, 3)
                }
            }

            GoCard {
                Text("Voice Input")
                    .font(.headline)
                Toggle("Enable voice input for posting and chat", isOn: Binding(
                    get: { store.voiceInputEnabled },
                    set: { store.voiceInputEnabled = $0 }
                ))
                Text("Language-aware dictation path follows selected app language.")
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
        }
    }

    private func growthItem(_ title: String, _ detail: String, _ icon: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(OneTheme.amber)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(OneTheme.muted)
            }
        }
        .padding(.vertical, 4)
    }

    private func currency(_ value: Double) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = store.activeLocale
        return formatter.string(from: NSNumber(value: value)) ?? "$0"
    }
}
