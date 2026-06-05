import SwiftUI

enum Persona: String, CaseIterable, Identifiable {
    case customer = "Customer"
    case helper = "Helper"
    case business = "Business Owner"
    case consultant = "Consultant"
    case toolOwner = "Tool Owner"
    case franchise = "Franchise Owner"
    case investor = "Investor"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .customer: return "house.and.flag.fill"
        case .helper: return "wrench.and.screwdriver.fill"
        case .business: return "briefcase.fill"
        case .consultant: return "person.bubble.fill"
        case .toolOwner: return "hammer.fill"
        case .franchise: return "building.2.fill"
        case .investor: return "chart.line.uptrend.xyaxis"
        }
    }

    var tagline: String {
        switch self {
        case .customer: return "Get help when you need it"
        case .helper: return "Turn skills into local work"
        case .business: return "Run and scale your operation"
        case .consultant: return "Onboard and serve clients"
        case .toolOwner: return "Rent out your tool inventory"
        case .franchise: return "Manage your territory"
        case .investor: return "Track your portfolio"
        }
    }

    var color: Color {
        switch self {
        case .customer: return Theme.pillarHome
        case .helper: return Theme.accent
        case .business: return Theme.pillarGoals
        case .consultant: return Theme.pillarPersonal
        case .toolOwner: return Theme.pillarCar
        case .franchise: return Theme.pillarSinking
        case .investor: return Theme.pillarMoney
        }
    }
}

struct PersonaLoopSignal: Identifiable {
    let id: String
    let tab: String
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
}

struct PersonaTabAction: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let icon: String
    let color: Color
    let targetTab: String?
    let learnCategory: String?

    init(
        id: String,
        title: String,
        subtitle: String,
        icon: String,
        color: Color,
        targetTab: String? = nil,
        learnCategory: String? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.color = color
        self.targetTab = targetTab
        self.learnCategory = learnCategory
    }
}

struct PersonaLoopNudge: Identifiable {
    let id: String
    let sourceTab: String
    let targetTab: String
    let actionName: String?
    let eyebrow: String
    let title: String
    let subtitle: String
    let cta: String
    let icon: String
    let color: Color
}

struct PersonaCalibrationOption: Identifiable {
    let id: String
    let title: String
    let unlock: String
    let icon: String
    let color: Color
}

enum PersonaSetupSignalKind: String {
    case context
    case style
}

struct PersonaSetupSignalOption: Identifiable {
    let id: String
    let title: String
    let unlock: String
    let icon: String
    let color: Color
}

struct BusinessRoleSetupOption: Identifiable {
    let id: String
    let title: String
    let detail: String
    let icon: String
}

