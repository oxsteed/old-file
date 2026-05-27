import SwiftUI

struct LearnTabView: View {
    private let columns = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                header
                heroCard
                searchBar

                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Start here", actionLabel: nil)
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(Samples.courses.prefix(4)) { CourseCard(course: $0) }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    SectionHeader(title: "Trending in your area", actionLabel: "See all")
                    VStack(spacing: 10) {
                        ForEach(Samples.courses.suffix(3)) { CourseRow(course: $0) }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .background(Theme.background.ignoresSafeArea())
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("LEARN").sectionTitle()
                Text("Learn. Do. Earn.")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
            }
            Spacer()
        }
    }

    private var heroCard: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                Text("LEARN MODE").sectionTitle()
                Text("Skill → kit → income")
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundStyle(Theme.textPrimary)
                Text("Watch a short guide, see the tool kit, then list as a service or do it yourself.")
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer(minLength: 0)
            VStack(alignment: .leading, spacing: 6) {
                step(1, "Learn a skill")
                step(2, "Do it yourself")
                step(3, "List as service")
                step(4, "Grow your business")
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 20)
                .fill(LinearGradient(colors: [Theme.surface, Theme.accentSoft],
                                     startPoint: .leading, endPoint: .trailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(Theme.stroke, lineWidth: 1))
    }

    private func step(_ n: Int, _ s: String) -> some View {
        HStack(spacing: 8) {
            Text("\(n)")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 18, height: 18)
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 5))
            Text(s).font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.textSecondary)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.textTertiary)
            Text("Search guides… (faucet, drywall, oil change)")
                .font(.system(size: 13))
                .foregroundStyle(Theme.textTertiary)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 14)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct CourseCard: View {
    let course: LearnCourse
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: course.icon).foregroundStyle(course.color).font(.system(size: 14, weight: .bold))
                Text(course.category.uppercased())
                    .font(.system(size: 10, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(course.color)
            }
            Text(course.title)
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(2)
            Spacer(minLength: 6)
            HStack(spacing: 8) {
                Text(course.level).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.success)
                Text("•").foregroundStyle(Theme.textTertiary)
                Label(course.duration, systemImage: "clock")
                    .font(.system(size: 10))
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 130, alignment: .topLeading)
        .padding(14)
        .background(
            RoundedRectangle(cornerRadius: 18)
                .fill(LinearGradient(colors: [course.color.opacity(0.18), Theme.surface],
                                     startPoint: .topLeading, endPoint: .bottomTrailing))
        )
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}

private struct CourseRow: View {
    let course: LearnCourse
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: course.icon)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(course.color)
                .frame(width: 44, height: 44)
                .background(course.color.opacity(0.16), in: RoundedRectangle(cornerRadius: 12))
            VStack(alignment: .leading, spacing: 3) {
                Text(course.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Theme.textPrimary)
                Text("\(course.category) • \(course.duration) • \(course.level)")
                    .font(.system(size: 11)).foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            Image(systemName: "play.fill").foregroundStyle(Theme.accent)
        }
        .padding(12)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.stroke, lineWidth: 1))
    }
}
