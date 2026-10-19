# Scope migration inventory (scope report Area 4)

Branch `codex/analytics-scope-centralization`, stacked on #608. Generated from `server/scripts/scope/routeInventory.js --json` (live Express router walk) plus a static count of hand-written tenant filters in `server/controllers`. Regenerate the route table with:

```
cd server && JWT_SECRET=<64 chars> node scripts/scope/routeInventory.js --json
```

## Totals

765 tenant routes (a path parameter of `:businessId`, `:restaurantId`, `:bizId`, `:business_id` or `:restaurant_id`) across every router in `server/routes`, plus the one tenant route mounted directly in `index.js`. Before this branch, 248 of them had a route-level gate and 517 relied on each controller remembering its own check. Now all of them have a gate or a registered exemption. `routeScopeGuard.test.js` fails on any new tenant route that has neither.

| Domain | Tenant routes | Gate already present | Newly gated | Newly exempt (registered reason) |
|---|---:|---:|---:|---:|
| restaurant/food | 331 | 2 | 250 | 79 |
| support | 119 | 0 | 83 | 36 |
| business | 311 | 242 | 30 | 39 |
| platform admin | 4 | 4 | 0 | 0 |
| **total** | **765** | **248** | **363** | **154** |

Copy-pasted restaurant access checks. 19 controllers carried their own copy of the restaurant ownership query. 16 had already been reduced to thin wrappers over `scopeModel.resolveRestaurantAccess` in the #606 pilot. The last three are migrated here:
- `restaurantInventoryOperationsController.restaurantAccess`
- `oxsteedCreditPartnerController.requireRestaurantManager`: a partner report read, with no payment or approval path
- the owner query in `restaurantMediaController.viewerCanModerateRestaurant`, now `scopeModel.isRestaurantOwner`

Every restaurant route now also runs `requireRestaurantAccess()` before the handler. The resolved row is handed to the controller's first `resolveRestaurantAccess` call through AsyncLocalStorage, keyed by user and restaurant, so gating adds no query.

Hand-written `business_id` filters. Controllers contain 521 `business_id = $N` predicates and 401 `restaurant_id = $N` predicates, across 100 files (see the table below). These are data predicates, not authorization. They have to stay in the SQL. What this migration changes is the *authorization* that makes the id trustworthy. On every tenant-param route, the id is now verified by a shared gate before the controller runs. Controllers that had local role checks trust the gate's verified level through `supportScopeSatisfies` / `businessScopeSatisfies`. That covers 12 support controllers and 7 business controllers, and the legacy check remains as a fallback for non-gated callers. `scopedBusinessId(req)` and `scopedRestaurantId(req)` are fail-closed accessors (500 `scope_gate_missing` without a gate) for new code. Rewriting the 922 SQL predicates themselves would be churn with no security gain and was not done.

## Tenant ids from the body or query (outside the route guard)

There are 77 reads of `business_id` / `restaurant_id` from `req.body` / `req.query` in controllers and routes, covering 50 handlers. Each was traced to its route and middleware.

