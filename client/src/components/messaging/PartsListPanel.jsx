import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Minus, Plus, Search, Send, ShoppingCart, Trash2, X } from 'lucide-react';
import { cartApi, jobKitsApi, marketplaceApi, shareApi } from '../../api/marketplaceApi';
import { createMessageRequestId } from '../../lib/messageRequestId';
import '../helperProfile/chat/MessengerDock.css';
import './PartsListPanel.css';

function formatMoney(cents, currency, locale) {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: /^[A-Za-z]{3}$/.test(String(currency || '')) ? String(currency).toUpperCase() : 'USD',
    }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

function kitLabel(t, jobType) {
  return t(`partsList.kits.${jobType}.label`, { defaultValue: jobType });
}

/**
 * Provider UI: pick a job kit, review the draft parts cart, share it into the thread.
 * Prices shown are the live DB prices returned by the job-kit build endpoint.
 */
export default function PartsListPanel({
  open = false,
  onClose,
  conversationId = null,
  jobId = null,
  onShared,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [step, setStep] = useState('pick'); // pick | review
  const [kits, setKits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedJobType, setSelectedJobType] = useState(null);
  const [building, setBuilding] = useState(false);
  const [draft, setDraft] = useState(null); // { cartId, name, currency, items, omitted }
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [addingId, setAddingId] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [sharing, setSharing] = useState(false);

  const loadKits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await jobKitsApi.listKits();
      setKits(Array.isArray(data?.kits) ? data.kits : []);
    } catch {
      setError(t('partsList.loadFailed'));
      setKits([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      setStep('pick');
      setSelectedJobType(null);
      setDraft(null);
      setSearchQuery('');
      setSearchResults([]);
      setError(null);
      loadKits();
    }
  }, [open, loadKits]);

  const buildDraft = async () => {
    if (!selectedJobType) return;
    setBuilding(true);
    setError(null);
    try {
      const { data } = await jobKitsApi.buildKit(selectedJobType, {
        name: t('partsList.defaultName', { kit: kitLabel(t, selectedJobType) }),
        jobId: jobId || undefined,
      });
      setDraft({
        cartId: data.cartId,
        name: data.name,
        currency: data.currency || 'USD',
        items: Array.isArray(data.items) ? data.items : [],
        omitted: Array.isArray(data.omitted) ? data.omitted : [],
      });
      setStep('review');
    } catch {
      setError(t('partsList.buildFailed'));
    } finally {
      setBuilding(false);
    }
  };

  const refreshLine = (item, quantity) => ({
    ...item,
    quantity,
    lineTotalCents: quantity * (Number(item.unitPriceCents) || 0),
  });

  const removeItem = async (item) => {
    if (!draft?.cartId || mutating) return;
    setMutating(true);
    setError(null);
    try {
      await cartApi.removeItem(draft.cartId, item.id);
      setDraft((d) => (d ? { ...d, items: d.items.filter((it) => it.id !== item.id) } : d));
    } catch {
      setError(t('partsList.buildFailed'));
    } finally {
      setMutating(false);
    }
  };

  const updateQuantity = async (item, delta) => {
    if (!draft?.cartId || mutating) return;
    const nextQty = (Number(item.quantity) || 1) + delta;
    if (nextQty < 1) {
      removeItem(item);
      return;
    }
    setMutating(true);
    setError(null);
    try {
      await cartApi.updateItem(draft.cartId, item.id, nextQty);
      setDraft((d) => (d ? { ...d, items: d.items.map((it) => (it.id === item.id ? refreshLine(it, nextQty) : it)) } : d));
    } catch {
      setError(t('partsList.buildFailed'));
    } finally {
      setMutating(false);
    }
  };

  const search = async () => {
    const q = searchQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const { data } = await marketplaceApi.searchProducts(q, null, null, null, 1, 8);
      setSearchResults(data?.data || data?.products || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addProduct = async (product) => {
    if (!draft?.cartId || addingId) return;
    const existing = draft.items.find((it) => String(it.productId) === String(product.id));
    if (existing) {
      updateQuantity(existing, 1);
      return;
    }
    setAddingId(product.id);
    setError(null);
    try {
      const { data } = await cartApi.addItem(draft.cartId, product.id, 1);
      const unitPriceCents = Number(product.price_cents) || 0;
      const quantity = Number(data?.quantity) || 1;
      setDraft((d) => (d ? {
        ...d,
        items: [...d.items, {
          id: data?.id || data?.item?.id || `local-${product.id}-${Date.now()}`,
          productId: product.id,
          name: product.name,
          quantity,
          unitPriceCents,
          lineTotalCents: quantity * unitPriceCents,
          notes: '',
          imageUrl: product.product_image_url || '',
        }],
      } : d));
    } catch {
      setError(t('partsList.buildFailed'));
    } finally {
      setAddingId(null);
    }
  };

  const share = async () => {
    if (!draft?.cartId || sharing) return;
    setSharing(true);
    setError(null);
    try {
      const { data } = await shareApi.shareCart(
        draft.cartId,
        null,
        true,
        undefined,
        conversationId,
        createMessageRequestId(),
      );
      onShared?.(data);
      onClose?.();
    } catch {
      setError(t('partsList.shareFailed'));
    } finally {
      setSharing(false);
    }
  };

  if (!open) return null;

  const subtotalCents = draft
    ? draft.items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPriceCents) || 0), 0)
    : 0;

  return (
    <div className="quote-share-panel parts-list-panel" role="dialog" aria-modal="true" aria-label={t('partsList.title')}>
      <header className="quote-share-panel__head">
        <h3>
          <ShoppingCart className="w-4 h-4" aria-hidden />
          {step === 'pick' ? t('partsList.title') : t('partsList.reviewTitle')}
        </h3>
        <button type="button" className="quote-share-panel__close" onClick={onClose} aria-label={t('common.close')}>
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="quote-share-panel__body">
        {step === 'pick' ? (
          <>
            <p className="parts-list-panel__subtitle">{t('partsList.pickKit')}</p>
            {loading ? (
              <p className="quote-share-panel__muted">
                <Loader2 className="w-4 h-4 animate-spin" /> {t('common.loading')}
              </p>
            ) : kits.length === 0 && !error ? (
              <p className="quote-share-panel__muted">{t('partsList.empty')}</p>
            ) : (
              <ul className="quote-share-panel__list">
                {kits.map((kit) => {
                  const label = kitLabel(t, kit.jobType);
                  const disabled = !kit.buildable;
                  return (
                    <li key={kit.jobType}>
                      <label className={`${selectedJobType === kit.jobType ? 'is-selected' : ''}${disabled ? ' is-disabled' : ''}`}>
                        <input
                          type="radio"
                          name="parts-kit-pick"
                          checked={selectedJobType === kit.jobType}
                          disabled={disabled}
                          onChange={() => setSelectedJobType(kit.jobType)}
                        />
                        <span className="quote-share-panel__pick-main">
                          <strong>{label}</strong>
                          <small>{t(`partsList.kits.${kit.jobType}.hint`)}</small>
                          <small>
                            {Number(kit.availableCount) || 0}/{Number(kit.itemCount) || 0}
                            {' · '}
                            {t('partsList.estimatedTotal')}: {formatMoney(kit.estimatedTotalCents, kit.currency, locale)}
                          </small>
                          {disabled && (
                            <small className="parts-list-panel__unavailable">{t('partsList.kitUnavailable')}</small>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <>
            {draft && draft.omitted.length > 0 && (
              <p className="parts-list-panel__note" role="note">
                {t('partsList.omittedNote', { count: draft.omitted.length })}
              </p>
            )}
            {!draft || draft.items.length === 0 ? (
              <p className="quote-share-panel__muted">{t('partsList.empty')}</p>
            ) : (
              <ul className="parts-list-panel__items">
                {draft.items.map((item) => (
                  <li key={item.id} className="parts-list-panel__item">
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt="" className="parts-list-panel__thumb" />
                    ) : null}
                    <div className="parts-list-panel__item-main">
                      <strong>{item.name}</strong>
                      <small>{formatMoney(item.unitPriceCents, draft.currency, locale)}</small>
                    </div>
                    <div className="parts-list-panel__qty">
                      <button
                        type="button"
                        onClick={() => updateQuantity(item, -1)}
                        disabled={mutating}
                        aria-label={t('partsList.decrease')}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span aria-live="polite">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => updateQuantity(item, 1)}
                        disabled={mutating}
                        aria-label={t('partsList.increase')}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <strong className="parts-list-panel__line-total">
                      {formatMoney(item.lineTotalCents, draft.currency, locale)}
                    </strong>
                    <button
                      type="button"
                      className="parts-list-panel__remove"
                      onClick={() => removeItem(item)}
                      disabled={mutating}
                      aria-label={t('partsList.remove')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {draft && (
              <p className="parts-list-panel__subtotal">
                {t('helperProfile.messenger.quoteTotal')}: <strong>{formatMoney(subtotalCents, draft.currency, locale)}</strong>
              </p>
            )}
            <div className="parts-list-panel__add">
              <div className="parts-list-panel__search-row">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      search();
                    }
                  }}
                  placeholder={t('partsList.searchPlaceholder')}
                  aria-label={t('partsList.searchPlaceholder')}
                />
                <button type="button" onClick={search} disabled={searching || !searchQuery.trim()} aria-label={t('common.search')}>
                  {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                </button>
              </div>
              {searchResults.length > 0 && (
                <ul className="parts-list-panel__results">
                  {searchResults.map((product) => (
                    <li key={product.id}>
                      <span>
                        {product.name}
                        <small>{formatMoney(product.price_cents, product.currency || draft?.currency, locale)}</small>
                      </span>
                      <button type="button" onClick={() => addProduct(product)} disabled={addingId === product.id}>
                        {addingId === product.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                        {t('partsList.addItem')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {error && (
        <p className="quote-share-panel__error" role="alert">
          {error}
        </p>
      )}

      <footer className="quote-share-panel__foot">
        <button type="button" className="quote-share-panel__cancel" onClick={onClose} disabled={building || sharing}>
          {t('common.cancel')}
        </button>
        {step === 'pick' ? (
          <button type="button" className="quote-share-panel__send" onClick={buildDraft} disabled={building || !selectedJobType}>
            {building ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
            {t('partsList.build')}
          </button>
        ) : (
          <button
            type="button"
            className="quote-share-panel__send"
            onClick={share}
            disabled={sharing || !draft || draft.items.length === 0}
          >
            {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sharing ? t('partsList.sharing') : t('partsList.share')}
          </button>
        )}
      </footer>
    </div>
  );
}
