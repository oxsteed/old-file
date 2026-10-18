"use strict";
// Every query returns an explicit, safe projection. Never select source metadata,
// credentials, private message bodies, card secrets, or provider response blobs.
const sources = Object.create(null);
function source(key, area, table, predicate, columns, options = {}) {
  sources[key] = {
    key,
    area,
    table,
    grant: "manage_users",
    route: "/admin/users",
    sql: `SELECT ${columns} FROM ${table} r WHERE ${predicate}`,
    ...options,
  };
}
const base = (label, status = "r.status", date = "r.created_at") =>
  `r.id::text AS id, ${label}::text AS label, ${status}::text AS status, ${date} AS occurred_at`;
const own = "r.user_id = $1::uuid";
const customer = "r.customer_id = $1::uuid";
const businessIds = `(SELECT id FROM businesses WHERE user_id = $1::uuid UNION SELECT business_id FROM business_members WHERE member_id = $1::uuid AND status = 'active')`;
const restaurants = `(SELECT id FROM food_restaurants WHERE owner_user_id = $1::uuid OR business_id IN ${businessIds})`;
source(
  "jobs",
  "work",
  "jobs",
  "(r.client_id = $1::uuid OR r.assigned_helper_id = $1::uuid) AND r.deleted_at IS NULL",
  `${base("r.title")}, CASE WHEN r.client_id=$1::uuid THEN 'customer' ELSE 'helper' END AS participant_role, r.client_id, r.assigned_helper_id, r.currency_code, r.job_value_cents AS amount_cents, r.scheduled_start_at, r.completed_at`,
  {
    grant: "manage_operations",
    route: "/admin/jobs",
    recordRoute: "/admin/jobs/",
  },
);
source(
  "bids",
  "work",
  "bids",
  "r.helper_id = $1::uuid",
  `${base("'Bid ' || r.id")}, r.job_id, r.amount_cents, r.currency_code, r.needs_reconfirm`,
  { grant: "manage_operations", route: "/admin/jobs" },
);
source(
  "invoices",
  "work",
  "business_invoices",
  `r.user_id=$1::uuid OR r.business_id IN ${businessIds}`,
  `${base("r.invoice_number")}, r.business_id, r.currency_code, r.total AS amount_major, r.due_date`,
  { grant: "view_financials", route: "/admin/businesses" },
);
source(
  "payments",
  "finance",
  "payments",
  "(r.payer_id = $1::uuid OR r.payee_id = $1::uuid)",
  `${base("'Payment ' || r.id")}, CASE WHEN r.payer_id=$1::uuid THEN 'payer' ELSE 'payee' END AS participant_role, r.job_id, r.payer_id, r.payee_id, r.stripe_payment_intent_id AS provider_reference, r.currency AS currency_code, r.amount AS amount_major, r.refunded_at, COALESCE(r.refunded_amount,r.refund_amount,0) AS refunded_major, r.escrow_status, r.dispute_status`,
  { grant: "view_financials", route: "/admin/payments" },
);
source(
  "foodOrders",
  "restaurants",
  "food_orders",
  `r.customer_id=$1::uuid OR r.restaurant_id IN ${restaurants}`,
  `${base("'Order ' || COALESCE(r.queue_number::text,r.id::text)")}, CASE WHEN r.customer_id=$1::uuid THEN 'customer' ELSE 'business_operator' END AS participant_role, r.restaurant_id, r.business_id, r.total_cents AS amount_cents, r.currency_code, r.payment_status, r.order_source, r.fulfillment_type, r.kitchen_stage, r.accepted_at, r.ready_at, r.handed_off_at`,
  {
    grant: "manage_orders",
    route: "/admin/food-orders",
    recordRoute: "/admin/food-orders/",
  },
);
source(
  "marketplaceOrders",
  "commerce",
  "marketplace_orders",
  customer,
  `${base("'Order ' || r.id")}, r.total_cents AS amount_cents, r.payment_method, r.refunded_at`,
  {
    grant: "manage_operations",
    route: "/admin/orders",
    recordRoute: "/admin/orders/",
  },
);
source(
  "businesses",
  "business",
  "businesses",
  `r.id IN ${businessIds}`,
  `${base("r.business_name", "CASE WHEN r.is_active THEN 'active' ELSE 'inactive' END")}, r.user_id AS owner_user_id, r.business_kind, r.setup_status, r.is_business_verified, r.is_listed, r.currency_code`,
  { route: "/admin/businesses" },
);
source(
  "memberships",
  "business",
  "business_members",
  "r.member_id = $1::uuid",
  `${base("'Business ' || r.business_id")}, r.business_id, r.role, r.accepted_at, r.role_updated_at, r.role_updated_by`,
  { route: "/admin/businesses" },
);
source(
  "restaurants",
  "business",
  "food_restaurants",
  `r.id IN ${restaurants}`,
  `${base("r.display_name")}, r.business_id, r.currency_code, r.accepts_online_orders, r.is_accepting_orders_now, r.online_order_pause_reason, r.is_verified, r.screens_v2_enabled`,
  { grant: "manage_orders", route: "/admin/businesses" },
);
source(
  "devices",
  "devices",
  "restaurant_app_devices",
  `r.restaurant_id IN ${restaurants}`,
  `${base("r.device_name")}, r.restaurant_id, r.location_id, r.mode, r.last_seen_at, r.last_sync_at, r.sync_status, r.config_version, r.applied_config_version, r.pending_operations`,
  { grant: "manage_orders", route: "/admin/businesses" },
);
source(
  "offlineTickets",
  "devices",
  "restaurant_screen_tickets",
  `r.restaurant_id IN ${restaurants}`,
  `${base("'Provisional ticket ' || r.id")}, r.restaurant_id, r.device_id, r.order_id, r.expected_total_cents AS amount_cents, r.conflict_code`,
  { grant: "manage_orders", route: "/admin/businesses" },
);
source(
  "creditAccounts",
  "credit",
  "oxsteed_credit_accounts",
  customer,
  `${base("r.account_type || ' ' || r.id")}, r.account_type, r.restaurant_id, r.currency_code, r.balance_cents, r.reserved_cents, r.ledger_version, r.last_posted_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "creditTransactions",
  "credit",
  "oxsteed_credit_transactions",
  `r.debit_account_id IN (SELECT id FROM oxsteed_credit_accounts WHERE customer_id=$1::uuid) OR r.credit_account_id IN (SELECT id FROM oxsteed_credit_accounts WHERE customer_id=$1::uuid)`,
  `${base("r.transaction_type")}, r.amount_cents, r.currency_code, r.debit_account_id, r.credit_account_id, r.reference_type, r.reference_id, r.correlation_id, r.posted_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "creditHolds",
  "credit",
  "oxsteed_credit_holds",
  customer,
  `${base("r.purpose")}, r.account_id, r.amount_cents, r.currency_code, r.expires_at, r.reference_type, r.reference_id`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "creditDisputes",
  "credit",
  "oxsteed_credit_disputes",
  customer,
  `${base("r.reason_code", "r.status", "r.opened_at")}, r.transaction_id, r.sla_due_at, r.resolution, r.resolved_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "creditCards",
  "credit",
  "oxsteed_credit_cards",
  customer,
  `${base("COALESCE(r.nickname,'Card')")}, r.account_id, r.card_type, r.credential_last4, r.fulfillment_status, r.issued_at, r.expires_at, r.last_used_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "creditEntitlements",
  "credit",
  "oxsteed_credit_customer_entitlements",
  customer,
  `${base("'Entitlement ' || r.id")}, r.starts_at, r.ends_at, r.max_transaction_cents, r.daily_limit_cents`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "restaurantWallets",
  "restaurantCredit",
  "food_customer_wallet_accounts",
  customer,
  `${base("'Restaurant ' || r.restaurant_id")}, r.restaurant_id, r.currency_code, r.balance_cents, r.reserved_cents, r.ledger_version`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "restaurantCreditRequests",
  "restaurantCredit",
  "food_customer_wallet_load_requests",
  customer,
  `${base("COALESCE(r.reference_id::text,'Request ' || r.id)")}, r.restaurant_id, r.amount_cents, r.currency_code, r.expires_at, r.approved_at`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "restaurantCreditLedger",
  "restaurantCredit",
  "food_customer_wallet_ledger",
  customer,
  `${base("r.entry_type", "'posted'")}, r.account_id, r.restaurant_id, r.amount_cents, r.currency_code, r.balance_after_cents, r.reference_type, r.reference_id, r.correlation_id`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "restaurantRefunds",
  "restaurantCredit",
  "food_credit_refunds",
  customer,
  `${base("'Refund ' || r.id")}, r.restaurant_id, r.amount_cents, r.currency_code, r.processed_at`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "restaurantDisputes",
  "restaurantCredit",
  "food_credit_disputes",
  customer,
  `${base("r.reason")}, r.restaurant_id, r.load_request_id, r.resolved_at`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "creditStatements",
  "documents",
  "credit_statement_documents",
  customer,
  `${base("r.product", "'generated'", "r.generated_at")}, r.account_id, r.currency_code, r.period_from, r.period_to, r.content_hash`,
  { superOnly: true, route: "/admin/super/statement-operations" },
);
source(
  "settlementStatements",
  "documents",
  "settlement_statement_documents",
  `r.scope_helper_user_id=$1::uuid OR r.scope_business_id IN ${businessIds} OR r.scope_restaurant_id IN ${restaurants}`,
  `${base("r.product", "'generated'", "r.generated_at")}, r.scope_business_id, r.scope_restaurant_id, r.currency_code, r.period_from, r.period_to, r.content_hash`,
  { superOnly: true, route: "/admin/super/statement-operations" },
);
source(
  "statementExports",
  "documents",
  "statement_export_jobs",
  "r.requested_by=$1::uuid",
  `${base("r.product", "r.state")}, r.currency_code, r.period_from, r.period_to, r.format, r.row_count, r.completed_at, r.error_code`,
  { superOnly: true, route: "/admin/super/statement-operations" },
);
source(
  "subscriptions",
  "subscriptions",
  "subscriptions",
  own,
  `${base("'Plan ' || r.plan_id")}, r.plan_id, r.current_period_start, r.current_period_end, r.cancel_at_period_end, r.consecutive_failures`,
  { superOnly: true, route: "/admin/users" },
);
source(
  "subscriptionEvents",
  "subscriptions",
  "subscription_events",
  own,
  `${base("r.event_type", "r.event_type")}, r.from_tier, r.to_tier`,
  { superOnly: true, route: "/admin/users" },
);
source(
  "campaigns",
  "logistics",
  "pooled_orders",
  "r.organizer_user_id=$1::uuid",
  `${base("r.title")}, r.reference, r.target_moq, r.current_committed_qty, r.approval_state, r.deposit_deadline`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "commitments",
  "logistics",
  "pooled_order_participants",
  own,
  `${base("'Campaign ' || r.pooled_order_id")}, r.pooled_order_id, r.committed_qty, r.deposit_paid_cents, r.final_paid_cents, r.deposit_paid_at, r.final_paid_at`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "purchaseOrders",
  "logistics",
  "purchase_orders",
  "r.buyer_user_id=$1::uuid",
  `${base("r.reference")}, r.currency AS currency_code, r.total_landed_usd AS amount_major, r.deposit_paid_cents, r.final_paid_cents, r.expected_arrival_date`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "logisticsPayments",
  "logistics",
  "logistics_payment_attempts",
  "r.buyer_user_id=$1::uuid",
  `${base("r.installment")}, r.quote_id, r.amount_cents, r.currency AS currency_code, r.method, r.failure_code, r.settled_at`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "shipments",
  "logistics",
  "shipment_records",
  `r.purchase_order_id IN (SELECT id FROM purchase_orders WHERE buyer_user_id=$1::uuid) OR r.pooled_order_id IN (SELECT id FROM pooled_orders WHERE organizer_user_id=$1::uuid UNION SELECT pooled_order_id FROM pooled_order_participants WHERE user_id=$1::uuid)`,
  `${base("r.reference")}, r.purchase_order_id, r.pooled_order_id, r.eta, r.exception_reason, r.customs_cleared_at`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "deliveries",
  "logistics",
  "delivery_orders",
  "r.recipient_user_id=$1::uuid",
  `${base("r.reference")}, r.shipment_id, r.method, r.scheduled_date, r.delivered_at`,
  { superOnly: true, route: "/admin/logistics" },
);
source(
  "tickets",
  "support",
  "support_tickets",
  own,
  `${base("r.subject")}, r.ticket_number, r.priority, r.assigned_to, r.sla_due_at, r.resolved_at`,
  { grant: "manage_support", route: "/admin/support" },
);
source(
  "conversations",
  "support",
  "support_conversations",
  customer,
  `${base("r.subject")}, r.agent_id, r.channel, r.priority, r.resolution_status, r.sla_first_response_breached, r.sla_resolution_breached, r.resolved_at`,
  { grant: "manage_support", route: "/admin/support" },
);
source(
  "notifications",
  "communications",
  "notifications",
  own,
  `${base("r.type", "CASE WHEN r.is_read THEN 'read' ELSE 'unread' END")}, r.is_push_sent, r.is_email_sent, r.read_at`,
  { grant: "message_users", route: "/admin/messages" },
);
source(
  "creditDeliveries",
  "communications",
  "oxsteed_credit_notification_outbox",
  own,
  `${base("r.event_type")}, r.attempts, r.next_attempt_at, r.sent_at, r.transaction_id`,
  { superOnly: true, route: "/admin/super/oxsteed-credit" },
);
source(
  "messageDeliveries",
  "communications",
  "message_notification_outbox",
  "r.recipient_id=$1::uuid",
  `${base("'Message ' || r.message_id")}, r.message_id, r.conversation_id, r.attempts, r.next_attempt_at, r.sent_at`,
  { grant: "message_users", route: "/admin/messages" },
);
source(
  "consents",
  "privacy",
  "user_consents",
  own,
  `${base("r.consent_type", "'accepted'", "r.accepted_at")}, r.version`,
  { superOnly: true, route: "/admin/legal/ccpa-requests" },
);
source(
  "privacyRequests",
  "privacy",
  "privacy_erasure_requests",
  own,
  `${base("'Erasure request ' || r.id", "r.status", "r.requested_at")}, r.blocked_reason, r.processed_at`,
  { superOnly: true, route: "/admin/legal/ccpa-requests" },
);
source(
  "appeals",
  "trust",
  "profile_visibility_appeals",
  "r.appellant_id=$1::uuid",
  `${base("r.profile_type")}, r.profile_id, r.reviewed_at, r.reviewed_by`,
  { grant: "manage_profile_visibility", route: "/admin/enforcement" },
);
source(
  "sessions",
  "security",
  "sessions",
  own,
  `${base("'Session ' || r.id", "CASE WHEN r.is_valid AND NOT r.is_revoked AND r.expires_at>now() THEN 'active' ELSE 'revoked_or_expired' END")}, r.last_used_at, r.expires_at, r.revoked_at`,
  { superOnly: true, route: "/admin/users" },
);
source(
  "tasks",
  "cases",
  "admin_customer_tasks",
  customer,
  `${base("r.title")}, r.priority, r.assigned_to, r.due_at, r.revision, r.resolution, r.completed_at, r.related_source, r.related_id`,
  { route: "/admin/users" },
);

