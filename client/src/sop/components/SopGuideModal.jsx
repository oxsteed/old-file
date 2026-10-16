/**
 * SopGuideModal.jsx - accessible overlay listing contextual step-by-step
 * guides for the current page.
 *
 * - Focus trap while open, Escape closes, aria-modal, and focus returns to
 *   the element that opened the modal.
 * - "Open full guide" opens the guide URL in a NEW TAB (target _blank,
 *   rel noopener) so the underlying page and any in-progress form state are
 *   never disturbed.
 */

import { useEffect, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { getArea, guideUrl } from '../guideRegistry.js';
import '../sop.css';
import { createPortal } from 'react-dom';
import SopGuideContent from './SopGuideContent.jsx';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export default function SopGuideModal({ guides = [], onClose, id }) {
  const { t } = useTranslation();
  const titleId = useId();
  const overlayRef = useRef(null);
  const [selectedId, setSelectedId] = useState(guides[0]?.id || null);

  const selected = guides.find((guide) => guide.id === selectedId) || guides[0] || null;

  useEffect(() => {
    setSelectedId(guides[0]?.id || null);
  }, [guides]);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const overlay = overlayRef.current;
    overlay?.querySelector('[data-autofocus]')?.focus();

    const onKeyDown = (event) => {
      if (overlay?.querySelector('.sop-lightbox[open]')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !overlay) return;
      const focusable = [...overlay.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (element) => element.offsetParent !== null,
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const inerted = [...document.body.children].filter(el => !el.contains(overlay) && !el.inert);
    inerted.forEach(el => { el.inert = true; });
    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      inerted.forEach(el => { el.inert = false; });
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={overlayRef}
      className="sop-modal-overlay"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) onClose();
      }}
    >
      <div
        id={id}
        className="sop-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sop-modal-head">
          <h2 id={titleId}>{t('sop.modal.title')}</h2>
          <button
            type="button"
            className="sop-btn sop-btn-ghost"
            onClick={onClose}
            data-autofocus
          >
            {t('sop.modal.close')}
          </button>
        </div>

        {guides.length === 0 ? (
          <p className="sop-modal-empty">{t('sop.modal.noneLinked')}</p>
        ) : (
          <>
            {guides.length > 1 && (
              <p className="sop-modal-empty">{t('sop.modal.chooseGuide')}</p>
            )}
            <ul className="sop-modal-list">
              {guides.map((guide) => {
                const area = getArea(guide.area);
                const isSelected = selected && guide.id === selected.id;
                return (
                  <li key={guide.id}>
                    <button
                      type="button"
                      className={`sop-modal-option${isSelected ? ' is-selected' : ''}`}
                      aria-pressed={guides.length > 1 ? isSelected : undefined}
                      onClick={() => setSelectedId(guide.id)}
                    >
                      <span className="sop-modal-option-title">{guide.title}</span>
                      <span className="sop-modal-option-goal">
                        {area ? `${area.title} - ` : ''}{guide.goal}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected && <SopGuideContent key={selected.id} guide={selected} embedded />}
            <div className="sop-modal-actions">
              <button type="button" className="sop-btn sop-btn-ghost" onClick={onClose}>
                {t('sop.modal.close')}
              </button>
              {selected && (
                <a
                  className="sop-btn sop-btn-primary"
                  href={guideUrl(selected)}
                  target="_blank"
                  rel="noopener"
                >
                  {t('sop.modal.openFullGuide')}
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>, document.body
  );
}
