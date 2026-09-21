import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Loader2, Plus, Send, X } from 'lucide-react';
import api from '../../../api/axios';
import { formatCents } from './messengerQuotes.js';
import './MessengerDock.css';

const EMPTY_LINE = { description: '', quantity: 1, unit_price: '' };

/**
 * Provider UI: pick an existing quote or quick-build, then share into the thread.
 */
export default function QuoteSharePanel({
  open = false,
  onClose,
  kind = 'helper', // 'helper' | 'business'
  businessId = null,
  conversationId = null,
  guestSessionId = null,
  clientName = '',
  clientEmail = '',
  onShared,
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const [tab, setTab] = useState('pick'); // pick | build
  const [quotes, setQuotes] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState('');
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [taxRate, setTaxRate] = useState('0');
  const [validUntil, setValidUntil] = useState('');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const params = { kind };
      if (kind === 'business' && businessId) params.businessId = businessId;
      const { data } = await api.get('/chat/quotes/list', { params });
      setQuotes(Array.isArray(data?.quotes) ? data.quotes : []);
    } catch {
      setQuotes([]);
    } finally {
      setLoadingList(false);
    }
  }, [kind, businessId]);

  useEffect(() => {
    if (open) {
      loadList();
      setTab('pick');
      setSelectedId(null);
      setError(null);
    }
  }, [open, loadList]);

  const subtotalCents = lines.reduce((sum, li) => {
    const q = parseFloat(li.quantity) || 0;
    const p = Math.round((parseFloat(li.unit_price) || 0) * 100);
    return sum + Math.round(q * p);
  }, 0);
  const tax = Math.round((subtotalCents * (parseFloat(taxRate) || 0)) / 100);
  const totalCents = subtotalCents + tax;

  const share = async () => {
    setSharing(true);
    setError(null);
    try {
      const payload = {
        kind,
        conversationId: conversationId || undefined,
        guestSessionId: guestSessionId || undefined,
        businessId: kind === 'business' ? businessId : undefined,
        client_name: clientName || undefined,
        client_email: clientEmail || undefined,
      };
      if (tab === 'pick') {
        if (!selectedId) {
          setError(t('messages.quoteShare.pickRequired'));
          setSharing(false);
          return;
        }
        payload.quoteId = selectedId;
      } else {
        const clean = lines
          .map((li) => ({
            description: String(li.description || '').trim(),
            quantity: parseFloat(li.quantity) || 1,
            unit_price: parseFloat(li.unit_price) || 0,
          }))
          .filter((li) => li.description);
        if (!clean.length) {
          setError(t('messages.quoteShare.linesRequired'));
          setSharing(false);
          return;
        }
        payload.title = title.trim() || t('messages.quoteShare.defaultTitle');
        payload.line_items = clean;
        payload.tax_rate = parseFloat(taxRate) || 0;
        payload.valid_until = validUntil || undefined;
      }

      const { data } = await api.post('/chat/quotes/share', payload);
      onShared?.(data);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.error || t('messages.quoteShare.failed'));
    } finally {
      setSharing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="quote-share-panel" role="dialog" aria-modal="true" aria-label={t('messages.quoteShare.title')}>
      <header className="quote-share-panel__head">
        <h3>
          <FileText className="w-4 h-4" aria-hidden />
          {t('messages.quoteShare.title')}
        </h3>
        <button type="button" className="quote-share-panel__close" onClick={onClose} aria-label={t('common.close')}>
          <X className="w-4 h-4" />
        </button>
      </header>

      <div className="quote-share-panel__tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pick'}
          className={tab === 'pick' ? 'is-active' : ''}
          onClick={() => setTab('pick')}
        >
          {t('messages.quoteShare.pickTab')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'build'}
          className={tab === 'build' ? 'is-active' : ''}
          onClick={() => setTab('build')}
        >
          {t('messages.quoteShare.buildTab')}
        </button>
      </div>

      <div className="quote-share-panel__body">
        {tab === 'pick' ? (
          loadingList ? (
            <p className="quote-share-panel__muted">
              <Loader2 className="w-4 h-4 animate-spin" /> {t('messages.quoteShare.loading')}
            </p>
          ) : quotes.length === 0 ? (
            <p className="quote-share-panel__muted">
              {t('messages.quoteShare.empty')}
              <button type="button" className="quote-share-panel__link" onClick={() => setTab('build')}>
                {t('messages.quoteShare.buildInstead')}
              </button>
            </p>
          ) : (
            <ul className="quote-share-panel__list">
              {quotes.map((q) => (
                <li key={q.id}>
                  <label className={selectedId === q.id ? 'is-selected' : ''}>
                    <input
                      type="radio"
                      name="quote-pick"
                      checked={selectedId === q.id}
                      onChange={() => setSelectedId(q.id)}
                    />
                    <span className="quote-share-panel__pick-main">
                      <strong>{q.title || t('messages.quoteShare.defaultTitle')}</strong>
                      <small>
                        {t(`helperProfile.messenger.quoteStatus.${q.status}`, { defaultValue: q.status })}
                        {' · '}
                        {formatCents(q.total_cents, locale)}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="quote-share-panel__form">
            <label>
              <span>{t('messages.quoteShare.titleLabel')}</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('messages.quoteShare.titlePlaceholder')}
              />
            </label>
            {lines.map((li, idx) => (
              <div key={idx} className="quote-share-panel__line">
                <input
                  value={li.description}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], description: e.target.value };
                    setLines(next);
                  }}
                  placeholder={t('messages.quoteShare.lineDesc')}
                />
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={li.quantity}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], quantity: e.target.value };
                    setLines(next);
                  }}
                  aria-label={t('messages.quoteShare.qty')}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={li.unit_price}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...next[idx], unit_price: e.target.value };
                    setLines(next);
                  }}
                  placeholder={t('messages.quoteShare.price')}
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                    aria-label={t('common.remove')}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="quote-share-panel__add-line"
              onClick={() => setLines([...lines, { ...EMPTY_LINE }])}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('messages.quoteShare.addLine')}
            </button>
            <div className="quote-share-panel__meta">
              <label>
                <span>{t('messages.quoteShare.tax')}</span>
                <input type="number" min="0" max="100" step="0.01" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </label>
              <label>
                <span>{t('messages.quoteShare.validUntil')}</span>
                <input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </label>
            </div>
            <p className="quote-share-panel__total">
              {t('helperProfile.messenger.quoteTotal')}: <strong>{formatCents(totalCents, locale)}</strong>
            </p>
          </div>
        )}
      </div>

      {error && (
        <p className="quote-share-panel__error" role="alert">
          {error}
        </p>
      )}

      <footer className="quote-share-panel__foot">
        <button type="button" className="quote-share-panel__cancel" onClick={onClose} disabled={sharing}>
          {t('common.cancel')}
        </button>
        <button type="button" className="quote-share-panel__send" onClick={share} disabled={sharing}>
          {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {t('messages.quoteShare.send')}
        </button>
      </footer>
    </div>
  );
}
