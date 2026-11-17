import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PERSONA_CATALOG, PERSONA_CLASSIFICATIONS, searchPersonas } from './personaCatalog.js';
import { installPersonaResources, personaLanguage, personaLocalKey } from './personaExplorerResources.js';
import './PersonaExplorer.css';

export default function PersonaExplorer() {
  const { i18n } = useTranslation();
  const [ready, setReady] = useState(null);
  const [query, setQuery] = useState('');
  const [family, setFamily] = useState('');
  const [classification, setClassification] = useState('');
  const id = useId();
  const searchRef = useRef(null);
  const language = personaLanguage(i18n.language || i18n.resolvedLanguage);
  useEffect(() => {
    installPersonaResources(i18n);
    setReady(i18n);
  }, [i18n]);
  const t = useMemo(() => i18n.getFixedT(language, 'personaExplorer'), [i18n, language, ready]);
  const results = useMemo(() => searchPersonas({
    query, family: family || null, classification: classification || null,
    translate: key => t(personaLocalKey(key)),
  }), [query, family, classification, t]);
  if (ready !== i18n) return null;
  const reset = () => {
    setQuery(''); setFamily(''); setClassification('');
    searchRef.current?.focus();
  };
  return (
    <section className="persona-explorer" lang={language} dir={language === 'ar' ? 'rtl' : 'ltr'} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('title')}</h2>
      <p id={`${id}-description`}>{t('description')}</p>
      <p className="persona-explorer__notice" id={`${id}-notice`}>{t('notice')}</p>
      <div className="persona-explorer__filters">
        <label htmlFor={`${id}-search`}>{t('search')}
          <input ref={searchRef} id={`${id}-search`} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} aria-describedby={`${id}-description ${id}-notice`} />
        </label>
        <label htmlFor={`${id}-family`}>{t('family')}
          <select id={`${id}-family`} value={family} onChange={event => setFamily(event.target.value)}>
            <option value="">{t('all')}</option>
            {PERSONA_CATALOG.map(entry => <option key={entry.id} value={entry.family}>{t(personaLocalKey(entry.labelKey))}</option>)}
          </select>
        </label>
        <label htmlFor={`${id}-evidence`}>{t('evidence')}
          <select id={`${id}-evidence`} value={classification} onChange={event => setClassification(event.target.value)}>
            <option value="">{t('all')}</option>
            {PERSONA_CLASSIFICATIONS.map(value => <option key={value} value={value}>{t(`classifications.${value}`)}</option>)}
          </select>
        </label>
        <button type="button" onClick={reset}>{t('reset')}</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true">{t('count', { matched: results.length, total: PERSONA_CATALOG.length })}</p>
      {!results.length && <p>{t('empty')}</p>}
      <ul className="persona-explorer__grid">
        {results.map(entry => <li key={entry.id}>
          <h3>{t(personaLocalKey(entry.labelKey))}</h3>
          <p>{t(personaLocalKey(entry.purposeKey))}</p>
          <span className="persona-explorer__evidence">{t('evidence')}: {t(`classifications.${entry.classification}`)}</span>
        </li>)}
      </ul>
      <p className="persona-explorer__notice">{t('investor')}</p>
    </section>
  );
}
