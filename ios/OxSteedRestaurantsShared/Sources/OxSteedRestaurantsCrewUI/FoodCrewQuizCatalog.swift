import Foundation

struct FoodCrewQuizChoice: Identifiable, Hashable {
    let id = UUID()
    let text: String
}

struct FoodCrewQuizQuestion: Identifiable, Hashable {
    let id = UUID()
    let prompt: String
    let choices: [FoodCrewQuizChoice]
    let correctIndex: Int
}

struct FoodCrewQuizDefinition: Identifiable, Hashable {
    let id: String
    let title: String
    let passingScore: Int
    let questions: [FoodCrewQuizQuestion]

    static let catalog: [FoodCrewQuizDefinition] = [
        FoodCrewQuizDefinition(
            id: "allergen-protocol",
            title: "Allergen protocol quiz",
            passingScore: 80,
            questions: [
                FoodCrewQuizQuestion(
                    prompt: "When a guest reports a peanut allergy, what must happen before the ticket leaves the POS?",
                    choices: [
                        FoodCrewQuizChoice(text: "Note it verbally only"),
                        FoodCrewQuizChoice(text: "Mark allergens on the ticket and confirm with expo"),
                        FoodCrewQuizChoice(text: "Swap any fried item automatically"),
                    ],
                    correctIndex: 1
                ),
                FoodCrewQuizQuestion(
                    prompt: "Where should allergen-modified orders be packaged?",
                    choices: [
                        FoodCrewQuizChoice(text: "Same bag as other orders to save time"),
                        FoodCrewQuizChoice(text: "Marked separate bag with visual allergen label"),
                        FoodCrewQuizChoice(text: "Only if the guest asks again at pickup"),
                    ],
                    correctIndex: 1
                ),
                FoodCrewQuizQuestion(
                    prompt: "If you are unsure about an ingredient, the correct action is:",
                    choices: [
                        FoodCrewQuizChoice(text: "Guess based on similar menu items"),
                        FoodCrewQuizChoice(text: "Pause service and verify with a manager or recipe card"),
                        FoodCrewQuizChoice(text: "Tell the guest it should be fine"),
                    ],
                    correctIndex: 1
                ),
            ]
        ),
        FoodCrewQuizDefinition(
            id: "food-safety-cold-hold",
            title: "Food safety — cold hold",
            passingScore: 80,
            questions: [
                FoodCrewQuizQuestion(
                    prompt: "Cold hold must stay at or below:",
                    choices: [
                        FoodCrewQuizChoice(text: "45°F / 7°C"),
                        FoodCrewQuizChoice(text: "41°F / 5°C"),
                        FoodCrewQuizChoice(text: "32°F / 0°C"),
                    ],
                    correctIndex: 1
                ),
                FoodCrewQuizQuestion(
                    prompt: "If a walk-in reads 44°F at open, you should:",
                    choices: [
                        FoodCrewQuizChoice(text: "Log it and move high-risk product out of the unit"),
                        FoodCrewQuizChoice(text: "Ignore until the lunch rush ends"),
                        FoodCrewQuizChoice(text: "Raise the thermostat and recheck tomorrow"),
                    ],
                    correctIndex: 0
                ),
                FoodCrewQuizQuestion(
                    prompt: "Thermometer checks should be logged:",
                    choices: [
                        FoodCrewQuizChoice(text: "Only after a health inspection"),
                        FoodCrewQuizChoice(text: "At open, mid-shift, and after any corrective action"),
                        FoodCrewQuizChoice(text: "Once per week"),
                    ],
                    correctIndex: 1
                ),
            ]
        ),
        FoodCrewQuizDefinition(
            id: "refund-void-policy",
            title: "Refund and void quiz",
            passingScore: 80,
            questions: [
                FoodCrewQuizQuestion(
                    prompt: "Who can approve a full order void after food has been started?",
                    choices: [
                        FoodCrewQuizChoice(text: "Any cashier without documentation"),
                        FoodCrewQuizChoice(text: "Manager on duty with reason captured in POS"),
                        FoodCrewQuizChoice(text: "Kitchen lead only"),
                    ],
                    correctIndex: 1
                ),
                FoodCrewQuizQuestion(
                    prompt: "When remaking an incorrect item, you should:",
                    choices: [
                        FoodCrewQuizChoice(text: "Trash the original without noting waste"),
                        FoodCrewQuizChoice(text: "Mark waste/remake reason so inventory and coaching stay accurate"),
                        FoodCrewQuizChoice(text: "Serve both versions if the guest might want them"),
                    ],
                    correctIndex: 1
                ),
            ]
        ),
    ]

    static func definition(matching title: String) -> FoodCrewQuizDefinition? {
        catalog.first { $0.title.caseInsensitiveCompare(title) == .orderedSame }
            ?? catalog.first { title.localizedCaseInsensitiveContains($0.title) || $0.title.localizedCaseInsensitiveContains(title) }
    }
}
