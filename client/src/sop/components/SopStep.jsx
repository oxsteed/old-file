/**
 * SopStep.jsx - one numbered guide step: title, body, expected result, and
 * screenshots merged with the capture worker's sidecar.
 *
 * Each step screenshot entry in the guide describes WHAT to capture
 * ({ viewport, screen, state, alt, caption, annotations: [{ n, label, locator }] }).
 * The actual image, dimensions, and x/y annotation coordinates come from
 * client/src/sop/screenshots.json, looked up by "<guideId>/<stepId>/<viewport>".
 * When the sidecar has no record yet, a labeled placeholder box renders
 * instead so the guide never crashes on missing captures.
 */

import { useEffect, useRef, useState, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { loadScreenshotSidecar, screenshotRecord } from '../screenshotSidecar.js';
import '../sop.css';

function ZoomDialog({ dialogRef, alt, src, annotations }) {
  const { t } = useTranslation();
  const closeZoom = () => dialogRef.current?.close();
  return (
    <dialog
      ref={dialogRef}
      className="sop-lightbox"
      aria-label={alt}
      onClick={(event) => {
        if (event.target === dialogRef.current) closeZoom();
      }}
    >
      <div className="sop-lightbox-head">
        <strong>{alt}</strong>
        <button type="button" className="sop-btn sop-btn-ghost" onClick={closeZoom}>
          {t('sop.guide.closeZoom')}
        </button>
      </div>
      <img src={src} alt={alt} />
      {(annotations || []).length > 0 && (
        <ol className="sop-list" style={{ marginBlockStart: '0.75rem' }}>
          {annotations.map((annotation) => (
            <li key={annotation.n}>
              <strong>{annotation.n}.</strong> {annotation.label}
            </li>
          ))}
        </ol>
      )}
    </dialog>
  );
}

function CapturedScreenshot({ entry, record, stepNumber }) {
  const { t } = useTranslation();
  const dialogRef = useRef(null);
  const [failed, setFailed] = useState(false);

  if (failed) return <figure className="sop-shot"><p role="status">{t("sop.imageUnavailable")}</p><button type="button" className="sop-btn" onClick={() => setFailed(false)}>{t("common.retry", { defaultValue: "Try again" })}</button></figure>;

  const alt = record.alt || entry.alt;
  const caption = record.caption || entry.caption;
  const annotations = Array.isArray(record.annotations) ? record.annotations : [];

  return (
    <figure className={`sop-shot${entry.viewport === 'mobile' ? ' sop-shot-mobile' : ''}`}>
      <div className="sop-shot-media">
        <img
          src={record.src}
          alt={alt}
          width={record.width || undefined}
          height={record.height || undefined}
          loading="lazy"
          onError={() => setFailed(true)}
        />
        {annotations.map((annotation) => (
          <span
            key={annotation.n}
            className="sop-annotation"
            style={{ left: `${annotation.x}%`, top: `${annotation.y}%` }}
            title={annotation.label}
            aria-label={`${annotation.n}: ${annotation.label}`}
          >
            {annotation.n}
          </span>
        ))}
        <button
          type="button"
          className="sop-shot-zoom-btn"
          onClick={() => dialogRef.current?.showModal()}
        >
          {t('sop.guide.viewLarger')}
        </button>
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
      <ZoomDialog dialogRef={dialogRef} alt={alt} src={record.src} annotations={annotations} />
    </figure>
  );
}

function PendingScreenshot({ entry }) {
  const { t } = useTranslation();
  return (
    <figure className={`sop-shot${entry.viewport === 'mobile' ? ' sop-shot-mobile' : ''}`}>
      <div className="sop-shot-placeholder" role="img" aria-label={entry.alt}>
        <span className="sop-shot-placeholder-viewport">{entry.viewport}</span>
        <strong className="sop-shot-placeholder-screen">{entry.screen}</strong>
        <p className="sop-shot-placeholder-state">{entry.state}</p>
        <p className="sop-shot-placeholder-note">{t('sop.guide.screenshotPending')}</p>
      </div>
      {entry.caption ? <figcaption>{entry.caption}</figcaption> : null}
    </figure>
  );
}

function StepScreenshot({ guideId, stepId, entry, stepNumber, sidecar }) {
  const record = screenshotRecord(sidecar, guideId, stepId, entry.viewport);
  if (record && record.src) {
    return <CapturedScreenshot entry={entry} record={record} stepNumber={stepNumber} />;
  }
  return <PendingScreenshot entry={entry} />;
}

export default function SopStep({ guide, step, index }) {
  const { t } = useTranslation();
  const stepNumber = index + 1;
  const stepHeadingId = useId();
  const [sidecar, setSidecar] = useState(null);

  useEffect(() => {
    let alive = true;
    loadScreenshotSidecar().then((data) => {
      if (alive) setSidecar(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <article className="sop-step" aria-labelledby={stepHeadingId}>
      <div className="sop-step-head">
        <span className="sop-step-number" aria-hidden="true">{stepNumber}</span>
        <h3 id={stepHeadingId}>
          <span className="sop-sr-only">{t('sop.guide.stepNumber', { n: stepNumber })}: </span>
          {step.title}
        </h3>
      </div>
      <p className="sop-step-body">{step.body}</p>
      <div className="sop-expected">
        <strong>{t('sop.guide.expectedResult')}</strong>
        {step.expectedResult}
      </div>
      <div className="sop-screenshots">
        {(step.screenshots || []).map((screenshot, shotIndex) => (
          <StepScreenshot
            key={`${screenshot.viewport}-${shotIndex}`}
            guideId={guide.id}
            stepId={step.id}
            entry={screenshot}
            stepNumber={stepNumber}
            sidecar={sidecar}
          />
        ))}
      </div>
    </article>
  );
}