enum BusinessSubPersona: String, CaseIterable, Identifiable {
    case owner = "Owner / Operator"
    case manager = "Manager"
    case representative = "Representative"
    case support = "Chat Support Agent"
    case employee = "Employee"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .owner: return "briefcase.fill"
        case .manager: return "person.3.fill"
        case .representative: return "person.crop.circle.badge.checkmark"
        case .support: return "headphones"
        case .employee: return "checklist.checked"
        }
    }

    var color: Color {
        switch self {
        case .owner: return Theme.pillarGoals
        case .manager: return Theme.pillarMoney
        case .representative: return Theme.success
        case .support: return Theme.accent
        case .employee: return Theme.pillarHome
        }
    }

    var tagline: String {
        switch self {
        case .owner:
            return "Owns the operation, quality, and growth system."
        case .manager:
            return "Oversees schedules, task completion, and quality flags."
        case .representative:
            return "Runs leads, follow-ups, intake, and conversion."
        case .support:
            return "Handles tickets, escalations, scripts, and recovery."
        case .employee:
            return "Works assigned tasks, SOPs, and training paths."
        }
    }

    var setupQuestion: String {
        switch self {
        case .owner:
            return "What should the owner dashboard stabilize first?"
        case .manager:
            return "How many team members are you overseeing?"
        case .representative:
            return "What's your main sales activity?"
        case .support:
            return "What types of issues do you most often handle?"
        case .employee:
            return "What's your primary role on the team?"
        }
    }

    var setupActivation: String {
        switch self {
        case .owner:
            return "Activates the operations dashboard, hiring/program prompts, and owner QA training."
        case .manager:
            return "Activates team schedule view, QA checklists, and shift management in Home and Learn."
        case .representative:
            return "Activates lead pipeline, follow-up queue, intake forms, and sales playbooks."
        case .support:
            return "Activates scripts library, escalation queue, and response templates in Learn."
        case .employee:
            return "Activates task queue, SOP library, role basics, and advancement training paths."
        }
    }

    var setupOptions: [BusinessRoleSetupOption] {
        switch self {
        case .owner:
            return [
                .init(id: "owner-operations", title: "Operations health", detail: "Jobs, quality, fulfillment, and team risk lead.", icon: "briefcase.fill"),
                .init(id: "owner-team", title: "Team quality", detail: "Manager, QA, and training setup move forward.", icon: "person.3.fill"),
                .init(id: "owner-growth", title: "Revenue growth", detail: "Hiring, programs, wholesale, and compliance get priority.", icon: "arrow.up.right.circle.fill")
            ]
        case .manager:
            return [
                .init(id: "manager-small", title: "2-5 people", detail: "Keep schedule, handoffs, and basic QA visible.", icon: "person.2.fill"),
                .init(id: "manager-mid", title: "6-15 people", detail: "Prioritize shift coverage, task completion, and reporting.", icon: "person.3.fill"),
                .init(id: "manager-growing", title: "More than 15", detail: "Focus on manager coverage, standards, and escalation paths.", icon: "building.2.fill")
            ]
        case .representative:
            return [
                .init(id: "rep-inbound", title: "Inbound", detail: "Lead intake, response speed, and follow-up queue lead.", icon: "tray.and.arrow.down.fill"),
                .init(id: "rep-outbound", title: "Outbound", detail: "Prospecting, scripts, and outreach cadence come first.", icon: "paperplane.fill"),
                .init(id: "rep-both", title: "Both", detail: "Balance intake, outreach, CRM hygiene, and conversion prompts.", icon: "arrow.left.arrow.right")
            ]
        case .support:
            return [
                .init(id: "support-scheduling", title: "Scheduling", detail: "Use reschedule scripts, reminders, and escalation rules.", icon: "calendar.badge.clock"),
                .init(id: "support-payments", title: "Payments", detail: "Prioritize billing, refund, and dispute response templates.", icon: "creditcard.fill"),
                .init(id: "support-quality", title: "Quality issues", detail: "Surface empathy scripts, evidence capture, and recovery paths.", icon: "checkmark.shield.fill")
            ]
        case .employee:
            return [
                .init(id: "employee-field", title: "Field work", detail: "Assigned jobs, SOPs, and quality standards lead.", icon: "hammer.fill"),
                .init(id: "employee-admin", title: "Admin", detail: "Task queue, paperwork, reminders, and handoffs stay close.", icon: "doc.text.fill"),
                .init(id: "employee-trainee", title: "Training path", detail: "Role basics, badges, and advancement steps come first.", icon: "graduationcap.fill")
            ]
        }
    }

    var firstValueTitle: String {
        switch self {
        case .owner: return "Your operations dashboard is staged"
        case .manager: return "Your manager workspace is staged"
        case .representative: return "Your lead pipeline is staged"
        case .support: return "Your support queue is staged"
        case .employee: return "Your team task view is staged"
        }
    }

    var firstValueSubtitle: String {
        switch self {
        case .owner:
            return "Team activity, quality checks, and hiring programs become the core loop."
        case .manager:
            return "Team schedule, task completion, quality flags, and shift handoffs lead."
        case .representative:
            return "Leads, follow-ups, intake forms, and conversion prompts come first."
        case .support:
            return "Active tickets, scripts, escalation paths, and service recovery stay close."
        case .employee:
            return "Assigned work, SOPs, shift basics, and advancement training stay visible."
        }
    }

    var homePreviewTitle: String {
        switch self {
        case .owner: return "Business Owner Home preview"
        case .manager: return "Manager Home preview"
        case .representative: return "Representative Home preview"
        case .support: return "Chat Support Home preview"
        case .employee: return "Employee Home preview"
        }
    }

    var loopSignals: [PersonaLoopSignal] {
        switch self {
        case .owner:
            return [
                .init(id: "business-owner-home", tab: "Home", title: "Operations health", subtitle: "Team activity, open jobs, fulfillment flags, and inbox issues lead.", icon: "briefcase.fill", color: Theme.pillarGoals),
                .init(id: "business-owner-growth", tab: "Growth", title: "Scale programs", subtitle: "Hiring, wholesale, compliance, and revenue expansion surface next.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "business-owner-learn", tab: "Learn", title: "Train the team", subtitle: "SOPs, QA checklists, scripts, and delegation paths stay close.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "business-owner-life", tab: "Life", title: "Operator stability", subtitle: "Personal money and routines support business continuity.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        case .manager:
            return [
                .init(id: "business-manager-home", tab: "Home", title: "Team schedule", subtitle: "Shifts, task completion, quality flags, and handoffs lead.", icon: "person.3.fill", color: Theme.pillarMoney),
                .init(id: "business-manager-learn", tab: "Learn", title: "QA and scheduling", subtitle: "Scheduling, conflict resolution, reporting, and QA standards stay close.", icon: "clipboard.fill", color: Theme.accent),
                .init(id: "business-manager-growth", tab: "Growth", title: "Manager coverage", subtitle: "Move repeatable work into team systems and stronger manager coverage.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "business-manager-life", tab: "Life", title: "Manager capacity", subtitle: "Personal cadence and energy protect team follow-through.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        case .representative:
            return [
                .init(id: "business-rep-home", tab: "Home", title: "Lead pipeline", subtitle: "Inbound, outbound, follow-ups, and intake forms lead.", icon: "person.crop.circle.badge.checkmark", color: Theme.success),
                .init(id: "business-rep-growth", tab: "Growth", title: "Conversion ladder", subtitle: "Move prospects into service agreements and recurring revenue.", icon: "arrow.up.right.circle.fill", color: Theme.pillarGoals),
                .init(id: "business-rep-learn", tab: "Learn", title: "Outreach playbook", subtitle: "Intake, outreach, objections, and CRM hygiene stay close.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "business-rep-life", tab: "Life", title: "Follow-up rhythm", subtitle: "Personal routines keep the pipeline from going cold.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        case .support:
            return [
                .init(id: "business-support-home", tab: "Home", title: "Ticket queue", subtitle: "Active tickets, escalations, response queue, and service recovery lead.", icon: "headphones", color: Theme.accent),
                .init(id: "business-support-learn", tab: "Learn", title: "Scripts and escalation", subtitle: "Response templates, empathy, escalation, and policy handling stay close.", icon: "text.bubble.fill", color: Theme.pillarHome),
                .init(id: "business-support-growth", tab: "Growth", title: "Support quality", subtitle: "Improve first-contact resolution and reduce repeat issues.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "business-support-life", tab: "Life", title: "Support cadence", subtitle: "Protect routines and recovery around emotionally charged work.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        case .employee:
            return [
                .init(id: "business-employee-home", tab: "Home", title: "Assigned work", subtitle: "Tasks, shifts, performance notes, and next actions lead.", icon: "checklist.checked", color: Theme.pillarHome),
                .init(id: "business-employee-learn", tab: "Learn", title: "SOP training", subtitle: "Role basics, quality standards, and advancement paths stay close.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "business-employee-growth", tab: "Growth", title: "Advancement path", subtitle: "Grow from assigned tasks into trusted specialist or manager coverage.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "business-employee-life", tab: "Life", title: "Routine baseline", subtitle: "Habits and schedule stability support reliable team work.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        }
    }

    var lifeTabActions: [PersonaTabAction] {
        switch self {
        case .owner:
            return [
                .init(id: "business-owner-life-ops", title: "Check operations", subtitle: "Connect owner stability to open jobs, quality, and cash flow.", icon: "briefcase.fill", color: Theme.pillarGoals, targetTab: "home"),
                .init(id: "business-owner-life-train", title: "Train the team", subtitle: "Use SOP and delegation guides before handing off work.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-owner-life-buffer", title: "Plan payroll buffer", subtitle: "Keep cash cushion and owner routines out of the blind spot.", icon: "banknote.fill", color: Theme.success, targetTab: "life")
            ]
        case .manager:
            return [
                .init(id: "business-manager-life-schedule", title: "Check team schedule", subtitle: "Tie personal capacity to shifts, handoffs, and open task risk.", icon: "person.3.fill", color: Theme.pillarMoney, targetTab: "home"),
                .init(id: "business-manager-life-qa", title: "Review QA playbook", subtitle: "Use checklists before quality issues turn into escalations.", icon: "clipboard.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-manager-life-cadence", title: "Protect manager cadence", subtitle: "Keep routines steady so the team has a reliable operating rhythm.", icon: "heart.text.square.fill", color: Theme.danger, targetTab: "life")
            ]
        case .representative:
            return [
                .init(id: "business-rep-life-leads", title: "Follow up leads", subtitle: "Move the next prospect back to Home before the pipeline cools.", icon: "person.crop.circle.badge.checkmark", color: Theme.success, targetTab: "home"),
                .init(id: "business-rep-life-script", title: "Practice objection handling", subtitle: "Use sales guides before the next intake or follow-up.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-rep-life-rhythm", title: "Plan follow-up rhythm", subtitle: "Keep outreach blocks and personal routines from colliding.", icon: "calendar.badge.clock", color: Theme.pillarGoals, targetTab: "life")
            ]
        case .support:
            return [
                .init(id: "business-support-life-queue", title: "Clear escalations", subtitle: "Route unresolved tickets back to Home before they age.", icon: "headphones", color: Theme.accent, targetTab: "home"),
                .init(id: "business-support-life-scripts", title: "Open script library", subtitle: "Use empathy and escalation guides when a case gets charged.", icon: "text.bubble.fill", color: Theme.pillarHome, targetTab: "learn"),
                .init(id: "business-support-life-recovery", title: "Protect support energy", subtitle: "Keep decompression and response cadence visible.", icon: "heart.text.square.fill", color: Theme.danger, targetTab: "life")
            ]
        case .employee:
            return [
                .init(id: "business-employee-life-tasks", title: "View assigned tasks", subtitle: "Keep shifts and task queue connected to the next Home action.", icon: "checklist.checked", color: Theme.pillarHome, targetTab: "home"),
                .init(id: "business-employee-life-sop", title: "Open next SOP", subtitle: "Use role basics before starting unfamiliar work.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-employee-life-routine", title: "Track work routine", subtitle: "Make reliability and personal cadence visible.", icon: "heart.text.square.fill", color: Theme.danger, targetTab: "life")
            ]
        }
    }

    var growthTabActions: [PersonaTabAction] {
        switch self {
        case .owner:
            return [
                .init(id: "business-owner-growth-audit", title: "Audit operations", subtitle: "Review team, jobs, quality, and inbox issues before scaling.", icon: "briefcase.fill", color: Theme.pillarGoals, targetTab: "home"),
                .init(id: "business-owner-growth-revenue", title: "Add revenue lane", subtitle: "Explore products, wholesale, recurring plans, or service expansion.", icon: "cart.fill.badge.plus", color: Theme.success, targetTab: "growth"),
                .init(id: "business-owner-growth-training", title: "Find team training", subtitle: "Use SOP and QA guides to remove owner bottlenecks.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn")
            ]
        case .manager:
            return [
                .init(id: "business-manager-growth-coverage", title: "Improve coverage", subtitle: "Spot schedule gaps and assign clearer handoffs before scaling.", icon: "person.3.fill", color: Theme.pillarMoney, targetTab: "home"),
                .init(id: "business-manager-growth-qa", title: "Build QA cadence", subtitle: "Turn quality checks into repeatable manager systems.", icon: "clipboard.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-manager-growth-reporting", title: "Report team health", subtitle: "Use team signals to support owner growth decisions.", icon: "chart.bar.fill", color: Theme.success, targetTab: "growth")
            ]
        case .representative:
            return [
                .init(id: "business-rep-growth-pipeline", title: "Grow the pipeline", subtitle: "Move prospects through intake, follow-up, and agreement stages.", icon: "person.crop.circle.badge.checkmark", color: Theme.success, targetTab: "home"),
                .init(id: "business-rep-growth-close", title: "Close service agreements", subtitle: "Use sales guides to turn repeat work into recurring revenue.", icon: "signature", color: Theme.pillarGoals, targetTab: "learn"),
                .init(id: "business-rep-growth-referrals", title: "Build referrals", subtitle: "Turn happy customers into the next lead source.", icon: "arrow.up.right.circle.fill", color: Theme.accent, targetTab: "growth")
            ]
        case .support:
            return [
                .init(id: "business-support-growth-resolution", title: "Raise first-contact resolution", subtitle: "Clear more issues without escalation or repeat messages.", icon: "headphones", color: Theme.accent, targetTab: "home"),
                .init(id: "business-support-growth-scripts", title: "Sharpen scripts", subtitle: "Use support lessons to improve tone, evidence, and closure.", icon: "text.bubble.fill", color: Theme.pillarHome, targetTab: "learn"),
                .init(id: "business-support-growth-patterns", title: "Spot support patterns", subtitle: "Turn repeat issues into training and operations changes.", icon: "chart.line.uptrend.xyaxis", color: Theme.success, targetTab: "growth")
            ]
        case .employee:
            return [
                .init(id: "business-employee-growth-reliability", title: "Build reliability", subtitle: "Complete assigned work and keep performance signals visible.", icon: "checklist.checked", color: Theme.pillarHome, targetTab: "home"),
                .init(id: "business-employee-growth-training", title: "Finish role training", subtitle: "Use SOPs and quality guides to become trusted on more work.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-employee-growth-advance", title: "Advance your path", subtitle: "Grow from role basics into specialist or manager readiness.", icon: "arrow.up.right.circle.fill", color: Theme.success, targetTab: "growth")
            ]
        }
    }

    var learnTabActions: [PersonaTabAction] {
        switch self {
        case .owner:
            return [
                .init(id: "business-owner-learn-ops", title: "Standardize operations", subtitle: "Build SOPs, QA checks, and delegation habits.", icon: "briefcase.fill", color: Theme.pillarGoals, learnCategory: "business"),
                .init(id: "business-owner-learn-management", title: "Manage the team", subtitle: "Use scheduling, roles, and accountability systems.", icon: "clipboard.fill", color: Theme.pillarMoney, learnCategory: "management"),
                .init(id: "business-owner-learn-support", title: "Improve support", subtitle: "Reduce disputes with communication and service recovery.", icon: "headphones", color: Theme.accent, learnCategory: "support")
            ]
        case .manager:
            return [
                .init(id: "business-manager-learn-daily", title: "Run daily operations", subtitle: "Use job queue, team status, and escalation routines.", icon: "clipboard.fill", color: Theme.pillarMoney, learnCategory: "management"),
                .init(id: "business-manager-learn-quality", title: "Manage quality flags", subtitle: "Build QA checks and handoff habits before issues repeat.", icon: "checkmark.shield.fill", color: Theme.accent, learnCategory: "management"),
                .init(id: "business-manager-learn-support", title: "Coordinate escalations", subtitle: "Know when to step into tickets, disputes, and recovery.", icon: "headphones", color: Theme.pillarHome, learnCategory: "support")
            ]
        case .representative:
            return [
                .init(id: "business-rep-learn-prospect", title: "Prospect local clients", subtitle: "Find local opportunities and start better outreach.", icon: "person.crop.circle.badge.checkmark", color: Theme.success, learnCategory: "sales"),
                .init(id: "business-rep-learn-agreements", title: "Close agreements", subtitle: "Turn one-off work into service agreements and retainers.", icon: "signature", color: Theme.pillarGoals, learnCategory: "sales"),
                .init(id: "business-rep-learn-crm", title: "Keep CRM hygiene", subtitle: "Track follow-ups and lead quality without losing context.", icon: "list.bullet.clipboard.fill", color: Theme.accent, learnCategory: "management")
            ]
        case .support:
            return [
                .init(id: "business-support-learn-contact", title: "Handle first contact", subtitle: "Resolve common issues with clarity and empathy.", icon: "headphones", color: Theme.accent, learnCategory: "support"),
                .init(id: "business-support-learn-disputes", title: "Resolve disputes", subtitle: "Use evidence, policy, and recovery options fairly.", icon: "checkmark.shield.fill", color: Theme.warning, learnCategory: "support"),
                .init(id: "business-support-learn-deescalate", title: "De-escalate conversations", subtitle: "Keep hard conversations clear without burning out.", icon: "text.bubble.fill", color: Theme.pillarHome, learnCategory: "support")
            ]
        case .employee:
            return [
                .init(id: "business-employee-learn-basics", title: "Learn role basics", subtitle: "Start with SOPs, task quality, and work expectations.", icon: "graduationcap.fill", color: Theme.accent, learnCategory: "business"),
                .init(id: "business-employee-learn-quality", title: "Understand quality standards", subtitle: "Know what good work looks like before the shift starts.", icon: "checkmark.shield.fill", color: Theme.success, learnCategory: "management"),
                .init(id: "business-employee-learn-support", title: "Communicate issues", subtitle: "Escalate blockers and customer concerns the right way.", icon: "headphones", color: Theme.pillarHome, learnCategory: "support")
            ]
        }
    }

    var primaryLearnCategory: String {
        switch self {
        case .owner: return "business"
        case .manager: return "management"
        case .representative: return "sales"
        case .support: return "support"
        case .employee: return "business"
        }
    }
}

extension Persona {
    var calibrationPrompt: String {
        switch self {
        case .customer: return "Which parts of life do you want to stay on top of?"
        case .helper: return "What can you do?"
        case .consultant: return "What do you consult or advise on?"
        case .investor: return "What opportunities interest you most?"
        case .business: return "What's hardest in the business right now?"
        case .toolOwner: return "What does your rental setup need first?"
        case .franchise: return "What does your territory need first?"
        }
    }

    var calibrationOptions: [PersonaCalibrationOption] {
        switch self {
        case .customer:
            return [
                .init(id: "home-care", title: "Home care", unlock: "Adds maintenance tasks to Life Pulse.", icon: "house.fill", color: Theme.pillarHome),
                .init(id: "car-care", title: "Car care", unlock: "Prioritizes overdue vehicle reminders.", icon: "car.fill", color: Theme.pillarCar),
                .init(id: "money", title: "Money & budgeting", unlock: "Activates budget and spending guides.", icon: "dollarsign.circle.fill", color: Theme.pillarMoney),
                .init(id: "goals", title: "Goals & savings", unlock: "Shows sinking funds and planned needs.", icon: "target", color: Theme.pillarGoals),
                .init(id: "personal", title: "Personal care", unlock: "Adds habit and routine prompts.", icon: "figure.run", color: Theme.pillarPersonal),
                .init(id: "hire-help", title: "Hire help faster", unlock: "Keeps Post Job close to urgent items.", icon: "person.2.fill", color: Theme.accent)
            ]
        case .helper:
            return [
                .init(id: "repairs", title: "Repairs", unlock: "Filters nearby demand to repair work.", icon: "wrench.and.screwdriver.fill", color: Theme.accent),
                .init(id: "cleaning", title: "Cleaning", unlock: "Shows cleaning jobs and pricing guides.", icon: "sparkles", color: Theme.pillarHome),
                .init(id: "landscaping", title: "Landscaping", unlock: "Prioritizes yard work and seasonal demand.", icon: "leaf.fill", color: Theme.success),
                .init(id: "moving", title: "Moving & labor", unlock: "Shows labor jobs and safety guides.", icon: "shippingbox.fill", color: Theme.pillarSinking),
                .init(id: "weekends", title: "Weekends", unlock: "Highlights flexible availability setup.", icon: "calendar", color: Theme.pillarGoals),
                .init(id: "starting", title: "Just starting", unlock: "Starts with profile and first-bid lessons.", icon: "graduationcap.fill", color: Theme.pillarCar)
            ]
        case .consultant:
            return [
                .init(id: "strategy", title: "Business strategy", unlock: "Builds first offer packaging.", icon: "briefcase.fill", color: Theme.pillarGoals),
                .init(id: "finance", title: "Finance & taxes", unlock: "Surfaces pricing and compliance guides.", icon: "dollarsign.circle.fill", color: Theme.pillarMoney),
                .init(id: "marketing", title: "Marketing", unlock: "Prioritizes client acquisition lessons.", icon: "megaphone.fill", color: Theme.accent),
                .init(id: "coaching", title: "Coaching", unlock: "Shows session and follow-up templates.", icon: "person.bubble.fill", color: Theme.pillarPersonal),
                .init(id: "retainers", title: "Retainers", unlock: "Adds recurring offer growth path.", icon: "repeat.circle.fill", color: Theme.success),
                .init(id: "async", title: "Async advice", unlock: "Focuses on written report workflows.", icon: "doc.text.fill", color: Theme.pillarHome)
            ]
        case .investor:
            return [
                .init(id: "local-services", title: "Local services", unlock: "Shows helper and trade operator signals.", icon: "wrench.and.screwdriver.fill", color: Theme.accent),
                .init(id: "consulting", title: "Consulting practices", unlock: "Adds service-package evaluation guides.", icon: "person.bubble.fill", color: Theme.pillarPersonal),
                .init(id: "lending", title: "Operator lending", unlock: "Prioritizes risk and performance basics.", icon: "banknote.fill", color: Theme.pillarMoney),
                .init(id: "community", title: "Community growth", unlock: "Highlights local development opportunities.", icon: "building.2.fill", color: Theme.pillarGoals),
                .init(id: "mentorship", title: "Mentorship + capital", unlock: "Adds advisor-style involvement prompts.", icon: "hand.raised.fill", color: Theme.success),
                .init(id: "due-diligence", title: "Due diligence", unlock: "Starts Learn with evaluation frameworks.", icon: "magnifyingglass", color: Theme.pillarHome)
            ]
        case .business:
            return [
                .init(id: "customers", title: "Consistent customers", unlock: "Prioritizes leads and Growth programs.", icon: "person.2.fill", color: Theme.accent),
                .init(id: "team", title: "Team quality", unlock: "Adds manager, QA, and training signals.", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(id: "payments", title: "Payments", unlock: "Keeps finance and paperwork visible.", icon: "creditcard.fill", color: Theme.success),
                .init(id: "organized", title: "Job organization", unlock: "Focuses Home on operations health.", icon: "list.bullet.clipboard.fill", color: Theme.pillarHome),
                .init(id: "hiring", title: "Hiring people", unlock: "Adds hiring and role setup prompts.", icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal),
                .init(id: "compliance", title: "Compliance", unlock: "Surfaces policies and readiness guides.", icon: "checkmark.shield.fill", color: Theme.warning)
            ]
        case .toolOwner:
            return [
                .init(id: "catalog", title: "Catalog tools", unlock: "Starts with listing and condition setup.", icon: "hammer.fill", color: Theme.pillarCar),
                .init(id: "deposits", title: "Deposits", unlock: "Prioritizes payment and trust rules.", icon: "lock.fill", color: Theme.warning),
                .init(id: "pickup", title: "Pickup rules", unlock: "Adds handoff windows and return policy.", icon: "clock.badge.checkmark", color: Theme.pillarHome),
                .init(id: "earnings", title: "Rental income", unlock: "Shows payout and Growth prompts.", icon: "dollarsign.circle.fill", color: Theme.success)
            ]
        case .franchise:
            return [
                .init(id: "territory", title: "Territory", unlock: "Prioritizes coverage and local expansion.", icon: "map.fill", color: Theme.pillarSinking),
                .init(id: "operators", title: "Operators", unlock: "Starts training and quality setup.", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(id: "compliance", title: "Compliance", unlock: "Shows required readiness checks.", icon: "checkmark.seal.fill", color: Theme.warning),
                .init(id: "launch", title: "Soft launch", unlock: "Adds early customer and review milestones.", icon: "flag.checkered", color: Theme.accent)
            ]
        }
    }

    func calibrationOptions(matching ids: Set<String>) -> [PersonaCalibrationOption] {
        calibrationOptions.filter { ids.contains($0.id) }
    }

    var contextSignalPrompt: String {
        switch self {
        case .customer: return "What feels most out of control right now?"
        case .helper: return "How would you describe your experience?"
        case .consultant: return "Where are you with consulting right now?"
        case .investor: return "What stage do you prefer to get involved?"
        case .business: return "What best describes your business?"
        case .toolOwner: return "What is most important for your rentals first?"
        case .franchise: return "Where is your territory right now?"
        }
    }

    var contextSignalOptions: [PersonaSetupSignalOption] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-urgent-home", title: "Tasks piling up at home", unlock: "Moves home care to the top of your Urgency Queue.", icon: "house.fill", color: Theme.pillarHome),
                .init(id: "customer-urgent-car", title: "My car is overdue", unlock: "Starts Life with a car-care item and a matching Learn guide.", icon: "car.fill", color: Theme.pillarCar),
                .init(id: "customer-urgent-routines", title: "Routines are slipping", unlock: "Adds personal care prompts to your Pulse.", icon: "figure.run", color: Theme.pillarPersonal),
                .init(id: "customer-urgent-money", title: "Money feels unorganized", unlock: "Prioritizes budget and spending basics.", icon: "dollarsign.circle.fill", color: Theme.pillarMoney),
                .init(id: "customer-urgent-system", title: "I want a better system", unlock: "Balances Home, Life, Learn, and Growth setup.", icon: "slider.horizontal.3", color: Theme.accent),
                .init(id: "customer-urgent-ahead", title: "I want to stay ahead", unlock: "Focuses on planned needs and prevention.", icon: "target", color: Theme.pillarGoals)
            ]
        case .helper:
            return [
                .init(id: "helper-exp-starting", title: "Just starting out", unlock: "Starts with profile, safety, and first-bid lessons.", icon: "sparkles", color: Theme.pillarCar),
                .init(id: "helper-exp-friends", title: "Friends and family", unlock: "Builds confidence from informal experience.", icon: "person.2.fill", color: Theme.pillarHome),
                .init(id: "helper-exp-paid", title: "People pay me already", unlock: "Prioritizes pricing, reviews, and repeat work.", icon: "star.fill", color: Theme.accent),
                .init(id: "helper-exp-operation", title: "Small operation", unlock: "Shows team, availability, and business-owner path signals.", icon: "briefcase.fill", color: Theme.pillarGoals)
            ]
        case .consultant:
            return [
                .init(id: "consultant-status-knowledge", title: "Knowledge, no offer yet", unlock: "Starts with offer packaging and positioning.", icon: "lightbulb.fill", color: Theme.pillarGoals),
                .init(id: "consultant-status-informal", title: "Informal advice", unlock: "Turns past help into a paid session path.", icon: "person.bubble.fill", color: Theme.pillarPersonal),
                .init(id: "consultant-status-paid", title: "Paid sessions now", unlock: "Prioritizes pipeline, pricing, and follow-up.", icon: "calendar.badge.clock", color: Theme.accent),
                .init(id: "consultant-status-scale", title: "Steady clients", unlock: "Shows retainers, programs, and scale systems.", icon: "arrow.up.right.circle.fill", color: Theme.success)
            ]
        case .investor:
            return [
                .init(id: "investor-stage-early", title: "Very early", unlock: "Surfaces mentorship and startup-readiness signals.", icon: "seedling.fill", color: Theme.success),
                .init(id: "investor-stage-growth", title: "Growth stage", unlock: "Prioritizes traction, pipeline, and operator performance.", icon: "chart.line.uptrend.xyaxis", color: Theme.pillarMoney),
                .init(id: "investor-stage-established", title: "Established", unlock: "Moves due diligence and stability checks forward.", icon: "checkmark.seal.fill", color: Theme.pillarGoals),
                .init(id: "investor-stage-flexible", title: "Flexible", unlock: "Keeps the opportunity watchlist broad.", icon: "slider.horizontal.3", color: Theme.accent)
            ]
        case .business:
            return [
                .init(id: "business-type-solo", title: "Solo operator", unlock: "Focuses Home on jobs, cash flow, and owner workload.", icon: "person.fill", color: Theme.pillarHome),
                .init(id: "business-type-small-team", title: "Small team", unlock: "Activates team roles, QA, and scheduling signals.", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(id: "business-type-mid-size", title: "6-15 people", unlock: "Prioritizes manager coverage, reporting, and fulfillment health.", icon: "building.2.fill", color: Theme.pillarMoney),
                .init(id: "business-type-franchise", title: "Franchise path", unlock: "Surfaces compliance, training, and territory systems.", icon: "flag.checkered", color: Theme.pillarSinking)
            ]
        case .toolOwner:
            return [
                .init(id: "tool-context-condition", title: "Condition tracking", unlock: "Starts with inspection and photo rules.", icon: "checkmark.shield.fill", color: Theme.pillarHome),
                .init(id: "tool-context-rates", title: "Rates and deposits", unlock: "Prioritizes money, trust, and pickup policies.", icon: "creditcard.fill", color: Theme.success),
                .init(id: "tool-context-demand", title: "Find demand", unlock: "Connects inventory to nearby jobs and kits.", icon: "location.fill", color: Theme.accent),
                .init(id: "tool-context-maintenance", title: "Maintenance fund", unlock: "Adds replacement and repair planning to Life.", icon: "banknote.fill", color: Theme.pillarMoney)
            ]
        case .franchise:
            return [
                .init(id: "franchise-context-research", title: "Still researching", unlock: "Starts with franchise basics and due diligence.", icon: "magnifyingglass", color: Theme.accent),
                .init(id: "franchise-context-launch", title: "Preparing launch", unlock: "Prioritizes territory setup and compliance.", icon: "flag.checkered", color: Theme.pillarSinking),
                .init(id: "franchise-context-operators", title: "Need operators", unlock: "Moves recruiting and training systems forward.", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(id: "franchise-context-scale", title: "Ready to scale", unlock: "Shows expansion ladder and operating standards.", icon: "arrow.up.right.circle.fill", color: Theme.success)
            ]
        }
    }

    var styleSignalPrompt: String {
        switch self {
        case .customer: return "When something comes up, what do you prefer?"
        case .helper: return "When are you generally available to work?"
        case .consultant: return "How do you prefer to deliver consulting?"
        case .investor: return "How do you want to be involved?"
        case .business: return "What's hardest in the business right now?"
        case .toolOwner: return "How do you want handoffs to work?"
        case .franchise: return "What kind of support do you want first?"
        }
    }

    var styleSignalOptions: [PersonaSetupSignalOption] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-handle-diy", title: "I'd rather DIY first", unlock: "Learn guides come before hiring actions.", icon: "wrench.fill", color: Theme.accent),
                .init(id: "customer-handle-hire", title: "I hire when faster", unlock: "Post Job and helper comparison stay close.", icon: "person.2.fill", color: Theme.pillarHome),
                .init(id: "customer-handle-depends", title: "Depends on the task", unlock: "Shows both Learn-first and hire-first routes.", icon: "arrow.left.arrow.right", color: Theme.pillarGoals),
                .init(id: "customer-handle-delay", title: "I let it go too long", unlock: "Keeps overdue reminders and soft nudges visible.", icon: "clock.badge.exclamationmark.fill", color: Theme.warning)
            ]
        case .helper:
            return [
                .init(id: "helper-time-mornings", title: "Weekday mornings", unlock: "Filters demand around morning availability.", icon: "sunrise.fill", color: Theme.pillarCar),
                .init(id: "helper-time-afternoons", title: "Weekday afternoons", unlock: "Matches jobs to afternoon openings.", icon: "sun.max.fill", color: Theme.pillarGoals),
                .init(id: "helper-time-evenings", title: "Weekday evenings", unlock: "Prioritizes after-work job options.", icon: "moon.fill", color: Theme.pillarSinking),
                .init(id: "helper-time-weekends", title: "Weekends", unlock: "Highlights flexible weekend demand.", icon: "calendar", color: Theme.accent),
                .init(id: "helper-time-flexible", title: "Flexible", unlock: "Keeps availability setup broad.", icon: "slider.horizontal.3", color: Theme.success)
            ]
        case .consultant:
            return [
                .init(id: "consultant-format-video", title: "1-on-1 video calls", unlock: "Starts with booking and session structure.", icon: "video.fill", color: Theme.accent),
                .init(id: "consultant-format-person", title: "In-person meetings", unlock: "Adds local appointment and follow-up habits.", icon: "person.2.fill", color: Theme.pillarHome),
                .init(id: "consultant-format-written", title: "Written reports", unlock: "Prioritizes async report workflows.", icon: "doc.text.fill", color: Theme.pillarGoals),
                .init(id: "consultant-format-retainer", title: "Ongoing retainers", unlock: "Shows recurring offer and client success paths.", icon: "repeat.circle.fill", color: Theme.success),
                .init(id: "consultant-format-async", title: "Async advice", unlock: "Surfaces voice-note and email workflows.", icon: "mic.fill", color: Theme.pillarPersonal)
            ]
        case .investor:
            return [
                .init(id: "investor-involve-capital", title: "Capital only", unlock: "Keeps watchlist and reporting lightweight.", icon: "banknote.fill", color: Theme.pillarMoney),
                .init(id: "investor-involve-mentor", title: "Mentorship + capital", unlock: "Adds advisor-fit and operator coaching signals.", icon: "hand.raised.fill", color: Theme.success),
                .init(id: "investor-involve-active", title: "Active operator", unlock: "Surfaces hands-on business paths.", icon: "briefcase.fill", color: Theme.pillarGoals),
                .init(id: "investor-involve-learning", title: "Still figuring it out", unlock: "Starts with due diligence and fundamentals.", icon: "graduationcap.fill", color: Theme.accent)
            ]
        case .business:
            return [
                .init(id: "business-hard-customers", title: "Consistent customers", unlock: "Prioritizes lead pipeline and Growth programs.", icon: "person.2.fill", color: Theme.accent),
                .init(id: "business-hard-team", title: "Team and quality", unlock: "Moves manager, QA, and training signals forward.", icon: "person.3.fill", color: Theme.pillarGoals),
                .init(id: "business-hard-payments", title: "Payments and paperwork", unlock: "Keeps money and compliance visible.", icon: "creditcard.fill", color: Theme.success),
                .init(id: "business-hard-organized", title: "Job organization", unlock: "Focuses Home on operations health.", icon: "list.bullet.clipboard.fill", color: Theme.pillarHome),
                .init(id: "business-hard-hiring", title: "Finding good people", unlock: "Adds hiring and role setup prompts.", icon: "person.crop.circle.badge.plus", color: Theme.pillarPersonal),
                .init(id: "business-hard-all", title: "All of the above", unlock: "Balances operations, team, Learn, and Growth.", icon: "sparkles", color: Theme.warning)
            ]
        case .toolOwner:
            return [
                .init(id: "tool-handoff-porch", title: "Simple pickup window", unlock: "Prioritizes pickup rules and reminders.", icon: "clock.badge.checkmark", color: Theme.pillarHome),
                .init(id: "tool-handoff-verified", title: "Verified renters only", unlock: "Moves trust and deposit rules forward.", icon: "checkmark.seal.fill", color: Theme.warning),
                .init(id: "tool-handoff-delivery", title: "Delivery possible", unlock: "Connects rentals to logistics and helper demand.", icon: "truck.box.fill", color: Theme.pillarSinking),
                .init(id: "tool-handoff-flexible", title: "Flexible", unlock: "Keeps handoff options broad.", icon: "slider.horizontal.3", color: Theme.accent)
            ]
        case .franchise:
            return [
                .init(id: "franchise-support-training", title: "Training system", unlock: "Prioritizes operator onboarding and SOPs.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "franchise-support-compliance", title: "Compliance", unlock: "Moves required checks and policies forward.", icon: "checkmark.shield.fill", color: Theme.warning),
                .init(id: "franchise-support-coverage", title: "Territory coverage", unlock: "Shows operator and service-area planning.", icon: "map.fill", color: Theme.pillarSinking),
                .init(id: "franchise-support-growth", title: "Expansion planning", unlock: "Surfaces hiring and growth programs.", icon: "arrow.up.right.circle.fill", color: Theme.success)
            ]
        }
    }

    func setupSignalOptions(matching ids: Set<String>) -> [PersonaSetupSignalOption] {
        (contextSignalOptions + styleSignalOptions).filter { ids.contains($0.id) }
    }

    func firstValueTitle(for businessRole: BusinessSubPersona?) -> String {
        guard self == .business else { return firstValueTitle }
        return (businessRole ?? .owner).firstValueTitle
    }

    func firstValueSubtitle(for businessRole: BusinessSubPersona?) -> String {
        guard self == .business else { return firstValueSubtitle }
        return (businessRole ?? .owner).firstValueSubtitle
    }

    func firstValueTitle(for businessRole: BusinessSubPersona?, setupSignalIDs: Set<String>) -> String {
        guard self == .customer else { return firstValueTitle(for: businessRole) }
        if setupSignalIDs.contains("customer-urgent-car") { return "Your car-care pulse is ready" }
        if setupSignalIDs.contains("customer-urgent-money") { return "Your money pulse is ready" }
        if setupSignalIDs.contains("customer-urgent-home") { return "Your home-care pulse is ready" }
        if setupSignalIDs.contains("customer-urgent-routines") { return "Your routine pulse is ready" }
        if setupSignalIDs.contains("customer-urgent-ahead") { return "Your prevention plan is ready" }
        return firstValueTitle
    }

    func firstValueSubtitle(for businessRole: BusinessSubPersona?, setupSignalIDs: Set<String>) -> String {
        guard self == .customer else { return firstValueSubtitle(for: businessRole) }
        if setupSignalIDs.contains("customer-urgent-car") {
            return "Your first item is an overdue oil change, with Life tracking it and Learn ready before you hire or DIY."
        }
        if setupSignalIDs.contains("customer-urgent-money") {
            return "Budget check, repair planning, and money guides move forward before new requests pile up."
        }
        if setupSignalIDs.contains("customer-urgent-home") {
            return "Home tasks move into your Urgency Queue so you can decide what to fix, learn, or hire out."
        }
        if setupSignalIDs.contains("customer-urgent-routines") {
            return "Personal routines and home needs stay visible without turning the app into another chore list."
        }
        if setupSignalIDs.contains("customer-urgent-ahead") {
            return "Planned needs, maintenance, and sinking funds stay ahead of the next surprise."
        }
        return firstValueSubtitle
    }

    func loopSignals(for businessRole: BusinessSubPersona?) -> [PersonaLoopSignal] {
        guard self == .business else { return loopSignals }
        return (businessRole ?? .owner).loopSignals
    }

    func lifeTabActions(for businessRole: BusinessSubPersona?) -> [PersonaTabAction] {
        guard self == .business else { return lifeTabActions }
        return (businessRole ?? .owner).lifeTabActions
    }

    func growthTabActions(for businessRole: BusinessSubPersona?) -> [PersonaTabAction] {
        guard self == .business else { return growthTabActions }
        return (businessRole ?? .owner).growthTabActions
    }

    func learnTabActions(for businessRole: BusinessSubPersona?) -> [PersonaTabAction] {
        guard self == .business else { return learnTabActions }
        return (businessRole ?? .owner).learnTabActions
    }

    func primaryLearnCategory(for businessRole: BusinessSubPersona?) -> String {
        guard self == .business else { return primaryLearnCategory }
        return (businessRole ?? .owner).primaryLearnCategory
    }

    func loopNudge(
        from sourceTab: String,
        businessRole: BusinessSubPersona?,
        calibrationIDs: Set<String>,
        setupSignalIDs: Set<String> = []
    ) -> PersonaLoopNudge {
        let source = sourceTab.lowercased()
        let role = self == .business ? (businessRole ?? .owner) : nil

        if source == "home" {
            return homeLoopNudge(businessRole: role, calibrationIDs: calibrationIDs, setupSignalIDs: setupSignalIDs)
        }

        if source == "learn" {
            return learnLoopNudge(businessRole: role, calibrationIDs: calibrationIDs, setupSignalIDs: setupSignalIDs)
        }

        let actions: [PersonaTabAction]
        switch source {
        case "life":
            actions = lifeTabActions(for: role)
        case "growth":
            actions = growthTabActions(for: role)
        default:
            return homeLoopNudge(businessRole: role, calibrationIDs: calibrationIDs, setupSignalIDs: setupSignalIDs)
        }

        if let action = actions.first(where: { ($0.targetTab ?? "").lowercased() != source }) ?? actions.first,
           let targetTab = normalizedLoopTarget(action.targetTab) {
            return PersonaLoopNudge(
                id: "\(rawValue)-\(source)-\(action.id)",
                sourceTab: source,
                targetTab: targetTab,
                actionName: nil,
                eyebrow: "Next in your loop",
                title: action.title,
                subtitle: action.subtitle,
                cta: "Open \(loopTargetLabel(targetTab))",
                icon: action.icon,
                color: action.color
            )
        }

        return homeLoopNudge(businessRole: role, calibrationIDs: calibrationIDs, setupSignalIDs: setupSignalIDs)
    }

    private func homeLoopNudge(
        businessRole: BusinessSubPersona?,
        calibrationIDs: Set<String>,
        setupSignalIDs: Set<String>
    ) -> PersonaLoopNudge {
        switch self {
        case .customer:
            if setupSignalIDs.contains("customer-handle-diy") {
                return makeLoopNudge(source: "home", target: "learn", title: "Learn before you act", subtitle: "You said you prefer to DIY first, so start with the guide before posting or hiring.", icon: "graduationcap.fill", color: Theme.accent)
            }
            if setupSignalIDs.contains("customer-urgent-car") {
                return makeLoopNudge(source: "home", target: "life", title: "Start with the overdue car item", subtitle: "Life has your car-care urgency queued so you can decide whether to DIY or hire.", icon: "car.fill", color: Theme.pillarCar)
            }
            if setupSignalIDs.contains("customer-urgent-money") {
                return makeLoopNudge(source: "home", target: "life", title: "Check budget pressure first", subtitle: "You flagged money as the friction, so Life should lead before a new request.", icon: "dollarsign.circle.fill", color: Theme.pillarMoney)
            }
            if calibrationIDs.contains("hire-help") {
                return makeLoopNudge(source: "home", target: "learn", title: "Compare before you hire", subtitle: "Use Learn to know what to ask, inspect, and compare before you post or accept help.", icon: "graduationcap.fill", color: Theme.accent)
            }
            if calibrationIDs.contains("car-care") {
                return makeLoopNudge(source: "home", target: "life", title: "Move car care into Pulse", subtitle: "Track overdue vehicle work in Life so Home only turns it into a request when it is time.", icon: "car.fill", color: Theme.pillarCar)
            }
            if calibrationIDs.contains("money") {
                return makeLoopNudge(source: "home", target: "life", title: "Check budget pressure first", subtitle: "Use Life Pulse to weigh repair urgency against budget, funds, and planned needs.", icon: "dollarsign.circle.fill", color: Theme.pillarMoney)
            }
            if calibrationIDs.contains("goals") {
                return makeLoopNudge(source: "home", target: "growth", title: "Plan the next priority", subtitle: "Growth keeps planned needs from becoming surprise expenses or rushed decisions.", icon: "target", color: Theme.pillarGoals)
            }
            return makeLoopNudge(source: "home", target: "life", title: "Set up your Life Pulse", subtitle: "Start with home, car, money, and planned needs so OxSteed knows what is urgent enough to act on today.", icon: "heart.text.square.fill", color: Theme.danger)
        case .helper:
            return makeLoopNudge(source: "home", target: "learn", title: "Complete your Helper profile", subtitle: "Use the profile and pricing basics before bidding so trust, scope, and rate floors are clear.", icon: "person.fill.checkmark", color: Theme.pillarGoals)
        case .consultant:
            return makeLoopNudge(source: "home", target: "growth", title: "Create your first offer package", subtitle: "Turn client activity into a clear session, retainer, or follow-up path.", icon: "sparkles", color: Theme.success)
        case .investor:
            return makeLoopNudge(source: "home", target: "learn", title: "Study the opportunity", subtitle: "Use Learn to evaluate operators, unit economics, and risk before acting.", icon: "magnifyingglass", color: Theme.pillarMoney)
        case .business:
            switch businessRole ?? .owner {
            case .owner:
                return makeLoopNudge(
                    source: "home",
                    target: "home",
                    title: "Set up your team roles",
                    subtitle: "Choose owner, manager, representative, support, and employee responsibilities before scaling the operation.",
                    icon: "person.3.fill",
                    color: Theme.pillarGoals,
                    cta: "Set roles",
                    actionName: "businessRoleSetup"
                )
            case .manager:
                return makeLoopNudge(source: "home", target: "learn", title: "Tighten the handoff", subtitle: "Use QA and scheduling guides before shift issues become escalations.", icon: "clipboard.fill", color: Theme.pillarMoney)
            case .representative:
                return makeLoopNudge(source: "home", target: "growth", title: "Move leads toward revenue", subtitle: "Growth turns intake, follow-ups, and agreements into a repeatable pipeline.", icon: "person.crop.circle.badge.checkmark", color: Theme.success)
            case .support:
                return makeLoopNudge(source: "home", target: "learn", title: "Open the script library", subtitle: "Use support guides when tickets need empathy, evidence, escalation, or recovery.", icon: "text.bubble.fill", color: Theme.accent)
            case .employee:
                return makeLoopNudge(source: "home", target: "learn", title: "Open the next SOP", subtitle: "Learn keeps assigned work connected to role basics, quality, and advancement.", icon: "graduationcap.fill", color: Theme.pillarHome)
            }
        case .toolOwner:
            return makeLoopNudge(source: "home", target: "learn", title: "Set rental rules", subtitle: "Learn deposits, pickup windows, condition photos, and rates before more rentals arrive.", icon: "hammer.fill", color: Theme.pillarCar)
        case .franchise:
            return makeLoopNudge(source: "home", target: "learn", title: "Review the training system", subtitle: "Operator onboarding, SOPs, and compliance standards protect territory growth.", icon: "graduationcap.fill", color: Theme.accent)
        }
    }

    private func learnLoopNudge(
        businessRole: BusinessSubPersona?,
        calibrationIDs: Set<String>,
        setupSignalIDs: Set<String>
    ) -> PersonaLoopNudge {
        let role = self == .business ? (businessRole ?? .owner) : nil
        let action = learnTabActions(for: role).first
        let targetTab: String = {
            if self == .customer, setupSignalIDs.contains("customer-handle-diy") {
                return "life"
            }
            switch self {
            case .consultant, .investor:
                return "growth"
            default:
                return "home"
            }
        }()

        let title: String
        let subtitle: String
        if self == .customer, setupSignalIDs.contains("customer-handle-diy") {
            title = "Apply this to your Pulse"
            subtitle = "Because you prefer to DIY first, bring the guide back to Life and track whether it solved the item."
        } else if self == .customer, setupSignalIDs.contains("customer-handle-hire") || calibrationIDs.contains("hire-help") {
            title = "Turn the guide into a request"
            subtitle = "Bring what you learned back to Home before you post, compare, or message a helper."
        } else if let action {
            title = "Apply: \(action.title)"
            subtitle = action.subtitle
        } else {
            title = "Apply what you learned"
            subtitle = "Bring the lesson back into the next Home or Growth action."
        }

        return makeLoopNudge(
            source: "learn",
            target: targetTab,
            title: title,
            subtitle: subtitle,
            icon: action?.icon ?? "arrow.turn.down.right",
            color: action?.color ?? color
        )
    }

    private func makeLoopNudge(
        source: String,
        target: String,
        title: String,
        subtitle: String,
        icon: String,
        color: Color,
        cta: String? = nil,
        actionName: String? = nil
    ) -> PersonaLoopNudge {
        PersonaLoopNudge(
            id: "\(rawValue)-\(source)-\(target)-\(title)",
            sourceTab: source,
            targetTab: target,
            actionName: actionName,
            eyebrow: "Next in your loop",
            title: title,
            subtitle: subtitle,
            cta: cta ?? "Open \(loopTargetLabel(target))",
            icon: icon,
            color: color
        )
    }

    private func normalizedLoopTarget(_ targetTab: String?) -> String? {
        guard let targetTab else { return nil }
        let normalized = targetTab.lowercased()
        return ["home", "life", "growth", "learn"].contains(normalized) ? normalized : nil
    }

    private func loopTargetLabel(_ targetTab: String) -> String {
        switch targetTab.lowercased() {
        case "home": return "Home"
        case "life": return "Life"
        case "growth": return "Growth"
        case "learn": return "Learn"
        default: return "Tab"
        }
    }

    static var onboardingPersonas: [Persona] {
        [.customer, .helper, .consultant, .investor, .business]
    }

    var onboardingDescription: String {
        switch self {
        case .customer:
            return "I want help managing my home, car, money, and personal life."
        case .helper:
            return "I want to earn income from my skills and get booked locally."
        case .consultant:
            return "I want to package my expertise into paid advice or coaching."
        case .investor:
            return "I want to find and evaluate local business opportunities."
        case .business:
            return "I am building or running a service business."
        case .toolOwner:
            return "I want idle tools to earn through rentals."
        case .franchise:
            return "I want to operate and grow an OxSteed territory."
        }
    }

    var onboardingUnlock: String {
        switch self {
        case .customer:
            return "Activates Life Pulse priorities, urgent home/car items, and learn-before-you-hire guides."
        case .helper:
            return "Prioritizes nearby demand, pricing guides, availability, and a slow-week reserve path."
        case .consultant:
            return "Shows offer-building, booking pipeline, pricing guides, and client follow-up next steps."
        case .investor:
            return "Opens opportunity signals, due-diligence basics, and portfolio watchlist prompts."
        case .business:
            return "Builds an operations dashboard for team work, quality, payments, and growth programs."
        case .toolOwner:
            return "Starts rental setup, condition rules, deposit readiness, and tool-owner lessons."
        case .franchise:
            return "Highlights territory setup, compliance checks, operator training, and expansion planning."
        }
    }

    var firstValueTitle: String {
        switch self {
        case .customer: return "Your personal pulse is ready"
        case .helper: return "Your Helper setup is staged"
        case .consultant: return "Your first paid offer path is ready"
        case .investor: return "Your opportunity dashboard is staged"
        case .business: return "Your operations dashboard is staged"
        case .toolOwner: return "Your rental launch path is staged"
        case .franchise: return "Your territory launch path is staged"
        }
    }

    var firstValueSubtitle: String {
        switch self {
        case .customer:
            return "Home care, car care, and budgeting rise to the top before you sign in."
        case .helper:
            return "Nearby work, pricing lessons, and income planning are ready to explore."
        case .consultant:
            return "Offer packaging, booking flow, and follow-up habits are the first loop."
        case .investor:
            return "Growth opportunities lead, with Learn explaining how to evaluate them."
        case .business:
            return "Team activity, quality checks, and hiring programs become the core loop."
        case .toolOwner:
            return "Tool catalog setup, rental rules, and payout readiness become the next actions."
        case .franchise:
            return "Territory, compliance, and operator training become the next actions."
        }
    }

    var loopSignals: [PersonaLoopSignal] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-home", tab: "Home", title: "Post or find help", subtitle: "Turn the top urgent item into a request when DIY is not worth it.", icon: "house.fill", color: Theme.pillarHome),
                .init(id: "customer-life", tab: "Life", title: "Urgency Queue", subtitle: "Home, car, money, habits, goals, and sinking funds stay visible.", icon: "heart.text.square.fill", color: Theme.danger),
                .init(id: "customer-learn", tab: "Learn", title: "Learn before you hire", subtitle: "Start with HVAC, car care, budgeting, and maintenance basics.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "customer-growth", tab: "Growth", title: "Plan next priorities", subtitle: "Use service history, budgets, and goals to stay ahead of bigger repairs.", icon: "arrow.up.right.circle.fill", color: Theme.success)
            ]
        case .helper:
            return [
                .init(id: "helper-home", tab: "Home", title: "Nearby demand", subtitle: "Available jobs, bid actions, calendar, and earnings come first.", icon: "location.fill", color: Theme.accent),
                .init(id: "helper-learn", tab: "Learn", title: "Bid and price better", subtitle: "Guides focus on quality, pricing, communication, and safety.", icon: "graduationcap.fill", color: Theme.pillarGoals),
                .init(id: "helper-life", tab: "Life", title: "Income consistency", subtitle: "Slow-week reserve and equipment funds keep work stable.", icon: "banknote.fill", color: Theme.success),
                .init(id: "helper-growth", tab: "Growth", title: "Path to owner", subtitle: "Milestones show when a helper is ready to specialize or scale.", icon: "arrow.up.right.circle.fill", color: Theme.pillarHome)
            ]
        case .consultant:
            return [
                .init(id: "consultant-home", tab: "Home", title: "Booking pipeline", subtitle: "Session requests, follow-ups, and client inbox stay central.", icon: "person.bubble.fill", color: Theme.pillarPersonal),
                .init(id: "consultant-growth", tab: "Growth", title: "Package your offer", subtitle: "Pricing, offer design, and acquisition programs are prioritized.", icon: "sparkles", color: Theme.success),
                .init(id: "consultant-learn", tab: "Learn", title: "Consulting playbook", subtitle: "Discovery calls, scoping, objections, and retainers lead the toolkit.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "consultant-life", tab: "Life", title: "Stability baseline", subtitle: "Income variability and personal routines keep the practice sustainable.", icon: "heart.fill", color: Theme.danger)
            ]
        case .investor:
            return [
                .init(id: "investor-growth", tab: "Growth", title: "Opportunity signals", subtitle: "Deal flow, operator performance, and market signals lead.", icon: "chart.line.uptrend.xyaxis", color: Theme.success),
                .init(id: "investor-learn", tab: "Learn", title: "Due diligence", subtitle: "Unit economics and local service business evaluation come first.", icon: "graduationcap.fill", color: Theme.pillarMoney),
                .init(id: "investor-home", tab: "Home", title: "Watchlist", subtitle: "Saved operators and portfolio alerts roll back into Home.", icon: "bell.fill", color: Theme.accent),
                .init(id: "investor-life", tab: "Life", title: "Capital discipline", subtitle: "Money and goal pillars keep personal finance visible.", icon: "dollarsign.circle.fill", color: Theme.pillarHome)
            ]
        case .business:
            return [
                .init(id: "business-home", tab: "Home", title: "Operations health", subtitle: "Team activity, open jobs, fulfillment flags, and inbox issues lead.", icon: "briefcase.fill", color: Theme.pillarGoals),
                .init(id: "business-growth", tab: "Growth", title: "Scale programs", subtitle: "Hiring, wholesale, compliance, and revenue expansion surface next.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "business-learn", tab: "Learn", title: "Train the team", subtitle: "SOPs, QA checklists, scripts, and delegation paths stay close.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "business-life", tab: "Life", title: "Operator stability", subtitle: "Personal money and routines support business continuity.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        case .toolOwner:
            return [
                .init(id: "tool-home", tab: "Home", title: "Rental requests", subtitle: "Inventory, inquiries, and handoff rules stay visible.", icon: "hammer.fill", color: Theme.pillarCar),
                .init(id: "tool-learn", tab: "Learn", title: "Rental basics", subtitle: "Condition, deposits, pickup rules, and rate-setting come first.", icon: "graduationcap.fill", color: Theme.pillarGoals),
                .init(id: "tool-growth", tab: "Growth", title: "Earn more", subtitle: "Bundle tools, kits, and helper demand into stronger rental income.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "tool-life", tab: "Life", title: "Asset planning", subtitle: "Sinking funds cover maintenance, replacement, and upgrades.", icon: "banknote.fill", color: Theme.pillarHome)
            ]
        case .franchise:
            return [
                .init(id: "franchise-home", tab: "Home", title: "Territory health", subtitle: "Operator coverage, compliance, and fulfillment signals lead.", icon: "map.fill", color: Theme.pillarSinking),
                .init(id: "franchise-growth", tab: "Growth", title: "Expansion ladder", subtitle: "Hiring, territory planning, and business programs drive the path.", icon: "arrow.up.right.circle.fill", color: Theme.success),
                .init(id: "franchise-learn", tab: "Learn", title: "Training system", subtitle: "Operator onboarding, SOPs, and quality standards are prioritized.", icon: "graduationcap.fill", color: Theme.accent),
                .init(id: "franchise-life", tab: "Life", title: "Owner baseline", subtitle: "Financial stability and goals stay visible while scaling.", icon: "heart.text.square.fill", color: Theme.danger)
            ]
        }
    }

    var lifeTabActions: [PersonaTabAction] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-life-job", title: "Turn urgency into a job", subtitle: "Move the top home or car item back to Home when hiring beats DIY.", icon: "plus.circle.fill", color: Theme.pillarHome, targetTab: "home"),
                .init(id: "customer-life-learn", title: "Learn before hiring", subtitle: "Use a quick guide to decide what to ask, inspect, or compare.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "customer-life-fund", title: "Fund the next repair", subtitle: "Keep sinking funds visible so surprise work is less stressful.", icon: "banknote.fill", color: Theme.success, targetTab: "life")
            ]
        case .helper:
            return [
                .init(id: "helper-life-demand", title: "Check nearby demand", subtitle: "Tie your income plan to jobs, bids, and availability on Home.", icon: "location.fill", color: Theme.accent, targetTab: "home"),
                .init(id: "helper-life-price", title: "Price the next bid", subtitle: "Review pricing and scope lessons before quoting.", icon: "graduationcap.fill", color: Theme.pillarGoals, targetTab: "learn"),
                .init(id: "helper-life-reserve", title: "Protect slow weeks", subtitle: "Keep reserve and equipment funds ahead of seasonal dips.", icon: "banknote.fill", color: Theme.success, targetTab: "life")
            ]
        case .consultant:
            return [
                .init(id: "consultant-life-offer", title: "Package the offer", subtitle: "Turn your expertise into a priced session or retainer path.", icon: "sparkles", color: Theme.success, targetTab: "growth"),
                .init(id: "consultant-life-playbook", title: "Review client playbook", subtitle: "Practice discovery calls, scoping, and follow-up habits.", icon: "graduationcap.fill", color: Theme.pillarPersonal, targetTab: "learn"),
                .init(id: "consultant-life-capacity", title: "Plan capacity", subtitle: "Keep energy, routines, and follow-ups sustainable.", icon: "heart.fill", color: Theme.danger, targetTab: "life")
            ]
        case .investor:
            return [
                .init(id: "investor-life-signals", title: "Review signals", subtitle: "Move from capital discipline into opportunity evaluation.", icon: "chart.line.uptrend.xyaxis", color: Theme.success, targetTab: "growth"),
                .init(id: "investor-life-diligence", title: "Study due diligence", subtitle: "Learn unit economics before committing money.", icon: "graduationcap.fill", color: Theme.pillarMoney, targetTab: "learn"),
                .init(id: "investor-life-rule", title: "Set capital rules", subtitle: "Keep allocation limits and reserves visible.", icon: "dollarsign.circle.fill", color: Theme.pillarHome, targetTab: "life")
            ]
        case .business:
            return [
                .init(id: "business-life-ops", title: "Check operations", subtitle: "Connect owner stability to open jobs, quality, and cash flow.", icon: "briefcase.fill", color: Theme.pillarGoals, targetTab: "home"),
                .init(id: "business-life-train", title: "Train the team", subtitle: "Use SOP and delegation guides before handing off work.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "business-life-buffer", title: "Plan payroll buffer", subtitle: "Keep cash cushion and owner routines out of the blind spot.", icon: "banknote.fill", color: Theme.success, targetTab: "life")
            ]
        case .toolOwner:
            return [
                .init(id: "tool-life-inventory", title: "Update inventory", subtitle: "Keep tool condition, availability, and handoff tasks current.", icon: "hammer.fill", color: Theme.pillarCar, targetTab: "home"),
                .init(id: "tool-life-rules", title: "Set rental rules", subtitle: "Learn deposits, pickup windows, and condition photos.", icon: "graduationcap.fill", color: Theme.pillarGoals, targetTab: "learn"),
                .init(id: "tool-life-replace", title: "Build replacement fund", subtitle: "Plan maintenance and replacement before rentals scale.", icon: "banknote.fill", color: Theme.pillarHome, targetTab: "life")
            ]
        case .franchise:
            return [
                .init(id: "franchise-life-territory", title: "Review territory", subtitle: "Connect owner baseline to coverage, compliance, and operators.", icon: "map.fill", color: Theme.pillarSinking, targetTab: "home"),
                .init(id: "franchise-life-training", title: "Train operators", subtitle: "Keep onboarding and quality standards close.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn"),
                .init(id: "franchise-life-cadence", title: "Plan compliance cadence", subtitle: "Make recurring checks part of the growth loop.", icon: "checkmark.shield.fill", color: Theme.warning, targetTab: "growth")
            ]
        }
    }

    var growthTabActions: [PersonaTabAction] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-growth-pulse", title: "Finish Life Pulse", subtitle: "Growth starts by knowing which need is urgent enough to act on.", icon: "heart.text.square.fill", color: Theme.danger, targetTab: "life"),
                .init(id: "customer-growth-post", title: "Post or find help", subtitle: "Turn a planned need into a request when it is time to hire.", icon: "house.fill", color: Theme.pillarHome, targetTab: "home"),
                .init(id: "customer-growth-learn", title: "Learn when to DIY", subtitle: "Use guides to compare DIY, hire, or defer.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn")
            ]
        case .helper:
            return [
                .init(id: "helper-growth-bid", title: "Bid first nearby job", subtitle: "Use demand signals and Home actions to create earning momentum.", icon: "location.fill", color: Theme.accent, targetTab: "home"),
                .init(id: "helper-growth-pricing", title: "Finish pricing guide", subtitle: "Learn scope, rate floors, and review-building habits.", icon: "graduationcap.fill", color: Theme.pillarGoals, targetTab: "learn"),
                .init(id: "helper-growth-owner", title: "Build owner path", subtitle: "Move from helper to specialty, team, or business-owner path.", icon: "arrow.up.right.circle.fill", color: Theme.success, targetTab: "growth")
            ]
        case .consultant:
            return [
                .init(id: "consultant-growth-offer", title: "Create paid offer", subtitle: "Package your expertise into a concrete first session.", icon: "sparkles", color: Theme.success, targetTab: "growth"),
                .init(id: "consultant-growth-pipeline", title: "Open client pipeline", subtitle: "Keep intake, follow-ups, and booked sessions in motion.", icon: "person.bubble.fill", color: Theme.pillarPersonal, targetTab: "home"),
                .init(id: "consultant-growth-discovery", title: "Practice discovery", subtitle: "Sharpen calls, scope, pricing, and objections.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn")
            ]
        case .investor:
            return [
                .init(id: "investor-growth-diligence", title: "Start due diligence basics", subtitle: "Use Learn first to understand operators, unit economics, and risk before capital moves.", icon: "graduationcap.fill", color: Theme.pillarMoney, targetTab: "learn"),
                .init(id: "investor-growth-watchlist", title: "Build watchlist", subtitle: "Track operators, territories, and signals after the diligence basics are clear.", icon: "eye.fill", color: Theme.accent, targetTab: "home"),
                .init(id: "investor-growth-pipeline", title: "Review pipeline", subtitle: "Compare franchise, operator, and marketplace opportunities.", icon: "chart.line.uptrend.xyaxis", color: Theme.success, targetTab: "growth")
            ]
        case .business:
            return [
                .init(id: "business-growth-audit", title: "Audit operations", subtitle: "Review team, jobs, quality, and inbox issues before scaling.", icon: "briefcase.fill", color: Theme.pillarGoals, targetTab: "home"),
                .init(id: "business-growth-revenue", title: "Add revenue lane", subtitle: "Explore products, wholesale, recurring plans, or service expansion.", icon: "cart.fill.badge.plus", color: Theme.success, targetTab: "growth"),
                .init(id: "business-growth-training", title: "Find team training", subtitle: "Use SOP and QA guides to remove owner bottlenecks.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn")
            ]
        case .toolOwner:
            return [
                .init(id: "tool-growth-list", title: "List first tool", subtitle: "Add rates, condition, deposit, and photos to start earning.", icon: "hammer.fill", color: Theme.pillarCar, targetTab: "home"),
                .init(id: "tool-growth-bundle", title: "Bundle rental kits", subtitle: "Grow from one-off rentals into demand-based kits.", icon: "shippingbox.fill", color: Theme.success, targetTab: "growth"),
                .init(id: "tool-growth-deposit", title: "Learn deposit rules", subtitle: "Reduce risk with pickup, condition, and damage processes.", icon: "graduationcap.fill", color: Theme.pillarGoals, targetTab: "learn")
            ]
        case .franchise:
            return [
                .init(id: "franchise-growth-health", title: "Check territory health", subtitle: "Track coverage, compliance, and fulfillment risk.", icon: "map.fill", color: Theme.pillarSinking, targetTab: "home"),
                .init(id: "franchise-growth-bench", title: "Build operator bench", subtitle: "Grow with training, standards, and manager coverage.", icon: "person.2.fill", color: Theme.success, targetTab: "growth"),
                .init(id: "franchise-growth-training", title: "Review training system", subtitle: "Keep onboarding and QA standards consistent.", icon: "graduationcap.fill", color: Theme.accent, targetTab: "learn")
            ]
        }
    }

    var learnTabActions: [PersonaTabAction] {
        switch self {
        case .customer:
            return [
                .init(id: "customer-learn-hire", title: "Hire with confidence", subtitle: "Compare bids, profiles, reviews, and protected payment basics.", icon: "house.and.flag.fill", color: Theme.pillarHome, learnCategory: "customer"),
                .init(id: "customer-learn-maintenance", title: "Understand maintenance", subtitle: "Know what to inspect before a helper arrives.", icon: "wrench.fill", color: Theme.accent, learnCategory: "maintenance"),
                .init(id: "customer-learn-car", title: "Handle car basics", subtitle: "Keep car-care decisions from becoming urgent surprises.", icon: "car.fill", color: Theme.pillarCar, learnCategory: "car-care")
            ]
        case .helper:
            return [
                .init(id: "helper-learn-reputation", title: "Build reputation", subtitle: "Win reviews with profile quality, communication, and prep.", icon: "star.fill", color: Theme.accent, learnCategory: "helper"),
                .init(id: "helper-learn-maintenance", title: "Sharpen trade basics", subtitle: "Improve execution before bidding higher-value work.", icon: "wrench.fill", color: Theme.pillarGoals, learnCategory: "maintenance"),
                .init(id: "helper-learn-safety", title: "Work safely", subtitle: "Use trust, scope, and communication routines on each job.", icon: "checkmark.shield.fill", color: Theme.success, learnCategory: "helper")
            ]
        case .consultant:
            return [
                .init(id: "consultant-learn-offer", title: "Package expertise", subtitle: "Turn advice into a clear session, scope, and outcome.", icon: "person.bubble.fill", color: Theme.pillarPersonal, learnCategory: "consulting"),
                .init(id: "consultant-learn-sales", title: "Practice sales calls", subtitle: "Use discovery, objection, and follow-up playbooks.", icon: "person.2.fill", color: Theme.success, learnCategory: "sales"),
                .init(id: "consultant-learn-business", title: "Operate the practice", subtitle: "Keep pricing, delivery, and client retention visible.", icon: "briefcase.fill", color: Theme.pillarGoals, learnCategory: "business")
            ]
        case .investor:
            return [
                .init(id: "investor-learn-management", title: "Evaluate operators", subtitle: "Study unit economics, quality signals, and management basics.", icon: "clipboard.fill", color: Theme.pillarMoney, learnCategory: "management"),
                .init(id: "investor-learn-franchise", title: "Understand territories", subtitle: "Review franchise economics, coverage, and compliance signals.", icon: "building.2.fill", color: Theme.pillarSinking, learnCategory: "franchise"),
                .init(id: "investor-learn-business", title: "Read business health", subtitle: "Learn what sustainable local service growth looks like.", icon: "briefcase.fill", color: Theme.success, learnCategory: "business")
            ]
        case .business:
            return [
                .init(id: "business-learn-ops", title: "Standardize operations", subtitle: "Build SOPs, QA checks, and delegation habits.", icon: "briefcase.fill", color: Theme.pillarGoals, learnCategory: "business"),
                .init(id: "business-learn-management", title: "Manage the team", subtitle: "Use scheduling, roles, and accountability systems.", icon: "clipboard.fill", color: Theme.pillarMoney, learnCategory: "management"),
                .init(id: "business-learn-support", title: "Improve support", subtitle: "Reduce disputes with communication and service recovery.", icon: "headphones", color: Theme.accent, learnCategory: "support")
            ]
        case .toolOwner:
            return [
                .init(id: "tool-learn-rental", title: "Launch rentals safely", subtitle: "Set deposits, pickup rules, condition photos, and rates.", icon: "hammer.fill", color: Theme.pillarCar, learnCategory: "tool-rental"),
                .init(id: "tool-learn-maintenance", title: "Maintain inventory", subtitle: "Keep tools ready, documented, and rentable.", icon: "wrench.fill", color: Theme.pillarHome, learnCategory: "maintenance"),
                .init(id: "tool-learn-business", title: "Grow rental income", subtitle: "Bundle kits and connect inventory to local demand.", icon: "briefcase.fill", color: Theme.success, learnCategory: "business")
            ]
        case .franchise:
            return [
                .init(id: "franchise-learn-system", title: "Run the territory", subtitle: "Learn territory setup, compliance, and operator standards.", icon: "building.2.fill", color: Theme.pillarSinking, learnCategory: "franchise"),
                .init(id: "franchise-learn-management", title: "Manage operators", subtitle: "Use training, QA, and coverage routines.", icon: "clipboard.fill", color: Theme.pillarMoney, learnCategory: "management"),
                .init(id: "franchise-learn-support", title: "Protect service quality", subtitle: "Build escalation, support, and customer recovery habits.", icon: "headphones", color: Theme.accent, learnCategory: "support")
            ]
        }
    }

    var primaryLearnCategory: String {
        switch self {
        case .customer: return "customer"
        case .helper: return "helper"
        case .business: return "business"
        case .consultant: return "consulting"
        case .toolOwner: return "tool-rental"
        case .franchise: return "franchise"
        case .investor: return "management"
        }
    }

    var serverMode: String {
        switch self {
        case .customer: return "customer"
        case .helper: return "helper"
        case .business: return "business_owner"
        case .consultant: return "consultant"
        case .toolOwner: return "tool_owner"
        case .franchise: return "franchise_applicant"
        case .investor: return "investor"
        }
    }

    init(serverMode: String?) {
        switch serverMode?.lowercased() {
        case "helper":
            self = .helper
        case "business_owner", "business":
            self = .business
        case "consultant":
            self = .consultant
        case "tool_owner":
            self = .toolOwner
        case "franchise_applicant", "franchise", "franchise_owner":
            self = .franchise
        case "investor":
            self = .investor
        default:
            self = .customer
        }
    }

    static var productionCoverageIssues: [String] {
        let expectedLoopTabs = Set(["Home", "Life", "Growth", "Learn"])
        let validTargetTabs = Set(["home", "life", "growth", "learn"])
        let learnCategories = Set(LearnGuideCatalog.all.map(\.category))
        var issues: [String] = []
        var serverModes = Set<String>()

        for persona in allCases {
            let label = persona.rawValue
            let signalTabs = persona.loopSignals.map(\.tab)
            let signalTabSet = Set(signalTabs)
            let missingLoopTabs = expectedLoopTabs.subtracting(signalTabSet)
            let extraLoopTabs = signalTabSet.subtracting(expectedLoopTabs)

            if persona.loopSignals.count != expectedLoopTabs.count {
                issues.append("\(label) has \(persona.loopSignals.count) loop signals; expected \(expectedLoopTabs.count).")
            }
            if !missingLoopTabs.isEmpty {
                issues.append("\(label) is missing loop tabs: \(missingLoopTabs.sorted().joined(separator: ", ")).")
            }
            if !extraLoopTabs.isEmpty {
                issues.append("\(label) has unsupported loop tabs: \(extraLoopTabs.sorted().joined(separator: ", ")).")
            }
            if signalTabs.count != signalTabSet.count {
                issues.append("\(label) has duplicate loop tab signals.")
            }

            issues.append(contentsOf: audit(
                actions: persona.lifeTabActions,
                tabName: "Life",
                persona: persona,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: true,
                requiresLearnCategory: false
            ))
            issues.append(contentsOf: audit(
                actions: persona.growthTabActions,
                tabName: "Growth",
                persona: persona,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: true,
                requiresLearnCategory: false
            ))
            issues.append(contentsOf: audit(
                actions: persona.learnTabActions,
                tabName: "Learn",
                persona: persona,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: false,
                requiresLearnCategory: true
            ))

            if !learnCategories.contains(persona.primaryLearnCategory) {
                issues.append("\(label) primary Learn category '\(persona.primaryLearnCategory)' is not in the guide catalog.")
            }
            if !serverModes.insert(persona.serverMode).inserted {
                issues.append("Duplicate server mode '\(persona.serverMode)' for \(label).")
            }
            if Persona(serverMode: persona.serverMode) != persona {
                issues.append("\(label) server mode '\(persona.serverMode)' does not round-trip.")
            }
            if Persona(rawValue: persona.rawValue) != persona {
                issues.append("\(label) raw value does not round-trip.")
            }
        }

        for role in BusinessSubPersona.allCases {
            let label = "Business \(role.rawValue)"
            let setupIDs = role.setupOptions.map(\.id)
            if role.setupOptions.count < 3 {
                issues.append("\(label) has \(role.setupOptions.count) setup options; expected at least 3.")
            }
            if setupIDs.count != Set(setupIDs).count {
                issues.append("\(label) setup options contain duplicate IDs.")
            }
            let signalTabs = role.loopSignals.map(\.tab)
            let signalTabSet = Set(signalTabs)
            let missingLoopTabs = expectedLoopTabs.subtracting(signalTabSet)
            if role.loopSignals.count != expectedLoopTabs.count {
                issues.append("\(label) has \(role.loopSignals.count) loop signals; expected \(expectedLoopTabs.count).")
            }
            if !missingLoopTabs.isEmpty {
                issues.append("\(label) is missing loop tabs: \(missingLoopTabs.sorted().joined(separator: ", ")).")
            }
            if signalTabs.count != signalTabSet.count {
                issues.append("\(label) has duplicate loop tab signals.")
            }
            issues.append(contentsOf: audit(
                actions: role.lifeTabActions,
                tabName: "Life",
                persona: .business,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: true,
                requiresLearnCategory: false
            ).map { $0.replacingOccurrences(of: "Business Owner", with: label) })
            issues.append(contentsOf: audit(
                actions: role.growthTabActions,
                tabName: "Growth",
                persona: .business,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: true,
                requiresLearnCategory: false
            ).map { $0.replacingOccurrences(of: "Business Owner", with: label) })
            issues.append(contentsOf: audit(
                actions: role.learnTabActions,
                tabName: "Learn",
                persona: .business,
                validTargetTabs: validTargetTabs,
                learnCategories: learnCategories,
                requiresTargetTab: false,
                requiresLearnCategory: true
            ).map { $0.replacingOccurrences(of: "Business Owner", with: label) })
            if !learnCategories.contains(role.primaryLearnCategory) {
                issues.append("\(label) primary Learn category '\(role.primaryLearnCategory)' is not in the guide catalog.")
            }
        }

        return issues
    }

    private static func audit(
        actions: [PersonaTabAction],
        tabName: String,
        persona: Persona,
        validTargetTabs: Set<String>,
        learnCategories: Set<String>,
        requiresTargetTab: Bool,
        requiresLearnCategory: Bool
    ) -> [String] {
        var issues: [String] = []
        let label = persona.rawValue

        if actions.count < 3 {
            issues.append("\(label) \(tabName) has \(actions.count) actions; expected at least 3.")
        }

        let ids = actions.map(\.id)
        if ids.count != Set(ids).count {
            issues.append("\(label) \(tabName) actions contain duplicate IDs.")
        }

        for action in actions {
            if action.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("\(label) \(tabName) action '\(action.id)' has an empty title.")
            }
            if action.subtitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                issues.append("\(label) \(tabName) action '\(action.id)' has an empty subtitle.")
            }
            if requiresTargetTab {
                guard let targetTab = action.targetTab?.lowercased(), !targetTab.isEmpty else {
                    issues.append("\(label) \(tabName) action '\(action.id)' is missing a target tab.")
                    continue
                }
                if !validTargetTabs.contains(targetTab) {
                    issues.append("\(label) \(tabName) action '\(action.id)' targets unsupported tab '\(targetTab)'.")
                }
            }
            if requiresLearnCategory {
                guard let learnCategory = action.learnCategory, !learnCategory.isEmpty else {
                    issues.append("\(label) \(tabName) action '\(action.id)' is missing a Learn category.")
                    continue
                }
                if !learnCategories.contains(learnCategory) {
                    issues.append("\(label) \(tabName) action '\(action.id)' uses unknown Learn category '\(learnCategory)'.")
                }
            }
        }

        return issues
    }
}

final class PersonaStore: ObservableObject {
    private static let storageKey = "ox.persona.active"
    private static let explicitPersonaStorageKey = "ox.persona.hasExplicit"
    private static let businessRoleStorageKey = "ox.persona.businessRole"
    private static let businessRoleSetupStorageKey = "ox.persona.businessRoleSetup"
    private static let calibrationStorageKey = "ox.persona.calibration"
    private static let setupSignalStorageKey = "ox.persona.setupSignals"

    @Published var active: Persona {
        didSet {
            UserDefaults.standard.set(active.rawValue, forKey: Self.storageKey)
        }
    }

    @Published var hasExplicitPersona: Bool {
        didSet {
            UserDefaults.standard.set(hasExplicitPersona, forKey: Self.explicitPersonaStorageKey)
        }
    }

    @Published var businessSubPersona: BusinessSubPersona {
        didSet {
            UserDefaults.standard.set(businessSubPersona.rawValue, forKey: Self.businessRoleStorageKey)
        }
    }

    @Published private var businessRoleSetupByRole: [String: String] {
        didSet {
            UserDefaults.standard.set(businessRoleSetupByRole, forKey: Self.businessRoleSetupStorageKey)
        }
    }

    @Published private var calibrationByPersona: [String: [String]] {
        didSet {
            UserDefaults.standard.set(calibrationByPersona, forKey: Self.calibrationStorageKey)
        }
    }

    @Published private var setupSignalsByPersona: [String: [String: String]] {
        didSet {
            UserDefaults.standard.set(setupSignalsByPersona, forKey: Self.setupSignalStorageKey)
        }
    }

    init() {
#if DEBUG
        let coverageIssues = Persona.productionCoverageIssues
        assert(coverageIssues.isEmpty, "OxPersona production coverage issues:\n\(coverageIssues.joined(separator: "\n"))")
#endif
        calibrationByPersona = UserDefaults.standard.dictionary(forKey: Self.calibrationStorageKey) as? [String: [String]] ?? [:]
        setupSignalsByPersona = UserDefaults.standard.dictionary(forKey: Self.setupSignalStorageKey) as? [String: [String: String]] ?? [:]
        businessRoleSetupByRole = UserDefaults.standard.dictionary(forKey: Self.businessRoleSetupStorageKey) as? [String: String] ?? [:]

        if let rawRole = UserDefaults.standard.string(forKey: Self.businessRoleStorageKey),
           let storedRole = BusinessSubPersona(rawValue: rawRole) {
            businessSubPersona = storedRole
        } else {
            businessSubPersona = .owner
        }

        if let raw = UserDefaults.standard.string(forKey: Self.storageKey),
           let stored = Persona(rawValue: raw) {
            active = stored
        } else {
            active = .customer
        }

        if UserDefaults.standard.object(forKey: Self.explicitPersonaStorageKey) != nil {
            hasExplicitPersona = UserDefaults.standard.bool(forKey: Self.explicitPersonaStorageKey)
        } else {
            hasExplicitPersona = UserDefaults.standard.string(forKey: Self.storageKey) != nil
        }
    }

    func businessRoleSetupOptionID(for role: BusinessSubPersona) -> String? {
        businessRoleSetupByRole[role.rawValue]
    }

    func businessRoleSetupOption(for role: BusinessSubPersona) -> BusinessRoleSetupOption? {
        let storedID = businessRoleSetupOptionID(for: role) ?? role.setupOptions.first?.id
        return role.setupOptions.first { $0.id == storedID } ?? role.setupOptions.first
    }

    func setBusinessRoleSetupOptionID(_ id: String?, for role: BusinessSubPersona) {
        var updated = businessRoleSetupByRole
        if let id {
            updated[role.rawValue] = id
        } else {
            updated.removeValue(forKey: role.rawValue)
        }
        businessRoleSetupByRole = updated
    }

    func calibrationIDs(for persona: Persona) -> Set<String> {
        Set(calibrationByPersona[persona.rawValue] ?? [])
    }

    func calibrationOptions(for persona: Persona) -> [PersonaCalibrationOption] {
        persona.calibrationOptions(matching: calibrationIDs(for: persona))
    }

    func setCalibrationIDs(_ ids: Set<String>, for persona: Persona) {
        var updated = calibrationByPersona
        updated[persona.rawValue] = Array(ids).sorted()
        calibrationByPersona = updated
    }

    func setupSignalID(for persona: Persona, kind: PersonaSetupSignalKind) -> String? {
        setupSignalsByPersona[persona.rawValue]?[kind.rawValue]
    }

    func setupSignalIDs(for persona: Persona) -> Set<String> {
        Set(setupSignalsByPersona[persona.rawValue].map { Array($0.values) } ?? [])
    }

    func setupSignalOptions(for persona: Persona) -> [PersonaSetupSignalOption] {
        persona.setupSignalOptions(matching: setupSignalIDs(for: persona))
    }

    func setSetupSignalID(_ id: String?, kind: PersonaSetupSignalKind, for persona: Persona) {
        var updated = setupSignalsByPersona
        var personaSignals = updated[persona.rawValue] ?? [:]
        if let id {
            personaSignals[kind.rawValue] = id
        } else {
            personaSignals.removeValue(forKey: kind.rawValue)
        }
        updated[persona.rawValue] = personaSignals
        setupSignalsByPersona = updated
    }
}
