import { useState } from 'react';
import { useParams } from 'react-router-dom';
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

function StepPill({ stepNumber, title, active, complete, onClick }) {
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
      <div className="text-xs uppercase tracking-[0.18em]">{complete ? 'Done' : `Step ${stepNumber}`}</div>
      <div className="mt-1 text-sm font-medium">{title}</div>
    </button>
  );
}

export default function SupportAgentOnboarding() {
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
        setError('First name, last name, and email are required.');
        setLoading(false);
        return;
      }

      if (formData.skills.length === 0) {
        setError('Please select at least one skill.');
        setLoading(false);
        return;
      }

      if (!businessId) {
        setError('Business ID is required. Enter the business UUID above or open this page from a business-scoped route.');
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

      toast.success('Agent onboarded successfully.');
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
      let errorMessage = 'Error onboarding agent';

      if (err.response?.data?.message) errorMessage = err.response.data.message;
      else if (err.response?.data?.error) errorMessage = err.response.data.error;
      else if (err.response?.status === 404) errorMessage = 'Server endpoint not found. Please contact support.';
      else if (err.response?.status === 400) errorMessage = 'Invalid data provided. Please check the form and try again.';
      else if (err.response?.status === 401) errorMessage = 'You are not authorized to perform this action.';
      else if (err.response?.status === 500) errorMessage = 'Server error. Please try again later.';
      else if (err.message === 'Network Error') errorMessage = 'Network error. Please check your connection and try again.';
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
        eyebrow="Hiring Workflow"
        title="Agent onboarding"
        description="Guide new support hires through profile setup, availability, and specialization so they enter the team with clean operational data."
        stats={[
          {
            icon: UserPlus,
            label: 'Profile',
            value: `${formData.first_name ? 1 : 0}/1`,
            detail: 'Basic identity captured.',
          },
          {
            icon: Clock3,
            label: 'Availability',
            value: `${formData.availability_start} - ${formData.availability_end}`,
            detail: 'Shift window being assigned.',
            tone: 'text-blue-300',
          },
          {
            icon: Globe2,
            label: 'Timezone',
            value: formData.timezone,
            detail: 'Working timezone for scheduling.',
            tone: 'text-orange-300',
          },
          {
            icon: Languages,
            label: 'Languages',
            value: formData.languages.length,
            detail: 'Languages currently selected.',
            tone: 'text-green-300',
          },
        ]}
      />

      {!businessIdFromRoute && (
        <SupportPanel
          title="Business scope"
          subtitle="Some support tools need a business UUID when the route is not already scoped."
        >
          <label className="mb-2 block text-sm font-medium text-gray-300">Business ID (UUID)</label>
          <input
            type="text"
            value={businessIdManual}
            onChange={(event) => setBusinessIdManual(event.target.value)}
            placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
            className="w-full rounded-2xl border border-gray-700 bg-gray-900 px-4 py-3 font-mono text-sm text-white focus:border-orange-500 focus:outline-none"
          />
          <div className="mt-2 text-xs leading-6 text-gray-500">
            Saved in this browser after a successful onboarding so future support flows can reuse the same business scope.
          </div>
        </SupportPanel>
      )}

      {error && (
        <div className="rounded-[24px] border border-red-700/50 bg-red-900/20 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 text-red-400" size={20} />
            <div>
              <div className="font-medium text-red-300">Onboarding error</div>
              <div className="mt-1 text-sm leading-6 text-red-200">{error}</div>
            </div>
          </div>
        </div>
      )}

      <SupportPanel
        title="Four-step onboarding"
        subtitle="Capture the information a support lead needs before turning a new agent loose on the queue."
      >
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
          {[
            'Basic info',
            'Availability',
            'Skills and languages',
            'Review and confirm',
          ].map((title, index) => (
            <StepPill
              key={title}
              stepNumber={index + 1}
              title={title}
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
                  <div className="text-xl font-semibold text-white">Basic information</div>
                  <div className="mt-2 text-sm text-gray-500">Start with identity and contact information for the new agent.</div>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">First name</label>
                    <input
                      type="text"
                      value={formData.first_name}
                      onChange={(event) => setFormData({ ...formData, first_name: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Last name</label>
                    <input
                      type="text"
                      value={formData.last_name}
                      onChange={(event) => setFormData({ ...formData, last_name: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(event) => setFormData({ ...formData, email: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(event) => setFormData({ ...formData, phone: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(2)}>
                  Continue to availability
                </SupportActionButton>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">Availability and timezone</div>
                  <div className="mt-2 text-sm text-gray-500">Set the working timezone and the base availability window this agent should start with.</div>
                </div>
                <div>
                  <label className="mb-2 block text-sm text-gray-400">Timezone</label>
                  <select
                    value={formData.timezone}
                    onChange={(event) => setFormData({ ...formData, timezone: event.target.value })}
                    className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                  >
                    <option value="UTC">UTC</option>
                    <option value="EST">Eastern Time</option>
                    <option value="CST">Central Time</option>
                    <option value="PST">Pacific Time</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Availability start</label>
                    <input
                      type="time"
                      value={formData.availability_start}
                      onChange={(event) => setFormData({ ...formData, availability_start: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm text-gray-400">Availability end</label>
                    <input
                      type="time"
                      value={formData.availability_end}
                      onChange={(event) => setFormData({ ...formData, availability_end: event.target.value })}
                      className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-white focus:border-orange-500 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(1)}>Back</SupportActionButton>
                  <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(3)}>
                    Continue to skills
                  </SupportActionButton>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">Skills and languages</div>
                  <div className="mt-2 text-sm text-gray-500">Define what this agent can confidently handle on day one and which customers they can support directly.</div>
                </div>
                <div>
                  <div className="mb-3 text-sm text-gray-400">Support skills</div>
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
                        {skill}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-3 text-sm text-gray-400">Languages</div>
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
                        {lang}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(2)}>Back</SupportActionButton>
                  <SupportActionButton icon={ChevronRight} tone="primary" onClick={() => setStep(4)}>
                    Continue to review
                  </SupportActionButton>
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-6">
                <div>
                  <div className="text-xl font-semibold text-white">Review and confirm</div>
                  <div className="mt-2 text-sm text-gray-500">Check the final summary before creating the support-agent profile.</div>
                </div>
                <div className="rounded-[24px] border border-gray-800 bg-gray-950/70 p-5">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Name</div>
                      <div className="mt-1 text-white">{formData.first_name} {formData.last_name}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Email</div>
                      <div className="mt-1 text-white">{formData.email}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Availability</div>
                      <div className="mt-1 text-white">{formData.availability_start} - {formData.availability_end}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Timezone</div>
                      <div className="mt-1 text-white">{formData.timezone}</div>
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">Skills</div>
                    <div className="flex flex-wrap gap-2">
                      {formData.skills.map((skill) => (
                        <SupportTag key={skill} tone="orange">{skill}</SupportTag>
                      ))}
                    </div>
                  </div>
                  <div className="mt-5">
                    <div className="mb-2 text-xs uppercase tracking-[0.18em] text-gray-500">Languages</div>
                    <div className="flex flex-wrap gap-2">
                      {formData.languages.map((lang) => (
                        <SupportTag key={lang} tone="blue">{lang}</SupportTag>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <SupportActionButton tone="secondary" onClick={() => setStep(3)}>Back</SupportActionButton>
                  <SupportActionButton icon={Save} tone="success" onClick={handleSubmit} disabled={loading}>
                    Complete onboarding
                  </SupportActionButton>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-[24px] border border-gray-800 bg-gray-900/70 p-6">
            <div className="text-lg font-semibold text-white">Onboarding snapshot</div>
            <div className="mt-2 text-sm leading-6 text-gray-500">
              Keep the setup consistent so staffing, routing, and language coverage all work from the start.
            </div>

            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Business scope</div>
                <div className="mt-2 break-all text-sm text-white">{businessId || 'Not set yet'}</div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Selected skills</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formData.skills.length
                    ? formData.skills.map((skill) => <SupportTag key={skill} tone="orange">{skill}</SupportTag>)
                    : <span className="text-sm text-gray-500">No skills selected yet.</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Selected languages</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {formData.languages.length
                    ? formData.languages.map((lang) => <SupportTag key={lang} tone="blue">{lang}</SupportTag>)
                    : <span className="text-sm text-gray-500">No languages selected yet.</span>}
                </div>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-4">
                <div className="flex items-start gap-3">
                  <CheckCircle size={18} className="mt-0.5 text-green-300" />
                  <div className="text-sm leading-6 text-gray-500">
                    Capture enough specialization here so scheduling, routing, and future performance reporting all start from clean baseline data.
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
