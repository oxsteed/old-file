'use strict';

const logger = require('../utils/logger');

function configuredCsamMode() {
  const configured = process.env.MEDIA_CSAM_MODE;
  if (configured != null && String(configured).trim()) return String(configured).trim().toLowerCase();
  const certified = String(process.env.MEDIA_CSAM_CERTIFIED || '').trim().toLowerCase() === 'true';
  return certified ? 'vendor' : 'cloudflare';
}

function normalizedHost(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    if (raw.includes('://')) return new URL(raw).hostname.toLowerCase();
    return raw.replace(/\/.*$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function cloudflareMediaHost() {
  return normalizedHost(process.env.MEDIA_CLOUDFLARE_HOST);
}

function cloudflarePublicBaseUrl() {
  const explicit = String(process.env.MEDIA_CLOUDFLARE_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  const host = cloudflareMediaHost();
  if (!host) return '';
  return `https://${host}`;
}

function cloudflareMediaHostConfigured() {
  return Boolean(cloudflareMediaHost() && cloudflarePublicBaseUrl());
}

function isProductionNode() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function photoDeliveryAllowed() {
  if (configuredCsamMode() !== 'cloudflare') return true;
  if (!isProductionNode()) return true;
  return cloudflareMediaHostConfigured();
}

function buildCloudflarePublicAssetUrl(storageKey) {
  const base = cloudflarePublicBaseUrl();
  const key = String(storageKey || '').replace(/^\/+/, '');
  if (!base || !key) return null;
  return `${base}/${key}`;
}

function storageKeyFromPublicUrl(publicUrl) {
  const raw = String(publicUrl || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = cloudflareMediaHost();
    if (host && parsed.hostname.toLowerCase() !== host) return null;
    const base = cloudflarePublicBaseUrl();
    if (base && raw.startsWith(base)) {
      const key = raw.slice(base.length).replace(/^\/+/, '');
      return key || null;
    }
    const altBase = String(process.env.S3_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
    if (altBase && raw.startsWith(altBase)) {
      return raw.slice(altBase.length).replace(/^\/+/, '') || null;
    }
    const path = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
    return path || null;
  } catch {
    return null;
  }
}

function logStartupWarnings() {
  if (configuredCsamMode() !== 'cloudflare') return;
  if (isProductionNode() && !cloudflareMediaHostConfigured()) {
    logger.error('[mediaCloudflareDelivery] MEDIA_CSAM_MODE=cloudflare but MEDIA_CLOUDFLARE_HOST is not configured; public photos will stay blocked in production');
  }
}

module.exports = {
  cloudflareMediaHost,
  cloudflarePublicBaseUrl,
  cloudflareMediaHostConfigured,
  photoDeliveryAllowed,
  buildCloudflarePublicAssetUrl,
  storageKeyFromPublicUrl,
  logStartupWarnings,
};