source(
  "bookings",
  "work",
  "booking_requests",
  "r.customer_id=$1::uuid OR r.helper_id=$1::uuid",
  `${base("r.service_name")}, r.business_id,r.payment_status,r.requested_date,r.converted_to_job_id`,
  { grant: "manage_operations", route: "/admin/jobs" },
);
source(
  "appointments",
  "work",
  "business_appointments",
  customer,
  `${base("'Appointment ' || r.id")},r.business_id,r.start_time,r.end_time,r.payment_status,r.final_price_cents AS amount_cents`,
  { grant: "manage_operations", route: "/admin/businesses" },
);
source(
  "quotes",
  "work",
  "business_quotes",
  "r.created_by=$1::uuid OR r.booking_request_id IN (SELECT id FROM booking_requests WHERE customer_id=$1::uuid OR helper_id=$1::uuid)",
  `${base("r.title")},r.business_id,r.total_cents AS amount_cents,r.valid_until,r.payment_status,r.booking_request_id`,
  { grant: "manage_operations", route: "/admin/businesses" },
);
source(
  "restaurantHolds",
  "restaurantCredit",
  "food_customer_wallet_holds",
  customer,
  `${base("r.purpose")},r.account_id,r.restaurant_id,r.amount_cents,r.currency_code,r.expires_at`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "restaurantReserves",
  "restaurantCredit",
  "restaurant_credit_reserves",
  `r.restaurant_id IN ${restaurants}`,
  `${base("'Restaurant ' || r.restaurant_id", "'recorded'", "r.updated_at").replace("r.id::text", "r.restaurant_id::text")},r.restaurant_id,r.balance_cents,r.currency_code,r.lifetime_purchased_cents,r.lifetime_issued_cents`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "notificationPreferences",
  "communications",
  "notification_preferences",
  own,
  `${base("'Preferences'", "'recorded'", "r.updated_at")},r.web_push_enabled,r.unsubscribe_all,r.sms_enabled,r.quiet_hours_start,r.quiet_hours_end,r.timezone,r.email_frequency`,
  { grant: "message_users", route: "/admin/messages" },
);
source(
  "connect",
  "finance",
  "connect_accounts",
  own,
  `${base("'Payout account'", "CASE WHEN r.payouts_enabled THEN 'enabled' ELSE 'incomplete' END")},r.charges_enabled,r.payouts_enabled,r.onboarding_complete`,
  { grant: "view_financials", route: "/admin/payments" },
);

