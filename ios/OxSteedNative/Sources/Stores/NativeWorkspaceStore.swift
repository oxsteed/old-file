import Foundation
import Observation

@Observable
final class NativeWorkspaceStore {
    var isSubmitting = false
    var resultMessage: String?
    var errorMessage: String?

    @MainActor
    func submitJobDraft(_ draft: JobDraftRequest, using apiClient: OxSteedAPIClient) async {
        await submit {
            try await apiClient.post("/jobs", body: draft) as GenericMutationResponse
        }
    }

    @MainActor
    func submitLogisticsRequest(_ draft: LogisticsSourcingRequestDraft, using apiClient: OxSteedAPIClient) async {
        await submit {
            try await apiClient.post("/logistics/requests", body: draft) as GenericMutationResponse
        }
    }

    @MainActor
    func submitTranslation(_ draft: TranslationDraftRequest, using apiClient: OxSteedAPIClient) async {
        await submit {
            try await apiClient.post("/translate", body: draft) as GenericMutationResponse
        }
    }

    @MainActor
    private func submit(_ operation: () async throws -> GenericMutationResponse) async {
        isSubmitting = true
        resultMessage = nil
        errorMessage = nil
        defer { isSubmitting = false }

        do {
            let response = try await operation()
            resultMessage = response.displayText
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
