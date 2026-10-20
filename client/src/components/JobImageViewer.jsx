import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export default function JobImageViewer({ images, index, onIndexChange, onClose }) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef(null);
  const controls = useRef({ index, onIndexChange, onClose });
  controls.current = { index, onIndexChange, onClose };
  useEffect(() => {
    const opener = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current.querySelector('button').focus();
    const onKey = event => {
      const current = controls.current;
      if (event.key === 'Escape') { event.preventDefault(); current.onClose(); }
      else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        const rtl = document.documentElement.dir === 'rtl';
        const forward = (event.key === 'ArrowRight') !== rtl;
        current.onIndexChange(Math.max(0, Math.min(images.length - 1, current.index + (forward ? 1 : -1))));
      } else if (event.key === 'Tab') {
        const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled)')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const onFocus = event => {
      if (!dialogRef.current.contains(event.target)) dialogRef.current.querySelector('button').focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      if (opener?.isConnected) opener.focus();
    };
  }, [images.length]);
  return createPortal(
    <div className="jdp-lightbox" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <h2 id={titleId} className="jdp-sr-only">{t('jobDetail.imageViewer')}</h2>
      <button type="button" className="jdp-lightbox-close" aria-label={t('common.aria.closeButton')} onClick={onClose} data-track="ui.6f20fbbd69.1">✕</button>
      <button type="button" className="jdp-lightbox-prev" aria-label={t('jobDetail.previousImage')}
        disabled={index === 0} onClick={() => onIndexChange(index - 1)} data-track="ui.6f20fbbd69.2">‹</button>
      <img src={images[index]} alt={t('jobDetail.jobMedia', { number: index + 1 })} />
      <button type="button" className="jdp-lightbox-next" aria-label={t('jobDetail.nextImage')}
        disabled={index === images.length - 1} onClick={() => onIndexChange(index + 1)} data-track="ui.6f20fbbd69.3">›</button>
      <p className="jdp-lightbox-counter" aria-live="polite">{t('jobDetail.imagePosition', { current: index + 1, total: images.length })}</p>
    </div>, document.body,
  );
}
