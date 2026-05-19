import Foundation

final class OxSteedAPIClient {
    static let shared = OxSteedAPIClient()

    private let baseURL = URL(string: "https://oxsteed.com/api")!
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        return decoder
    }()

    func popularDiscover() async throws -> [DiscoverItem] {
        let response: DiscoverResponse = try await get("discover/popular", queryItems: [
            URLQueryItem(name: "limit", value: "16")
        ])
        return response.results
    }

    func searchDiscover(query: String) async throws -> [DiscoverItem] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return try await popularDiscover() }
        let response: DiscoverResponse = try await get("discover", queryItems: [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "limit", value: "24")
        ])
        return response.results
    }

    func helpers(query: String = "") async throws -> [NativeHelper] {
        var items = [
            URLQueryItem(name: "limit", value: "12"),
            URLQueryItem(name: "sort", value: "best_match")
        ]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "query", value: trimmed))
        }
        let response: HelpersResponse = try await get("helpers", queryItems: items)
        return response.helpers + (response.businesses ?? [])
    }

    func jobs() async throws -> [NativeJob] {
        let response: JobsResponse = try await get("jobs", queryItems: [
            URLQueryItem(name: "limit", value: "15"),
            URLQueryItem(name: "sort", value: "newest")
        ])
        return response.jobs
    }

    func products() async throws -> [NativeProduct] {
        let response: ProductBrowseResponse = try await get("marketplace/products/browse", queryItems: [
            URLQueryItem(name: "limit", value: "12"),
            URLQueryItem(name: "sortBy", value: "newest")
        ])
        return response.data
    }

    func helperProfile(id: String) async throws -> HelperProfileResponse {
        try await get("helpers/\(id)/profile")
    }

    func jobDetail(id: String) async throws -> NativeJobDetail {
        try await get("jobs/\(id)")
    }

    func productDetail(id: String) async throws -> NativeProductDetail {
        let response: APIDataResponse<NativeProductDetail> = try await get("marketplace/products/\(id)")
        return response.data
    }

    func login(email: String, password: String, agreementName: String) async throws -> LoginResponse {
        try await post("auth/login", body: [
            "email": email,
            "password": password,
            "rememberMe": true,
            "termsAgreed": true,
            "agreementName": agreementName
        ], authenticated: false)
    }

    func registerAccount(_ payload: RegistrationSubmission) async throws -> LoginResponse {
        try await postEncodable("auth/register", body: payload, authenticated: false)
    }

    func submitConsultation(_ payload: ConsultingSubmission) async throws -> ConsultingResponse {
        try await postEncodable("consulting/submit", body: payload, authenticated: false)
    }

    func submitJob(_ payload: JobSubmission) async throws -> JobSubmissionResponse {
        try await postEncodable("jobs", body: payload, authenticated: true)
    }

    func submitBookingRequest(_ payload: BookingRequestSubmission) async throws -> BookingRequestResponse {
        try await postEncodable("bookings", body: payload, authenticated: true)
    }

    func submitBid(_ payload: BidSubmission) async throws -> BidResponse {
        try await postEncodable("bids", body: payload, authenticated: true)
    }

    func conversations() async throws -> [ConversationItem] {
        try await get("messages/conversations", authenticated: true)
    }

    func conversationMessages(conversationId: String) async throws -> [MessageItem] {
        try await get("messages/conversations/\(conversationId)", queryItems: [
            URLQueryItem(name: "limit", value: "60")
        ], authenticated: true)
    }

    func sendMessage(conversationId: String, content: String) async throws -> MessageSendResponse {
        try await post("messages/conversations/\(conversationId)", body: [
            "content": content
        ], authenticated: true)
    }

    func appointments() async throws -> [AppointmentItem] {
        let response: AppointmentsResponse = try await get("calendar/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "10")
        ], authenticated: true)
        return response.appointments
    }

    func appointments(role: String) async throws -> [AppointmentItem] {
        let response: AppointmentsResponse = try await get("calendar/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "25"),
            URLQueryItem(name: "role", value: role)
        ], authenticated: true)
        return response.appointments
    }

    func businesses() async throws -> [NativeBusiness] {
        let response: BusinessListResponse = try await get("businesses", authenticated: true)
        return response.businesses
    }

    func managedBusinesses() async throws -> [NativeBusiness] {
        let response: BusinessListResponse = try await get("businesses/managed", authenticated: true)
        return response.businesses
    }

    func createCart(name: String, description: String?) async throws -> CartCreateResponse {
        try await post("carts", body: [
            "name": name,
            "description": description ?? ""
        ], authenticated: true)
    }

    func addProduct(productId: String, toCart cartId: String, quantity: Int) async throws -> CartItemResponse {
        try await post("carts/\(cartId)/items", body: [
            "productId": productId,
            "quantity": quantity
        ], authenticated: true)
    }

    func tools(query: String = "") async throws -> [NativeToolRental] {
        var items = [
            URLQueryItem(name: "limit", value: "20"),
            URLQueryItem(name: "sort", value: "newest")
        ]
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            items.append(URLQueryItem(name: "name", value: trimmed))
        }
        let response: ToolBrowseResponse = try await get("tool-rentals/browse", queryItems: items)
        return response.tools
    }

    func toolDetail(id: String) async throws -> NativeToolRental {
        let response: ToolDetailResponse = try await get("tool-rentals/public/\(id)")
        return response.tool
    }

    func bookTool(_ payload: ToolBookingSubmission) async throws -> ToolBookingResponse {
        try await postEncodable("tool-rentals/bookings", body: payload, authenticated: true)
    }

    func businessAppointments(businessId: String) async throws -> [BusinessAppointmentItem] {
        let response: BusinessAppointmentsResponse = try await get("businesses/\(businessId)/appointments", queryItems: [
            URLQueryItem(name: "limit", value: "25")
        ], authenticated: true)
        return response.appointments
    }

    func businessProfileEdit(businessId: String) async throws -> BusinessProfileEdit {
        let response: BusinessProfileEditResponse = try await get("businesses/\(businessId)/profile-edit", authenticated: true)
        return response.business
    }

    func createBusiness(_ payload: BusinessProfileUpdate) async throws -> BusinessMutationResponse {
        try await postEncodable("businesses", body: payload, authenticated: true)
    }

    func updateBusiness(id: String, payload: BusinessProfileUpdate) async throws -> BusinessMutationResponse {
        try await putEncodable("businesses/\(id)", body: payload, authenticated: true)
    }

    func createBusinessService(businessId: String, payload: BusinessServiceSubmission) async throws -> NativeBusinessService {
        try await postEncodable("businesses/\(businessId)/services", body: payload, authenticated: true)
    }

    func businessInvoices(businessId: String) async throws -> BusinessInvoiceListResponse {
        try await get("businesses/\(businessId)/invoices", queryItems: [
            URLQueryItem(name: "limit", value: "25")
        ], authenticated: true)
    }

    func createBusinessInvoice(businessId: String, payload: BusinessInvoiceSubmission) async throws -> BusinessInvoiceMutationResponse {
        try await postEncodable("businesses/\(businessId)/invoices", body: payload, authenticated: true)
    }

    func sendBusinessInvoice(businessId: String, invoiceId: String) async throws -> BusinessInvoiceMutationResponse {
        try await post("businesses/\(businessId)/invoices/\(invoiceId)/send", body: [:], authenticated: true)
    }

    func markBusinessInvoicePaid(businessId: String, invoiceId: String, amount: Double?) async throws -> BusinessInvoiceMutationResponse {
        var body: [String: Any] = [:]
        if let amount {
            body["amount"] = amount
        }
        return try await post("businesses/\(businessId)/invoices/\(invoiceId)/pay", body: body, authenticated: true)
    }

    func businessClients(businessId: String) async throws -> [BusinessClientItem] {
        let response: BusinessClientsResponse = try await get("businesses/\(businessId)/clients", queryItems: [
            URLQueryItem(name: "limit", value: "50")
        ], authenticated: true)
        return response.clients
    }

    func createBusinessClient(businessId: String, payload: BusinessClientSubmission) async throws -> BusinessClientMutationResponse {
        try await postEncodable("businesses/\(businessId)/clients", body: payload, authenticated: true)
    }

    func businessMembers(businessId: String) async throws -> [BusinessMemberItem] {
        let response: BusinessMembersResponse = try await get("businesses/\(businessId)/members", authenticated: true)
        return response.members
    }

    func inviteBusinessMember(businessId: String, payload: BusinessMemberInviteSubmission) async throws -> BusinessMemberInviteResponse {
        try await postEncodable("businesses/\(businessId)/members", body: payload, authenticated: true)
    }

    func businessProducts(businessId: String) async throws -> [BusinessProductItem] {
        let response: BusinessProductListResponse = try await get("businesses/\(businessId)/products", queryItems: [
            URLQueryItem(name: "limit", value: "25")
        ], authenticated: true)
        return response.data
    }

    func createBusinessProduct(businessId: String, payload: BusinessProductSubmission) async throws -> BusinessProductMutationResponse {
        try await postEncodable("businesses/\(businessId)/products", body: payload, authenticated: true)
    }

    func businessProductDetail(businessId: String, productId: String) async throws -> BusinessProductDetail {
        let response: BusinessProductDetailResponse = try await get("businesses/\(businessId)/products/\(productId)", authenticated: true)
        return response.data
    }

    func businessLowStockAlerts(businessId: String) async throws -> [BusinessLowStockItem] {
        let response: BusinessLowStockResponse = try await get("businesses/\(businessId)/products/alerts/low-stock", authenticated: true)
        return response.data
    }

    func createBusinessProductVariant(businessId: String, productId: String, payload: BusinessProductVariantSubmission) async throws -> BusinessProductVariantMutationResponse {
        try await postEncodable("businesses/\(businessId)/products/\(productId)/variants", body: payload, authenticated: true)
    }

    func adjustBusinessProductInventory(businessId: String, productId: String, variantId: String, payload: BusinessInventoryAdjustmentSubmission) async throws -> BusinessInventoryAdjustmentResponse {
        try await putEncodable("businesses/\(businessId)/products/\(productId)/variants/\(variantId)/inventory", body: payload, authenticated: true)
    }

    func businessServicePackages(businessId: String) async throws -> [BusinessServicePackage] {
        try await get("businesses/\(businessId)/packages", authenticated: true)
    }

    func createBusinessServicePackage(businessId: String, payload: BusinessServicePackageSubmission) async throws -> BusinessServicePackage {
        try await postEncodable("businesses/\(businessId)/packages", body: payload, authenticated: true)
    }

    func businessClientPackages(businessId: String) async throws -> [BusinessClientPackage] {
        try await get("businesses/\(businessId)/client-packages", authenticated: true)
    }

    func issueBusinessClientPackage(businessId: String, payload: BusinessClientPackageIssueSubmission) async throws -> BusinessClientPackage {
        try await postEncodable("businesses/\(businessId)/client-packages", body: payload, authenticated: true)
    }

    func redeemBusinessClientPackage(businessId: String, clientPackageId: String) async throws -> BusinessClientPackage {
        try await post("businesses/\(businessId)/client-packages/\(clientPackageId)/redeem", body: [:], authenticated: true)
    }

    func businessBulkPricingTiers(businessId: String, productId: String) async throws -> [BusinessBulkPricingTier] {
        let response: BusinessBulkPricingTiersResponse = try await get("businesses/\(businessId)/products/\(productId)/bulk-pricing", authenticated: true)
        return response.data
    }

    func setBusinessBulkPricingTiers(businessId: String, productId: String, tiers: [BusinessBulkPricingTier]) async throws -> BusinessBulkPricingTiersMutationResponse {
        try await postEncodable("businesses/\(businessId)/products/\(productId)/bulk-pricing", body: BusinessBulkPricingTiersSubmission(tiers: tiers), authenticated: true)
    }

    func businessProductPricingRules(businessId: String) async throws -> [BusinessProductPricingRule] {
        let response: BusinessProductPricingRulesResponse = try await get("businesses/\(businessId)/product-pricing/rules", queryItems: [
            URLQueryItem(name: "limit", value: "50")
        ], authenticated: true)
        return response.data
    }

    func createBusinessProductPricingRule(businessId: String, payload: BusinessProductPricingRuleSubmission) async throws -> BusinessProductPricingRuleMutationResponse {
        try await postEncodable("businesses/\(businessId)/product-pricing/rules", body: payload, authenticated: true)
    }

    func businessAnalytics(businessId: String) async throws -> BusinessAnalyticsResponse {
        try await get("businesses/\(businessId)/analytics", authenticated: true)
    }

    func businessTax(businessId: String) async throws -> BusinessTaxResponse {
        try await get("businesses/\(businessId)/tax", authenticated: true)
    }

    func businessCalendarSummary(businessId: String) async throws -> BusinessCalendarSummary {
        let response: APIDataResponse<BusinessCalendarSummary> = try await get("businesses/\(businessId)/calendar/summary", authenticated: true)
        return response.data
    }

    func createBusinessCalendarEvent(businessId: String, payload: BusinessCalendarEventSubmission) async throws -> BusinessCalendarEvent {
        let response: APIDataResponse<BusinessCalendarEventMutationData> = try await postEncodable("businesses/\(businessId)/calendar/events", body: payload, authenticated: true)
        return response.data.event
    }

    func businessExpenses(businessId: String) async throws -> BusinessExpensesResponse {
        try await get("businesses/\(businessId)/expenses", queryItems: [
            URLQueryItem(name: "limit", value: "40")
        ], authenticated: true)
    }

    func createBusinessExpense(businessId: String, payload: BusinessExpenseSubmission) async throws -> BusinessExpenseItem {
        try await postEncodable("businesses/\(businessId)/expenses", body: payload, authenticated: true)
    }

    func businessQuotes(businessId: String) async throws -> BusinessQuotesResponse {
        try await get("businesses/\(businessId)/quotes", queryItems: [
            URLQueryItem(name: "limit", value: "40")
        ], authenticated: true)
    }

    func createBusinessQuote(businessId: String, payload: BusinessQuoteSubmission) async throws -> BusinessQuoteItem {
        try await postEncodable("businesses/\(businessId)/quotes", body: payload, authenticated: true)
    }

    func sendBusinessQuote(businessId: String, quoteId: String) async throws -> BusinessQuoteItem {
        try await post("businesses/\(businessId)/quotes/\(quoteId)/send", body: [:], authenticated: true)
    }

    func businessLeads(businessId: String) async throws -> BusinessLeadsResponse {
        try await get("businesses/\(businessId)/leads", queryItems: [
            URLQueryItem(name: "limit", value: "40")
        ], authenticated: true)
    }

    func createBusinessLead(businessId: String, payload: BusinessLeadSubmission) async throws -> BusinessLeadItem {
        try await postEncodable("businesses/\(businessId)/leads", body: payload, authenticated: true)
    }

    func businessRecurringBilling(businessId: String) async throws -> [BusinessRecurringBillingItem] {
        try await get("businesses/\(businessId)/recurring", authenticated: true)
    }

    func createBusinessRecurringBilling(businessId: String, payload: BusinessRecurringBillingSubmission) async throws -> BusinessRecurringBillingItem {
        try await postEncodable("businesses/\(businessId)/recurring", body: payload, authenticated: true)
    }

    func businessGoals(businessId: String) async throws -> [BusinessGoalItem] {
        let response: BusinessGoalsResponse = try await get("businesses/\(businessId)/goals", authenticated: true)
        return response.goals
    }

    func createBusinessGoal(businessId: String, payload: BusinessGoalSubmission) async throws -> BusinessGoalMutationResponse {
        try await postEncodable("businesses/\(businessId)/goals", body: payload, authenticated: true)
    }

    private func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem] = [], authenticated: Bool = false) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems.isEmpty ? nil : queryItems

        var request = URLRequest(url: components.url!)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated, let token = UserDefaults.standard.string(forKey: "oxsteedAccessToken") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.timeoutInterval = 20

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(T.self, from: data)
    }

    private func post<T: Decodable>(_ path: String, body: [String: Any], authenticated: Bool) async throws -> T {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await send(path, body: data, authenticated: authenticated)
    }

    private func postEncodable<T: Decodable, U: Encodable>(_ path: String, body: U, authenticated: Bool) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await send(path, body: data, authenticated: authenticated)
    }

    private func putEncodable<T: Decodable, U: Encodable>(_ path: String, body: U, authenticated: Bool) async throws -> T {
        let data = try JSONEncoder().encode(body)
        return try await send(path, method: "PUT", body: data, authenticated: authenticated)
    }

    private func send<T: Decodable>(_ path: String, body: Data, authenticated: Bool) async throws -> T {
        try await send(path, method: "POST", body: body, authenticated: authenticated)
    }

    private func send<T: Decodable>(_ path: String, method: String, body: Data, authenticated: Bool) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if authenticated, let token = UserDefaults.standard.string(forKey: "oxsteedAccessToken") {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = body
        request.timeoutInterval = 25

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decoder.decode(T.self, from: data)
    }
}
