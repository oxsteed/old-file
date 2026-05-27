import SwiftUI

struct HomeHero: View {
    let persona: AppPersona
    let name: String
    let onSwitchPersona: () -> Void

    private var greeting: String {
        let hour = Calendar.current.component(.hour, from: Date())
        switch hour {
        case 5..<12:  return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<22: return "Good evening"
        default:      return "Hello"
        }
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            backgroundLayer
            content
        }
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .shadow(color: persona.tint.opacity(0.18), radius: 14, x: 0, y: 8)
    }

    private var backgroundLayer: some View {
        ZStack {
            LinearGradient(
                colors: [persona.tint.opacity(0.95), persona.tint.opacity(0.65), OneTheme.ember.opacity(0.55)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            Circle()
                .fill(.white.opacity(0.10))
                .frame(width: 240, height: 240)
                .offset(x: 120, y: -120)
            Circle()
                .fill(.white.opacity(0.08))
                .frame(width: 160, height: 160)
                .offset(x: -110, y: 90)
        }
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("OxSteed One")
                    .font(.caption.weight(.bold))
                    .tracking(1.2)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(.white.opacity(0.18), in: Capsule())
                Spacer()
                Button(action: onSwitchPersona) {
                    HStack(spacing: 6) {
                        Image(systemName: persona.icon)
                        Text(persona.displayName)
                        Image(systemName: "chevron.down")
                            .font(.caption.weight(.bold))
                    }
                    .font(.footnote.weight(.semibold))
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.white.opacity(0.22), in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .foregroundStyle(.white)

            VStack(alignment: .leading, spacing: 4) {
                Text("\(greeting), \(name)")
                    .font(.system(.title2, design: .rounded, weight: .bold))
                Text(persona.tagline)
                    .font(.subheadline)
                    .opacity(0.92)
            }
            .foregroundStyle(.white)
            .padding(.top, 4)

            HStack(spacing: 10) {
                HeroChip(icon: "bolt.fill", label: "3 quick wins")
                HeroChip(icon: "calendar", label: "2 today")
            }
            .padding(.top, 2)
        }
        .padding(18)
    }
}

private struct HeroChip: View {
    let icon: String
    let label: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
            Text(label)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 12).padding(.vertical, 7)
        .background(.white.opacity(0.18), in: Capsule())
    }
}
