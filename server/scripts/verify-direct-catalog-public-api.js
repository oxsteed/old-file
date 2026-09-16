#!/usr/bin/env node
'use strict';

const locales = ['en', 'es', 'fr', 'ht', 'ar'];
const categories = ['electrical', 'plumbing', 'carpentry', 'painting', 'landscaping'];
const DEFAULT_BOUNDED_LIMIT = 24;

function evaluatePublicCatalogPayload(payload, expectedLocale = null) {
  const failures = [];
  const catalog = payload?.catalog;
  if (!catalog || !Array.isArray(catalog.categories) || !Array.isArray(catalog.tools)) {
    return { ok: false, failures: ['catalog response shape is invalid'] };
  }
  if (expectedLocale && catalog.locale !== expectedLocale) failures.push(`locale=${catalog.locale}, expected ${expectedLocale}`);
  if (catalog.categories.length !== categories.length) failures.push(`categories=${catalog.categories.length}, expected ${categories.length}`);
  const services = catalog.categories.flatMap((category) => category.services || []);
  const generated = services.filter((service) => service.slug?.startsWith('direct-'));
  if (generated.length !== 1000) failures.push(`generatedServices=${generated.length}, expected 1000`);
  if (new Set(generated.map((service) => service.slug)).size !== generated.length) failures.push('generated service slugs are not unique');
  const unknownServiceCategories = generated.filter((service) => !categories.includes(service.categorySlug));
  if (unknownServiceCategories.length) failures.push(`unknownServiceCategories=${unknownServiceCategories.length}`);
  for (const categorySlug of categories) {
    const count = generated.filter((service) => service.categorySlug === categorySlug).length;
    if (count !== 200) failures.push(`${categorySlug}GeneratedServices=${count}, expected 200`);
  }
  const incompleteServices = generated.filter((service) => !service.name?.trim() || !service.description?.trim() || !service.serviceArea?.trim() || !Array.isArray(service.availabilityDays));
  if (incompleteServices.length) failures.push(`incompleteGeneratedServices=${incompleteServices.length}`);
  const unsafeServices = generated.filter((service) => service.priceCents !== null || service.currencyCode !== 'USD' || service.requestable !== true || service.isBookable === true);
  if (unsafeServices.length) failures.push(`unsafeGeneratedServices=${unsafeServices.length}`);
  if (catalog.tools.length < 40) failures.push(`tools=${catalog.tools.length}, expected at least 40`);
  if (new Set(catalog.tools.map((tool) => tool.slug)).size !== catalog.tools.length) failures.push('tool slugs are not unique');
  const incompleteTools = catalog.tools.filter((tool) => !tool.name?.trim() || !tool.description?.trim() || !tool.serviceArea?.trim() || !Array.isArray(tool.availabilityDays));
  if (incompleteTools.length) failures.push(`incompleteTools=${incompleteTools.length}`);
  const unknownToolCategories = catalog.tools.filter((tool) => !categories.includes(tool.categorySlug));
  if (unknownToolCategories.length) failures.push(`unknownToolCategories=${unknownToolCategories.length}`);
  for (const categorySlug of categories) {
    const count = catalog.tools.filter((tool) => tool.categorySlug === categorySlug).length;
    if (count < 8) failures.push(`${categorySlug}Tools=${count}, expected at least 8`);
  }
  const unsafeTools = catalog.tools.filter((tool) => !tool.categorySlug || tool.isOperationallyAvailable !== true);
  if (unsafeTools.length) failures.push(`unsafeTools=${unsafeTools.length}`);
  return { ok: failures.length === 0, failures, serviceCount: services.length, toolCount: catalog.tools.length };
}

