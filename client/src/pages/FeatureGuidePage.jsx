import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  LifeBuoy,
  MessageSquare,
  Sparkles,
  UserRoundCheck,
} from 'lucide-react';
import PageMeta from '../components/PageMeta';
import PageShell from '../components/PageShell';
import useAuth from '../hooks/useAuth';
import {
  getHowItWorksStory,
  rememberStoryRole,
  readRememberedStoryRole,
  selectHowItWorksStory,
  STORY_ROLE_KEYS,
} from '../utils/howItWorksRoleModel';
import { getExperienceArea, getExperienceAreaKeys, experienceAreaTranslationKey } from '../utils/experienceGuideModel';
import './FeatureGuidePage.css';

const ICONS = {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  LifeBuoy,
  MessageSquare,
  Sparkles,
  UserRoundCheck,
};

function Icon({ name, size = 20, strokeWidth = 2 }) {
  const Component = ICONS[name] || Sparkles;
  return <Component aria-hidden="true" size={size} strokeWidth={strokeWidth} />;
}

function useMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return reducedMotion;
}

function StoryStep({ step, index, story, t, active, reducedMotion, stepRef }) {
  const base = `howOxsteedWorks.experience.steps.${story.role}.${step.key}`;
  return (
    <article
      ref={stepRef}
      className={`how-works-step${active || reducedMotion ? ' is-visible' : ''}`}
      data-step-index={index}
    >
      <div className="how-works-step__marker" aria-hidden="true">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="how-works-step__copy">
        <p className="how-works-eyebrow">{t(`${base}.eyebrow`)}</p>
        <h3>{t(`${base}.title`)}</h3>
        <p>{t(`${base}.description`)}</p>
      </div>
      <div className="how-works-product-card" aria-label={t(`${base}.cardAria`)}>
        <div className="how-works-product-card__topline">
          <span className="how-works-product-card__icon"><Icon name={step.icon} size={18} /></span>
          <span>{t(`${base}.cardTitle`)}</span>
          <span className="how-works-status"><CheckCircle2 size={14} aria-hidden="true" /> {t(`${base}.status`)}</span>
        </div>
        <div className="how-works-product-card__body">
          <strong>{t(`${base}.cardHeadline`)}</strong>
          <span>{t(`${base}.cardDetail`)}</span>
        </div>
        <div className="how-works-product-card__progress" aria-hidden="true">
          <span style={{ width: `${Math.min(92, 34 + index * 27)}%` }} />
        </div>
      </div>
    </article>
  );
}

