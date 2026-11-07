'use strict';

// Phase 8 Track E — franchise reporting (baseline gap 18, section 6).
//
// Per-store franchise reporting with conversion, and royalty/fee
// reporting from the fee terms that already exist on
// franchise_agreements — royalty_bps, marketing_fee_bps,
// initial_fee_cents, and the agreement currency. Nothing is
// invented: a royalty is store sales in the period times the stored
// basis points, and an initial fee is the stored amount. There is no
// fee schedule in the model beyond those stored terms, so there is
// nothing else to report.
//
// A store maps to its franchise agreement EXPLICITLY, through
// franchise_location_agreements (design-review item 44) — never
// through city/region string matching. When two launched agreements
// covered the same city, the old most-recently-updated-wins string
// match attributed the store (and its royalty and marketing fee) to
// the wrong franchisee. A store with no mapping reports with no
// agreement and no royalty — it is listed in `unmappedStores`, not
// dropped and never string-matched. A backfilled mapping whose old
// match was ambiguous is flagged on the store (`mappingAmbiguous`)
// and listed in `ambiguousStores` so an operator can confirm it.
//
// The royalty ACCRUAL for store revenue (food orders, which carry a
// location_id) reads the same table through
// franchiseRoyaltyService.accrueTerritoryRoyalty. Revenue that is only
// a territory point (jobs, marketplace shipping addresses, Direct
// bookings) has no store to map, so it keeps the deterministic
// territory match in franchiseRoyaltyService.findTerritoryAgreement;
// report and accrual agree wherever a store exists, and the
// territory-point path is documented there, not silently unified.
//
// Permission boundary: an HQ caller sees every store they can
// already access; a franchisee (the owner_user_id of a launched
// agreement) sees only the stores that match their own
// agreement(s); anyone else sees nothing (brand_not_found, the
// same indistinguishable 404 the brand console uses).

const AppError = require('../utils/appError');
const fx = require('./restaurantFxService');
const brandService = require('./restaurantBrandService');
const hq = require('./restaurantHQService');
const locationAgreements = require('./restaurantFranchiseLocationAgreementService');

function dateOnly(value, field = 'date') {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new AppError(`A valid ${field} (YYYY-MM-DD) is required`, 400, 'validation_failed');
  }
  return text;
}

// Agreements a user owns as franchisee: launched applications with
// a signed agreement. The owner sees only stores matching these.
async function listFranchiseeAgreements(client, userId) {
  const { rows } = await client.query(
    `SELECT fagr.id AS agreement_id,
            fa.id AS application_id,
            fa.owner_user_id,
            fa.desired_city,
            fa.desired_region,
            fagr.royalty_bps,
            fagr.marketing_fee_bps,
            fagr.initial_fee_cents,
            fagr.currency,
            fagr.territory_exclusive,
            fagr.signed_at
       FROM franchise_applications fa
       JOIN franchise_agreements fagr ON fagr.application_id = fa.id
      WHERE fa.owner_user_id = $1 AND fa.status = 'launched'`,
    [userId]
  );
  return rows;
}

// Reporting agreement for one store: the explicit mapping only.
// No city/region string fallback — an unmapped store reports as
// unmapped, never guessed. Returns the mapped agreement row or null.
async function findReportingAgreement(client, locationId) {
  return locationAgreements.findLocationAgreement(client, locationId);
}

