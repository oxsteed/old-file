import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { jobKitsApi, cartApi } from '../api/marketplaceApi';
import { formatMoney } from '../lib/format';

/**
 * Group 1, item 32: customer-facing DIY kit picker. The curated job kits
 * already existed for the helper parts-list flow; this surface lets a
 * customer pick a kit, see its estimated total, and build it into a draft
 * cart. Prices are live DB prices, re-read at build time by the server.
 * Items the catalog cannot supply are reported as omitted, never silently
 * swapped (see item 34 for the substitution preview).
 */
export default function DiyKitPicker({ signedIn }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kits, setKits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [building, setBuilding] = useState(null);
  const [lastOmitted, setLastOmitted] = useState(null);
  // Group 1, item 34: substitution preview per kit.
  const [previewJobType, setPreviewJobType] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const load = useCallback(() => {
    if (!signedIn) return;
    jobKitsApi.listKits()
      .then((r) => setKits(Array.isArray(r.data?.kits) ? r.data.kits : []))
      .catch(() => setKits([]))
      .finally(() => setLoaded(true));
  }, [signedIn]);

  useEffect(load, [load]);

  async function buildKit(jobType) {
    setBuilding(jobType);
    setLastOmitted(null);
    try {
      const { data } = await jobKitsApi.buildKit(jobType);
      if (data.omitted?.length) setLastOmitted({ jobType, items: data.omitted });
      navigate(`/cart/${data.cartId}`);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('marketplace.kits.buildFailed'));
    } finally {
      setBuilding(null);
    }
  }

  async function loadPreview(jobType) {
    if (previewJobType === jobType) {
      setPreviewJobType(null);
      setPreview(null);
      return;
    }
    setPreviewJobType(jobType);
    setPreviewLoading(true);
    try {
      const { data } = await jobKitsApi.previewKit(jobType);
      setPreview(data);
    } catch {
      setPreview(null);
      toast.error(t('marketplace.kits.previewFailed'));
    } finally {
      setPreviewLoading(false);
    }
  }

  // Group 1, item 34: build the kit, then add the chosen substitute for
  // the omitted item to the same draft cart. The customer picks; nothing
  // is auto-swapped.
  async function buildWithSubstitute(jobType, omittedItem, substitute) {
    setBuilding(jobType);
    try {
      const { data } = await jobKitsApi.buildKit(jobType);
      await cartApi.addItem(data.cartId, substitute.productId, omittedItem.quantity || 1, `Substitute for ${omittedItem.productName || omittedItem.sku}`);
      navigate(`/cart/${data.cartId}`);
    } catch (err) {
      toast.error(err?.response?.data?.error || t('marketplace.kits.buildFailed'));
    } finally {
      setBuilding(null);
    }
  }

  if (!signedIn || !loaded || kits.length === 0) return null;

  return (
    <section aria-label={t('marketplace.kits.title')} className="rounded-2xl border border-gray-800 bg-gray-900/60 p-4">
      <h2 className="text-lg font-semibold text-white">{t('marketplace.kits.title')}</h2>
      <p className="text-sm text-gray-400 mt-1">{t('marketplace.kits.hint')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {kits.map((kit) => (
          <div key={kit.jobType} className="rounded-xl border border-gray-700 bg-gray-900 p-3 flex flex-col gap-2">
            <span className="font-medium text-white">{kit.jobType}</span>
            <span className="text-sm text-gray-400">
              {t('marketplace.kits.items', { available: kit.availableCount, total: kit.itemCount })}
              {kit.missingCount > 0 && ` · ${t('marketplace.kits.missing', { count: kit.missingCount })}`}
            </span>
            <span className="text-sm font-semibold text-white">
              {t('marketplace.kits.estimatedTotal', {
                amount: formatMoney(kit.estimatedTotalCents / 100, { currency: kit.currency }),
              })}
            </span>
            <button
              type="button"
              onClick={() => buildKit(kit.jobType)}
              disabled={!kit.buildable || building === kit.jobType}
              className="mt-auto px-3 py-2 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-sm font-semibold disabled:opacity-50" data-track="ui.cb95c3cc30.1"
            >
              {building === kit.jobType ? t('marketplace.kits.building') : t('marketplace.kits.buildKit')}
            </button>
            {kit.missingCount > 0 && (
              <button
                type="button"
                onClick={() => loadPreview(kit.jobType)}
                className="px-3 py-2 rounded-xl border border-gray-700 text-gray-300 text-sm font-medium hover:bg-gray-800" data-track="ui.cb95c3cc30.2"
              >
                {previewJobType === kit.jobType ? t('marketplace.kits.hidePreview') : t('marketplace.kits.previewSubstitutes')}
              </button>
            )}
          </div>
        ))}
      </div>
      {previewJobType && (
        <div className="mt-4 rounded-xl border border-gray-700 bg-gray-900 p-3">
          {previewLoading ? (
            <p className="text-sm text-gray-400">{t('marketplace.kits.previewLoading')}</p>
          ) : preview ? (
            <>
              <h3 className="font-medium text-white">{t('marketplace.kits.previewTitle', { jobType: preview.jobType })}</h3>
              {preview.omitted.length === 0 ? (
                <p className="text-sm text-gray-400 mt-1">{t('marketplace.kits.previewAllAvailable')}</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {preview.omitted.map((om) => (
                    <li key={om.sku} className="text-sm">
                      <span className="text-gray-300">
                        {t('marketplace.kits.omittedItem', { name: om.productName || om.sku })}
                      </span>
                      {om.substitutes?.length ? (
                        <ul className="mt-1 space-y-1 ps-3">
                          {om.substitutes.map((sub) => (
                            <li key={sub.productId} className="flex items-center justify-between gap-2">
                              <span className="text-gray-300">
                                {sub.name} · {formatMoney(sub.unitPriceCents / 100, { currency: sub.currency })}
                              </span>
                              <button
                                type="button"
                                onClick={() => buildWithSubstitute(preview.jobType, om, sub)}
                                disabled={building === preview.jobType}
                                className="shrink-0 px-2 py-1 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold disabled:opacity-50" data-track="ui.cb95c3cc30.3"
                              >
                                {t('marketplace.kits.useInstead')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-500 ps-3">{t('marketplace.kits.noSubstitutes')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-400">{t('marketplace.kits.previewFailed')}</p>
          )}
        </div>
      )}
      {lastOmitted && (
        <p role="status" className="text-sm text-amber-300 mt-3">
          {t('marketplace.kits.omittedNotice', {
            jobType: lastOmitted.jobType,
            items: lastOmitted.items.map((o) => o.productName || o.sku).join(', '),
          })}
        </p>
      )}
    </section>
  );
}
