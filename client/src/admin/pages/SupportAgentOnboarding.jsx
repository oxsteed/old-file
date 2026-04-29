import { useState } from 'react';
import { useParams } from 'react-router-dom';
import adminApi from '../../lib/adminApi';
import { CheckCircle, ChevronRight, AlertCircle, Save } from 'lucide-react';

export default function SupportAgentOnboarding() {
  const { businessId } = useParams();
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

  const skills = ['billing', 'technical', 'account', 'general', 'escalations'];
  const languages = ['English', 'Spanish', 'French', 'German', 'Portuguese'];

  const handleSkillToggle = (skill) => {
    setFormData(prev => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter(s => s !== skill)
        : [...prev.skills, skill]
    }));
  };

  const handleLanguageToggle = (lang) => {
    setFormData(prev => ({
      ...prev,
      languages: prev.languages.includes(lang)
        ? prev.languages.filter(l => l !== lang)
        : [...prev.languages, lang]
    }));
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await adminApi.post(`/api/support/agents/onboard`, {
        ...formData,
        business_id: businessId,
      });
      alert('Agent onboarded successfully!');
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
      console.error('Failed to onboard agent:', err);
      alert('Error onboarding agent');
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-white font-bold text-3xl mb-2">Agent Onboarding</h1>
        <p className="text-gray-400 text-sm">Complete the 4-step process to add a new support agent.</p>
      </div>

      {/* Step Indicator */}
      <div className="flex gap-4 mb-8">
        {[1, 2, 3, 4].map(s => (
          <div
            key={s}
            onClick={() => s <= step && setStep(s)}
            className={`flex-1 py-3 px-4 rounded-lg text-center font-semibold cursor-pointer transition ${
              s === step
                ? 'bg-orange-600 text-white'
                : s < step
                ? 'bg-green-900/30 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {s < step ? <CheckCircle size={16} className="inline mr-2" /> : `Step ${s}`}
          </div>
        ))}
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-8">
        {/* Step 1: Basic Info */}
        {step === 1 && (
          <div className="space-y-6">
            <h2 className="text-white font-bold text-xl">Basic Information</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">First Name</label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={e => setFormData({ ...formData, first_name: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">Last Name</label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={e => setFormData({ ...formData, last_name: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-2">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-2">Phone</label>
              <input
                type="tel"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
              />
            </div>
            <button
              onClick={() => setStep(2)}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
            >
              Next <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* Step 2: Availability */}
        {step === 2 && (
          <div className="space-y-6">
            <h2 className="text-white font-bold text-xl">Availability & Timezone</h2>
            <div>
              <label className="block text-gray-400 text-sm mb-2">Timezone</label>
              <select
                value={formData.timezone}
                onChange={e => setFormData({ ...formData, timezone: e.target.value })}
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
              >
                <option value="UTC">UTC</option>
                <option value="EST">Eastern Time</option>
                <option value="CST">Central Time</option>
                <option value="PST">Pacific Time</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-400 text-sm mb-2">Start Time</label>
                <input
                  type="time"
                  value={formData.availability_start}
                  onChange={e => setFormData({ ...formData, availability_start: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
              </div>
              <div>
                <label className="block text-gray-400 text-sm mb-2">End Time</label>
                <input
                  type="time"
                  value={formData.availability_end}
                  onChange={e => setFormData({ ...formData, availability_end: e.target.value })}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setStep(1)}
                className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Skills & Languages */}
        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-white font-bold text-xl">Skills & Languages</h2>
            <div>
              <label className="block text-gray-400 text-sm mb-3">Support Skills</label>
              <div className="grid grid-cols-2 gap-3">
                {skills.map(skill => (
                  <label key={skill} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.skills.includes(skill)}
                      onChange={() => handleSkillToggle(skill)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-gray-300 capitalize">{skill}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-3">Languages</label>
              <div className="grid grid-cols-2 gap-3">
                {languages.map(lang => (
                  <label key={lang} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.languages.includes(lang)}
                      onChange={() => handleLanguageToggle(lang)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-gray-300">{lang}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setStep(2)}
                className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
              >
                Back
              </button>
              <button
                onClick={() => setStep(4)}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition"
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review */}
        {step === 4 && (
          <div className="space-y-6">
            <h2 className="text-white font-bold text-xl">Review & Confirm</h2>
            <div className="bg-gray-700 rounded-lg p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-gray-400 text-sm">Name</p>
                  <p className="text-white font-medium">{formData.first_name} {formData.last_name}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-sm">Email</p>
                  <p className="text-white font-medium">{formData.email}</p>
                </div>
              </div>
              <div>
                <p className="text-gray-400 text-sm mb-2">Skills</p>
                <div className="flex flex-wrap gap-2">
                  {formData.skills.map(skill => (
                    <span key={skill} className="px-3 py-1 bg-orange-900/30 text-orange-300 rounded-full text-sm">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-4">
              <button
                onClick={() => setStep(3)}
                className="flex-1 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition disabled:opacity-50"
              >
                <Save size={18} />
                Complete Onboarding
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