| Outcome | Handlers |
|---|---|
| Platform-admin routes (`requireAdmin`/`requireSuperAdmin`) | adminListCases, listFoodOrders, approveRequest (featured), listIntegrations, registerAdminPartner, enrollAdminParticipant, admin.js statement/report filters |
| Verified in the handler against the caller | settlementStatementArchive (`assertScopeStanding`), credit funding path/proof (`requireRestaurantAccess`), credit reserve (`authorizeOperator`), support routes (`userCanAccessBusinessConversations` / `userCanAdministrateBusiness`), follow-up reminders, QA reviews, channel capabilities, careers employer openings (`canEditProfile`), media createPost (business/restaurant ownership), setWorkspaceContext, chat quotes, credit payment request, proof-of-payment and agreement share (participant asserts), message conversations (`business_members`), restaurant app bootstrap, attention inbox (`resolveBusinesses`: owner/member, 404 otherwise), hireAgent (`canManageBusiness`), agent shifts (resource-scoped, mismatched body business refused) |
| Filter inside the caller's own rows | messages getConversations / getGuestInquiries, recurring procurement programs (owner/subscriber predicate), customer profile, customer eligibility, admin-less guest chat verification (guest code) |
| Customer acting toward a tenant (by design) | support createConversation, restaurant support createCase, food quote/order/card intent, favorites, credit restaurant conversion (the customer's own wallet), applyToBeAgent, createRestaurant (the caller becomes owner) |
| **Tightened here** | `POST /api/logistics/campaigns/:id/join`: `business_id` was stored on the pledge unverified. It now requires owner/member standing, otherwise 404 `business_not_found`, and non-numeric ids get 404 without a query. `GET /api/chat/payments/credit-hint`: the conversation's own business now wins over a client-supplied `businessId`. |
| **Flagged** | `POST /api/main-app/payment-requests` stores a client-asserted `business_id`. A payer may legitimately name the business they pay, so membership cannot be required. No reader filters on that column today. If one is ever added, it must not trust the column. |

## Gates

| Gate | Kind | Semantics (unchanged from the controller checks it fronts) |
|---|---|---|
| `requireBusinessAccess({minRole})` | business | owner, or active `business_members` role ≥ minRole. Deleted and inactive businesses get 404, non-members 404, and insufficient role 403. |
| `requireRestaurantAccess()` | restaurant | `scopeModel.resolveRestaurantAccess`: business owner, restaurant owner, or active member. Non-numeric ids and no standing both get 404 `restaurant_not_found`. |
| `requirePayoutManager` | restaurant | Existing payout-manager gate, now marked. |
| `requireSupportBusinessAccess(level)` | support-business | `administrate` = owner/manager/representative; `manage` = adds support_agent members; `conversations` = adds an employed support agent. Platform admins pass unless the route passes `{platformAdmins:false}` (support applications). Denial is 403 `Access denied`, the same as the controllers. |
| `requireAdmin` / `requireSuperAdmin` | platform-admin | Existing, now marked. |
| `scopeExempt(reason)` | exempt | No-op marker. The reason must be in `EXEMPT_REASONS`, otherwise the route file throws when it loads. `resource-scoped` is limited to the 31 routes in `scripts/scope/resourceScopedRoutes.json`. |

## Behavior tightenings (intended, never widening)

1. **The gate runs before validation and resource lookup.** A non-member now gets the gate's 404/403 before any 400 for a bad body, and before a resource 404. Members see exactly what they saw before.
2. **Garbage restaurant ids** (`/restaurants/abc/...`) now get 404 instead of a Postgres cast 500 on the 4 wrappers that had no guard.
3. **Staff scheduling, leads (business list), maintenance (business list), mobile summary and Business Hub `services/manage`** now run `requireBusinessAccess` at the same role as the legacy check (manager+ for scheduling and services/manage, any member for the others). This has three effects:
   - Non-members get 404 instead of 403.
   - Deleted businesses get 404. The legacy leads, maintenance and services/manage checks did not exclude `deleted_at`, and mobile summary checked only `is_active`.
   - Inactive businesses get 404.
4. **Unmounted route files that were also unsafe** are now gated, in case they are ever mounted:
   - `businessExpenses.js` had *no* access check at all.
   - `businessMessageTemplates.js`: two routes had no check.
   - `businessHealth.js`
   - `businessSkills.js`

   The local `checkAccess` in `businessHealthController` and `businessTemplatesController` queried `business_members.user_id`, a column that does not exist. It now uses `resolveBusinessAccess`. None of these files is mounted in `index.js` today, so production behavior is unchanged.
5. **Support routes whose handler looked the resource up first** (survey follow-up, escalation policies, team mutations, settings sub-resources, AI handoff check) now deny non-members with 403 before the lookup. Two mocked tests were updated to reflect the new query order. The assertions are unchanged.

## Flagged for a decision (behavior kept)

- **Support SQL ignores `businesses.deleted_at`.** `requireBusinessAccess` 404s deleted businesses, but the support helpers (`BUSINESS_ACCESS_SQL` and the others) still admit them. The support gate keeps the support semantics. Should a deleted business's support desk stay reachable?
- **The restaurant gate does not check `businesses.deleted_at` either.** This is the existing #606 note. Restaurants of a deleted business remain manageable.
- **Platform admins have no restaurant standing** through the gate. Admin restaurant tooling goes through `/api/admin`. This was already the behavior and is unchanged.
- **`GET /api/support-routing/:businessId/status`** *(resolved, decision 7)*: now gated by `requireSupportBusinessAccess('conversations')` and reports that business's availability only.
- **Resource-scoped support routes** are not gated by business membership, by design. These are:
  - agent self-service (`agent/:agentId/...`)
  - customer conversation routes (`conversations/:id/...`)
  - applications by employer
  - message and attachment routes

  Each authorizes against the loaded row. The list is frozen in `resourceScopedRoutes.json`.
- **Unmounted route files** (`businessExpenses`, `businessHealth`, `businessMessageTemplates`, `businessSkills`) should be deleted or mounted deliberately.

## One Truth

- Analyst scoping (`withAnalystScope`, every call site in `oneTruthController`) now uses the shared `scopeModel.appendAnalystUserScope`. Semantics are unchanged, and unit tests pin them:
  - null means a super-admin, unscoped.
  - Each column binds `ANY($n::uuid[])`.
  - An empty grant set matches nothing.
- `attachOperationalCounts` fell back to *another user's* ops counts (`opsMap.values().next().value`) when an id was missing. The fallback can't be reached today, because every id is seeded, but it now returns zeros.
- **Q3 O(n²) pairing.** Groups now come from indexed `GROUP BY … HAVING COUNT(*) > 1` queries. Users are not compared all-against-all in Node. Pairing *within* a group is still k(k-1)/2, because the response is a list of pairs: a NAT IP shared by k users yields every pair. The old comment overstated the fix and has been corrected. The 5,000-user scope cap bounds the work today, but a single shared-IP group of 5,000 would emit about 12.5M pairs. **Decision needed:** return clusters (group + members) instead of pairs, or cap the group size and mark the group truncated. Either one changes the API response and the review-state keys (`pairKeyFor`), so neither was done here.

## Controller tenant filters

| Controller | `business_id = $N` | `restaurant_id = $N` | Route coverage |
|---|---:|---:|---|
| adminFeaturedPlacementController.js | 0 | 1 | no tenant-param routes (scope from resource/body/admin) |
| agentOnboardingController.js | 3 | 0 | gated + exempt:customer-self-service, exempt:resource-scoped |
| agentShiftsController.js | 7 | 0 | gated + exempt:resource-scoped |
| aiChatbotController.js | 7 | 0 | all tenant routes gated |
| beautyOperationsController.js | 15 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| bookingController.js | 6 | 0 | gated + exempt:public-storefront |
| businessAccessCodesController.js | 8 | 0 | all tenant routes gated |
| businessAppointmentsController.js | 20 | 0 | gated + exempt:public-intake |
| businessCalendarController.js | 6 | 0 | gated + exempt:public-storefront |
| businessClientsController.js | 3 | 0 | no tenant-param routes (scope from resource/body/admin) |
| businessContentController.js | 17 | 0 | gated + exempt:public-storefront |
| businessController.js | 24 | 0 | no tenant-param routes (scope from resource/body/admin) |
| businessConversationAssignmentController.js | 3 | 0 | all tenant routes gated |
| businessExpensesController.js | 4 | 0 | all tenant routes gated |
| businessHealthAlertsController.js | 6 | 0 | all tenant routes gated |
| businessHealthController.js | 6 | 0 | all tenant routes gated |
| businessIntegrationsController.js | 3 | 0 | gated + exempt:signed-callback |
| businessInvoiceController.js | 12 | 0 | no tenant-param routes (scope from resource/body/admin) |
| businessLeadPipelineController.js | 6 | 0 | all tenant routes gated |
| businessMarketingController.js | 9 | 0 | all tenant routes gated |
| businessMembersController.js | 3 | 0 | no tenant-param routes (scope from resource/body/admin) |
| businessMessageTemplatesController.js | 4 | 0 | all tenant routes gated |
| businessMessagingController.js | 10 | 0 | all tenant routes gated |
| businessPackagesController.js | 6 | 0 | gated + exempt:public-storefront |
| businessProductPricingController.js | 9 | 0 | gated + exempt:public-storefront |
| businessProductsController.js | 8 | 0 | all tenant routes gated |
| businessQuotesController.js | 7 | 0 | all tenant routes gated |
| businessRecurringBillingController.js | 6 | 0 | all tenant routes gated |
| businessReviewManagementController.js | 4 | 0 | all tenant routes gated |
| businessServicesController.js | 2 | 0 | gated + exempt:public-storefront |
| businessSkillsController.js | 10 | 0 | gated + exempt:public-storefront |
| businessStaffScheduleController.js | 8 | 0 | all tenant routes gated |
| businessSupportSettingsController.js | 8 | 0 | all tenant routes gated |
| businessTeamController.js | 5 | 0 | all tenant routes gated |
| businessTemplatesController.js | 4 | 0 | all tenant routes gated |
| businessWaitlistController.js | 4 | 0 | gated + exempt:public-intake |
| cannedResponsesController.js | 5 | 0 | all tenant routes gated |
| careerController.js | 3 | 0 | no tenant-param routes (scope from resource/body/admin) |
| chatClientIntakeController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| chatController.js | 7 | 0 | no tenant-param routes (scope from resource/body/admin) |
| chatOxsteedCreditPaymentController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| chatQuotesController.js | 3 | 0 | no tenant-param routes (scope from resource/body/admin) |
| continuityOperationsController.js | 15 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| conversationAssignmentController.js | 20 | 0 | gated + exempt:resource-scoped |
| conversationMessageController.js | 2 | 0 | gated + exempt:resource-scoped |
| creativeOperationsController.js | 13 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| dynamicPricingController.js | 4 | 0 | gated + exempt:public-storefront |
| escalationPoliciesController.js | 12 | 0 | all tenant routes gated |
| foodController.js | 11 | 52 | gated + exempt:customer-self-service, exempt:device-credential, exempt:public-storefront |
| foodCreditDisputeController.js | 0 | 4 | gated + exempt:customer-self-service |
| foodWalletController.js | 0 | 28 | gated + exempt:customer-self-service |
| franchiseController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| knowledgeBaseController.js | 10 | 0 | all tenant routes gated |
| leadController.js | 4 | 0 | gated + exempt:public-intake |
| loyaltyTiersController.js | 7 | 0 | all tenant routes gated |
| maintenanceRequestController.js | 4 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| mediaController.js | 2 | 1 | gated + exempt:public-storefront |
| messageController.js | 7 | 0 | no tenant-param routes (scope from resource/body/admin) |
| mobileController.js | 5 | 0 | all tenant routes gated |
| oxsteedCreditCardController.js | 0 | 1 | no tenant-param routes (scope from resource/body/admin) |
| oxsteedCreditPartnerController.js | 0 | 1 | all tenant routes gated |
| performanceAnalyticsController.js | 5 | 0 | all tenant routes gated |
| pricingRulesAdminController.js | 5 | 0 | all tenant routes gated |
| professionalOperationsController.js | 13 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| propertyOperationsController.js | 16 | 0 | gated + exempt:public-storefront |
| queueController.js | 7 | 0 | all tenant routes gated |
| restaurantAppFlowController.js | 2 | 160 | gated + exempt:device-credential, exempt:public-storefront |
| restaurantAuditsController.js | 1 | 12 | all tenant routes gated |
| restaurantCreditAdminController.js | 0 | 2 | no tenant-param routes (scope from resource/body/admin) |
| restaurantCreditFundingController.js | 0 | 1 | no tenant-param routes (scope from resource/body/admin) |
| restaurantCrewController.js | 0 | 7 | all tenant routes gated |
| restaurantHelpController.js | 0 | 1 | all tenant routes gated |
| restaurantInventoryController.js | 0 | 22 | all tenant routes gated |
| restaurantInventoryOperationsController.js | 0 | 29 | all tenant routes gated |
| restaurantKioskController.js | 0 | 1 | gated + exempt:public-storefront |
| restaurantMediaController.js | 0 | 9 | gated + exempt:customer-media, exempt:public-storefront |
| restaurantMediaVideoController.js | 0 | 2 | gated + exempt:customer-media |
| restaurantOpsController.js | 0 | 9 | all tenant routes gated |
| restaurantPayoutController.js | 0 | 5 | all tenant routes gated |
| restaurantPosController.js | 0 | 2 | all tenant routes gated |
| restaurantReportsController.js | 0 | 12 | all tenant routes gated |
| restaurantRunnerController.js | 0 | 16 | all tenant routes gated |
| restaurantScreensController.js | 0 | 10 | gated + exempt:device-credential |
| restaurantSupportController.js | 0 | 4 | all tenant routes gated |
| restaurantTrainingController.js | 2 | 9 | all tenant routes gated |
| reviewsController.js | 5 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| satisfactionSurveyController.js | 7 | 0 | gated + exempt:customer-self-service |
| skillBasedRoutingController.js | 3 | 0 | all tenant routes gated |
| slaMetricsController.js | 7 | 0 | all tenant routes gated |
| staffSchedulingController.js | 7 | 0 | all tenant routes gated |
| supportAgentsController.js | 7 | 0 | gated + exempt:resource-scoped |
| supportChannelWebhookController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| supportConversationsController.js | 5 | 0 | gated + exempt:customer-self-service, exempt:resource-scoped |
| supportFollowUpReminderController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| supportQualityController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| supportRoutingController.js | 1 | 0 | gated + exempt:customer-self-service, exempt:public-storefront, exempt:resource-scoped |
| supportTeamsController.js | 6 | 0 | all tenant routes gated |
| tradesOperationsController.js | 14 | 0 | gated + exempt:public-intake, exempt:public-storefront |
| vortexController.js | 4 | 0 | no tenant-param routes (scope from resource/body/admin) |
| webhookController.js | 1 | 0 | no tenant-param routes (scope from resource/body/admin) |
| **total (100 files)** | **521** | **401** | |

"No tenant-param routes" means the controller derives the tenant from the loaded resource, the body or the caller, or serves admin surfaces. Those paths are outside the route guard, and their resource-level checks are unchanged.

## Route table

Columns:
- **current check**: what authorized the route before this branch.
- **target helper**: the gate it runs now. `exempt:<reason>` refers to `EXEMPT_REASONS`.
- **risk**: the residual risk.
- **handler**: the controller function.

| file | route | current check | target helper | risk | handler |
|---|---|---|---|---|---|
| admin.js | GET /super/restaurant-credit/accounts/:customerId/:restaurantId/statements.pdf | route gate: platform-admin:requireSuperAdmin | platform-admin:requireSuperAdmin | none: route gate pre-existed | routes/admin.js#inline |
| adminRestaurantTopups.js | POST /applications/:restaurantId/approve | route gate: platform-admin:requireAdmin | platform-admin:requireAdmin | none: route gate pre-existed | adminRestaurantTopupController.js#approveApplication |
| adminRestaurantTopups.js | POST /applications/:restaurantId/reject | route gate: platform-admin:requireAdmin | platform-admin:requireAdmin | none: route gate pre-existed | adminRestaurantTopupController.js#rejectApplication |
| adminRestaurantTopups.js | POST /applications/:restaurantId/suspend | route gate: platform-admin:requireAdmin | platform-admin:requireAdmin | none: route gate pre-existed | adminRestaurantTopupController.js#suspendApplication |
| beautyOperations.js | DELETE /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#deletePackage |
| beautyOperations.js | DELETE /business/:businessId/trust-records/:recordId | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#deleteTrustRecord |
| beautyOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | beautyOperationsController.js#getBusinessWorkspace |
| beautyOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | beautyOperationsController.js#getPublicWorkspace |
| beautyOperations.js | POST /business/:businessId/packages | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#createPackage |
| beautyOperations.js | POST /business/:businessId/trust-records | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#createTrustRecord |
| beautyOperations.js | POST /public/:businessId/intakes | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | beautyOperationsController.js#createIntakeRequest |
| beautyOperations.js | PUT /business/:businessId/intakes/:requestId | route gate: business:any | business:any | none: route gate pre-existed | beautyOperationsController.js#updateIntakeRequest |
| beautyOperations.js | PUT /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#updatePackage |
| beautyOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#updateSettings |
| beautyOperations.js | PUT /business/:businessId/trust-records/:recordId | route gate: business:manager | business:manager | none: route gate pre-existed | beautyOperationsController.js#updateTrustRecord |
| bookings.js | GET /business/:businessId/available-slots | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | bookingController.js#getBusinessAvailableSlots |
| businessExpenses.js | DELETE /:businessId/expenses/:id | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | businessExpensesController.js#deleteExpense |
| businessExpenses.js | GET /:businessId/expenses | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | businessExpensesController.js#listExpenses |
| businessExpenses.js | POST /:businessId/expenses | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | businessExpensesController.js#createExpense |
| businessExpenses.js | PUT /:businessId/expenses/:id | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | businessExpensesController.js#updateExpense |
| businessFinance.js | DELETE /:businessId/expenses/:expenseId | route gate: business:manager | business:manager | none: route gate pre-existed | businessExpensesController.js#deleteExpense |
| businessFinance.js | DELETE /:businessId/quotes/:quoteId | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#deleteQuote |
| businessFinance.js | DELETE /:businessId/recurring/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#deleteRecurring |
| businessFinance.js | GET /:businessId/expenses | route gate: business:manager | business:manager | none: route gate pre-existed | businessExpensesController.js#listExpenses |
| businessFinance.js | GET /:businessId/quotes | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#listQuotes |
| businessFinance.js | GET /:businessId/quotes/:quoteId | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#getQuote |
| businessFinance.js | GET /:businessId/recurring | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#listRecurring |
| businessFinance.js | POST /:businessId/expenses | route gate: business:manager | business:manager | none: route gate pre-existed | businessExpensesController.js#createExpense |
| businessFinance.js | POST /:businessId/quotes | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#createQuote |
| businessFinance.js | POST /:businessId/quotes/:quoteId/convert | route gate: business:manager | business:manager | none: route gate pre-existed | routes/businessFinance.js#inline |
| businessFinance.js | POST /:businessId/quotes/:quoteId/send | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#sendQuote |
| businessFinance.js | POST /:businessId/recurring | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#createRecurring |
| businessFinance.js | PUT /:businessId/expenses/:expenseId | route gate: business:manager | business:manager | none: route gate pre-existed | businessExpensesController.js#updateExpense |
| businessFinance.js | PUT /:businessId/quotes/:quoteId | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#updateQuote |
| businessFinance.js | PUT /:businessId/recurring/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#updateRecurring |
| businessHealth.js | GET /:businessId/health-alerts | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessHealthController.js#getAlerts |
| businessHealth.js | PATCH /:businessId/health-alerts/:id/dismiss | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessHealthController.js#dismissAlert |
| businessHealthAlerts.js | GET /:businessId/health-alerts | route gate: business:any | business:any | none: route gate pre-existed | businessHealthAlertsController.js#listAlerts |
| businessHealthAlerts.js | POST /:businessId/health-alerts/:alertId/dismiss | route gate: business:any | business:any | none: route gate pre-existed | businessHealthAlertsController.js#dismissAlert |
| businessHealthAlerts.js | POST /:businessId/health-alerts/generate | route gate: business:any | business:any | none: route gate pre-existed | businessHealthAlertsController.js#generateAlerts |
| businessIntegrations.js | DELETE /:businessId/webhooks/:webhookId | route gate: business:manager | business:manager | none: route gate pre-existed | businessIntegrationsController.js#deleteWebhook |
| businessIntegrations.js | GET /:businessId/integrations | route gate: business:any | business:any | none: route gate pre-existed | businessIntegrationsController.js#getIntegrations |
| businessIntegrations.js | GET /:businessId/integrations/stripe/callback | controller: inline-business-members | exempt:signed-callback | low: keyed by caller/credential | businessIntegrationsController.js#stripeCallback |
| businessIntegrations.js | GET /:businessId/webhooks | route gate: business:any | business:any | none: route gate pre-existed | businessIntegrationsController.js#listWebhooks |
| businessIntegrations.js | PATCH /:businessId/integrations/:integrationType | route gate: business:manager | business:manager | none: route gate pre-existed | businessIntegrationsController.js#updateIntegration |
| businessIntegrations.js | POST /:businessId/integrations/api-key/regenerate | route gate: business:owner | business:owner | none: route gate pre-existed | businessIntegrationsController.js#regenerateApiKey |
| businessIntegrations.js | POST /:businessId/integrations/stripe/auth | route gate: business:owner | business:owner | none: route gate pre-existed | businessIntegrationsController.js#stripeAuthUrl |
| businessIntegrations.js | POST /:businessId/integrations/stripe/continue-setup | route gate: business:owner | business:owner | none: route gate pre-existed | businessIntegrationsController.js#stripeContinueSetup |
| businessIntegrations.js | POST /:businessId/integrations/stripe/disconnect | route gate: business:owner | business:owner | none: route gate pre-existed | businessIntegrationsController.js#disconnectStripe |
| businessIntegrations.js | POST /:businessId/webhooks | route gate: business:manager | business:manager | none: route gate pre-existed | businessIntegrationsController.js#createWebhook |
| businessLeadPipeline.js | GET /:businessId/lead-pipeline | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#listLeads |
| businessLeadPipeline.js | PATCH /:businessId/lead-pipeline/:id | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#updateLead |
| businessLeadPipeline.js | PATCH /:businessId/lead-pipeline/:id/notes | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#addNote |
| businessLeadPipeline.js | POST /:businessId/lead-pipeline/:id/to-quote | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#createLeadQuote |
| businessLeads.js | DELETE /:businessId/leads/:leadId | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#deleteLead |
| businessLeads.js | GET /:businessId/leads | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#listLeads |
| businessLeads.js | GET /:businessId/leads/:leadId | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#getLead |
| businessLeads.js | POST /:businessId/leads | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#createLead |
| businessLeads.js | POST /:businessId/leads/:leadId/quotes | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#createLeadQuote |
| businessLeads.js | PUT /:businessId/leads/:leadId | route gate: business:any | business:any | none: route gate pre-existed | businessLeadPipelineController.js#updateLead |
| businessMarketing.js | DELETE /:businessId/broadcasts/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#deleteBroadcast |
| businessMarketing.js | DELETE /:businessId/promo-codes/:codeId | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#deletePromoCode |
| businessMarketing.js | GET /:businessId/broadcasts | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#listBroadcasts |
| businessMarketing.js | GET /:businessId/broadcasts/:id/stats | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#getBroadcastStats |
| businessMarketing.js | GET /:businessId/broadcasts/report | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#getBroadcastReport |
| businessMarketing.js | GET /:businessId/campaign-performance | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#getCampaignPerformance |
| businessMarketing.js | GET /:businessId/featured-placement-requests | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#getFeaturedPlacementRequest |
| businessMarketing.js | GET /:businessId/promo-codes | route gate: business:any | business:any | none: route gate pre-existed | businessMarketingController.js#listPromoCodes |
| businessMarketing.js | GET /:businessId/promotion-performance | route gate: business:manager | business:manager | none: route gate pre-existed | promotionAnalyticsController.js#getBusinessPerformance |
| businessMarketing.js | POST /:businessId/broadcasts | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#createBroadcast |
| businessMarketing.js | POST /:businessId/broadcasts/:id/send | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#sendBroadcast |
| businessMarketing.js | POST /:businessId/featured-placement-requests | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#requestFeaturedPlacement |
| businessMarketing.js | POST /:businessId/promo-codes | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#createPromoCode |
| businessMarketing.js | POST /:businessId/promo-codes/:codeId/toggle | route gate: business:manager | business:manager | none: route gate pre-existed | businessMarketingController.js#togglePromoCode |
| businessMarketing.js | POST /:businessId/promotion-events/share | route gate: business:manager | business:manager | none: route gate pre-existed | promotionAnalyticsController.js#recordBusinessShare |
| businessMessageTemplates.js | DELETE /:businessId/message-templates/:id | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessTemplatesController.js#remove |
| businessMessageTemplates.js | GET /:businessId/message-templates | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessTemplatesController.js#list |
| businessMessageTemplates.js | POST /:businessId/message-templates | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessTemplatesController.js#create |
| businessMessageTemplates.js | POST /:businessId/message-templates/:id/use | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessTemplatesController.js#use |
| businessMessageTemplates.js | PUT /:businessId/message-templates/:id | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | businessTemplatesController.js#update |
| businessMsgTemplates.js | DELETE /:businessId/message-templates/:templateId | route gate: business:manager | business:manager | none: route gate pre-existed | businessMessageTemplatesController.js#deleteTemplate |
| businessMsgTemplates.js | GET /:businessId/message-templates | route gate: business:any | business:any | none: route gate pre-existed | businessMessageTemplatesController.js#listTemplates |
| businessMsgTemplates.js | POST /:businessId/message-templates | route gate: business:manager | business:manager | none: route gate pre-existed | businessMessageTemplatesController.js#createTemplate |
| businessMsgTemplates.js | POST /:businessId/message-templates/:templateId/use | route gate: business:any | business:any | none: route gate pre-existed | businessMessageTemplatesController.js#incrementUsage |
| businessMsgTemplates.js | PUT /:businessId/message-templates/:templateId | route gate: business:manager | business:manager | none: route gate pre-existed | businessMessageTemplatesController.js#updateTemplate |
| businessOperations.js | DELETE /:businessId/loyalty-tiers/:tierId | route gate: business:manager | business:manager | none: route gate pre-existed | loyaltyTiersController.js#deleteLoyaltyTier |
| businessOperations.js | DELETE /:businessId/pricing-rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | dynamicPricingController.js#deletePricingRule |
| businessOperations.js | GET /:businessId/appointments | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#listAppointments |
| businessOperations.js | GET /:businessId/appointments/:appointmentId | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#getAppointment |
| businessOperations.js | GET /:businessId/appointments/calendar | route gate: business:any | business:any | none: route gate pre-existed | businessCalendarController.js#getBusinessAppointmentsCalendar |
| businessOperations.js | GET /:businessId/loyalty-tiers | route gate: business:any | business:any | none: route gate pre-existed | loyaltyTiersController.js#listLoyaltyTiers |
| businessOperations.js | GET /:businessId/loyalty/tier/:tierId/customers | route gate: business:any | business:any | none: route gate pre-existed | loyaltyTiersController.js#listTierCustomers |
| businessOperations.js | GET /:businessId/messages | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#getConversations |
| businessOperations.js | GET /:businessId/messages/:conversationId | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#getConversation |
| businessOperations.js | GET /:businessId/messages/assignments/list | route gate: business:any | business:any | none: route gate pre-existed | businessConversationAssignmentController.js#listAssignments |
| businessOperations.js | GET /:businessId/pricing-rules | route gate: business:any | business:any | none: route gate pre-existed | dynamicPricingController.js#listPricingRules |
| businessOperations.js | GET /:businessId/services | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessServicesController.js#listServices |
| businessOperations.js | GET /:businessId/services/:serviceId/calculate-price | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | dynamicPricingController.js#calculatePrice |
| businessOperations.js | GET /:businessId/services/:serviceId/pricing-rules | route gate: business:any | business:any | none: route gate pre-existed | dynamicPricingController.js#listPricingRules |
| businessOperations.js | GET /:businessId/services/:serviceId/slots | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessCalendarController.js#getServiceSlots |
| businessOperations.js | POST /:businessId/appointments | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | businessAppointmentsController.js#createAppointment |
| businessOperations.js | POST /:businessId/appointments/:appointmentId/cancel | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#cancelAppointment |
| businessOperations.js | POST /:businessId/appointments/:appointmentId/notes | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#addAppointmentNote |
| businessOperations.js | POST /:businessId/appointments/:appointmentId/record-payment | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#recordAppointmentPayment |
| businessOperations.js | POST /:businessId/appointments/:appointmentId/reschedule | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#rescheduleAppointment |
| businessOperations.js | POST /:businessId/appointments/staff-create | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#createAppointment |
| businessOperations.js | POST /:businessId/loyalty-tiers | route gate: business:manager | business:manager | none: route gate pre-existed | loyaltyTiersController.js#createLoyaltyTier |
| businessOperations.js | POST /:businessId/messages | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#createConversation |
| businessOperations.js | POST /:businessId/messages/:conversationId | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#sendMessage |
| businessOperations.js | POST /:businessId/messages/:conversationId/archive | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#archiveConversation |
| businessOperations.js | POST /:businessId/messages/:conversationId/attachments | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#uploadAttachment |
| businessOperations.js | POST /:businessId/messages/:conversationId/claim | route gate: business:any | business:any | none: route gate pre-existed | businessConversationAssignmentController.js#claimConversation |
| businessOperations.js | POST /:businessId/messages/:conversationId/reassign | route gate: business:manager | business:manager | none: route gate pre-existed | businessConversationAssignmentController.js#reassignConversation |
| businessOperations.js | POST /:businessId/messages/:conversationId/release | route gate: business:any | business:any | none: route gate pre-existed | businessConversationAssignmentController.js#releaseConversation |
| businessOperations.js | POST /:businessId/messages/:conversationId/restore | route gate: business:any | business:any | none: route gate pre-existed | businessMessagingController.js#restoreConversation |
| businessOperations.js | POST /:businessId/pricing-rules | route gate: business:manager | business:manager | none: route gate pre-existed | dynamicPricingController.js#createPricingRule |
| businessOperations.js | POST /:businessId/services | route gate: business:manager | business:manager | none: route gate pre-existed | businessServicesController.js#createService |
| businessOperations.js | POST /:businessId/services/:serviceId/availability | route gate: business:manager | business:manager | none: route gate pre-existed | businessServicesController.js#setServiceAvailability |
| businessOperations.js | POST /:businessId/services/:serviceId/staff | route gate: business:manager | business:manager | none: route gate pre-existed | businessServicesController.js#assignStaffToService |
| businessOperations.js | PUT /:businessId/appointments/:appointmentId/staff | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#reassignAppointmentStaff |
| businessOperations.js | PUT /:businessId/appointments/:appointmentId/status | route gate: business:any | business:any | none: route gate pre-existed | businessAppointmentsController.js#updateAppointmentStatus |
| businessOperations.js | PUT /:businessId/loyalty-tiers/:tierId | route gate: business:manager | business:manager | none: route gate pre-existed | loyaltyTiersController.js#updateLoyaltyTier |
| businessOperations.js | PUT /:businessId/pricing-rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | dynamicPricingController.js#updatePricingRule |
| businessOperations.js | PUT /:businessId/services/:serviceId | route gate: business:manager | business:manager | none: route gate pre-existed | businessServicesController.js#updateService |
| businessPackages.js | DELETE /:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | businessPackagesController.js#deletePackage |
| businessPackages.js | GET /:businessId/client-packages | route gate: business:any | business:any | none: route gate pre-existed | businessPackagesController.js#listClientPackages |
| businessPackages.js | GET /:businessId/packages | route gate: business:any | business:any | none: route gate pre-existed | businessPackagesController.js#listPackages |
| businessPackages.js | GET /public/:businessId/packages | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessPackagesController.js#listPublicPackages |
| businessPackages.js | POST /:businessId/client-packages | route gate: business:manager | business:manager | none: route gate pre-existed | businessPackagesController.js#issueClientPackage |
| businessPackages.js | POST /:businessId/client-packages/:clientPackageId/redeem | route gate: business:any | business:any | none: route gate pre-existed | businessPackagesController.js#redeemSession |
| businessPackages.js | POST /:businessId/packages | route gate: business:manager | business:manager | none: route gate pre-existed | businessPackagesController.js#createPackage |
| businessPackages.js | PUT /:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | businessPackagesController.js#updatePackage |
| businessProductPricing.js | DELETE /:businessId/product-pricing/rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductPricingController.js#deletePricingRule |
| businessProductPricing.js | GET /:businessId/product-pricing/rules | route gate: business:any | business:any | none: route gate pre-existed | businessProductPricingController.js#listPricingRules |
| businessProductPricing.js | GET /:businessId/product-pricing/rules/:ruleId | route gate: business:any | business:any | none: route gate pre-existed | businessProductPricingController.js#getPricingRule |
| businessProductPricing.js | GET /:businessId/products/:productId/bulk-pricing | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessProductPricingController.js#getBulkPricingTiers |
| businessProductPricing.js | POST /:businessId/product-pricing/calculate | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessProductPricingController.js#calculatePrice |
| businessProductPricing.js | POST /:businessId/product-pricing/rules | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductPricingController.js#createPricingRule |
| businessProductPricing.js | POST /:businessId/products/:productId/bulk-pricing | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductPricingController.js#setBulkPricingTiers |
| businessProductPricing.js | PUT /:businessId/product-pricing/rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductPricingController.js#updatePricingRule |
| businessProducts.js | DELETE /:businessId/products/:productId | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductsController.js#deleteProduct |
| businessProducts.js | GET /:businessId/products | route gate: business:any | business:any | none: route gate pre-existed | businessProductsController.js#listProducts |
| businessProducts.js | GET /:businessId/products/:productId | route gate: business:any | business:any | none: route gate pre-existed | businessProductsController.js#getProduct |
| businessProducts.js | GET /:businessId/products/alerts/low-stock | route gate: business:any | business:any | none: route gate pre-existed | businessProductsController.js#getLowStockAlerts |
| businessProducts.js | POST /:businessId/products | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductsController.js#createProduct |
| businessProducts.js | POST /:businessId/products/:productId/publish | route gate: business:manager | business:manager | none: route gate pre-existed | routes/businessProducts.js#inline |
| businessProducts.js | POST /:businessId/products/:productId/sync-stock | route gate: business:any | business:any | none: route gate pre-existed | routes/businessProducts.js#inline |
| businessProducts.js | POST /:businessId/products/:productId/unpublish | route gate: business:manager | business:manager | none: route gate pre-existed | routes/businessProducts.js#inline |
| businessProducts.js | POST /:businessId/products/:productId/variants | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductsController.js#createVariant |
| businessProducts.js | PUT /:businessId/products/:productId | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductsController.js#updateProduct |
| businessProducts.js | PUT /:businessId/products/:productId/variants/:variantId/inventory | route gate: business:manager | business:manager | none: route gate pre-existed | businessProductsController.js#updateVariantInventory |
| businessProfileImages.js | GET /:businessId/public | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessProfileImageController.js#getBusinessProfileWithCover |
| businessProfileImages.js | GET /:businessId/qr-code | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessProfileImageController.js#generateQRCode |
| businessProfileImages.js | GET /:businessId/qr-code/multi-size | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessProfileImageController.js#generateMultiSizeQRCode |
| businessQuotes.js | DELETE /:businessId/quotes/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#deleteQuote |
| businessQuotes.js | GET /:businessId/quotes | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#listQuotes |
| businessQuotes.js | POST /:businessId/quotes | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#createQuote |
| businessQuotes.js | POST /:businessId/quotes/:id/convert | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#convertToInvoice |
| businessQuotes.js | POST /:businessId/quotes/:id/send | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#sendQuote |
| businessQuotes.js | PUT /:businessId/quotes/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessQuotesController.js#updateQuote |
| businessRecurringBilling.js | DELETE /:businessId/recurring-billing/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#deleteRecurring |
| businessRecurringBilling.js | GET /:businessId/recurring-billing | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#listRecurring |
| businessRecurringBilling.js | PATCH /:businessId/recurring-billing/:id/toggle | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#toggleStatus |
| businessRecurringBilling.js | POST /:businessId/recurring-billing | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#createRecurring |
| businessRecurringBilling.js | POST /:businessId/recurring-billing/:id/generate-invoice | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#generateInvoice |
| businessRecurringBilling.js | PUT /:businessId/recurring-billing/:id | route gate: business:manager | business:manager | none: route gate pre-existed | businessRecurringBillingController.js#updateRecurring |
| businessReviewMgmt.js | DELETE /:businessId/reviews-manage/:reviewId/reply | route gate: business:any | business:any | none: route gate pre-existed | businessReviewManagementController.js#deleteReply |
| businessReviewMgmt.js | GET /:businessId/review-requests | route gate: business:any | business:any | none: route gate pre-existed | businessReviewManagementController.js#listReviewRequests |
| businessReviewMgmt.js | GET /:businessId/reviews-manage | route gate: business:any | business:any | none: route gate pre-existed | businessReviewManagementController.js#listReviews |
| businessReviewMgmt.js | POST /:businessId/review-requests | route gate: business:any | business:any | none: route gate pre-existed | businessReviewManagementController.js#sendReviewRequest |
| businessReviewMgmt.js | POST /:businessId/reviews-manage/:reviewId/reply | route gate: business:any | business:any | none: route gate pre-existed | businessReviewManagementController.js#replyToReview |
| businessReviews.js | GET /:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | reviewsController.js#getBusinessReviews |
| businessReviews.js | GET /:businessId/stats | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | reviewsController.js#getReviewStats |
| businessReviews.js | POST /:businessId/submit | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | reviewsController.js#submitReview |
| businessSkills.js | DELETE /:businessId/skills/:skillId | controller: legacy-business-helper | business:manager | low: gate + legacy controller check (defence in depth) | businessSkillsController.js#removeBusinessSkill |
| businessSkills.js | GET /:businessId/skills | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessSkillsController.js#listBusinessSkills |
| businessSkills.js | GET /:businessId/skills/search | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessSkillsController.js#searchSkillsForBusiness |
| businessSkills.js | POST /:businessId/skills | controller: legacy-business-helper | business:manager | low: gate + legacy controller check (defence in depth) | businessSkillsController.js#addBusinessSkill |
| businessSkills.js | PUT /:businessId/skills/:skillId | controller: legacy-business-helper | business:manager | low: gate + legacy controller check (defence in depth) | businessSkillsController.js#updateBusinessSkill |
| businessStaff.js | DELETE /:businessId/staff/shifts/:shiftId | route gate: business:manager | business:manager | none: route gate pre-existed | businessStaffScheduleController.js#deleteShift |
| businessStaff.js | GET /:businessId/staff/shifts | route gate: business:any | business:any | none: route gate pre-existed | businessStaffScheduleController.js#listShifts |
| businessStaff.js | GET /:businessId/staff/time-entries | route gate: business:manager | business:manager | none: route gate pre-existed | businessStaffScheduleController.js#listTimeEntries |
| businessStaff.js | POST /:businessId/staff/clock-in | route gate: business:any | business:any | none: route gate pre-existed | businessStaffScheduleController.js#clockIn |
| businessStaff.js | POST /:businessId/staff/clock-out/:entryId | route gate: business:any | business:any | none: route gate pre-existed | businessStaffScheduleController.js#clockOut |
| businessStaff.js | POST /:businessId/staff/shifts | route gate: business:manager | business:manager | none: route gate pre-existed | businessStaffScheduleController.js#createShift |
| businessStaff.js | PUT /:businessId/staff/shifts/:shiftId | route gate: business:manager | business:manager | none: route gate pre-existed | businessStaffScheduleController.js#updateShift |
| businessTeam.js | DELETE /:businessId/access-codes/:codeId | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#revokeAccessCode |
| businessTeam.js | GET /:businessId/access-codes | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#listAccessCodes |
| businessTeam.js | GET /:businessId/me | route gate: business:any | business:any | none: route gate pre-existed | businessTeamController.js#getMyMembership |
| businessTeam.js | GET /:businessId/memberships | route gate: business:manager | business:manager | none: route gate pre-existed | businessTeamController.js#listMemberships |
| businessTeam.js | GET /:businessId/team/catalog | route gate: business:any | business:any | none: route gate pre-existed | businessTeamController.js#getCatalog |
| businessTeam.js | PATCH /:businessId/access-codes/:codeId | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#updateAccessCode |
| businessTeam.js | PATCH /:businessId/memberships/:membershipId/role | route gate: business:owner | business:owner | none: route gate pre-existed | businessTeamController.js#changeMembershipRole |
| businessTeam.js | POST /:businessId/access-codes | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#createAccessCode |
| businessTeam.js | POST /:businessId/access-codes/:codeId/rotate | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#rotateAccessCode |
| businessTeam.js | POST /:businessId/memberships/:membershipId/approve | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#approveMembership |
| businessTeam.js | POST /:businessId/memberships/:membershipId/deny | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#denyMembership |
| businessTeam.js | POST /:businessId/memberships/:membershipId/remove | route gate: business:manager | business:manager | none: route gate pre-existed | businessAccessCodesController.js#removeMembership |
| businessTeam.js | PUT /:businessId/memberships/:membershipId/overrides | route gate: business:manager | business:manager | none: route gate pre-existed | businessTeamController.js#setMembershipOverrides |
| businessWaitlist.js | DELETE /:businessId/waitlist/:entryId | route gate: business:any | business:any | none: route gate pre-existed | businessWaitlistController.js#removeFromWaitlist |
| businessWaitlist.js | GET /:businessId/waitlist | route gate: business:any | business:any | none: route gate pre-existed | businessWaitlistController.js#listWaitlist |
| businessWaitlist.js | POST /:businessId/waitlist | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | businessWaitlistController.js#addToWaitlist |
| businessWaitlist.js | PUT /:businessId/waitlist/:entryId | route gate: business:any | business:any | none: route gate pre-existed | businessWaitlistController.js#updateWaitlistEntry |
| businesses.js | DELETE /:businessId/faqs/:faqId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#deleteBusinessFAQ |
| businesses.js | DELETE /:businessId/gallery/:photoId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#deleteBusinessGalleryPhoto |
| businesses.js | DELETE /:businessId/policies/:policyId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#deleteBusinessPolicy |
| businesses.js | DELETE /:businessId/services/:serviceId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#deleteBusinessService |
| businesses.js | DELETE /:businessId/services/:serviceId/blocked-times/:blockId | route gate: business:manager | business:manager | none: route gate pre-existed | businessContentController.js#deleteServiceBlockedTime |
| businesses.js | DELETE /:businessId/skills/:skillId | route gate: business:any | business:any | none: route gate pre-existed | businessSkillsController.js#removeBusinessSkill |
| businesses.js | GET /:businessId/faqs | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessContentController.js#getBusinessFAQs |
| businesses.js | GET /:businessId/gallery | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessContentController.js#getBusinessGallery |
| businesses.js | GET /:businessId/hours | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessContentController.js#getBusinessHours |
| businesses.js | GET /:businessId/policies | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessContentController.js#getBusinessPolicies |
| businesses.js | GET /:businessId/services | controller: legacy-business-helper,support-employer | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessContentController.js#getBusinessServices |
| businesses.js | GET /:businessId/services/:serviceId/blocked-times | route gate: business:manager | business:manager | none: route gate pre-existed | businessContentController.js#listServiceBlockedTimes |
| businesses.js | GET /:businessId/services/manage | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | routes/businesses.js#inline |
| businesses.js | GET /:businessId/skills | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessSkillsController.js#listBusinessSkills |
| businesses.js | GET /:businessId/skills/search | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | businessSkillsController.js#searchSkillsForBusiness |
| businesses.js | POST /:businessId/faqs | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#createBusinessFAQ |
| businesses.js | POST /:businessId/gallery | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#addBusinessGalleryPhoto |
| businesses.js | POST /:businessId/policies | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#createBusinessPolicy |
| businesses.js | POST /:businessId/services | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#createBusinessService |
| businesses.js | POST /:businessId/services/:serviceId/blocked-times | route gate: business:manager | business:manager | none: route gate pre-existed | businessContentController.js#createServiceBlockedTime |
| businesses.js | POST /:businessId/skills | route gate: business:any | business:any | none: route gate pre-existed | businessSkillsController.js#addBusinessSkill |
| businesses.js | PUT /:businessId/faqs/:faqId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#updateBusinessFAQ |
| businesses.js | PUT /:businessId/gallery/:photoId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#updateBusinessGalleryPhoto |
| businesses.js | PUT /:businessId/hours | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#updateBusinessHours |
| businesses.js | PUT /:businessId/policies/:policyId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#updateBusinessPolicy |
| businesses.js | PUT /:businessId/services/:serviceId | route gate: business:any | business:any | none: route gate pre-existed | businessContentController.js#updateBusinessService |
| businesses.js | PUT /:businessId/skills | route gate: business:any | business:any | none: route gate pre-existed | businessSkillsController.js#replaceBusinessSkills |
| businesses.js | PUT /:businessId/skills/:skillId | route gate: business:any | business:any | none: route gate pre-existed | businessSkillsController.js#updateBusinessSkill |
| continuityOperations.js | DELETE /business/:businessId/plans/:planId | route gate: business:manager | business:manager | none: route gate pre-existed | continuityOperationsController.js#deletePlan |
| continuityOperations.js | DELETE /business/:businessId/trust-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | continuityOperationsController.js#deleteTrustRecord |
| continuityOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | continuityOperationsController.js#getBusinessWorkspace |
| continuityOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | continuityOperationsController.js#getPublicWorkspace |
| continuityOperations.js | POST /business/:businessId/plans | route gate: business:manager | business:manager | none: route gate pre-existed | continuityOperationsController.js#createPlan |
| continuityOperations.js | POST /business/:businessId/trust-records | route gate: business:any | business:any | none: route gate pre-existed | continuityOperationsController.js#createTrustRecord |
| continuityOperations.js | POST /public/:businessId/intakes | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | continuityOperationsController.js#createIntakeRequest |
| continuityOperations.js | PUT /business/:businessId/intakes/:requestId | route gate: business:any | business:any | none: route gate pre-existed | continuityOperationsController.js#updateIntakeRequest |
| continuityOperations.js | PUT /business/:businessId/plans/:planId | route gate: business:manager | business:manager | none: route gate pre-existed | continuityOperationsController.js#updatePlan |
| continuityOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | continuityOperationsController.js#updateSettings |
| continuityOperations.js | PUT /business/:businessId/trust-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | continuityOperationsController.js#updateTrustRecord |
| creativeOperations.js | DELETE /business/:businessId/approval-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | creativeOperationsController.js#deleteApprovalRecord |
| creativeOperations.js | DELETE /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | creativeOperationsController.js#deletePackage |
| creativeOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | creativeOperationsController.js#getBusinessWorkspace |
| creativeOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | creativeOperationsController.js#getPublicWorkspace |
| creativeOperations.js | POST /business/:businessId/approval-records | route gate: business:any | business:any | none: route gate pre-existed | creativeOperationsController.js#createApprovalRecord |
| creativeOperations.js | POST /business/:businessId/packages | route gate: business:manager | business:manager | none: route gate pre-existed | creativeOperationsController.js#createPackage |
| creativeOperations.js | POST /public/:businessId/intakes | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | creativeOperationsController.js#createIntakeRequest |
| creativeOperations.js | PUT /business/:businessId/approval-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | creativeOperationsController.js#updateApprovalRecord |
| creativeOperations.js | PUT /business/:businessId/intakes/:requestId | route gate: business:any | business:any | none: route gate pre-existed | creativeOperationsController.js#updateIntakeRequest |
| creativeOperations.js | PUT /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | creativeOperationsController.js#updatePackage |
| creativeOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | creativeOperationsController.js#updateSettings |
| food.js | DELETE /restaurants/:restaurantId/categories/:categoryId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#deleteMenuCategory |
| food.js | DELETE /restaurants/:restaurantId/menu-items/:itemId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#deleteMenuItem |
| food.js | DELETE /restaurants/:restaurantId/modifier-groups/:groupId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#deleteModifierGroup |
| food.js | GET /admin/restaurants/:restaurantId/credit-approval | route gate: platform-admin:requireAdmin | platform-admin:requireAdmin | none: route gate pre-existed | foodWalletController.js#getRestaurantCreditApproval |
| food.js | GET /customer/loyalty/:restaurantId | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodController.js#getMyLoyaltyBalance |
| food.js | GET /customer/wallets/:restaurantId | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#getCustomerWallet |
| food.js | GET /customer/wallets/:restaurantId/credit-capacity | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#getCreditCapacity |
| food.js | GET /customer/wallets/:restaurantId/disputes | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodCreditDisputeController.js#listMyDisputes |
| food.js | GET /customer/wallets/:restaurantId/holds | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#listMyWalletHolds |
| food.js | GET /customer/wallets/:restaurantId/integrity | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#verifyMyWalletIntegrity |
| food.js | GET /customer/wallets/:restaurantId/load-requests | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#listMyWalletLoadRequests |
| food.js | GET /customer/wallets/:restaurantId/refunds | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#listMyWalletRefunds |
| food.js | GET /customer/wallets/:restaurantId/statements | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | routes/food.js#inline |
| food.js | GET /customer/wallets/:restaurantId/statements.csv | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | routes/food.js#inline |
| food.js | GET /customer/wallets/:restaurantId/statements.pdf | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | routes/food.js#inline |
| food.js | GET /customer/wallets/:restaurantId/transfers | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#listMyWalletTransfers |
| food.js | GET /merchant/wallets/:restaurantId/disputes | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodCreditDisputeController.js#listMerchantDisputes |
| food.js | GET /merchant/wallets/:restaurantId/exposure | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#getCreditExposure |
| food.js | GET /merchant/wallets/:restaurantId/refunds | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#listRestaurantWalletRefunds |
| food.js | GET /restaurants/:restaurantId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#getRestaurant |
| food.js | GET /restaurants/:restaurantId/customer-wallet-integrity | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#verifyCustomerWalletIntegrity |
| food.js | GET /restaurants/:restaurantId/customer-wallet-load-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#listCustomerWalletLoadRequests |
| food.js | GET /restaurants/:restaurantId/customer-wallet-reconciliation | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#getCustomerWalletReconciliation |
| food.js | GET /restaurants/:restaurantId/customer-wallet-statement | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#getCustomerWalletStatement |
| food.js | GET /restaurants/:restaurantId/kiosk-config | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | restaurantKioskController.js#getPublicKioskConfig |
| food.js | GET /restaurants/:restaurantId/locations | controller: restaurant-wrapper | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#listRestaurantLocations |
| food.js | GET /restaurants/:restaurantId/menu/manage | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#getManagedRestaurantMenu |
| food.js | GET /restaurants/:restaurantId/orders | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#listRestaurantOrders |
| food.js | GET /restaurants/:restaurantId/oxsteed-credit/ledger | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | oxsteedCreditPartnerController.js#getPartnerCreditLedger |
| food.js | GET /restaurants/:restaurantId/oxsteed-credit/report.csv | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | oxsteedCreditPartnerController.js#downloadPartnerCreditReport |
| food.js | GET /restaurants/:restaurantId/oxsteed-credit/settlements | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | oxsteedCreditPartnerController.js#listPartnerSettlements |
| food.js | GET /restaurants/:restaurantId/oxsteed-credit/transactions | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | oxsteedCreditPartnerController.js#listPartnerTransactions |
| food.js | GET /restaurants/:restaurantId/promotions | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#listRestaurantPromotions |
| food.js | GET /restaurants/:restaurantId/promotions/manage | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#listMerchantRestaurantPromotions |
| food.js | GET /restaurants/:restaurantId/queue-board | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#getQueueBoard |
| food.js | GET /restaurants/:restaurantId/setup-progress | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#getRestaurantSetupProgress |
| food.js | PATCH /restaurants/:restaurantId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateRestaurant |
| food.js | PATCH /restaurants/:restaurantId/categories/:categoryId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateMenuCategory |
| food.js | PATCH /restaurants/:restaurantId/customer-wallet-status | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#updateCustomerWalletStatus |
| food.js | PATCH /restaurants/:restaurantId/locations/:locationId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateRestaurantLocation |
| food.js | PATCH /restaurants/:restaurantId/menu-items/:itemId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateMenuItem |
| food.js | PATCH /restaurants/:restaurantId/modifier-groups/:groupId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateModifierGroup |
| food.js | PATCH /restaurants/:restaurantId/orders/:orderId/status | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateOrderStatus |
| food.js | PATCH /restaurants/:restaurantId/promotions/:promotionId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#updateRestaurantPromotion |
| food.js | POST /admin/restaurants/:restaurantId/credit-approval | route gate: platform-admin:requireAdmin | platform-admin:requireAdmin | none: route gate pre-existed | foodWalletController.js#setRestaurantCreditApproval |
| food.js | POST /customer/favorite-items/:restaurantId/:itemId/toggle | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodController.js#toggleCustomerFavoriteItem |
| food.js | POST /customer/favorites/:restaurantId/toggle | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodController.js#toggleCustomerFavoriteRestaurant |
| food.js | POST /customer/wallets/:restaurantId/holds | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#createMyWalletHold |
| food.js | POST /customer/wallets/:restaurantId/holds/:holdId/release | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#releaseMyWalletHold |
| food.js | POST /customer/wallets/:restaurantId/load-requests | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#createMyWalletLoadRequest |
| food.js | POST /customer/wallets/:restaurantId/load-requests/:requestId/cancel | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#cancelMyWalletLoadRequest |
| food.js | POST /customer/wallets/:restaurantId/load-requests/:requestId/disputes | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodCreditDisputeController.js#createDispute |
| food.js | POST /customer/wallets/:restaurantId/payment-sessions | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#createCustomerWalletPaymentSession |
| food.js | POST /customer/wallets/:restaurantId/payment-sessions/:sessionId/cancel | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#cancelCustomerWalletPaymentSession |
| food.js | POST /customer/wallets/:restaurantId/transfers | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodWalletController.js#createMyWalletTransfer |
| food.js | POST /merchant/wallets/:restaurantId/derisk | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#deriskCredit |
| food.js | POST /merchant/wallets/:restaurantId/disputes/:disputeId/respond | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodCreditDisputeController.js#respondToDispute |
| food.js | POST /merchant/wallets/:restaurantId/refunds | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#createCustomerWalletRefund |
| food.js | POST /restaurants/:restaurantId/campaign-click | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#trackCampaignClick |
| food.js | POST /restaurants/:restaurantId/categories | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#createMenuCategory |
| food.js | POST /restaurants/:restaurantId/customer-wallet-holds/:holdId/capture | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#captureCustomerWalletHold |
| food.js | POST /restaurants/:restaurantId/customer-wallet-holds/:holdId/release | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#releaseCustomerWalletHold |
| food.js | POST /restaurants/:restaurantId/customer-wallet-load-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#loadCustomerWallet |
| food.js | POST /restaurants/:restaurantId/customer-wallet-load-requests/:requestId/approve | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#approveCustomerWalletLoadRequest |
| food.js | POST /restaurants/:restaurantId/customer-wallet-load-requests/:requestId/cancel | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#cancelCustomerWalletLoadRequest |
| food.js | POST /restaurants/:restaurantId/customer-wallet-loads | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodWalletController.js#loadCustomerWallet |
| food.js | POST /restaurants/:restaurantId/locations | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#createRestaurantLocation |
| food.js | POST /restaurants/:restaurantId/menu-items | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#createMenuItem |
| food.js | POST /restaurants/:restaurantId/menu-items/:itemId/duplicate | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#duplicateMenuItem |
| food.js | POST /restaurants/:restaurantId/menu-items/:itemId/modifier-groups | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#createModifierGroup |
| food.js | POST /restaurants/:restaurantId/messages | controller: inline-business-members | exempt:customer-self-service | low: keyed by caller/credential | foodController.js#createRestaurantCustomerMessage |
| food.js | POST /restaurants/:restaurantId/orders | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#createOrder |
| food.js | POST /restaurants/:restaurantId/orders/:orderId/split | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#splitOrder |
| food.js | POST /restaurants/:restaurantId/orders/quote | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#quoteOrder |
| food.js | POST /restaurants/:restaurantId/promotions | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#createRestaurantPromotion |
| food.js | POST /restaurants/:restaurantId/reports | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | foodController.js#createRestaurantReport |
| leads.js | GET /business/:businessId | controller: legacy helper/local query (see handler) | business:any | low: gate verified to match legacy first-query semantics | leadController.js#getBusinessLeads |
| leads.js | POST /:businessId/request | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | leadController.js#createLead |
| maintenanceRequests.js | GET /business/:businessId | controller: legacy-business-helper | business:any | low: gate + legacy controller check (defence in depth) | maintenanceRequestController.js#listBusinessRequests |
| maintenanceRequests.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | maintenanceRequestController.js#getPublicBusiness |
| maintenanceRequests.js | POST /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | maintenanceRequestController.js#createRequest |
| media.js | GET /business/:businessId/posts | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | mediaController.js#getBusinessPosts |
| mobile.js | GET /business/:businessId/workspace/mobile-summary | controller: inline-business-members | business:any | low: gate + legacy controller check (defence in depth) | mobileController.js#getBusinessMobileSummary |
| pricingRulesAdmin.js | DELETE /:businessId/pricing/product/:productId/rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#deleteProductRule |
| pricingRulesAdmin.js | DELETE /:businessId/pricing/service/:serviceId/rules/:ruleId | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#deleteServiceRule |
| pricingRulesAdmin.js | GET /:businessId/pricing/product/:productId/rules | route gate: business:any | business:any | none: route gate pre-existed | pricingRulesAdminController.js#listProductRules |
| pricingRulesAdmin.js | GET /:businessId/pricing/service/:serviceId/rules | route gate: business:any | business:any | none: route gate pre-existed | pricingRulesAdminController.js#listServiceRules |
| pricingRulesAdmin.js | PATCH /:businessId/pricing/product/:productId/rules/:ruleId/toggle | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#toggleProductRule |
| pricingRulesAdmin.js | PATCH /:businessId/pricing/service/:serviceId/rules/:ruleId/toggle | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#toggleServiceRule |
| pricingRulesAdmin.js | POST /:businessId/pricing/preview | route gate: business:any | business:any | none: route gate pre-existed | pricingRulesAdminController.js#previewPrice |
| pricingRulesAdmin.js | POST /:businessId/pricing/product/:productId/rules | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#createProductRule |
| pricingRulesAdmin.js | POST /:businessId/pricing/service/:serviceId/rules | route gate: business:manager | business:manager | none: route gate pre-existed | pricingRulesAdminController.js#createServiceRule |
| professionalOperations.js | DELETE /business/:businessId/compliance-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | professionalOperationsController.js#deleteComplianceRecord |
| professionalOperations.js | DELETE /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | professionalOperationsController.js#deletePackage |
| professionalOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | professionalOperationsController.js#getBusinessWorkspace |
| professionalOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | professionalOperationsController.js#getPublicWorkspace |
| professionalOperations.js | POST /business/:businessId/compliance-records | route gate: business:any | business:any | none: route gate pre-existed | professionalOperationsController.js#createComplianceRecord |
| professionalOperations.js | POST /business/:businessId/packages | route gate: business:manager | business:manager | none: route gate pre-existed | professionalOperationsController.js#createPackage |
| professionalOperations.js | POST /public/:businessId/intakes | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | professionalOperationsController.js#createEngagementRequest |
| professionalOperations.js | PUT /business/:businessId/compliance-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | professionalOperationsController.js#updateComplianceRecord |
| professionalOperations.js | PUT /business/:businessId/intakes/:requestId | route gate: business:any | business:any | none: route gate pre-existed | professionalOperationsController.js#updateEngagementRequest |
| professionalOperations.js | PUT /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | professionalOperationsController.js#updatePackage |
| professionalOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | professionalOperationsController.js#updateSettings |
| propertyOperations.js | DELETE /business/:businessId/compliance-records/:recordId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#deleteComplianceRecord |
| propertyOperations.js | DELETE /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#deletePackage |
| propertyOperations.js | DELETE /business/:businessId/units/:unitId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#deleteUnit |
| propertyOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | propertyOperationsController.js#getBusinessWorkspace |
| propertyOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | propertyOperationsController.js#getPublicWorkspace |
| propertyOperations.js | POST /business/:businessId/compliance-records | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#createComplianceRecord |
| propertyOperations.js | POST /business/:businessId/packages | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#createPackage |
| propertyOperations.js | POST /business/:businessId/units | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#createUnit |
| propertyOperations.js | PUT /business/:businessId/compliance-records/:recordId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#updateComplianceRecord |
| propertyOperations.js | PUT /business/:businessId/packages/:packageId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#updatePackage |
| propertyOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#updateSettings |
| propertyOperations.js | PUT /business/:businessId/units/:unitId | route gate: business:manager | business:manager | none: route gate pre-existed | propertyOperationsController.js#updateUnit |
| qrPayments.js | GET /public/business/:businessId/pay-code | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | routes/qrPayments.js#inline |
| restaurantPayouts.js | GET /:restaurantId/payouts/status | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantPayoutController.js#getRestaurantConnectStatus |
| restaurantPayouts.js | GET /:restaurantId/wallet-payouts | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantWalletPayoutController.js#listPayouts |
| restaurantPayouts.js | GET /:restaurantId/wallet-payouts/balance | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantWalletPayoutController.js#getPayoutBalance |
| restaurantPayouts.js | POST /:restaurantId/payouts/connect | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantPayoutController.js#createConnectRestaurantAccount |
| restaurantPayouts.js | POST /:restaurantId/payouts/disconnect | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantPayoutController.js#disconnectConnectRestaurantAccount |
| restaurantPayouts.js | POST /:restaurantId/wallet-payouts | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantWalletPayoutController.js#requestPayout |
| restaurantSupport.js | GET /:restaurantId/support/cases | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#listRestaurantCases |
| restaurantSupport.js | GET /:restaurantId/support/cases/:caseId | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#getRestaurantCase |
| restaurantSupport.js | GET /:restaurantId/support/summary | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#getRestaurantSummary |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/assign | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantAssign |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/escalate | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantEscalate |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/internal-note | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantInternalNote |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/offer-resolution | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantOfferResolution |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/resolve | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantResolve |
| restaurantSupport.js | POST /:restaurantId/support/cases/:caseId/respond | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantSupportController.js#restaurantRespond |
| restaurantTopups.js | GET /:restaurantId/topup-eligibility | controller: restaurant-wrapper | exempt:customer-self-service | low: keyed by caller/credential | restaurantTopupController.js#getEligibility |
| restaurantTopups.js | GET /:restaurantId/topups/:topupId | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | restaurantTopupController.js#getTopup |
| restaurantTopups.js | POST /:restaurantId/topup-eligibility/apply | controller: legacy helper/local query (see handler) | restaurant:payout-manager | low: gate verified to match legacy first-query semantics | restaurantTopupController.js#applyForEligibility |
| restaurantTopups.js | POST /:restaurantId/topups | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | restaurantTopupController.js#createTopup |
| restaurantTopups.js | POST /:restaurantId/topups/stepup-challenges | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | restaurantTopupController.js#issueTopupStepupChallenge |
| restaurants.js | DELETE /:restaurantId/audits/templates/:templateId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#deleteTemplate |
| restaurants.js | DELETE /:restaurantId/checklists/:checklistId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#deleteChecklist |
| restaurants.js | DELETE /:restaurantId/checklists/:checklistId/tasks/:taskId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#deleteTask |
| restaurants.js | DELETE /:restaurantId/inventory/items/:itemId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#deleteItem |
| restaurants.js | DELETE /:restaurantId/inventory/mappings/:mappingId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#deleteMapping |
| restaurants.js | DELETE /:restaurantId/media/:mediaId | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#deleteRestaurantMedia |
| restaurants.js | DELETE /:restaurantId/sops/:sopId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#deleteSop |
| restaurants.js | DELETE /:restaurantId/training/modules/:moduleId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#deleteModule |
| restaurants.js | GET /:restaurantId/app/bootstrap | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getBootstrap |
| restaurants.js | GET /:restaurantId/audits/corrective-actions | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#listCorrectiveActions |
| restaurants.js | GET /:restaurantId/audits/runs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#listAudits |
| restaurants.js | GET /:restaurantId/audits/runs/:auditId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#getAudit |
| restaurants.js | GET /:restaurantId/audits/templates | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#listTemplates |
| restaurants.js | GET /:restaurantId/checklist-runs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#listRuns |
| restaurants.js | GET /:restaurantId/checklists | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#listChecklists |
| restaurants.js | GET /:restaurantId/crew/dashboard | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#getDashboard |
| restaurants.js | GET /:restaurantId/crew/shifts | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listCrewShifts |
| restaurants.js | GET /:restaurantId/crew/shifts/:shiftId/history | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getCrewShiftHistory |
| restaurants.js | GET /:restaurantId/crew/tasks | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listCrewTasks |
| restaurants.js | GET /:restaurantId/crew/tasks/:taskId/comments | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listCrewTaskComments |
| restaurants.js | GET /:restaurantId/crew/tasks/:taskId/events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listCrewTaskEvents |
| restaurants.js | GET /:restaurantId/crew/tasks/:taskId/proofs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listCrewTaskProofs |
| restaurants.js | GET /:restaurantId/devices/:deviceId/config | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getDeviceConfig |
| restaurants.js | GET /:restaurantId/devices/:deviceId/display-settings | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceDisplaySettings |
| restaurants.js | GET /:restaurantId/devices/:deviceId/display-stats | controller: restaurant-wrapper | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDisplayStats |
| restaurants.js | GET /:restaurantId/devices/:deviceId/kitchen-feed | controller: restaurant-wrapper | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getKitchenFeed |
| restaurants.js | GET /:restaurantId/devices/:deviceId/queue-board | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceQueueBoard |
| restaurants.js | GET /:restaurantId/devices/:deviceId/runtime-config | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceRuntimeConfig |
| restaurants.js | GET /:restaurantId/devices/:deviceId/screen-changes | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantScreensController.js#changes |
| restaurants.js | GET /:restaurantId/devices/:deviceId/screen-snapshot | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantScreensController.js#snapshot |
| restaurants.js | GET /:restaurantId/display/devices/:deviceId/queue-board | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceQueueBoard |
| restaurants.js | GET /:restaurantId/display/devices/:deviceId/runtime-config | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceRuntimeConfig |
| restaurants.js | GET /:restaurantId/display/devices/:deviceId/settings | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDeviceDisplaySettings |
| restaurants.js | GET /:restaurantId/display/devices/:deviceId/stats | controller: restaurant-wrapper | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#getDisplayStats |
| restaurants.js | GET /:restaurantId/display/menu | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#getRestaurant |
| restaurants.js | GET /:restaurantId/display/queue-board | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | restaurantAppFlowController.js#getPublicDisplayQueueBoard |
| restaurants.js | GET /:restaurantId/display/stats | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getDisplayStats |
| restaurants.js | GET /:restaurantId/help-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantHelpController.js#listHelpRequests |
| restaurants.js | GET /:restaurantId/inventory/adjustments | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#listAdjustments |
| restaurants.js | GET /:restaurantId/inventory/areas | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#listAreas |
| restaurants.js | GET /:restaurantId/inventory/audit-events | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#listAuditEvents |
| restaurants.js | GET /:restaurantId/inventory/dashboard | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#getDashboard |
| restaurants.js | GET /:restaurantId/inventory/hooks/status | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getInventoryHookStatus |
| restaurants.js | GET /:restaurantId/inventory/items | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#listItems |
| restaurants.js | GET /:restaurantId/inventory/mappings | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#listMappings |
| restaurants.js | GET /:restaurantId/inventory/purchase-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#listPurchaseRequests |
| restaurants.js | GET /:restaurantId/inventory/receipts | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#listReceipts |
| restaurants.js | GET /:restaurantId/inventory/reports | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#getReports |
| restaurants.js | GET /:restaurantId/inventory/supplier-issues | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#listSupplierIssues |
| restaurants.js | GET /:restaurantId/inventory/suppliers | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#listSuppliers |
| restaurants.js | GET /:restaurantId/inventory/transfers | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#listTransfers |
| restaurants.js | GET /:restaurantId/kiosk-config | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantKioskController.js#getKioskConfig |
| restaurants.js | GET /:restaurantId/kitchen/audit-events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listKitchenAuditEvents |
| restaurants.js | GET /:restaurantId/kitchen/events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listKitchenEvents |
| restaurants.js | GET /:restaurantId/kitchen/feed | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getKitchenFeed |
| restaurants.js | GET /:restaurantId/kitchen/prep-device-config | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getPrepDeviceConfig |
| restaurants.js | GET /:restaurantId/kitchen/printer-jobs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listPrinterJobs |
| restaurants.js | GET /:restaurantId/kitchen/stations | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listKitchenStations |
| restaurants.js | GET /:restaurantId/manager/dashboard | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getManagerDashboard |
| restaurants.js | GET /:restaurantId/manager/reports | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getManagerReports |
| restaurants.js | GET /:restaurantId/media | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | restaurantMediaController.js#listRestaurantMedia |
| restaurants.js | GET /:restaurantId/media/mine | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#listMyRestaurantMedia |
| restaurants.js | GET /:restaurantId/menu | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#getRestaurant |
| restaurants.js | GET /:restaurantId/orders | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | foodController.js#listRestaurantOrders |
| restaurants.js | GET /:restaurantId/pos/customer-wallet | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#lookupPosCustomerWallet |
| restaurants.js | GET /:restaurantId/pos/discounts | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantPosController.js#listDiscounts |
| restaurants.js | GET /:restaurantId/pos/held-tickets | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listHeldTickets |
| restaurants.js | GET /:restaurantId/pos/orders | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listPosOrders |
| restaurants.js | GET /:restaurantId/pos/payments/:paymentId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getPosPaymentStatus |
| restaurants.js | GET /:restaurantId/pos/receipt-events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantPosController.js#listReceiptEvents |
| restaurants.js | GET /:restaurantId/pos/shifts | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listShifts |
| restaurants.js | GET /:restaurantId/pos/shifts/:shiftId/drawer-events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listDrawerEvents |
| restaurants.js | GET /:restaurantId/pos/sync/health | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getPosSyncStatus |
| restaurants.js | GET /:restaurantId/pos/sync/status | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getPosSyncStatus |
| restaurants.js | GET /:restaurantId/pos/tickets/held | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listHeldTickets |
| restaurants.js | GET /:restaurantId/publishing | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#getPublishing |
| restaurants.js | GET /:restaurantId/reports/inventory | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantReportsController.js#inventorySummary |
| restaurants.js | GET /:restaurantId/reports/loyalty | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantReportsController.js#loyaltySummary |
| restaurants.js | GET /:restaurantId/reports/operations | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantReportsController.js#operationsSummary |
| restaurants.js | GET /:restaurantId/reports/sales | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantReportsController.js#salesSummary |
| restaurants.js | GET /:restaurantId/runner/dashboard | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#getDashboard |
| restaurants.js | GET /:restaurantId/runner/offers | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listRunnerOffers |
| restaurants.js | GET /:restaurantId/runner/settlements | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#listRunnerSettlements |
| restaurants.js | GET /:restaurantId/runs/:runId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#getRun |
| restaurants.js | GET /:restaurantId/screens/changes | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#changes |
| restaurants.js | GET /:restaurantId/screens/control | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#control |
| restaurants.js | GET /:restaurantId/screens/snapshot | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#snapshot |
| restaurants.js | GET /:restaurantId/sops | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#listSops |
| restaurants.js | GET /:restaurantId/training/assignments | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#listAssignments |
| restaurants.js | GET /:restaurantId/training/completions | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#listCompletions |
| restaurants.js | GET /:restaurantId/training/modules | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#listModules |
| restaurants.js | GET /:restaurantId/training/staff | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#listStaff |
| restaurants.js | PATCH /:restaurantId/audits/corrective-actions/:actionId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#updateCorrectiveAction |
| restaurants.js | PATCH /:restaurantId/audits/templates/:templateId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#updateTemplate |
| restaurants.js | PATCH /:restaurantId/checklists/:checklistId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#updateChecklist |
| restaurants.js | PATCH /:restaurantId/checklists/:checklistId/tasks/:taskId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#updateTask |
| restaurants.js | PATCH /:restaurantId/crew/badges/:badgeId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#upsertBadge |
| restaurants.js | PATCH /:restaurantId/crew/modules/:moduleId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#updateModule |
| restaurants.js | PATCH /:restaurantId/crew/shifts/:shiftId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateCrewShift |
| restaurants.js | PATCH /:restaurantId/crew/tasks/:taskId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateCrewTask |
| restaurants.js | PATCH /:restaurantId/devices/:deviceId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateDeviceConfig |
| restaurants.js | PATCH /:restaurantId/devices/:deviceId/display-settings | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#updateDeviceDisplaySettings |
| restaurants.js | PATCH /:restaurantId/display/devices/:deviceId/settings | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#updateDeviceDisplaySettings |
| restaurants.js | PATCH /:restaurantId/help-requests/:helpRequestId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantHelpController.js#updateHelpRequest |
| restaurants.js | PATCH /:restaurantId/inventory/items/:itemId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#updateItem |
| restaurants.js | PATCH /:restaurantId/inventory/purchase-requests/:requestId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#updatePurchaseRequest |
| restaurants.js | PATCH /:restaurantId/inventory/supplier-issues/:issueId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#updateSupplierIssue |
| restaurants.js | PATCH /:restaurantId/inventory/transfers/:transferId | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#updateTransfer |
| restaurants.js | PATCH /:restaurantId/kiosk-config | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantKioskController.js#upsertKioskConfig |
| restaurants.js | PATCH /:restaurantId/kitchen/prep-device-config | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updatePrepDeviceConfig |
| restaurants.js | PATCH /:restaurantId/kitchen/printer-jobs/:jobId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updatePrinterJob |
| restaurants.js | PATCH /:restaurantId/locations/:locationId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateRestaurantLocation |
| restaurants.js | PATCH /:restaurantId/menu-items/:itemId/availability | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#setMenuItemAvailability |
| restaurants.js | PATCH /:restaurantId/pos/orders/:orderId/ticket | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updatePosTicket |
| restaurants.js | PATCH /:restaurantId/publishing | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updatePublishing |
| restaurants.js | PATCH /:restaurantId/runner/tasks/:taskId/dispatch | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateRunnerDispatch |
| restaurants.js | PATCH /:restaurantId/runner/tasks/:taskId/status | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#updateTaskStatus |
| restaurants.js | PATCH /:restaurantId/runs/:runId/items/:itemId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#toggleRunItem |
| restaurants.js | PATCH /:restaurantId/sops/:sopId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#updateSop |
| restaurants.js | PATCH /:restaurantId/training/modules/:moduleId | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#updateModule |
| restaurants.js | POST /:restaurantId/audits/findings/:findingId/actions | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#createCorrectiveAction |
| restaurants.js | POST /:restaurantId/audits/runs/:auditId/complete | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#completeAudit |
| restaurants.js | POST /:restaurantId/audits/runs/:auditId/findings | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#addFinding |
| restaurants.js | POST /:restaurantId/audits/runs/:auditId/score | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#scoreItem |
| restaurants.js | POST /:restaurantId/audits/templates | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#createTemplate |
| restaurants.js | POST /:restaurantId/audits/templates/:templateId/runs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAuditsController.js#startAudit |
| restaurants.js | POST /:restaurantId/checklists | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#createChecklist |
| restaurants.js | POST /:restaurantId/checklists/:checklistId/runs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#startRun |
| restaurants.js | POST /:restaurantId/checklists/:checklistId/tasks | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#addTask |
| restaurants.js | POST /:restaurantId/crew/badges | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#upsertBadge |
| restaurants.js | POST /:restaurantId/crew/bootstrap-defaults | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#bootstrapDefaults |
| restaurants.js | POST /:restaurantId/crew/modules | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#createModule |
| restaurants.js | POST /:restaurantId/crew/quizzes | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantCrewController.js#createQuizResult |
| restaurants.js | POST /:restaurantId/crew/shifts | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createCrewShift |
| restaurants.js | POST /:restaurantId/crew/tasks | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createCrewTask |
| restaurants.js | POST /:restaurantId/crew/tasks/:taskId/comments | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#addCrewTaskComment |
| restaurants.js | POST /:restaurantId/crew/tasks/:taskId/proofs | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#addCrewTaskProof |
| restaurants.js | POST /:restaurantId/crew/tasks/:taskId/proofs/upload | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#uploadCrewTaskProof |
| restaurants.js | POST /:restaurantId/crew/tasks/:taskId/review | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#reviewCrewTask |
| restaurants.js | POST /:restaurantId/devices/:deviceId/heartbeat | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#deviceHeartbeat |
| restaurants.js | POST /:restaurantId/devices/:deviceId/kitchen-feed/ack | controller: restaurant-wrapper | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#ackKitchenFeed |
| restaurants.js | POST /:restaurantId/devices/:deviceId/offline-tickets | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantScreensController.js#importTicket |
| restaurants.js | POST /:restaurantId/devices/:deviceId/orders | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | foodController.js#createOrder |
| restaurants.js | POST /:restaurantId/devices/:deviceId/report-issue | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#reportDeviceIssue |
| restaurants.js | POST /:restaurantId/devices/:deviceId/rotate-token | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#rotateDeviceToken |
| restaurants.js | POST /:restaurantId/devices/:deviceId/screen-items/:orderItemId/action | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#performKitchenItemAction |
| restaurants.js | POST /:restaurantId/devices/:deviceId/screen-orders | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantScreensController.js#createOrder |
| restaurants.js | POST /:restaurantId/devices/:deviceId/screen-orders/:orderId/action | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantScreensController.js#orderAction |
| restaurants.js | POST /:restaurantId/devices/pair | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#pairDevice |
| restaurants.js | POST /:restaurantId/devices/pairing-codes | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createDevicePairingCode |
| restaurants.js | POST /:restaurantId/display/devices/:deviceId/heartbeat | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#deviceHeartbeat |
| restaurants.js | POST /:restaurantId/display/devices/:deviceId/orders | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | foodController.js#createOrder |
| restaurants.js | POST /:restaurantId/display/devices/:deviceId/report-issue | controller: legacy helper/local query (see handler) | exempt:device-credential | low: keyed by caller/credential | restaurantAppFlowController.js#reportDeviceIssue |
| restaurants.js | POST /:restaurantId/display/orders/quote | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#quoteOrder |
| restaurants.js | POST /:restaurantId/help-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantHelpController.js#createHelpRequest |
| restaurants.js | POST /:restaurantId/inventory/areas | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#createArea |
| restaurants.js | POST /:restaurantId/inventory/hooks/sync | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#syncMenuAvailability |
| restaurants.js | POST /:restaurantId/inventory/items | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#createItem |
| restaurants.js | POST /:restaurantId/inventory/items/:itemId/adjust | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#adjustItem |
| restaurants.js | POST /:restaurantId/inventory/mappings | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#upsertMapping |
| restaurants.js | POST /:restaurantId/inventory/mappings/bootstrap-defaults | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#bootstrapMappings |
| restaurants.js | POST /:restaurantId/inventory/purchase-requests | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#createPurchaseRequest |
| restaurants.js | POST /:restaurantId/inventory/receipts | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#createReceipt |
| restaurants.js | POST /:restaurantId/inventory/supplier-issues | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryController.js#createSupplierIssue |
| restaurants.js | POST /:restaurantId/inventory/suppliers | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#createSupplier |
| restaurants.js | POST /:restaurantId/inventory/sync-menu-availability | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#syncMenuAvailability |
| restaurants.js | POST /:restaurantId/inventory/transfers | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantInventoryOperationsController.js#createTransfer |
| restaurants.js | POST /:restaurantId/kiosk/orders/quote | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#quoteOrder |
| restaurants.js | POST /:restaurantId/kitchen/devices/:deviceId/feed-ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackKitchenFeed |
| restaurants.js | POST /:restaurantId/kitchen/events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#recordKitchenEvent |
| restaurants.js | POST /:restaurantId/kitchen/feed/ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackKitchenFeed |
| restaurants.js | POST /:restaurantId/kitchen/items/:orderItemId/action | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#performKitchenItemAction |
| restaurants.js | POST /:restaurantId/kitchen/orders/:orderId/ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackKitchenTicket |
| restaurants.js | POST /:restaurantId/kitchen/orders/:orderId/action | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#performKitchenOrderAction |
| restaurants.js | POST /:restaurantId/kitchen/printer-jobs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPrinterJob |
| restaurants.js | POST /:restaurantId/kitchen/printer-jobs/:jobId/claim | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#claimPrinterJob |
| restaurants.js | POST /:restaurantId/kitchen/station-routes | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#routeMenuItemToStation |
| restaurants.js | POST /:restaurantId/kitchen/stations | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#upsertKitchenStation |
| restaurants.js | POST /:restaurantId/kitchen/tickets/:orderId/ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackKitchenTicket |
| restaurants.js | POST /:restaurantId/locations | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createRestaurantLocation |
| restaurants.js | POST /:restaurantId/media | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#postRestaurantMedia |
| restaurants.js | POST /:restaurantId/media/:mediaId/flags | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#flagMedia |
| restaurants.js | POST /:restaurantId/media/:mediaId/like | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#toggleMediaLike |
| restaurants.js | POST /:restaurantId/media/:mediaId/retry | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaVideoController.js#retryVideoProcessing |
| restaurants.js | POST /:restaurantId/media/photo-uploads | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaController.js#postRestaurantMediaPhoto |
| restaurants.js | POST /:restaurantId/media/video-uploads | controller: legacy helper/local query (see handler) | exempt:customer-media | low: keyed by caller/credential | restaurantMediaVideoController.js#postVideoUpload |
| restaurants.js | POST /:restaurantId/menu-items/:itemId/availability | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#setMenuItemAvailability |
| restaurants.js | POST /:restaurantId/orders | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#createOrder |
| restaurants.js | POST /:restaurantId/orders/quote | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | foodController.js#quoteOrder |
| restaurants.js | POST /:restaurantId/pos/menu-items/:itemId/availability | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#setMenuItemAvailability |
| restaurants.js | POST /:restaurantId/pos/menu-items/:itemId/sold-out | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#setMenuItemAvailability |
| restaurants.js | POST /:restaurantId/pos/orders | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/card-intents | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPosCardIntent |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/hold | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#holdPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/merge | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#mergePosOrders |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/payment | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#recordPosPayment |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/payments | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#recordPosPayment |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/refund | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#refundPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/refunds | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#refundPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/reopen | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#reopenPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/reprint-receipt | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#reprintReceipt |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/split | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#splitPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/:orderId/void | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#voidPosOrder |
| restaurants.js | POST /:restaurantId/pos/orders/create | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPosOrder |
| restaurants.js | POST /:restaurantId/pos/payments/:paymentId/capture | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#capturePosCardPayment |
| restaurants.js | POST /:restaurantId/pos/payments/:paymentId/refund | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#refundPosCardPayment |
| restaurants.js | POST /:restaurantId/pos/pending-operations/ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackPendingOperations |
| restaurants.js | POST /:restaurantId/pos/receipt-events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantPosController.js#createReceiptEvent |
| restaurants.js | POST /:restaurantId/pos/shifts | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#openShift |
| restaurants.js | POST /:restaurantId/pos/shifts/:shiftId/close | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#closeShift |
| restaurants.js | POST /:restaurantId/pos/shifts/:shiftId/drawer-events | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#recordDrawerEvent |
| restaurants.js | POST /:restaurantId/pos/staff-pins | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#setStaffPin |
| restaurants.js | POST /:restaurantId/pos/staff-pins/validate | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#validateStaffPin |
| restaurants.js | POST /:restaurantId/pos/sync/ack | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#ackPendingOperations |
| restaurants.js | POST /:restaurantId/pos/terminal/connection-token | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPosTerminalConnectionToken |
| restaurants.js | POST /:restaurantId/pos/tickets | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#createPosOrder |
| restaurants.js | POST /:restaurantId/runner/contact-rules | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#createContactRule |
| restaurants.js | POST /:restaurantId/runner/location | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#logRunnerLocation |
| restaurants.js | POST /:restaurantId/runner/settlements | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#upsertRunnerSettlement |
| restaurants.js | POST /:restaurantId/runner/tasks | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#createTask |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/assign | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#updateRunnerDispatch |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/claim | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#claimRunnerTask |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/decline | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#declineRunnerTask |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/handoff | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#completeRunnerHandoff |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/issues | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#reportIssue |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/location | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#logRunnerLocation |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/payment-notes | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#logPaymentNote |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/proofs | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantRunnerController.js#logProof |
| restaurants.js | POST /:restaurantId/runner/tasks/:taskId/settlements | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantAppFlowController.js#upsertRunnerSettlement |
| restaurants.js | POST /:restaurantId/runs/:runId/complete | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#completeRun |
| restaurants.js | POST /:restaurantId/screens/offline-tickets | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#importTicket |
| restaurants.js | POST /:restaurantId/screens/offline-tickets/:ticketId/accept | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#acceptTicket |
| restaurants.js | POST /:restaurantId/screens/offline-tickets/:ticketId/dismiss | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#dismissTicket |
| restaurants.js | POST /:restaurantId/sops | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantOpsController.js#createSop |
| restaurants.js | POST /:restaurantId/training/assignments/:assignmentId/start | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#startAssignment |
| restaurants.js | POST /:restaurantId/training/assignments/:assignmentId/submit | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#submitQuiz |
| restaurants.js | POST /:restaurantId/training/modules | controller: restaurant-wrapper | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#createModule |
| restaurants.js | POST /:restaurantId/training/modules/:moduleId/assign | controller: restaurant-wrapper,inline-business-members | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantTrainingController.js#assignModule |
| restaurants.js | PUT /:restaurantId/screens/enabled | controller: legacy helper/local query (see handler) | restaurant:restaurantId | low: gate verified to match legacy first-query semantics | restaurantScreensController.js#enable |
| staffScheduling.js | DELETE /:businessId/staff-schedule/:id | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | staffSchedulingController.js#deleteShift |
| staffScheduling.js | DELETE /:businessId/time-entries/:id | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | staffSchedulingController.js#deleteTimeEntry |
| staffScheduling.js | GET /:businessId/staff-schedule | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | staffSchedulingController.js#getWeekSchedule |
| staffScheduling.js | GET /:businessId/time-entries | controller: legacy helper/local query (see handler) | business:manager | low: gate verified to match legacy first-query semantics | staffSchedulingController.js#getTimeEntries |
| staffScheduling.js | POST /:businessId/staff-schedule | controller: inline-business-members | business:manager | low: gate + legacy controller check (defence in depth) | staffSchedulingController.js#createShift |
| staffScheduling.js | POST /:businessId/time-entries | controller: inline-business-members | business:manager | low: gate + legacy controller check (defence in depth) | staffSchedulingController.js#logHours |
| support.js | DELETE /:businessId/escalation-policies/:policyId | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#deletePolicy |
| support.js | DELETE /:businessId/messages/:messageId | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#deleteMessage |
| support.js | DELETE /:businessId/responses/:responseId | controller: legacy-business-helper,support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#deleteResponse |
| support.js | DELETE /:businessId/settings/routing-rules/:ruleId | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#deleteRoutingRule |
| support.js | DELETE /:businessId/teams/members/:memberId | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#removeMember |
| support.js | GET /:businessId/agents | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportAgentsController.js#listAgents |
| support.js | GET /:businessId/agents/:agentId | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportAgentsController.js#getAgent |
| support.js | GET /:businessId/agents/:agentId/assignments | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationAssignmentController.js#getAgentAssignments |
| support.js | GET /:businessId/agents/:agentId/availability-log | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportAgentsController.js#getAvailabilityLog |
| support.js | GET /:businessId/agents/:agentId/shift-templates | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#getShiftTemplate |
| support.js | GET /:businessId/agents/:agentId/shifts | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#getAgentShifts |
| support.js | GET /:businessId/ai/suggest-articles/:conversationId | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | aiChatbotController.js#suggestKBArticles |
| support.js | GET /:businessId/ai/suggest-responses | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | aiChatbotController.js#suggestResponses |
| support.js | GET /:businessId/analytics/agents/:agentId | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getAgentMetrics |
| support.js | GET /:businessId/analytics/business | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getBusinessMetrics |
| support.js | GET /:businessId/analytics/conversations | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getConversationMetrics |
| support.js | GET /:businessId/analytics/leaderboard | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getAgentLeaderboard |
| support.js | GET /:businessId/analytics/teams | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getTeamPerformance |
| support.js | GET /:businessId/analytics/utilization | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | performanceAnalyticsController.js#getAgentUtilization |
| support.js | GET /:businessId/applications | controller: support-employer | support-business:manage (no platform-admin bypass) | low: gate + legacy controller check (defence in depth) | agentOnboardingController.js#getApplications |
| support.js | GET /:businessId/applications-stats | controller: support-employer | support-business:manage (no platform-admin bypass) | low: gate + legacy controller check (defence in depth) | agentOnboardingController.js#getApplicationStats |
| support.js | GET /:businessId/applications/:applicationId | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentOnboardingController.js#getApplication |
| support.js | GET /:businessId/conversation-stats | controller: support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | supportConversationsController.js#getConversationStats |
| support.js | GET /:businessId/conversations | controller: support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | supportConversationsController.js#listConversations |
| support.js | GET /:businessId/conversations/:conversationId | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportConversationsController.js#getConversation |
| support.js | GET /:businessId/conversations/:conversationId/messages | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#getMessages |
| support.js | GET /:businessId/conversations/:conversationId/unread-count | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#getUnreadCount |
| support.js | GET /:businessId/escalation-policies | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#listPolicies |
| support.js | GET /:businessId/escalations/:conversationId | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#getEscalationHistory |
| support.js | GET /:businessId/kb/articles/:articleId | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | knowledgeBaseController.js#getArticle |
| support.js | GET /:businessId/kb/categories | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#listCategories |
| support.js | GET /:businessId/kb/categories/:categoryId/articles | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#getArticlesByCategory |
| support.js | GET /:businessId/kb/search | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#searchArticles |
| support.js | GET /:businessId/my-application | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentOnboardingController.js#getMyApplicationStatus |
| support.js | GET /:businessId/queue/analytics | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | queueController.js#getQueueAnalytics |
| support.js | GET /:businessId/queue/next-agent | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | queueController.js#getNextAvailableAgent |
| support.js | GET /:businessId/queue/status | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | queueController.js#getQueueStatus |
| support.js | GET /:businessId/response-categories | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#getCategories |
| support.js | GET /:businessId/responses | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#listResponses |
| support.js | GET /:businessId/responses/expand | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#expandShortcut |
| support.js | GET /:businessId/routing/coverage | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | skillBasedRoutingController.js#getCoverageBySkill |
| support.js | GET /:businessId/routing/skill-matrix | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | skillBasedRoutingController.js#getAgentSkillMatrix |
| support.js | GET /:businessId/settings | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#getSupportSettings |
| support.js | GET /:businessId/settings/hiring | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#getHiringProfile |
| support.js | GET /:businessId/sla/breaches | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#getSLABreaches |
| support.js | GET /:businessId/sla/by-priority | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#getSLAByPriority |
| support.js | GET /:businessId/sla/dashboard | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#getSLADashboard |
| support.js | GET /:businessId/sla/trends | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#getSLATrends |
| support.js | GET /:businessId/sla/upcoming-breaches | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#getUpcomingBreaches |
| support.js | GET /:businessId/statistics | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#getSupportStatistics |
| support.js | GET /:businessId/surveys | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#getSurveys |
| support.js | GET /:businessId/surveys/agent-ratings | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#getAgentRatings |
| support.js | GET /:businessId/surveys/negative-feedback | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#getNegativeFeedback |
| support.js | GET /:businessId/surveys/summary | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#getSurveySummary |
| support.js | GET /:businessId/surveys/trends | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#getSurveyTrends |
| support.js | GET /:businessId/teams | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#listTeams |
| support.js | GET /:businessId/teams/:teamId/metrics | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#getTeamMetrics |
| support.js | POST /:businessId/agents/:agentId/break-end | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#endBreak |
| support.js | POST /:businessId/agents/:agentId/break-start | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#startBreak |
| support.js | POST /:businessId/agents/:agentId/clock-in | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#clockIn |
| support.js | POST /:businessId/agents/:agentId/clock-out | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#clockOut |
| support.js | POST /:businessId/agents/:agentId/shift-templates | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#setShiftTemplate |
| support.js | POST /:businessId/agents/:agentId/shifts | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentShiftsController.js#createShift |
| support.js | POST /:businessId/agents/:agentId/skills | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportAgentsController.js#addAgentSkill |
| support.js | POST /:businessId/ai/check-handoff | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | aiChatbotController.js#checkNeedsHandoff |
| support.js | POST /:businessId/ai/drafts/:draftId/apply | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | aiChatbotController.js#applyDraft |
| support.js | POST /:businessId/ai/drafts/:draftId/discard | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | aiChatbotController.js#discardDraft |
| support.js | POST /:businessId/ai/message | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | aiChatbotController.js#sendMessage |
| support.js | POST /:businessId/applications/:applicationId/hire | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentOnboardingController.js#approveAndHire |
| support.js | POST /:businessId/apply | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | agentOnboardingController.js#applyToBeAgent |
| support.js | POST /:businessId/conversations | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | supportConversationsController.js#createConversation |
| support.js | POST /:businessId/conversations/:conversationId/assign | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationAssignmentController.js#assignToAgent |
| support.js | POST /:businessId/conversations/:conversationId/attachment | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationMessageController.js#addAttachment |
| support.js | POST /:businessId/conversations/:conversationId/claim | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationAssignmentController.js#claimConversation |
| support.js | POST /:businessId/conversations/:conversationId/mark-all-read | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#markAllAsRead |
| support.js | POST /:businessId/conversations/:conversationId/messages | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportConversationsController.js#addMessage |
| support.js | POST /:businessId/conversations/:conversationId/reassign | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationAssignmentController.js#reassignAgent |
| support.js | POST /:businessId/conversations/:conversationId/release | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationAssignmentController.js#releaseConversation |
| support.js | POST /:businessId/conversations/:conversationId/typing | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#sendTypingIndicator |
| support.js | POST /:businessId/escalation-policies | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#createPolicy |
| support.js | POST /:businessId/escalation-policies/:policyId/steps | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#addStep |
| support.js | POST /:businessId/escalations/trigger/:conversationId | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#triggerEscalation |
| support.js | POST /:businessId/kb/articles | controller: legacy-business-helper,support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#createArticle |
| support.js | POST /:businessId/kb/articles/:articleId/feedback | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#recordFeedback |
| support.js | POST /:businessId/kb/articles/:articleId/publish | controller: legacy helper/local query (see handler) | support-business:manage | low: gate verified to match legacy first-query semantics | knowledgeBaseController.js#publishArticle |
| support.js | POST /:businessId/kb/categories | controller: legacy-business-helper,support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | knowledgeBaseController.js#createCategory |
| support.js | POST /:businessId/queue/remove/:conversationId | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | queueController.js#removeFromQueue |
| support.js | POST /:businessId/queue/route-next | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | queueController.js#routeNextConversation |
| support.js | POST /:businessId/responses | controller: legacy-business-helper,support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#createResponse |
| support.js | POST /:businessId/routing/by-skills/:conversationId | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | skillBasedRoutingController.js#routeBySkills |
| support.js | POST /:businessId/routing/find-agent | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | skillBasedRoutingController.js#findAgentBySkills |
| support.js | POST /:businessId/routing/find-team | controller: legacy-business-helper,support-employer | support-business:conversations | low: gate + legacy controller check (defence in depth) | skillBasedRoutingController.js#findTeamBySkills |
| support.js | POST /:businessId/settings/break-types | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#createBreakType |
| support.js | POST /:businessId/settings/routing-rules | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#createRoutingRule |
| support.js | POST /:businessId/settings/sla | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#setSLATarget |
| support.js | POST /:businessId/sla/update/:conversationId | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | slaMetricsController.js#updateSLAStatus |
| support.js | POST /:businessId/surveys/:conversationId | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | satisfactionSurveyController.js#createSurvey |
| support.js | POST /:businessId/surveys/:surveyId/follow-up | controller: legacy helper/local query (see handler) | support-business:administrate | low: gate verified to match legacy first-query semantics | satisfactionSurveyController.js#sendFollowUp |
| support.js | POST /:businessId/teams | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#createTeam |
| support.js | POST /:businessId/teams/:teamId/members | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#addMember |
| support.js | POST /:businessId/teams/:teamId/skills | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#addSkill |
| support.js | PUT /:businessId/agents/:agentId/availability | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportAgentsController.js#setAgentAvailability |
| support.js | PUT /:businessId/agents/:agentId/status | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportAgentsController.js#updateAgentStatus |
| support.js | PUT /:businessId/applications/:applicationId/review | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | agentOnboardingController.js#reviewApplication |
| support.js | PUT /:businessId/conversations/:conversationId/status | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportConversationsController.js#updateConversationStatus |
| support.js | PUT /:businessId/escalation-policies/:policyId | controller: support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | escalationPoliciesController.js#updatePolicy |
| support.js | PUT /:businessId/kb/articles/:articleId | controller: legacy helper/local query (see handler) | support-business:manage | low: gate verified to match legacy first-query semantics | knowledgeBaseController.js#updateArticle |
| support.js | PUT /:businessId/messages/:messageId | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | conversationMessageController.js#editMessage |
| support.js | PUT /:businessId/messages/:messageId/read | controller: legacy helper/local query (see handler) | support-business:conversations | low: gate verified to match legacy first-query semantics | conversationMessageController.js#markAsRead |
| support.js | PUT /:businessId/responses/:responseId | controller: legacy-business-helper,support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | cannedResponsesController.js#updateResponse |
| support.js | PUT /:businessId/settings/hiring | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#upsertHiringProfile |
| support.js | PUT /:businessId/settings/routing-rules/:ruleId | controller: support-employer | support-business:manage | low: gate + legacy controller check (defence in depth) | businessSupportSettingsController.js#updateRoutingRule |
| support.js | PUT /:businessId/teams/:teamId | controller: legacy-business-helper,support-employer | support-business:administrate | low: gate + legacy controller check (defence in depth) | supportTeamsController.js#updateTeam |
| supportRouting.js | GET /:businessId/conversations/:ticketId | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportRoutingController.js#getConversation |
| supportRouting.js | GET /:businessId/status | gate: support-business (conversations) | gated | low: route gate | supportRoutingController.js#getStatus |
| supportRouting.js | POST /:businessId/conversations | controller: legacy helper/local query (see handler) | exempt:customer-self-service | low: keyed by caller/credential | supportRoutingController.js#createConversation |
| supportRouting.js | POST /:businessId/conversations/:ticketId/assign | controller: support-employer | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportRoutingController.js#assignToAgent |
| supportRouting.js | POST /:businessId/conversations/:ticketId/message | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportRoutingController.js#sendMessage |
| supportRouting.js | PUT /:businessId/conversations/:ticketId/status | controller: legacy helper/local query (see handler) | exempt:resource-scoped | medium: resource-level check only (reviewed allowlist) | supportRoutingController.js#updateStatus |
| tradesOperations.js | DELETE /business/:businessId/recommendations/:recommendationId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#deleteRecommendation |
| tradesOperations.js | DELETE /business/:businessId/trust-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#deleteTrustRecord |
| tradesOperations.js | GET /business/:businessId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#getBusinessWorkspace |
| tradesOperations.js | GET /public/:businessId | controller: legacy helper/local query (see handler) | exempt:public-storefront | low: public/self-service, no tenant data beyond public predicate | tradesOperationsController.js#getPublicWorkspace |
| tradesOperations.js | POST /business/:businessId/recommendations | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#createRecommendation |
| tradesOperations.js | POST /business/:businessId/requests | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#createDiagnosticRequest |
| tradesOperations.js | POST /business/:businessId/trust-records | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#createTrustRecord |
| tradesOperations.js | POST /public/:businessId/requests | controller: legacy helper/local query (see handler) | exempt:public-intake | low: public/self-service, no tenant data beyond public predicate | tradesOperationsController.js#createDiagnosticRequest |
| tradesOperations.js | PUT /business/:businessId/recommendations/:recommendationId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#updateRecommendation |
| tradesOperations.js | PUT /business/:businessId/requests/:requestId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#updateDiagnosticRequest |
| tradesOperations.js | PUT /business/:businessId/settings | route gate: business:manager | business:manager | none: route gate pre-existed | tradesOperationsController.js#updateSettings |
| tradesOperations.js | PUT /business/:businessId/trust-records/:recordId | route gate: business:any | business:any | none: route gate pre-existed | tradesOperationsController.js#updateTrustRecord |
