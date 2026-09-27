'use strict';

// Launch pricing for simple point-to-point delivery. Keep this model small and
// transparent until OxSteed has enough completed trips to calibrate by market.
// Values are intentionally centralized so operators can tune them without
// changing the delivery workflow or payment records.
const PRICING_VERSION = 'local-delivery-v1';
const DEFAULTS = Object.freeze({
  minimumFareCents: 1500,
  baseFareCents: 900,
  includedMiles: 5,
  extraMileCents: 175,
  platformFeeRate: 0.12,
  platformFeeMinimumCents: 299,
  driverShareRate: 0.8,
  driverMinimumCents: 1200,
  demandMultiplier: 1,
  quoteTtlMinutes: 15,
});

const PACKAGE_TYPES = Object.freeze({
  small: Object.freeze({ maxWeightLbs: 25, surchargeCents: 0 }),
  medium: Object.freeze({ maxWeightLbs: 75, surchargeCents: 500 }),
  large: Object.freeze({ maxWeightLbs: 150, surchargeCents: 1200 }),
  oversized: Object.freeze({ maxWeightLbs: 300, surchargeCents: 2500 }),
});

const SERVICE_LEVELS = Object.freeze({
  standard: Object.freeze({ multiplier: 1, label: 'standard' }),
  same_day: Object.freeze({ multiplier: 1.15, label: 'same_day' }),
  rush: Object.freeze({ multiplier: 1.35, label: 'rush' }),
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cents(value) {
  return Math.max(0, Math.round(finiteNumber(value)));
}

function dollars(value) {
  return Number((cents(value) / 100).toFixed(2));
}

function normalizePackageType(value) {
  return Object.prototype.hasOwnProperty.call(PACKAGE_TYPES, value) ? value : 'small';
}

function normalizeServiceLevel(value) {
  return Object.prototype.hasOwnProperty.call(SERVICE_LEVELS, value) ? value : 'standard';
}

function resolveDemandMultiplier(value = DEFAULTS.demandMultiplier) {
  // Demand can only add a bounded premium. It can never make a quote cheaper
  // and is not accepted from a customer as an arbitrary price override.
  return Math.min(Math.max(finiteNumber(value, DEFAULTS.demandMultiplier), 1), 1.5);
}

function calculateLocalDeliveryPrice({
  distanceMiles,
  packageType = 'small',
  weightLbs = 0,
  serviceLevel = 'standard',
  demandMultiplier = DEFAULTS.demandMultiplier,
  tollsCents = 0,
  parkingCents = 0,
  config = DEFAULTS,
} = {}) {
  const miles = Math.max(0, finiteNumber(distanceMiles));
  const normalizedPackage = normalizePackageType(packageType);
  const normalizedService = normalizeServiceLevel(serviceLevel);
  const packageRule = PACKAGE_TYPES[normalizedPackage];
  const serviceRule = SERVICE_LEVELS[normalizedService];
  const weight = Math.max(0, finiteNumber(weightLbs));

  if (weight > packageRule.maxWeightLbs) {
    const error = new Error(`Weight exceeds the ${normalizedPackage} package limit`);
    error.code = 'delivery_weight_exceeds_package_limit';
    error.status = 400;
    error.maxWeightLbs = packageRule.maxWeightLbs;
    throw error;
  }

  const extraMiles = Math.max(0, miles - finiteNumber(config.includedMiles, DEFAULTS.includedMiles));
  const distanceCents = Math.ceil(extraMiles * finiteNumber(config.extraMileCents, DEFAULTS.extraMileCents));
  const baseCents = cents(config.baseFareCents ?? DEFAULTS.baseFareCents);
  const packageSurchargeCents = cents(packageRule.surchargeCents);
  const distanceSubtotalCents = baseCents + distanceCents + packageSurchargeCents;
  const serviceAdjustedCents = Math.ceil(distanceSubtotalCents * serviceRule.multiplier);
  const demandAdjustedCents = Math.ceil(serviceAdjustedCents * resolveDemandMultiplier(demandMultiplier));
  const deliverySubtotalCents = Math.max(cents(config.minimumFareCents ?? DEFAULTS.minimumFareCents), demandAdjustedCents);
  const platformFeeCents = Math.max(
    cents(config.platformFeeMinimumCents ?? DEFAULTS.platformFeeMinimumCents),
    Math.ceil(deliverySubtotalCents * finiteNumber(config.platformFeeRate, DEFAULTS.platformFeeRate)),
  );
  const passThroughCents = cents(tollsCents) + cents(parkingCents);
  const customerTotalCents = deliverySubtotalCents + platformFeeCents + passThroughCents;
  const driverPayoutCents = Math.max(
    cents(config.driverMinimumCents ?? DEFAULTS.driverMinimumCents),
    Math.round(deliverySubtotalCents * finiteNumber(config.driverShareRate, DEFAULTS.driverShareRate)),
  );

  return {
    pricingVersion: PRICING_VERSION,
    currency: 'USD',
    packageType: normalizedPackage,
    serviceLevel: normalizedService,
    distanceMiles: Number(miles.toFixed(2)),
    includedMiles: finiteNumber(config.includedMiles, DEFAULTS.includedMiles),
    demandMultiplier: resolveDemandMultiplier(demandMultiplier),
    breakdown: {
      baseFare: dollars(baseCents),
      distance: dollars(distanceCents),
      packageSurcharge: dollars(packageSurchargeCents),
      serviceLevelAdjustment: dollars(demandAdjustedCents - distanceSubtotalCents),
      tolls: dollars(tollsCents),
      parking: dollars(parkingCents),
      deliverySubtotal: dollars(deliverySubtotalCents),
      platformFee: dollars(platformFeeCents),
      driverPayout: dollars(driverPayoutCents),
      customerTotal: dollars(customerTotalCents),
    },
    cents: {
      deliverySubtotal: deliverySubtotalCents,
      platformFee: platformFeeCents,
      passThrough: passThroughCents,
      driverPayout: driverPayoutCents,
      customerTotal: customerTotalCents,
    },
    quoteTtlMinutes: Number(config.quoteTtlMinutes ?? DEFAULTS.quoteTtlMinutes),
  };
}

function milesFromMeters(distanceMeters) {
  return Math.max(0, finiteNumber(distanceMeters) / 1609.344);
}

module.exports = {
  DEFAULTS,
  PACKAGE_TYPES,
  PRICING_VERSION,
  SERVICE_LEVELS,
  calculateLocalDeliveryPrice,
  milesFromMeters,
  normalizePackageType,
  normalizeServiceLevel,
};