source(
  "restaurantPayouts",
  "finance",
  "restaurant_payouts",
  `r.restaurant_id IN ${restaurants}`,
  `${base("'Payout ' || r.id")},r.restaurant_id,r.amount_cents,r.currency_code,r.provider_status,r.completed_at,r.funds_settled`,
  { grant: "manage_financials", route: "/admin/super/restaurant-payouts" },
);
source(
  "creditWithdrawals",
  "credit",
  "oxsteed_credit_withdrawals",
  customer,
  `${base("'Withdrawal ' || r.id")},r.account_id,r.amount_cents,r.fee_cents,r.net_cents,r.currency_code,r.expires_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit/money-out" },
);
source(
  "creditApprovals",
  "credit",
  "oxsteed_credit_pending_actions",
  `r.payload->>'customerId'=$1::text OR r.payload->>'customer_id'=$1::text OR r.payload->>'accountId' IN (SELECT id::text FROM oxsteed_credit_accounts WHERE customer_id=$1::uuid)`,
  `${base("r.action_type", "r.status", "r.requested_at")},r.requested_by,r.decided_by,r.decided_at,r.expires_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit/approvals" },
);
source(
  "creditSettlements",
  "finance",
  "oxsteed_credit_settlements",
  `r.partner_id IN (SELECT id FROM oxsteed_credit_partners WHERE restaurant_id IN ${restaurants} OR business_id IN ${businessIds})`,
  `${base("'Settlement ' || r.id")},r.currency_code,r.net_cents AS amount_cents,r.partner_id,r.period_start,r.period_end,r.paid_at,r.payout_status`,
  { superOnly: true, route: "/admin/super/oxsteed-credit/settlements" },
);
source(
  "creditIdentity",
  "trust",
  "oxsteed_credit_identity_verifications",
  customer,
  `${base("r.provider")},r.tier,r.expires_at,r.sla_due_at,r.appeal_status,r.appeal_sla_due_at,r.reviewed_at`,
  { superOnly: true, route: "/admin/super/oxsteed-credit/compliance" },
);
source(
  "reviews",
  "trust",
  "reviews",
  "r.reviewee_id=$1::uuid",
  `${base("'Review ' || r.id", "CASE WHEN r.removed THEN 'removed' WHEN r.flagged THEN 'flagged' ELSE 'published' END")},r.job_id,r.rating,r.reviewee_id,r.reviewer_id,r.is_public`,
  { grant: "moderate_content", route: "/admin/reports" },
);
source(
  "adminActions",
  "trust",
  "admin_audit_log",
  "r.target_type='user' AND r.target_id::text=$1::text AND r.action NOT IN ('customer360_workspace_read','customer360_assistant_draft')",
  `${base("r.action", "'recorded'")},r.admin_id,r.target_type`,
  { superOnly: true, route: "/admin/super/audit-log" },
);

