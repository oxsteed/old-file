import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../api/axios';

interface Props {
  token: string;
  onSuccess: (data: { phone: string; zip: string; city: string; state: string; bio: string; skills: string[]; photoUrl: string }) => void;
  onBack: () => void;
}

interface SkillOption { id: number; name: string; category: string; }

function useSkillSearch(q: string) {
  const [results, setResults] = useState<SkillOption[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/helpers/skills?q=${encodeURIComponent(q)}&limit=10`);
        setResults(data.skills || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return { results, loading };
}

export default function Step4ProfileLocation({ token, onSuccess, onBack }: Props) {
  const [form, setForm] = useState({
    phone: '', zip: '', bio: '', skills: [] as string[], photoUrl: '',
  });
  const [cityState, setCityState] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [skillQuery, setSkillQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const skillInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { results: skillResults, loading: skillSearching } = useSkillSearch(skillQuery);

  const set = (field: string, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  };

  // Zip lookup
  useEffect(() => {
    const zip = form.zip.replace(/\D/g, '');
    if (zip.length === 5) {
      fetch(`https://api.zippopotam.us/us/${zip}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.places?.[0]) {
            setCityState(`${data.places[0]['place name']}, ${data.places[0]['state abbreviation']}`);
          } else {
            setCityState('');
          }
        })
        .catch(() => setCityState(''));
    } else {
      setCityState('');
    }
  }, [form.zip]);

  const addSkill = useCallback((name: string) => {
    if (form.skills.includes(name) || form.skills.length >= 8) return;
    setForm(prev => ({ ...prev, skills: [...prev.skills, name] }));
    setErrors(prev => ({ ...prev, skills: '' }));
    setSkillQuery('');
    setShowDropdown(false);
    skillInputRef.current?.focus();
  }, [form.skills]);

  const removeSkill = useCallback((name: string) => {
    setForm(prev => ({ ...prev, skills: prev.skills.filter(s => s !== name) }));
  }, []);

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrors(prev => ({ ...prev, photo: 'Please select an image file' }));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, photo: 'Image must be under 5MB' }));
      return;
    }
    setUploading(true);
    setErrors(prev => ({ ...prev, photo: '' }));
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const { data } = await api.post('/helper-registration/profile-photo', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      set('photoUrl', data.photoUrl);
    } catch (err: any) {
      setErrors(prev => ({ ...prev, photo: err.response?.data?.error || 'Photo upload failed' }));
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length < 10) e.phone = 'Enter a valid 10-digit US phone number';
    if (form.zip.replace(/\D/g, '').length !== 5) e.zip = 'Enter a valid 5-digit zip code';
    if (form.skills.length < 1) e.skills = 'Select at least one skill';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const phone = form.phone.replace(/\D/g, '');
      const zip = form.zip.replace(/\D/g, '');
      const slugs = form.skills.map(s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));

      await api.post('/helper-registration/profile', {
        token,
        profileHeadline: form.skills.slice(0, 3).join(', '),
        bio: form.bio || null,
        serviceCategories: slugs,
        serviceRadius: 10,
        ratePreference: 'per_job',
        hourlyRate: null,
      });

      // Update phone/zip on user record
      await api.post('/helper-registration/update-contact', { phone, zip });

      const parts = cityState.split(', ');
      onSuccess({
        phone, zip,
        city: parts[0] || '', state: parts[1] || '',
        bio: form.bio, skills: form.skills, photoUrl: form.photoUrl,
      });
    } catch (err: any) {
      setErrors({ general: err.response?.data?.error || 'Failed to save profile' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:ring-2 focus:ring-orange-500 focus:border-transparent transition';

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {errors.general && (
        <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg text-red-300 text-sm" role="alert">{errors.general}</div>
      )}

      {/* Phone */}
      <div>
        <label htmlFor="phone" className="block text-sm text-gray-300 mb-1">Phone Number</label>
        <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567"
          value={form.phone} onChange={e => set('phone', formatPhone(e.target.value))}
          className={inputClass} aria-required="true" />
        {errors.phone && <p className="text-red-400 text-xs mt-1" role="alert">{errors.phone}</p>}
      </div>

      {/* Zip */}
      <div>
        <label htmlFor="zip" className="block text-sm text-gray-300 mb-1">Zip Code</label>
        <input id="zip" type="text" inputMode="numeric" autoComplete="postal-code" placeholder="45505" maxLength={5}
          value={form.zip} onChange={e => set('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
          className={inputClass} aria-required="true" />
        {cityState && <p className="text-green-400 text-xs mt-1">{cityState}</p>}
        {errors.zip && <p className="text-red-400 text-xs mt-1" role="alert">{errors.zip}</p>}
      </div>

      {/* Photo upload */}
      <div>
        <label className="block text-sm text-gray-300 mb-1">Profile Photo <span className="text-gray-500">(optional)</span></label>
        <div className="flex items-center gap-4">
          <button type="button" onClick={handlePhotoClick}
            className="w-16 h-16 rounded-full bg-gray-800 border-2 border-dashed border-gray-600 hover:border-orange-500 flex items-center justify-center text-gray-500 text-2xl cursor-pointer transition overflow-hidden">
            {form.photoUrl ? <img src={form.photoUrl} alt="" className="w-full h-full rounded-full object-cover" /> : uploading ? '...' : '+'}
          </button>
          <div>
            <button type="button" onClick={handlePhotoClick}
              className="text-sm text-orange-500 hover:text-orange-400 font-medium">
              {form.photoUrl ? 'Change Photo' : uploading ? 'Uploading...' : 'Add Photo'}
            </button>
            <p className="text-gray-500 text-xs mt-0.5">Helpers with photos get 2x more job requests.</p>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        </div>
        {errors.photo && <p className="text-red-400 text-xs mt-1" role="alert">{errors.photo}</p>}
      </div>

      {/* Skills searchable input */}
      <div>
        <label className="block text-sm text-gray-300 mb-2">
          Skills <span className="text-gray-500">(select 1–8)</span>
        </label>

        {/* Selected skill tags */}
        {form.skills.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {form.skills.map(skill => (
              <span key={skill}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-orange-500/20 text-orange-300 text-sm border border-orange-500/40">
                {skill}
                <button type="button" onClick={() => removeSkill(skill)}
                  className="ml-0.5 text-orange-400 hover:text-white leading-none" aria-label={`Remove ${skill}`}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Search input */}
        {form.skills.length < 8 && (
          <div className="relative">
            <input
              ref={skillInputRef}
              type="text"
              placeholder="Search skills (e.g. Plumbing, Painting, Pet Care…)"
              value={skillQuery}
              onChange={e => { setSkillQuery(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
              className={inputClass}
            />
            {skillSearching && (
              <span className="absolute right-3 top-3 text-gray-500 text-xs">Searching…</span>
            )}
            {showDropdown && skillResults.length > 0 && (
              <ul className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {skillResults.map(s => (
                  <li key={s.id}>
                    <button type="button"
                      onMouseDown={() => addSkill(s.name)}
                      disabled={form.skills.includes(s.name)}
                      className={`w-full text-left px-4 py-2 text-sm transition ${
                        form.skills.includes(s.name)
                          ? 'text-gray-500 cursor-default'
                          : 'text-white hover:bg-gray-700'
                      }`}>
                      <span>{s.name}</span>
                      <span className="text-gray-500 text-xs ml-2">{s.category}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {showDropdown && skillQuery.trim() && !skillSearching && skillResults.length === 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-500">
                No skills found for "{skillQuery}"
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500 mt-1">{form.skills.length}/8 selected</p>
        {errors.skills && <p className="text-red-400 text-xs mt-1" role="alert">{errors.skills}</p>}
      </div>

      {/* Bio */}
      <div>
        <label htmlFor="bio" className="block text-sm text-gray-300 mb-1">Short Bio <span className="text-gray-500">(optional)</span></label>
        <textarea id="bio" placeholder="Tell customers about your experience..." rows={3} maxLength={500}
          value={form.bio} onChange={e => set('bio', e.target.value)}
          className={inputClass + ' resize-none'} />
        <p className="text-xs text-gray-500 mt-1 text-right">{form.bio.length}/500</p>
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="px-6 py-3 bg-transparent border border-gray-600 text-gray-300 hover:border-gray-500 rounded-lg transition">
          Back
        </button>
        <button type="submit" disabled={loading}
          className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white font-bold rounded-lg disabled:opacity-50 transition">
          {loading ? 'Saving...' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
