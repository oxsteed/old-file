import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';
import {
  CheckCircle,
  ChevronRight,
  AlertCircle,
  Save,
  UserPlus,
  Globe2,
  Languages,
  Clock3,
} from 'lucide-react';
import {
  SupportPageShell,
  SupportHero,
  SupportPanel,
  SupportActionButton,
  SupportTag,
} from '../components/support/SupportPageChrome';

const SUPPORT_BUSINESS_STORAGE_KEY = 'oxs:support_business_id';

const skills = ['billing', 'technical', 'account', 'general', 'escalations'];
const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

// Skill/language ids stay stable for the API; only the displayed labels translate.
const SKILL_LABEL_KEYS = {
  billing: 'adminSupportOnboarding.skillBilling',
  technical: 'adminSupportOnboarding.skillTechnical',
  account: 'adminSupportOnboarding.skillAccount',
  general: 'adminSupportOnboarding.skillGeneral',
  escalations: 'adminSupportOnboarding.skillEscalations',
};

const LANGUAGE_LABEL_KEYS = {
  English: 'adminSupportOnboarding.languageEnglish',
  Spanish: 'adminSupportOnboarding.languageSpanish',
  French: 'adminSupportOnboarding.languageFrench',
  German: 'adminSupportOnboarding.languageGerman',
  Portuguese: 'adminSupportOnboarding.languagePortuguese',
};

const STEP_TITLE_KEYS = [
  'adminSupportOnboarding.stepBasicInfo',
  'adminSupportOnboarding.stepAvailability',
  'adminSupportOnboarding.stepSkillsLanguages',
  'adminSupportOnboarding.stepReviewConfirm',
];

