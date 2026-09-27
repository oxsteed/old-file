import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, Sparkles } from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import useAuth from '../hooks/useAuth';
import {
  getExperienceArea,
  getExperienceGuide,
  getRememberedExperienceRole,
  rememberExperienceRole,
  experienceAreaTranslationKey,
} from '../utils/experienceGuideModel';
import './ExperienceGuidePage.css';

export default function ExperienceGuidePage() {
  const { area: areaKey = 'food' } = useParams();
  const { t } = useTranslation();
  const { user } = useAuth();
  const area = getExperienceArea(areaKey);
  const translationKey = experienceAreaTranslationKey(areaKey);
  const [requestedRole, setRequestedRole] = useState(null);
  const guide = useMemo(() => getExperienceGuide(areaKey, user, requestedRole), [areaKey, requestedRole, user]);

  useEffect(() => {
    if (!area) return;
    const remembered = getRememberedExperienceRole(areaKey);
    if (remembered) setRequestedRole(remembered);
  }, [area, areaKey]);

  if (!area || !guide) {
    return <PageShell><div className="experience-guide experience-guide--not-found"><h1>{t('experienceGuides.notFound', { defaultValue: 'Guide not found' })}</h1><Link to="/how-it-works">{t('experienceGuides.backToHub', { defaultValue: 'Back to How OxSteed Works' })}</Link></div></PageShell>;
  }

  const areaTitle = t(`experienceGuides.areas.${translationKey}.title`, { defaultValue: areaKey });
  const areaDescription = t(`experienceGuides.areas.${translationKey}.description`, { defaultValue: '' });
  const chooseRole = (role) => {
    setRequestedRole(role);
    rememberExperienceRole(areaKey, role);
  };

  return (
    <PageShell>
      <PageMeta
        title={t(`experienceGuides.areas.${translationKey}.metaTitle`, { defaultValue: `${areaTitle} | OxSteed` })}
        description={t(`experienceGuides.areas.${translationKey}.metaDescription`, { defaultValue: areaDescription })}
      />
      <div className="experience-guide">
        <header className="experience-guide__hero">
          <Link to="/how-it-works" className="experience-guide__back"><ArrowLeft size={16} aria-hidden="true" /> {t('experienceGuides.backToHub', { defaultValue: 'How OxSteed Works' })}</Link>
          <div className="experience-guide__hero-grid">
            <div>
              <p className="experience-eyebrow"><Sparkles size={15} aria-hidden="true" /> {t(`experienceGuides.areas.${translationKey}.eyebrow`, { defaultValue: t('experienceGuides.eyebrow', { defaultValue: 'OxSteed experience' }) })}</p>
              <h1>{areaTitle}</h1>
              <p className="experience-guide__subtitle">{areaDescription}</p>
              <div className="experience-guide__status"><span className={`experience-status-dot${area.enabled ? '' : ' is-muted'}`} aria-hidden="true" />{area.enabled ? t('experienceGuides.availableNow', { defaultValue: 'Available now' }) : t('experienceGuides.notAvailableNow', { defaultValue: 'Not available in the current launch' })}</div>
            </div>
            <div className="experience-guide__preview" aria-label={t('experienceGuides.previewAria', { defaultValue: 'OxSteed product preview' })}>
              <div className="experience-preview__bar"><span /><span /><span /><strong>OxSteed</strong></div>
              <div className="experience-preview__body"><span>{t('experienceGuides.connectedWorkspace', { defaultValue: 'Connected workspace' })}</span><strong>{areaTitle}</strong><i /><i /><i /></div>
            </div>
          </div>
        </header>

        {guide.supportedRoles.length > 1 && (
          <section className="experience-guide__roles" aria-labelledby="experience-role-title">
            <div className="experience-section-heading"><div><p className="experience-eyebrow">{t('experienceGuides.roleKicker', { defaultValue: 'Make it yours' })}</p><h2 id="experience-role-title">{t('experienceGuides.chooseRole', { defaultValue: 'Choose the view that fits you' })}</h2></div><p>{t('experienceGuides.roleHint', { defaultValue: 'See the actions available for each role.' })}</p></div>
            <div className="experience-role-tabs" role="tablist" aria-label={t('experienceGuides.roleChooserAria', { defaultValue: 'Choose a role' })}>
              {guide.supportedRoles.map((role) => (
                <button key={role} type="button" role="tab" aria-selected={guide.role === role} className={`experience-role-tab${guide.role === role ? ' is-selected' : ''}`} onClick={() => chooseRole(role)}>
                  <strong>{t(`experienceGuides.roles.${role}.label`, { defaultValue: role })}</strong><span>{t(`experienceGuides.roles.${role}.short`, { defaultValue: '' })}</span><ChevronRight size={16} aria-hidden="true" />
                </button>
              ))}
            </div>
          </section>
        )}

        {!area.enabled ? (
          <section className="experience-unavailable" role="status">
            <AlertCircle size={26} aria-hidden="true" />
            <div><h2>{t('experienceGuides.unavailableTitle', { defaultValue: 'This area is not available yet' })}</h2><p>{t(`experienceGuides.areas.${translationKey}.unavailable`, { defaultValue: t('experienceGuides.unavailableDescription', { defaultValue: 'We will show this experience when it is enabled for the current launch.' }) })}</p></div>
          </section>
        ) : (
          <>
            <section className="experience-guide__story" aria-labelledby="experience-story-title">
              <div className="experience-section-heading experience-section-heading--story"><div><p className="experience-eyebrow">{t('experienceGuides.storyKicker', { defaultValue: 'Your OxSteed journey' })}</p><h2 id="experience-story-title">{t(`experienceGuides.areas.${translationKey}.roles.${guide.role}.title`, { defaultValue: areaTitle })}</h2></div><p>{t(`experienceGuides.areas.${translationKey}.roles.${guide.role}.description`, { defaultValue: areaDescription })}</p></div>
              <div className="experience-steps">
                {guide.steps.map((stepKey, index) => (
                  <article className="experience-step" key={`${areaKey}-${guide.role}-${stepKey}`}>
                    <div className="experience-step__number">{String(index + 1).padStart(2, '0')}</div>
                    <div className="experience-step__copy"><p className="experience-eyebrow">{t(`experienceGuides.steps.${stepKey}.eyebrow`, { defaultValue: `${String(index + 1).padStart(2, '0')} / ${t('experienceGuides.step', { defaultValue: 'Step' })}` })}</p><h3>{t(`experienceGuides.steps.${stepKey}.title`, { defaultValue: stepKey })}</h3><p>{t(`experienceGuides.steps.${stepKey}.description`, { defaultValue: '' })}</p></div>
                    <div className="experience-step__card"><div><span><CheckCircle2 size={14} aria-hidden="true" /> {t('experienceGuides.statusReady', { defaultValue: 'Ready' })}</span></div><strong>{areaTitle}</strong><small>{areaDescription}</small></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="experience-guide__available" aria-labelledby="experience-available-title">
              <div className="experience-section-heading"><div><p className="experience-eyebrow">{t('experienceGuides.availableKicker', { defaultValue: 'Available now' })}</p><h2 id="experience-available-title">{t('experienceGuides.availableTitle', { defaultValue: 'Useful actions, ready when you are' })}</h2></div><p>{t('experienceGuides.availableDescription', { defaultValue: 'Use the current permitted product surfaces to move forward.' })}</p></div>
              <div className="experience-action-grid">
                {guide.cards.map((card) => <Link key={card.key} to={card.to} className="experience-action-card"><span><strong>{t(`experienceGuides.actions.${card.key}.title`, { defaultValue: card.key })}</strong><small>{t(`experienceGuides.actions.${card.key}.description`, { defaultValue: areaDescription })}</small></span><ArrowRight size={17} aria-hidden="true" /></Link>)}
              </div>
            </section>
            <section className="experience-guide__cta"><div><p className="experience-eyebrow">{t('experienceGuides.nextKicker', { defaultValue: 'Ready when you are' })}</p><h2>{t('experienceGuides.nextTitle', { defaultValue: 'Start with one clear next step.' })}</h2></div><Link to={guide.primary.to} className="experience-button experience-button--primary">{t(`experienceGuides.actions.${guide.primary.key}.title`, { defaultValue: areaTitle })}<ArrowRight size={17} aria-hidden="true" /></Link></section>
          </>
        )}

        <nav className="experience-related" aria-label={t('experienceGuides.relatedAria', { defaultValue: 'Related OxSteed experiences' })}>
          <span>{t('experienceGuides.related', { defaultValue: 'Related experiences' })}</span>
          <Link to="/how-it-works">{t('experienceGuides.allExperiences', { defaultValue: 'All experiences' })}</Link>
          {areaKey === 'food' && <><Link to="/how-it-works/credit">{t('experienceGuides.areas.credit.title', { defaultValue: 'OxSteed Credit' })}</Link><Link to="/how-it-works/restaurant-credit">{t('experienceGuides.areas.restaurantCredit.title', { defaultValue: 'Restaurant Credit' })}</Link></>}
          {areaKey === 'credit' && <Link to="/how-it-works/food">{t('experienceGuides.areas.food.title', { defaultValue: 'Local Food Directory' })}</Link>}
        </nav>
      </div>
    </PageShell>
  );
}
