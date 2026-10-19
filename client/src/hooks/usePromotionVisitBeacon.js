import { useEffect, useRef } from 'react';
import api from '../api/axios';

// Records one first-party visit for a Growth Center tracked link
// (?ref=growth_center&utm_source=...). Fire-and-forget: the server answers 204
// and never surfaces errors, so a failed beacon can never break the profile.
//
// Dedupe key: a random device id. It is persisted in localStorage only when the
// visitor accepted analytics cookies; otherwise a per-tab sessionStorage id is
// used so nothing durable is stored without consent. The server hashes it and
// counts at most one visit per device/source/campaign/UTC day.

import { PROMO_CONSENT_KEY as CONSENT_KEY, PROMO_VISITOR_KEY as VISITOR_KEY } from '../utils/promotionVisitor';

const SLUG_RE = /^[a-z0-9_-]{1,60}$/;

function hasAnalyticsConsent() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONSENT_KEY) || 'null');
    return parsed?.analytics === true;
  } catch {
    return false;
  }
}

function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function promotionVisitorId() {
  const store = hasAnalyticsConsent() ? window.localStorage : window.sessionStorage;
  try {
    const existing = store.getItem(VISITOR_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    const id = randomId();
    store.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return randomId();
  }
}

function slug(value) {
  // Mirrors server normalization in promotionLinkAnalytics.slug().
  const v = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return SLUG_RE.test(v) ? v : null;
}

export function parsePromotionParams(search) {
  const params = new URLSearchParams(search || '');
  if (params.get('ref') !== 'growth_center') return null;
  const source = slug(params.get('utm_source'));
  if (!source) return null;
  const campaign = String(params.get('utm_campaign') || '').trim().slice(0, 80) || null;
  return {
    source,
    medium: slug(params.get('utm_medium')),
    content: slug(params.get('utm_content')),
    campaign,
  };
}

/**
 * @param {'helper'|'business'} ownerType
 * @param {string|null|undefined} ownerId  profile owner id once loaded
 */
export default function usePromotionVisitBeacon(ownerType, ownerId) {
  // Capture the landing query string at mount: canonical-slug redirects drop it.
  const initialSearch = useRef(typeof window !== 'undefined' ? window.location.search : '');
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || !ownerId) return;
    const promo = parsePromotionParams(initialSearch.current);
    if (!promo) return;
    sent.current = true;
    api.post('/promotion-analytics/visit', {
      ownerType,
      ownerId,
      ...promo,
      visitorId: promotionVisitorId(),
    }).catch(() => {});
  }, [ownerType, ownerId]);
}
