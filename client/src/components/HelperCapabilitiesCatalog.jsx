import { useMemo, useState } from 'react';
import { CheckCircle2, Search, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '../lib/format';
import '../styles/HelperCapabilitiesCatalog.css';

const normalized = (value) => String(value || '').trim().toLocaleLowerCase();

export default function HelperCapabilitiesCatalog({
  skills, tools, skillsLoading, toolsLoading, showTools,
  onAddSkill, onEditSkill, onDeleteSkill,
  onAddTool, onEditTool, onDeleteTool, onViewTool, onViewProfile,
}) {
  const { t } = useTranslation();
  const [category, setCategory] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [serviceSearch, setServiceSearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');

  const categories = useMemo(() => {
    const names = [...skills, ...(showTools ? tools : [])]
      .map((item) => String(item.category || '').trim() || t('common.other'));
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [skills, tools, showTools, t]);
  const selectedCategory = categories.includes(category) ? category : categories[0] || '';
  const shownCategories = categories.filter((name) => normalized(name).includes(normalized(categorySearch)));
  const shownSkills = skills.filter((skill) =>
    (String(skill.category || '').trim() || t('common.other')) === selectedCategory
      && `${skill.skill_name} ${skill.description || ''}`.toLocaleLowerCase().includes(normalized(serviceSearch)));
  const shownTools = tools.filter((tool) =>
    (String(tool.category || '').trim() || t('common.other')) === selectedCategory
      && `${tool.name} ${tool.description || ''} ${tool.brand || ''}`.toLocaleLowerCase().includes(normalized(toolSearch)));

  return (
    <section className="helper-capabilities" aria-label={t('dashboard.skillsTools.skillsTitle')}>
      <div className="helper-capabilities__top">
        <p>{t('dashboard.skillsTools.skillsSub')}</p>
        <button type="button" onClick={onViewProfile}>{t('helperDashboard.viewPublicProfile')}</button>
      </div>

      <div className={`helper-capabilities__grid${showTools ? '' : ' helper-capabilities__grid--two'}`}>
        <section className="helper-capabilities__panel" aria-labelledby="helper-capability-categories">
          <h2 id="helper-capability-categories">{t('directCatalog.skillCategories')}</h2>
          <label className="helper-capabilities__search">
            <Search size={17} aria-hidden="true" />
            <input type="search" value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)}
              aria-label={t('directCatalog.searchCategoriesAria')} placeholder={t('directCatalog.searchCategories')} />
          </label>
          <div className="helper-capabilities__scroll" role="group" aria-label={t('directCatalog.skillCategories')}>
            {shownCategories.map((name) => (
              <button key={name} type="button" className={`helper-capabilities__category${name === selectedCategory ? ' is-active' : ''}`}
                aria-pressed={name === selectedCategory} onClick={() => { setCategory(name); setServiceSearch(''); setToolSearch(''); }}>
                <Wrench size={17} aria-hidden="true" /><span>{name}</span>
                <small>{skills.filter((skill) => (String(skill.category || '').trim() || t('common.other')) === name).length}</small>
              </button>
            ))}
            {!shownCategories.length && <p className="helper-capabilities__empty">{t('directCatalog.noCategories')}</p>}
          </div>
        </section>

        <section className="helper-capabilities__panel" aria-labelledby="helper-capability-services">
          <div className="helper-capabilities__panel-head">
            <div><p className="helper-capabilities__eyebrow">{selectedCategory || t('dashboard.skillsTools.skillsTitle')}</p>
              <h2 id="helper-capability-services">{t('directCatalog.availableServices')}</h2></div>
            <button type="button" className="helper-capabilities__add" onClick={onAddSkill}>{t('dashboard.skillsTools.addSkill')}</button>
          </div>
          <label className="helper-capabilities__search">
            <Search size={17} aria-hidden="true" />
            <input type="search" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)}
              aria-label={t('directCatalog.searchServicesAria')} placeholder={t('directCatalog.searchServices', { category: selectedCategory || t('dashboard.skillsTools.skillsTitle') })} />
          </label>
          <div className="helper-capabilities__scroll">
            {skillsLoading ? <p className="helper-capabilities__empty">{t('directCatalog.loadingServices')}</p>
              : shownSkills.map((skill) => <article key={skill.id} className="helper-capabilities__item">
                  <div className="helper-capabilities__item-head"><h3>{skill.skill_name}</h3>
                    <span className={`helper-capabilities__status${skill.is_available ? ' is-available' : ''}`}>
                      <CheckCircle2 size={13} aria-hidden="true" />{t(skill.is_available ? 'dashboard.skillsTools.available' : 'dashboard.skillsTools.unavailable')}
                    </span></div>
                  {skill.description && <p>{skill.description}</p>}
                  <div className="helper-capabilities__item-foot">
                    <span>{skill.hourly_rate ? `${formatMoney(skill.hourly_rate)}${t('helpersDir.perHour')}` : t('dashboard.skillsTools.contactForPricing')}</span>
                    <div><button type="button" onClick={() => onEditSkill(skill)}>{t('common.edit')}</button>
                      <button type="button" onClick={() => onDeleteSkill(skill.id)}>{t('helperDashboard.delete')}</button></div>
                  </div>
                </article>)}
            {!skillsLoading && !shownSkills.length && <p className="helper-capabilities__empty">{t('dashboard.skillsTools.noSkills')}</p>}
          </div>
        </section>

        {showTools && <section className="helper-capabilities__panel" aria-labelledby="helper-capability-tools">
          <div className="helper-capabilities__panel-head"><div><p className="helper-capabilities__eyebrow">{t('directCatalog.equipment')}</p>
            <h2 id="helper-capability-tools">{t('directCatalog.toolsEquipment')}</h2></div>
            <button type="button" className="helper-capabilities__add" onClick={onAddTool}>{t('dashboard.skillsTools.listToolBtn')}</button></div>
          <label className="helper-capabilities__search"><Search size={17} aria-hidden="true" />
            <input type="search" value={toolSearch} onChange={(event) => setToolSearch(event.target.value)}
              aria-label={t('directCatalog.searchToolsAria')} placeholder={t('directCatalog.searchTools')} /></label>
          <div className="helper-capabilities__scroll">
            {toolsLoading ? <p className="helper-capabilities__empty">{t('directCatalog.loadingServices')}</p>
              : shownTools.map((tool) => <article key={tool.id} className="helper-capabilities__item helper-capabilities__tool">
                  {tool.image_url ? <img src={tool.image_url} alt="" /> : <Wrench size={20} aria-hidden="true" />}
                  <div><div className="helper-capabilities__item-head"><h3>{tool.name}</h3>
                    <span className={`helper-capabilities__status${tool.is_available ? ' is-available' : ''}`}>
                      <CheckCircle2 size={13} aria-hidden="true" />{t(tool.is_available ? 'dashboard.skillsTools.available' : 'dashboard.skillsTools.unavailable')}
                    </span></div>
                    {tool.description && <p>{tool.description}</p>}
                    <div className="helper-capabilities__item-foot"><span>{tool.daily_rate ? `${formatMoney(tool.daily_rate)} ${t('toolRentals.perDay')}` : t('dashboard.skillsTools.contactForPricing')}</span>
                      <div>{tool.is_available && <button type="button" onClick={() => onViewTool(tool)}>{t('common.view')}</button>}
                        <button type="button" onClick={() => onEditTool(tool)}>{t('common.edit')}</button>
                        <button type="button" onClick={() => onDeleteTool(tool.id)}>{t('helperDashboard.delete')}</button></div></div>
                  </div>
                </article>)}
            {!toolsLoading && !shownTools.length && <p className="helper-capabilities__empty">{t('dashboard.skillsTools.noTools')}</p>}
          </div>
        </section>}
      </div>
    </section>
  );
}