function evaluateBoundedCatalogPayload(payload, { categorySlug, limit, offset }) {
  const failures = [];
  const catalog = payload?.catalog;
  if (!catalog || !Array.isArray(catalog.categories)) return { ok: false, failures: ['bounded catalog response shape is invalid'] };
  const pagination = catalog.servicePagination;
  if (!pagination || pagination.categorySlug !== categorySlug || pagination.limit !== limit || pagination.offset !== offset || pagination.search !== null) {
    failures.push('bounded catalog pagination metadata is missing or incorrect');
  }
  const selected = catalog.categories.find((category) => category.slug === categorySlug);
  if (!selected) failures.push(`bounded catalog is missing category ${categorySlug}`);
  const selectedServices = selected?.services || [];
  if (selectedServices.length === 0 || selectedServices.length > limit) failures.push(`bounded ${categorySlug} services=${selectedServices.length}, expected 1-${limit}`);
  if (catalog.categories.some((category) => category.slug !== categorySlug && (category.services || []).length > 0)) failures.push('bounded catalog returned services outside the requested category');
  if (selected && selected.liveServiceCount < offset + selectedServices.length) failures.push('bounded catalog category total is smaller than the requested page');
  return { ok: failures.length === 0, failures, serviceCount: selectedServices.length, durationMs: payload?.durationMs };
}

async function verifyBoundedPublicCatalog(baseUrl, { limit = DEFAULT_BOUNDED_LIMIT, offset = DEFAULT_BOUNDED_LIMIT } = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set('lang', 'en');
  url.searchParams.set('category', categories[0]);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  const startedAt = Date.now();
  const response = await fetch(url);
  if (!response.ok) throw new Error(`bounded public catalog returned HTTP ${response.status}`);
  const payload = await response.json();
  const result = evaluateBoundedCatalogPayload({ ...payload, durationMs: Date.now() - startedAt }, { categorySlug: categories[0], limit, offset });
  if (!result.ok) throw new Error(`bounded public catalog failed: ${result.failures.join('; ')}`);
  const maxMs = Number(process.env.DIRECT_CATALOG_BOUNDED_MAX_MS || 5000);
  if (!Number.isFinite(maxMs) || maxMs < 1) throw new Error('DIRECT_CATALOG_BOUNDED_MAX_MS must be a positive number');
  if (result.durationMs > maxMs) throw new Error(`bounded public catalog took ${result.durationMs}ms, maximum ${maxMs}ms`);
  return result;
}

async function verifyPublicCatalog(baseUrl = process.env.DIRECT_CATALOG_PUBLIC_API_URL || 'https://oxsteed.com/api/direct/catalog') {
  const results = [];
  const englishNames = new Map();
  for (const locale of locales) {
    const url = new URL(baseUrl);
    url.searchParams.set('lang', locale);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`public catalog ${locale} returned HTTP ${response.status}`);
    const payload = await response.json();
    const result = evaluatePublicCatalogPayload(payload, locale);
    if (!result.ok) throw new Error(`public catalog ${locale} failed: ${result.failures.join('; ')}`);
    const generated = payload.catalog.categories.flatMap((category) => category.services || []).filter((service) => service.slug?.startsWith('direct-'));
    if (locale === 'en') generated.forEach((service) => englishNames.set(service.slug, service.name));
    else if (!generated.some((service) => englishNames.get(service.slug) && englishNames.get(service.slug) !== service.name)) {
      throw new Error(`public catalog ${locale} did not return any localized generated service names`);
    }
    results.push({ locale, serviceCount: result.serviceCount, toolCount: result.toolCount });
  }
  const bounded = await verifyBoundedPublicCatalog(baseUrl);
  results.push({ boundedServiceCount: bounded.serviceCount, boundedDurationMs: bounded.durationMs });
  return results;
}

if (require.main === module) {
  verifyPublicCatalog()
    .then((results) => {
      const localesResult = results.filter((result) => result.locale).map((result) => `${result.locale}=${result.serviceCount}/${result.toolCount}`).join(' ');
      const bounded = results.find((result) => result.boundedServiceCount !== undefined);
      console.log(`Public Direct catalog verification passed: ${localesResult} bounded=${bounded.boundedServiceCount} services/${bounded.boundedDurationMs}ms`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { evaluatePublicCatalogPayload, evaluateBoundedCatalogPayload, verifyBoundedPublicCatalog, verifyPublicCatalog };