async function getFranchiseReport(client, {
  brandId,
  accessibleRestaurantIds,
  from,
  to,
  franchiseeUserId = null,
} = {}) {
  const fromDate = dateOnly(from, 'from date');
  const toDate = dateOnly(to, 'to date');
  const restaurants = await brandService.listBrandRestaurants(client, brandId);
  const allowed = new Set((accessibleRestaurantIds || []).map((id) => Number(id)));
  const inScope = restaurants.filter((row) => allowed.has(Number(row.id)));
  if (!inScope.length) throw new AppError('Brand not found', 404, 'brand_not_found');

  const franchiseeAgreements = franchiseeUserId
    ? await listFranchiseeAgreements(client, franchiseeUserId)
    : [];
  const franchiseeAgreementIds = new Set(franchiseeAgreements.map((row) => String(row.agreement_id)));

  const policy = await fx.getFxPolicy(client, { brandId });
  const rateDate = fx.resolveRateDate(policy, toDate);

  const stores = [];
  const unmappedStores = [];
  const ambiguousStores = [];
  const perCurrencySales = new Map();
  const perCurrencyRoyalty = new Map();
  const perCurrencyMarketing = new Map();
  const perCurrencyInitialFees = new Map();
  const missingCurrencies = new Set();
  const staleCurrencies = new Set();
  let maxRateAgeDays = null;
  let stalestRateDate = null;
  let convertedSalesTotal = 0;
  let convertedRoyaltyTotal = 0;
  let convertedMarketingTotal = 0;
  const agreementsSeen = new Map();

  for (const restaurant of inScope) {
    const { rows: locations } = await client.query(
      `SELECT id, name, address_city, address_state, currency_code, timezone
         FROM restaurant_locations
        WHERE restaurant_id = $1 AND status <> 'archived'
        ORDER BY is_primary DESC, id`,
      [restaurant.id]
    );
    if (!locations.length) continue;
    const locationIds = locations.map((row) => Number(row.id));
    const { salesRows } = await hq.rollupLocations(client, {
      restaurantId: Number(restaurant.id),
      locationIds,
      from: fromDate,
      to: toDate,
      timezone: restaurant.timezone || 'UTC',
    });
    const salesByLocation = new Map();
    for (const row of salesRows) {
      const key = Number(row.location_id);
      if (!salesByLocation.has(key)) salesByLocation.set(key, []);
      salesByLocation.get(key).push(row);
    }
    for (const location of locations) {
      const sales = (salesByLocation.get(Number(location.id)) || []).map((row) => ({
        currencyCode: row.currency_code,
        orderCount: Number(row.order_count || 0),
        netCollectedCents: Number(row.net_collected_cents || 0),
      }));
      // Explicit mapping only: the store's agreement comes from
      // franchise_location_agreements, never from a city/region
      // string match. No mapping means no agreement, full stop.
      const agreement = await findReportingAgreement(client, Number(location.id));
      let agreementOut = null;
      let royaltyLines = [];
      if (agreement) {
        agreementOut = {
          agreementId: String(agreement.agreementId),
          ownerUserId: agreement.ownerUserId,
          royaltyBps: Number(agreement.royaltyBps || 0),
          marketingFeeBps: Number(agreement.marketingFeeBps || 0),
          initialFeeCents: agreement.initialFeeCents,
          currency: agreement.currency,
          territoryExclusive: agreement.territoryExclusive === true,
          territoryCity: agreement.territoryCity,
          territoryRegion: agreement.territoryRegion,
        };
        if (!agreementsSeen.has(String(agreementOut.agreementId))) {
          agreementsSeen.set(String(agreementOut.agreementId), agreementOut);
          const feeCurrency = agreementOut.currency;
          if (agreementOut.initialFeeCents != null) {
            perCurrencyInitialFees.set(
              feeCurrency,
              (perCurrencyInitialFees.get(feeCurrency) || 0) + agreementOut.initialFeeCents
            );
          }
        }
        // Royalty and marketing fee accrue on this store's sales in
        // the period, at the stored basis points, in the sale
        // currency. The agreement currency is the denomination of
        // the initial fee, not a conversion instruction for sales.
        royaltyLines = sales.map((sale) => {
          const royaltyCents = Math.round((sale.netCollectedCents * agreementOut.royaltyBps) / 10000);
          const marketingCents = Math.round((sale.netCollectedCents * agreementOut.marketingFeeBps) / 10000);
          return {
            currencyCode: sale.currencyCode,
            salesCents: sale.netCollectedCents,
            royaltyBps: agreementOut.royaltyBps,
            royaltyCents,
            marketingFeeBps: agreementOut.marketingFeeBps,
            marketingCents,
          };
        });
      }
      // Franchisee boundary: a franchisee sees only stores matching
      // their own agreements. HQ callers (franchiseeUserId null) see
      // every accessible store.
      if (franchiseeUserId && (!agreementOut || !franchiseeAgreementIds.has(String(agreementOut.agreementId)))) {
        continue;
      }
      for (const sale of sales) {
        perCurrencySales.set(sale.currencyCode, (perCurrencySales.get(sale.currencyCode) || 0) + sale.netCollectedCents);
      }
      for (const line of royaltyLines) {
        perCurrencyRoyalty.set(line.currencyCode, (perCurrencyRoyalty.get(line.currencyCode) || 0) + line.royaltyCents);
        perCurrencyMarketing.set(line.currencyCode, (perCurrencyMarketing.get(line.currencyCode) || 0) + line.marketingCents);
      }
      const storeOut = {
        restaurantId: Number(restaurant.id),
        restaurantName: restaurant.display_name,
        locationId: Number(location.id),
        locationName: location.name,
        city: location.address_city || null,
        region: location.address_state || null,
        currencyCode: location.currency_code || restaurant.currency_code || null,
        sales,
        agreement: agreementOut,
        royalty: royaltyLines,
        // No mapping: the store still reports its sales; royalty is
        // simply absent, never zero-filled from a guess. The store is
        // also listed in unmappedStores so an operator can assign it.
        noAgreement: agreementOut == null,
        mappingSource: agreement ? agreement.mappingSource : null,
        // Backfilled from an ambiguous old string match: the
        // attribution is the old winner, flagged for confirmation.
        mappingAmbiguous: agreement ? agreement.mappingAmbiguous === true : false,
      };
      if (agreementOut == null) {
        unmappedStores.push({
          locationId: storeOut.locationId,
          locationName: storeOut.locationName,
          restaurantId: storeOut.restaurantId,
          restaurantName: storeOut.restaurantName,
          city: storeOut.city,
          region: storeOut.region,
        });
      } else if (agreement.mappingAmbiguous) {
        ambiguousStores.push({
          locationId: storeOut.locationId,
          locationName: storeOut.locationName,
          restaurantId: storeOut.restaurantId,
          restaurantName: storeOut.restaurantName,
          agreementId: agreementOut.agreementId,
          ambiguousCandidateCount: agreement.ambiguousCandidateCount,
        });
      }
      stores.push(storeOut);
    }
  }

  // Converted totals: sales, royalties, and marketing fees each
  // convert from their own native currency. Any currency without a
  // stored rate leaves its converted total null and is named. The
  // staleness summary is aggregated across all four conversions in
  // the breakdown's own shape (any stale line, the union of stale
  // currencies, the oldest rate's age and date), so a converted
  // franchise total built on an old rate carries the same warning
  // the HQ rollups surface — no new threshold, just carried through.
  async function convertMap(map) {
    const entries = [...map.entries()].map(([currencyCode, amountCents]) => ({ currencyCode, amountCents }));
    const converted = await fx.convertBreakdown(client, {
      entries,
      reportingCurrency: policy.reportingCurrency,
      rateDate,
      rateSource: policy.rateSource,
    });
    for (const missing of converted.missingCurrencies) missingCurrencies.add(missing);
    for (const stale of converted.staleCurrencies || []) staleCurrencies.add(stale);
    if (converted.maxRateAgeDays != null && (maxRateAgeDays == null || converted.maxRateAgeDays > maxRateAgeDays)) {
      maxRateAgeDays = converted.maxRateAgeDays;
      stalestRateDate = converted.stalestRateDate;
    }
    return converted;
  }
  const salesConverted = await convertMap(perCurrencySales);
  const royaltyConverted = await convertMap(perCurrencyRoyalty);
  const marketingConverted = await convertMap(perCurrencyMarketing);
  const initialFeeConverted = await convertMap(perCurrencyInitialFees);
  convertedSalesTotal = salesConverted.convertedTotalCents;
  convertedRoyaltyTotal = royaltyConverted.convertedTotalCents;
  convertedMarketingTotal = marketingConverted.convertedTotalCents;

  const asList = (map) => [...map.entries()].map(([currencyCode, amountCents]) => ({ currencyCode, amountCents }));
  return {
    brandId: Number(brandId),
    from: fromDate,
    to: toDate,
    reportingCurrency: policy.reportingCurrency,
    rateDate,
    rateSource: policy.rateSource,
    isDefaultPolicy: policy.isDefault,
    missingCurrencies: [...missingCurrencies],
    stale: staleCurrencies.size > 0,
    staleCurrencies: [...staleCurrencies],
    maxRateAgeDays,
    stalestRateDate,
    stores,
    unmappedStores,
    ambiguousStores,
    agreements: [...agreementsSeen.values()],
    totals: {
      salesByCurrency: asList(perCurrencySales),
      salesConvertedCents: convertedSalesTotal,
      royaltyByCurrency: asList(perCurrencyRoyalty),
      royaltyConvertedCents: convertedRoyaltyTotal,
      marketingFeeByCurrency: asList(perCurrencyMarketing),
      marketingFeeConvertedCents: convertedMarketingTotal,
      initialFeesByCurrency: asList(perCurrencyInitialFees),
      initialFeesConvertedCents: initialFeeConverted.convertedTotalCents,
    },
  };
}

module.exports = {
  getFranchiseReport,
  listFranchiseeAgreements,
  findReportingAgreement,
};
