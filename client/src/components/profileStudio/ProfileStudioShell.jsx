import { useTranslation } from 'react-i18next';
import '../../styles/ProfileStudio.css';

/**
 * Shared Profile Studio chrome for Business + Helper Edit Profile.
 * RTL: LanguageContext sets <html dir>; do not set dir on this shell.
 *
 * props:
 * - title, subtitle
 * - sections: { id, label, complete? }[]
 * - activeSection, onSectionChange
 * - dirty, saving, onSave, onDiscard?, saveLabel?
 * - hideSave?: boolean — list/CRUD sections that save inline
 * - preview: ReactNode (usually ProfilePreviewCard)
 * - headerExtra?: ReactNode
 * - readinessPill?: { label, ready?: boolean }
 * - panelTitle?, panelHint?
 * - saveExtra?: ReactNode (e.g. Publish)
 * - children: active section content
 */
export default function ProfileStudioShell({
  title,
  subtitle,
  sections = [],
  activeSection,
  onSectionChange,
  dirty = false,
  saving = false,
  onSave,
  onDiscard,
  saveLabel,
  hideSave = false,
  preview = null,
  headerExtra = null,
  readinessPill = null,
  panelTitle = null,
  panelHint = null,
  saveExtra = null,
  children,
}) {
  const { t } = useTranslation();
  const active = sections.find((s) => s.id === activeSection) || sections[0];
  const resolvedSaveLabel = saveLabel
    || (saving ? t('common.saving') : t('common.save'));

  return (
    <div className="ps">
      <div className="ps-header">
        <div>
          <p className="ps-kicker">{t('profileStudio.kicker')}</p>
          <h2>{title}</h2>
          {subtitle ? <p className="ps-sub">{subtitle}</p> : null}
        </div>
        <div className="ps-header-extra">
          {readinessPill ? (
            <span className={`ps-pill${readinessPill.ready ? ' ready' : ''}`}>
              {readinessPill.label}
            </span>
          ) : null}
          {headerExtra}
        </div>
      </div>

      <div className="ps-mobile-nav">
        <div className="ps-chips" role="tablist" aria-label={t('profileStudio.sections')}>
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === activeSection}
              className={`ps-chip${s.id === activeSection ? ' active' : ''}`}
              onClick={() => onSectionChange?.(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <label className="ps-sr-only" htmlFor="ps-section-select">
          {t('profileStudio.sections')}
        </label>
        <select
          id="ps-section-select"
          className="ps-select"
          value={activeSection}
          onChange={(e) => onSectionChange?.(e.target.value)}
          aria-label={t('profileStudio.sections')}
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      <div className="ps-body">
        <nav className="ps-nav" aria-label={t('profileStudio.sections')}>
          <ul className="ps-nav-list">
            {sections.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`ps-nav-btn${s.id === activeSection ? ' active' : ''}`}
                  onClick={() => onSectionChange?.(s.id)}
                  aria-current={s.id === activeSection ? 'page' : undefined}
                >
                  <span>{s.label}</span>
                  {typeof s.complete === 'boolean' ? (
                    <span
                      className={`ps-nav-check${s.complete ? ' on' : ''}`}
                      aria-label={s.complete ? t('profileStudio.complete') : t('profileStudio.incomplete')}
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ps-main">
          <div className="ps-panel">
            {(panelTitle || active?.label) ? (
              <h3 className="ps-panel-title">{panelTitle || active?.label}</h3>
            ) : null}
            {panelHint ? <p className="ps-panel-hint">{panelHint}</p> : null}
            {children}
          </div>
        </div>

        <aside className="ps-preview-col">
          <div className="ps-preview-sticky">
            {preview}
          </div>
        </aside>
      </div>

      {!hideSave ? (
        <div className="ps-savebar">
          <div className="ps-save-copy">
            <p className={`ps-dirty${dirty ? '' : ' clean'}`} aria-live="polite">
              {dirty
                ? t('profileStudio.unsaved')
                : t('profileStudio.savedHint')}
            </p>
            <p className="ps-save-hint">{t('profileStudio.saveShortcut')}</p>
          </div>
          <div className="ps-save-actions">
            {saveExtra}
            {dirty && onDiscard ? (
              <button
                type="button"
                className="ps-btn ghost"
                onClick={onDiscard}
                disabled={saving}
              >
                {t('profileStudio.discard')}
              </button>
            ) : null}
            <button
              type="button"
              className="ps-btn primary"
              onClick={onSave}
              disabled={saving || !dirty}
            >
              {resolvedSaveLabel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
