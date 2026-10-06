import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eraser, RotateCcw } from 'lucide-react';

/**
 * Drawn signature capture. Mouse + touch. No click-to-accept: the user must
 * physically draw. Emits a base64 PNG via onChange when the pad is non-empty.
 */
export default function SignaturePad({ onChange, disabled = false, height = 180 }) {
  const { t } = useTranslation();
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, [height]);

  useEffect(() => {
    setupCanvas();
    window.addEventListener('resize', setupCanvas);
    return () => window.removeEventListener('resize', setupCanvas);
  }, [setupCanvas]);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    drawingRef.current = true;
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e) => {
    if (!drawingRef.current || disabled) return;
    e.preventDefault();
    const { x, y } = pos(e);
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      setIsEmpty(false);
    }
  };

  const stop = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    if (hasDrawnRef.current && onChange) {
      onChange(canvasRef.current.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setIsEmpty(true);
    if (onChange) onChange(null);
  };

  return (
    <div className="sigpad">
      <div className="sigpad__canvas-wrap">
        <canvas
          ref={canvasRef}
          style={{ height }}
          className="sigpad__canvas"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={stop}
          onMouseLeave={stop}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={stop}
          aria-label={t('workAgreement.signHere', { defaultValue: 'Draw your signature here' })}
        />
        {isEmpty && (
          <span className="sigpad__hint" aria-hidden="true">
            {t('workAgreement.signHint', { defaultValue: 'Draw your signature with mouse or finger' })}
          </span>
        )}
      </div>
      <div className="sigpad__actions">
        <button type="button" onClick={clear} disabled={disabled || isEmpty} className="sigpad__btn">
          <Eraser size={16} aria-hidden="true" />
          {t('workAgreement.clearSignature', { defaultValue: 'Clear' })}
        </button>
        <span className="sigpad__note">
          <RotateCcw size={14} aria-hidden="true" />
          {t('workAgreement.drawnOnly', { defaultValue: 'Drawn signatures only. Typing your name does not count.' })}
        </span>
      </div>
    </div>
  );
}
