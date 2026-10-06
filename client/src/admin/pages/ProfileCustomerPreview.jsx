import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';

export default function ProfileCustomerPreview({ content, profileType, profileId, copy }) {
  const { i18n } = useTranslation();
  const { language, availableLanguages } = useLanguage();
  const { isDark } = useTheme();
  const [device, setDevice] = useState('desktop');
  const [theme, setTheme] = useState(isDark ? 'dark' : 'light');
  const [tab, setTab] = useState('menu');
  const [category, setCategory] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setSnapshot(null); setFailed(false);
    import('./customerProfileSnapshot').then(({ buildCustomerProfileDocument }) => {
      if (cancelled) return;
      const value = buildCustomerProfileDocument({ type: profileType, id: profileId, content, i18n, language, availableLanguages, theme, tab, category });
      if (!cancelled) setSnapshot(value);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [content, profileType, profileId, i18n, language, availableLanguages, theme, tab, category]);
  const selectStyle = { background: 'var(--color-bg)', color: 'var(--color-text)', padding: '0.5rem', border: '1px solid var(--color-border)', borderRadius: 6 };
  const width = device === 'mobile' ? 390 : 1280;
  return <section data-testid="pv-customer-panel">
    <p role="note" style={{ marginBottom: '1rem' }}>{copy('customerSnapshotNotice')}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem' }}>
      <label>{copy('customerViewport')} <select aria-label={copy('customerViewport')} value={device} onChange={e => setDevice(e.target.value)} style={selectStyle}>
        <option value="desktop">{copy('customerDesktop')}</option><option value="mobile">{copy('customerMobile')}</option>
      </select></label>
      <label>{copy('customerTheme')} <select aria-label={copy('customerTheme')} value={theme} onChange={e => setTheme(e.target.value)} style={selectStyle}>
        <option value="light">{copy('customerLight')}</option><option value="dark">{copy('customerDark')}</option>
      </select></label>
      {profileType === 'restaurant' && <label>{copy('customerSection')} <select aria-label={copy('customerSection')} value={tab} onChange={e => setTab(e.target.value)} style={selectStyle}>
        <option value="menu">{copy('previewMenu')}</option><option value="info">{copy('previewDetails')}</option>
      </select></label>}
      {profileType === 'restaurant' && tab === 'menu' && <label>{copy('customerCategory')} <select aria-label={copy('customerCategory')} value={category} onChange={e => setCategory(e.target.value)} style={selectStyle}>
        <option value="">{copy('customerFirstCategory')}</option>
        {(content.menu || []).filter(section => section.items?.length).map(section => <option key={section.id} value={section.id}>{section.name}</option>)}
        {content.uncategorizedItems?.length > 0 && <option value="other">{copy('previewMenuOther')}</option>}
      </select></label>}
    </div>
    {failed ? <p role="alert">{copy('previewUnavailable')}</p> : !snapshot ? <p role="status">{copy('previewLoading')}</p> :
      <div style={{ overflow: 'auto', border: '1px solid var(--color-border)', maxWidth: '100%' }}>
        <iframe title={copy('customerView')} data-testid="pv-customer-frame" sandbox="" referrerPolicy="no-referrer"
          srcDoc={snapshot} style={{ display: 'block', border: 0, width, height: device === 'mobile' ? 844 : 720 }} />
      </div>}
  </section>;
}