function StepPill({ stepNumber, title, active, complete, onClick }) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition ${
        active
          ? 'border-orange-500/40 bg-orange-500/10 text-white'
          : complete
            ? 'border-green-500/25 bg-green-500/10 text-green-200'
            : 'border-gray-800 bg-gray-900/70 text-gray-400'
      }`}
    >
      <div className="text-xs uppercase tracking-[0.18em]">{complete ? t('adminSupportOnboarding.stepDone') : t('adminSupportOnboarding.stepLabel', { stepNumber })}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
    </button>
  );
}

export default function SupportAgentOnboarding() {
  const { t } = useTranslation();
  const { businessId: businessIdFromRoute } = useParams();
  const [businessIdManual, setBusinessIdManual] = useState(() => {
    try {
      return localStorage.getItem(SUPPORT_BUSINESS_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const businessId = businessIdFromRoute || businessIdManual.trim() || undefined;
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    timezone: 'UTC',
    availability_start: '09:00',
    availability_end: '17:00',
    skills: [],
    languages: [],
    experience_level: 'junior',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSkillToggle = (skill) => {
    setFormData((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((item) => item !== skill)
        : [...prev.skills, skill],
    }));
  };

  const handleLanguageToggle = (lang) => {
    setFormData((prev) => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter((item) => item !== lang)
        : [...prev.languages, lang],
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!formData.first_name || !formData.last_name || !formData.email) {
        setError(t('adminSupportOnboarding.errorRequiredFields'));
        setLoading(false);
        return;
      }

      if (formData.skills.length === 0) {
        setError(t('adminSupportOnboarding.errorSkillRequired'));
        setLoading(false);
        return;
      }

      if (!businessId) {
        setError(t('adminSupportOnboarding.errorBusinessIdRequired'));
        setLoading(false);
        return;
      }

      await adminApi.post('/support/agents/onboard', {
        ...formData,
        business_id: businessId,
      });

      try {
        localStorage.setItem(SUPPORT_BUSINESS_STORAGE_KEY, businessId);
      } catch {
        /* ignore */
      }

      toast.success(t('adminSupportOnboarding.onboardedSuccess'));
      setStep(1);
      setFormData({
        first_name: '',
        last_name: '',
        email: '',
        phone: '',
        timezone: 'UTC',
        availability_start: '09:00',
        availability_end: '17:00',
        skills: [],
        languages: [],
        experience_level: 'junior',
      });
    } catch (err) {
      let errorMessage = t('adminSupportOnboarding.errorDefault');

      if (err.response?.data?.message) errorMessage = err.response.data.message;
      else if (err.response?.data?.error) errorMessage = err.response.data.error;
      else if (err.response?.status === 404) errorMessage = t('adminSupportOnboarding.errorEndpointNotFound');
      else if (err.response?.status === 400) errorMessage = t('adminSupportOnboarding.errorInvalidData');
      else if (err.response?.status === 401) errorMessage = t('adminSupportOnboarding.errorUnauthorized');
      else if (err.response?.status === 500) errorMessage = t('adminSupportOnboarding.errorServer');
      else if (err.message === 'Network Error') errorMessage = t('adminSupportOnboarding.errorNetwork');
      else if (err.message) errorMessage = err.message;

      console.error('Agent onboarding failed:', err);
      setError(errorMessage);
    }

    setLoading(false);
  };

  return (
    <SupportPageShell>
      <SupportHero
        icon={UserPlus}
        eyebrow={t('adminSupportOnboarding.heroEyebrow')}
        title={t('adminSupportOnboarding.heroTitle')}
        description={t('adminSupportOnboarding.heroDescription')}
        stats={[
          {
            icon: UserPlus,
            label: t('adminSupportOnboarding.statProfile'),
            value: `${formData.first_name ? 1 : 0}/1`,
            detail: t('adminSupportOnboarding.statProfileDetail'),
          },
          {
            icon: Clock3,
            label: t('adminSupportOnboarding.statAvailability'),
            value: t('adminSupportOnboarding.availabilityValue', { start: formData.availability_start, end: formData.availability_end }),
            detail: t('adminSupportOnboarding.statAvailabilityDetail'),
            tone: 'text-blue-300',
          },
          {
            icon: Globe2,
            label: t('adminSupportOnboarding.statTimezone'),
            value: formData.timezone,
            detail: t('adminSupportOnboarding.statTimezoneDetail'),
            tone: 'text-orange-300',
          },
          {
            icon: Languages,
            label: t('adminSupportOnboarding.statLanguages'),
            value: formData.languages.length,
            detail: t('adminSupportOnboarding.statLanguagesDetail'),
            tone: 'text-green-300',
          },
        ]}
      />

      {!businessIdFromRoute && (
        <SupportPanel
          title={t('adminSupportOnboarding.businessScopeTitle')}
          subtitle={t('adminSupportOnboarding.businessScopeSubtitle')}
        >
          <label className="mb-2 block text-sm font-medium text-gray-300">{t('adminSupportOnboarding.businessIdLabel')}</label>
          <input
            type="text"
            value={businessIdManual}
            onChange={(event) => setBusinessIdManual(event.target.value)}
            placeholder={t('adminSupportOnboarding.businessIdPlaceholder')}
            className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 font-mono text-sm text-white focus:border-orange-500 focus:outline-none"
          />
          <div className="mt-2 text-xs leading-6 text-gray-500">
            {t('adminSupportOnboarding.businessIdHint')}
          </div>
        </SupportPanel>
      )}

      {error && (
        <div className="rounded-[24px] border border-red-700/50 bg-red-900/20 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-400" size={20} />
            <div>
              <div className="font-medium text-red-300">{t('adminSupportOnboarding.onboardingErrorTitle')}</div>
              <div className="mt-1 text-sm leading-6 text-red-200">{error}</div>
            </div>
          </div>
        </div>
      )}

      <SupportPanel
        title={t('adminSupportOnboarding.panelTitle')}
        subtitle={t('adminSupportOnboarding.panelSubtitle')}
      >
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          {STEP_TITLE_KEYS.map((titleKey, index) => (
            <StepPill
              key={titleKey}
              stepNumber={index + 1}
              title={t(titleKey)}
              active={step === index + 1}
              complete={step > index + 1}
              onClick={() => step >= index + 1 && setStep(index + 1)}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-6">
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">{t('adminSupportOnboarding.sectionBasicInfo')}</div>
                  <div className="mt-2 text-sm text-gray-500">{t('adminSupportOnboarding.sectionBasicInfoDesc')}</div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.firstName')}</label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(event) => setFormData({ ...formData, first_name: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.lastName')}</label>
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={(event) => setFormData({ ...formData, last_name: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.email')}</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.phone')}</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(2)}>
                  {t('adminSupportOnboarding.continueToAvailability')}
                </SupportActionButton>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">{t('adminSupportOnboarding.sectionAvailability')}</div>
                  <div className="mt-2 text-sm text-gray-500">{t('adminSupportOnboarding.sectionAvailabilityDesc')}</div>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.timezoneLabel')}</label>
                  <select
                    value={formData.timezone}
                    onChange={(event) => setFormData({ ...formData, timezone: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  >
                    <option value="UTC">UTC</option>
                    <option value="EST">{t('adminSupportOnboarding.timezoneEastern')}</option>
                    <option value="CST">{t('adminSupportOnboarding.timezoneCentral')}</option>
                    <option value="PST">{t('adminSupportOnboarding.timezonePacific')}</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.availabilityStart')}</label>
                    <input
                      type="time"
                      value={formData.availability_start}
                      onChange={(event) => setFormData({ ...formData, availability_start: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">{t('adminSupportOnboarding.availabilityEnd')}</label>
                    <input
                      type="time"
                      value={formData.availability_end}
                      onChange={(event) => setFormData({ ...formData, availability_end: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(1)}>{t('adminSupportOnboarding.back')}</SupportActionButton>
                  <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(3)}>
                    {t('adminSupportOnboarding.continueToSkills')}
                  </SupportActionButton>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">{t('adminSupportOnboarding.sectionSkills')}</div>
                  <div className="mt-2 text-sm text-gray-500">{t('adminSupportOnboarding.sectionSkillsDesc')}</div>
                </div>
                <div>
                  <div className="mb-3 text-sm text-gray-400">{t('adminSupportOnboarding.supportSkillsLabel')}</div>
                  <div className="flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <button
                        key={skill}
                        onClick={() => handleSkillToggle(skill)}
                        className={`rounded-full border px-3 py-2 text-sm capitalize transition ${
                          formData.skills.includes(skill)
                            ? 'border-orange-500/30 bg-orange-500/10 text-orange-300'
                            : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {t(SKILL_LABEL_KEYS[skill])}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-3 text-sm text-gray-400">{t('adminSupportOnboarding.languagesLabel')}</div>
                  <div className="flex flex-wrap gap-2">
                    {languages.map((lang) => (
                      <button
                        key={lang}
                        onClick={() => handleLanguageToggle(lang)}
                        className={`rounded-full border px-3 py-2 text-sm transition ${
                          formData.languages.includes(lang)
                            ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                            : 'border-gray-700 bg-gray-950 text-gray-400 hover:border-gray-600'
                        }`}
                      >
                        {t(LANGUAGE_LABEL_KEYS[lang])}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(2)}>{t('adminSupportOnboarding.back')}</SupportActionButton>
                  <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(4)}>
                    {t('adminSupportOnboarding.continueToReview')}
                  </SupportActionButton>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">{t('adminSupportOnboarding.sectionReview')}</div>
                  <div className="mt-2 text-sm text-gray-500">{t('adminSupportOnboarding.sectionReviewDesc')}</div>
                </div>
                <div className="rounded-[24px] border border-gray-800 bg-gray-950/70 p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewName')}</div>
                      <div className="mt-1 text-white">{formData.first_name} {formData.last_name}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewEmail')}</div>
                      <div className="mt-1 text-white">{formData.email}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewAvailability')}</div>
                      <div className="mt-1 text-white">{formData.availability_start} - {formData.availability_end}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewTimezone')}</div>
                      <div className="mt-1 text-white">{formData.timezone}</div>
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewSkills')}</div>
                    <div className="flex flex-wrap gap-2">
                      {formData.skills.map((skill) => (
                        <SupportTag key={skill} tone="orange">{t(SKILL_LABEL_KEYS[skill])}</SupportTag>
                      ))}
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.reviewLanguages')}</div>
                    <div className="flex flex-wrap gap-2">
                      {formData.languages.map((lang) => (
                        <SupportTag key={lang} tone="blue">{t(LANGUAGE_LABEL_KEYS[lang])}</SupportTag>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(3)}>{t('adminSupportOnboarding.back')}</SupportActionButton>
                  <SupportActionButton icon={Save} tone="success" onClick={handleSubmit} disabled={loading}>
                    {t('adminSupportOnboarding.completeOnboarding')}
                  </SupportActionButton>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-6">
            <div className="text-lg font-semibold text-white">{t('adminSupportOnboarding.snapshotTitle')}</div>
            <div className="mt-2 text-sm leading-6 text-gray-500">
              {t('adminSupportOnboarding.snapshotDesc')}
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.snapshotBusinessScope')}</div>
                <div className="mt-2 break-all text-sm text-white">{businessId || t('adminSupportOnboarding.notSetYet')}</div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.selectedSkills')}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formData.skills.length
                    ? formData.skills.map((skill) => <SupportTag key={skill} tone="orange">{t(SKILL_LABEL_KEYS[skill])}</SupportTag>)
                    : <span className="text-sm text-gray-500">{t('adminSupportOnboarding.noSkillsSelected')}</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">{t('adminSupportOnboarding.selectedLanguages')}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formData.languages.length
                    ? formData.languages.map((lang) => <SupportTag key={lang} tone="blue">{t(LANGUAGE_LABEL_KEYS[lang])}</SupportTag>)
                    : <span className="text-sm text-gray-500">{t('adminSupportOnboarding.noLanguagesSelected')}</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle size={18} className="mt-0.5 text-green-300" />
                  <div className="text-sm leading-6 text-gray-500">
                    {t('adminSupportOnboarding.snapshotTip')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SupportPanel>
    </SupportPageShell>
  );
}
