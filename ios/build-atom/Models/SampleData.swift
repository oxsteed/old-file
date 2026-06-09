import SwiftUI

struct JobItem: Identifiable {
    let id = UUID()
    let title: String
    let category: String
    let status: String
    let statusColor: Color
    let helper: String
    let amount: String
    let timeLabel: String
}

struct AvailableJob: Identifiable {
    let id = UUID()
    let title: String
    let distance: String
    let payout: String
    let postedAgo: String
    let tags: [String]
}

struct MessageThread: Identifiable {
    let id = UUID()
    let name: String
    let initials: String
    let preview: String
    let timeAgo: String
    let unread: Int
    let tint: Color
}

struct TeamMember: Identifiable {
    let id = UUID()
    let name: String
    let role: String
    let status: String
    let statusColor: Color
    let initials: String
}

struct PulsePillar: Identifiable {
    let id = UUID()
    let name: String
    let score: Int
    let weight: Int
    let color: Color
    let icon: String
    let topItem: String
    let deadline: String
}

struct GrowthStep: Identifiable {
    let id = UUID()
    let stage: String
    let title: String
    let description: String
    let progress: Double
    let isActive: Bool
    /// Tab name to switch to when the step row is tapped ("home","life","learn","growth").
    var tapTab: String? = nil
}

struct LearnCourse: Identifiable {
    let id = UUID()
    let title: String
    let category: String
    let duration: String
    let level: String
    let color: Color
    let icon: String
}

enum Samples {
    static let customerJobs: [JobItem] = [
        .init(title: "Fix leaky kitchen faucet", category: "Plumbing", status: "In Progress", statusColor: Theme.accent, helper: "Emile R.", amount: "$120", timeLabel: "Today, 2:30 PM"),
        .init(title: "Bi-weekly lawn care", category: "Yard Work", status: "Matched", statusColor: Theme.pillarHome, helper: "Marcus T.", amount: "$45", timeLabel: "Fri, 9:00 AM"),
        .init(title: "Move 2BR apartment", category: "Moving", status: "Open · 3 bids", statusColor: Theme.warning, helper: "—", amount: "$280 est.", timeLabel: "Sat, all day"),
        .init(title: "Deep clean before guests", category: "Cleaning", status: "Completed", statusColor: Theme.success, helper: "Lina P.", amount: "$180", timeLabel: "Last week")
    ]

    static let helperJobs: [AvailableJob] = [
        .init(title: "Replace bathroom vanity", distance: "0.8 mi", payout: "$240", postedAgo: "12 min ago", tags: ["Plumbing", "Same day"]),
        .init(title: "Mount 65\" TV + cable hide", distance: "1.4 mi", payout: "$95", postedAgo: "32 min ago", tags: ["Handyman"]),
        .init(title: "Pressure wash driveway", distance: "2.1 mi", payout: "$140", postedAgo: "1 hr ago", tags: ["Outdoor", "Tools provided"]),
        .init(title: "Assemble IKEA wardrobe", distance: "3.0 mi", payout: "$80", postedAgo: "2 hr ago", tags: ["Assembly"])
    ]

    static let messages: [MessageThread] = [
        .init(name: "Emile R.", initials: "ER", preview: "On my way — should be there by 2:30.", timeAgo: "4m", unread: 1, tint: Theme.accent),
        .init(name: "Marcus T.", initials: "MT", preview: "Friday confirmed. I'll bring my own mower.", timeAgo: "1h", unread: 0, tint: Theme.pillarHome),
        .init(name: "Lina P.", initials: "LP", preview: "Thanks for the 5-star review!", timeAgo: "2d", unread: 0, tint: Theme.pillarPersonal)
    ]

    static let team: [TeamMember] = [
        .init(name: "Marcus Taylor", role: "Lead Helper", status: "On job · Hilltop", statusColor: Theme.success, initials: "MT"),
        .init(name: "Lina Park", role: "Cleaner", status: "Available", statusColor: Theme.success, initials: "LP"),
        .init(name: "Jared Cole", role: "Apprentice", status: "Off today", statusColor: Theme.textTertiary, initials: "JC"),
        .init(name: "Sara Nguyen", role: "Dispatcher", status: "In office", statusColor: Theme.pillarHome, initials: "SN")
    ]

    static let pillars: [PulsePillar] = [
        .init(name: "Money", score: 78, weight: 25, color: Theme.pillarMoney, icon: "dollarsign.circle.fill",
              topItem: "You'll be short $120 on Jun 3", deadline: "in 9 days"),
        .init(name: "Home Care", score: 64, weight: 20, color: Theme.pillarHome, icon: "house.fill",
              topItem: "HVAC filter swap overdue", deadline: "12 days late"),
        .init(name: "Car Care", score: 82, weight: 20, color: Theme.pillarCar, icon: "car.fill",
              topItem: "Oil change in 400 mi", deadline: "~12 days"),
        .init(name: "Personal", score: 71, weight: 15, color: Theme.pillarPersonal, icon: "heart.fill",
              topItem: "Dentist appt to book", deadline: "this month"),
        .init(name: "Goals", score: 55, weight: 10, color: Theme.pillarGoals, icon: "target",
              topItem: "Finish HVAC certification", deadline: "6 weeks"),
        .init(name: "Sinking Funds", score: 69, weight: 10, color: Theme.pillarSinking, icon: "banknote.fill",
              topItem: "Christmas gifts — $23/wk", deadline: "by Dec 1")
    ]

    static let growthLadder: [GrowthStep] = [
        .init(stage: "Step 1", title: "Build a skill", description: "5–15 min daily lessons in the Learn tab.", progress: 1.0, isActive: false),
        .init(stage: "Step 2", title: "Side income", description: "Take your first 5 jobs as a Helper.", progress: 0.6, isActive: true),
        .init(stage: "Step 3", title: "Licensed business", description: "Business Ascension Application — get insured, branded, and bookable.", progress: 0.15, isActive: false),
        .init(stage: "Step 4", title: "Scaled operation", description: "Hire a team, dispatch jobs, qualify for equipment financing.", progress: 0.0, isActive: false)
    ]

    static let courses: [LearnCourse] = [
        .init(title: "Fix a Leaky Faucet", category: "Plumbing", duration: "8 min", level: "Easy", color: Theme.pillarHome, icon: "drop.fill"),
        .init(title: "Reset a GFCI Outlet", category: "Electrical", duration: "5 min", level: "Easy", color: Theme.pillarCar, icon: "bolt.fill"),
        .init(title: "Replace HVAC Filter", category: "HVAC", duration: "10 min", level: "Easy", color: Theme.pillarSinking, icon: "thermometer.medium"),
        .init(title: "Inspect an Investment Property", category: "Management", duration: "12 min", level: "Medium", color: Theme.pillarGoals, icon: "doc.text.magnifyingglass"),
        .init(title: "Basic Bookkeeping", category: "Business", duration: "15 min", level: "Medium", color: Theme.pillarMoney, icon: "chart.bar.fill"),
        .init(title: "Customer Service 101", category: "Soft Skills", duration: "9 min", level: "Easy", color: Theme.pillarPersonal, icon: "person.2.fill")
    ]
}