source(
  "creditTopups",
  "credit",
  "oxsteed_credit_topups",
  customer,
  `${base("'Top-up ' || r.id")},r.account_id,r.amount_cents,r.currency_code,r.expires_at,r.stripe_payment_intent_id AS provider_reference`,
  { superOnly: true, route: "/admin/super/oxsteed-credit/customers" },
);
source(
  "appointmentDeliveries",
  "communications",
  "notification_delivery_log",
  `r.appointment_id::text IN (SELECT id::text FROM appointments WHERE customer_id=$1::uuid UNION SELECT id::text FROM business_appointments WHERE customer_id=$1::uuid)`,
  `${base("r.notification_type")},r.appointment_id,r.channel,r.sent_at,(r.error_message IS NOT NULL) AS has_delivery_error`,
  { grant: "message_users", route: "/admin/messages" },
);
source(
  "kitchenEvents",
  "restaurants",
  "restaurant_kitchen_events",
  `r.food_order_id IN (SELECT id FROM food_orders WHERE customer_id=$1::uuid) OR r.restaurant_id IN ${restaurants}`,
  `${base("r.event_type", "r.to_status")},r.food_order_id,r.food_order_item_id,r.from_status,r.station_label,r.created_by`,
  { grant: "manage_orders", route: "/admin/food-orders" },
);
source(
  "screenEvents",
  "devices",
  "restaurant_screen_events",
  `r.restaurant_id IN ${restaurants} OR (r.kind='food_orders' AND r.entity_id IN (SELECT id::text FROM food_orders WHERE customer_id=$1::uuid))`,
  `${base("r.kind", "CASE WHEN r.published_at IS NULL THEN 'pending' ELSE 'published' END").replace("r.id::text", "r.restaurant_id::text || ':' || r.revision::text")},r.restaurant_id,r.revision,r.location_id,r.entity_id,r.published_at`,
  { grant: "manage_orders", route: "/admin/businesses" },
);
source(
  "cancellations",
  "work",
  "cancellation_audit_log",
  "r.cancelled_by_id=$1::uuid OR r.counterparty_id=$1::uuid",
  `${base("r.fee_reason", "r.fee_status")},r.job_id,r.cancelled_by_id,r.counterparty_id,r.fee_amount_cents AS amount_cents,r.payment_method,r.cancellation_reason`,
  { grant: "manage_operations", route: "/admin/jobs" },
);
source(
  "restaurantExposure",
  "restaurantCredit",
  "restaurant_credit_exposure",
  `r.restaurant_id IN ${restaurants}`,
  `${base("r.restaurant_id::text", "CASE WHEN r.outstanding_cents>=r.cap_cents THEN 'blocked' ELSE 'within_cap' END", "r.updated_at").replace("r.id::text", "r.restaurant_id::text")},r.restaurant_id,r.outstanding_cents,r.cap_cents,(SELECT currency_code FROM food_restaurants WHERE id=r.restaurant_id) AS currency_code`,
  { superOnly: true, route: "/admin/super/restaurant-credit" },
);
source(
  "logisticsQuotes",
  "logistics",
  "logistics_buyer_quotes",
  `r.accepted_by_user_id=$1::uuid OR r.purchase_order_id IN (SELECT id FROM purchase_orders WHERE buyer_user_id=$1::uuid) OR r.participant_id IN (SELECT id FROM pooled_order_participants WHERE user_id=$1::uuid)`,
  `${base("r.reference")},r.purchase_order_id,r.participant_id,r.currency AS currency_code,r.total_cents AS amount_cents,r.deposit_cents,r.final_cents,r.deposit_due_at,r.final_due_at,r.valid_until`,
  { superOnly: true, route: "/admin/logistics" },
);
module.exports = { sources };