export default function FeatureGuidePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const reducedMotion = useMotionPreference();
  const [visitorPreference, setVisitorPreference] = useState(null);
  const [selectedRole, setSelectedRole] = useState('customer');
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef([]);

  useEffect(() => {
    const remembered = readRememberedStoryRole();
    setVisitorPreference(remembered);
    setSelectedRole(selectHowItWorksStory(user, remembered).role);
  }, [user]);

  const story = useMemo(() => getHowItWorksStory(user, selectedRole), [user, selectedRole]);

  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined' || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => Number(a.target.dataset.stepIndex) - Number(b.target.dataset.stepIndex));
      if (visible[0]) setActiveStep(Number(visible[0].target.dataset.stepIndex));
    }, { rootMargin: '-22% 0px -58% 0px', threshold: 0.05 });

    stepRefs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, [reducedMotion, story.role]);

  const changeRole = (role) => {
    setSelectedRole(role);
    setActiveStep(0);
    setVisitorPreference(role);
    rememberStoryRole(role);
  };

  const roleLabel = t(`howOxsteedWorks.experience.roles.${story.role}.label`);
  const primary = story.primary;
  const secondary = story.secondary;

  return (
    <PageShell>
      <PageMeta
        title={t('howOxsteedWorks.experience.metaTitle')}
        description={t('howOxsteedWorks.experience.metaDescription')}
      />
      <div className="feature-guide-page how-works-page">
        <section className="how-works-hero" aria-labelledby="how-works-title">
          <div className="how-works-hero__glow" aria-hidden="true" />
          <div className="how-works-hero__content">
            <p className="how-works-eyebrow"><Sparkles size={16} aria-hidden="true" /> {t('howOxsteedWorks.experience.kicker')}</p>
            <h1 id="how-works-title">{t('howOxsteedWorks.experience.title')}</h1>
            <p className="how-works-hero__subtitle">{t(`howOxsteedWorks.experience.roles.${story.role}.description`)}</p>
            <div className="how-works-hero__availability">
              <span className="how-works-live-dot" aria-hidden="true" />
              <span>{t('howOxsteedWorks.experience.availableNow')}</span>
              <span className="how-works-hero__role">{roleLabel}</span>
            </div>
            <div className="how-works-actions">
              <Link className="how-works-button how-works-button--primary" to={primary.to}>
                {t(`howOxsteedWorks.experience.actions.${story.role}.${primary.key}`)} <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <Link className="how-works-button how-works-button--secondary" to={secondary.to}>
                {t(`howOxsteedWorks.experience.actions.${story.role}.${secondary.key}`)}
              </Link>
            </div>
          </div>
          <div className="how-works-hero__preview" aria-label={t('howOxsteedWorks.experience.previewAria')}>
            <div className="how-works-preview-window">
              <div className="how-works-preview-window__bar"><span /><span /><span /><strong>OxSteed</strong></div>
              <div className="how-works-preview-window__body">
                <span className="how-works-preview-kicker">{t('howOxsteedWorks.experience.previewKicker')}</span>
                <strong>{t(`howOxsteedWorks.experience.preview.${story.role}.title`)}</strong>
                <span>{t(`howOxsteedWorks.experience.preview.${story.role}.detail`)}</span>
                <div className="how-works-preview-lines"><i /><i /><i /></div>
              </div>
            </div>
          </div>
        </section>

        <section className="how-works-role-section" aria-labelledby="how-works-role-title">
          <div className="how-works-section-heading">
            <div>
              <p className="how-works-eyebrow">{t('howOxsteedWorks.experience.roleKicker')}</p>
              <h2 id="how-works-role-title">{t('howOxsteedWorks.experience.chooseRole')}</h2>
            </div>
            <p>{t('howOxsteedWorks.experience.roleHint')}</p>
          </div>
          <div className="how-works-role-tabs" role="tablist" aria-label={t('howOxsteedWorks.experience.roleChooserAria')}>
            {STORY_ROLE_KEYS.map((role) => (
              <button
                key={role}
                type="button"
                role="tab"
                aria-selected={selectedRole === role}
                aria-controls="how-works-story"
                className={`how-works-role-tab${selectedRole === role ? ' is-selected' : ''}`}
                onClick={() => changeRole(role)}
              >
                <span className="how-works-role-tab__icon"><Icon name={role === 'customer' ? 'UserRoundCheck' : role === 'helper' ? 'Briefcase' : 'Building2'} /></span>
                <span><strong>{t(`howOxsteedWorks.experience.roles.${role}.label`)}</strong><small>{t(`howOxsteedWorks.experience.roles.${role}.short`)}</small></span>
                <ChevronRight className="how-works-role-tab__arrow" size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>

        <section
          id="how-works-story"
          className={`how-works-story${reducedMotion ? ' is-static' : ''}`}
          aria-labelledby="how-works-story-title"
        >
          <div className="how-works-section-heading how-works-section-heading--story">
            <div>
              <p className="how-works-eyebrow">{t('howOxsteedWorks.experience.storyKicker')}</p>
              <h2 id="how-works-story-title">{t(`howOxsteedWorks.experience.roles.${story.role}.title`)}</h2>
            </div>
            <p>{t('howOxsteedWorks.experience.storyHint')}</p>
          </div>
          <div className="how-works-story__steps">
            {story.steps.map((step, index) => (
              <StoryStep
                key={`${story.role}-${step.key}`}
                step={step}
                index={index}
                story={story}
                t={t}
                active={activeStep === index}
                reducedMotion={reducedMotion || typeof window === 'undefined' || !('IntersectionObserver' in window)}
                stepRef={(element) => { stepRefs.current[index] = element; }}
              />
            ))}
          </div>
        </section>

        <section className="how-works-available" aria-labelledby="how-works-available-title">
          <div className="how-works-section-heading">
            <div>
              <p className="how-works-eyebrow">{t('howOxsteedWorks.experience.availableKicker')}</p>
              <h2 id="how-works-available-title">{t('howOxsteedWorks.experience.availableTitle')}</h2>
            </div>
            <p>{t('howOxsteedWorks.experience.availableDescription')}</p>
          </div>
          <div className="how-works-card-grid">
            {story.cards.map((card) => (
              <Link className="how-works-action-card" key={card.key} to={card.to}>
                <span className="how-works-action-card__icon"><Icon name={card.icon} /></span>
                <span className="how-works-action-card__copy">
                  <strong>{t(`howOxsteedWorks.experience.cards.${story.role}.${card.key}.title`)}</strong>
                  <span>{t(`howOxsteedWorks.experience.cards.${story.role}.${card.key}.description`)}</span>
                </span>
                <ArrowRight className="how-works-action-card__arrow" size={18} aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>

        <section className="how-works-available how-works-experience-directory" aria-labelledby="how-works-experience-title">
          <div className="how-works-section-heading">
            <div>
              <p className="how-works-eyebrow">{t('experienceGuides.directoryKicker', { defaultValue: 'Explore OxSteed' })}</p>
              <h2 id="how-works-experience-title">{t('experienceGuides.directoryTitle', { defaultValue: 'See how each part connects' })}</h2>
            </div>
            <p>{t('experienceGuides.directoryDescription', { defaultValue: 'Choose a product journey to see the current roles, actions, and next steps.' })}</p>
          </div>
          <div className="how-works-card-grid">
            {getExperienceAreaKeys().map((areaKey) => {
              const area = getExperienceArea(areaKey);
              const translationKey = experienceAreaTranslationKey(areaKey);
              return (
                <Link className="how-works-action-card" key={areaKey} to={`/how-it-works/${areaKey}`}>
                  <span className="how-works-action-card__icon"><Icon name={area.enabled ? 'ArrowRight' : 'Clock3'} /></span>
                  <span className="how-works-action-card__copy">
                    <strong>{t(`experienceGuides.areas.${translationKey}.title`, { defaultValue: areaKey })}</strong>
                    <span>{t(`experienceGuides.areas.${translationKey}.description`, { defaultValue: t('experienceGuides.directoryDescription', { defaultValue: 'See the current OxSteed journey.' }) })}</span>
                  </span>
                  <ArrowRight className="how-works-action-card__arrow" size={18} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </section>

        <section className="how-works-bottom-cta" aria-labelledby="how-works-bottom-title">
          <div>
            <p className="how-works-eyebrow"><Clock3 size={16} aria-hidden="true" /> {t('howOxsteedWorks.experience.nextKicker')}</p>
            <h2 id="how-works-bottom-title">{t('howOxsteedWorks.experience.nextTitle')}</h2>
            <p>{t('howOxsteedWorks.experience.nextDescription')}</p>
          </div>
          <Link className="how-works-button how-works-button--primary" to={primary.to}>
            {t(`howOxsteedWorks.experience.actions.${story.role}.${primary.key}`)} <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </section>
      </div>
    </PageShell>
  );
}
