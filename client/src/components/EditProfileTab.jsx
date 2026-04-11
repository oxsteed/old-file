import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { ProgressBar, Card, CardHeader, Btn, Input, Textarea, Select } from './dashboardUI';

const DAY_LABELS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const buildDefaultAvail = () => Object.fromEntries(DAY_LABELS.map(d => [d, { closed: true, start: '09:00', end: '17:00' }]));

// ── Main component ────────────────────────────────────────────────────────────
export default function EditProfileTab() {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [section, setSection] = useState('core');

  const [core, setCore] = useState({
    profile_headline: '', bio_long: '', hourly_rate_min: '', hourly_rate_max: '',
    service_radius_miles: 10, service_city: '', service_state: '',
    availability_json: buildDefaultAvail(), is_available_now: false,
  });
  const [services,  setServices]  = useState([]);
  const [faqs,      setFaqs]      = useState([]);
  const [policies,  setPolicies]  = useState([]);
  const [gallery,   setGallery]   = useState([]);

  const [newSvc, setNewSvc] = useState({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
  const [newFaq, setNewFaq] = useState({ question:'', answer:'' });
  const [newPol, setNewPol] = useState({ title:'', content:'', icon:'calendar-x' });
  const [newImg, setNewImg] = useState({ url:'', caption:'' });

  useEffect(() => {
    api.get('/helper-profile/me')
      .then(r => {
        const d = r.data;
        setCore({
          profile_headline:     d.profile_headline     || '',
          bio_long:             d.bio_long              || '',
          hourly_rate_min:      d.hourly_rate_min       || '',
          hourly_rate_max:      d.hourly_rate_max       || '',
          service_radius_miles: d.service_radius_miles  || 10,
          service_city:         d.service_city          || '',
          service_state:        d.service_state         || '',
          availability_json:    d.availability_json     || buildDefaultAvail(),
          is_available_now:     !!d.is_available_now,
        });
        setServices(d.services  || []);
        setFaqs(d.faqs          || []);
        setPolicies(d.policies  || []);
        setGallery(d.gallery    || []);
      })
      .catch(() => toast.error('Failed to load profile'))
      .finally(() => setLoading(false));
  }, []);

  // ── Core save ───────────────────────────────────────────────────────────────
  const saveCore = async (e) => {
    e?.preventDefault();
    setSaving(true);
    try {
      await api.put('/helper-profile/core', core);
      toast.success('Profile saved!');
    } catch {
      toast.error('Failed to save');
    }
    setSaving(false);
  };

  // ── Services ────────────────────────────────────────────────────────────────
  const addService = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/services', newSvc);
      setServices(p => [...p, r.data]);
      setNewSvc({ name:'', description:'', price:'', price_unit:'flat', duration:'', category:'General', popular:false });
      toast.success('Service added');
    } catch { toast.error('Failed to add service'); }
  };
  const deleteService = async (id) => {
    try { await api.delete(`/helper-profile/services/${id}`); setServices(p => p.filter(s => s.id !== id)); }
    catch { toast.error('Failed to delete'); }
  };

  // ── FAQs ────────────────────────────────────────────────────────────────────
  const addFaq = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/faqs', newFaq);
      setFaqs(p => [...p, r.data]);
      setNewFaq({ question:'', answer:'' });
      toast.success('FAQ added');
    } catch { toast.error('Failed to add FAQ'); }
  };
  const deleteFaq = async (id) => {
    try { await api.delete(`/helper-profile/faqs/${id}`); setFaqs(p => p.filter(f => f.id !== id)); }
    catch { toast.error('Failed to delete'); }
  };

  // ── Policies ────────────────────────────────────────────────────────────────
  const addPolicy = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/policies', newPol);
      setPolicies(p => [...p, r.data]);
      setNewPol({ title:'', content:'', icon:'calendar-x' });
      toast.success('Policy added');
    } catch { toast.error('Failed to add policy'); }
  };
  const deletePolicy = async (id) => {
    try { await api.delete(`/helper-profile/policies/${id}`); setPolicies(p => p.filter(pol => pol.id !== id)); }
    catch { toast.error('Failed to delete'); }
  };

  // ── Gallery ─────────────────────────────────────────────────────────────────
  const addImage = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/helper-profile/gallery', newImg);
      setGallery(p => [...p, r.data]);
      setNewImg({ url:'', caption:'' });
      toast.success('Photo added');
    } catch { toast.error('Failed to add photo'); }
  };
  const deleteImage = async (id) => {
    try { await api.delete(`/helper-profile/gallery/${id}`); setGallery(p => p.filter(g => g.id !== id)); }
    catch { toast.error('Failed to delete'); }
  };

  // ── Availability helpers ─────────────────────────────────────────────────────
  const toggleDay = (day) => setCore(prev => ({
    ...prev,
    availability_json: {
      ...prev.availability_json,
      [day]: { ...prev.availability_json[day], closed: !prev.availability_json[day]?.closed },
    },
  }));
  const setDayTime = (day, field, val) => setCore(prev => ({
    ...prev,
    availability_json: {
      ...prev.availability_json,
      [day]: { ...prev.availability_json[day], [field]: val },
    },
  }));

  // ── Profile completeness ─────────────────────────────────────────────────────
  const checks = [
    !!core.bio_long,
    !!core.profile_headline,
    !!core.hourly_rate_min,
    services.length > 0,
    faqs.length > 0,
    policies.length > 0,
    gallery.length > 0,
    DAY_LABELS.some(d => !core.availability_json[d]?.closed),
  ];
  const pct = Math.round((checks.filter(Boolean).length / checks.length) * 100);

  const SECTIONS = [
    { id: 'core',     label: 'Basic Info'   },
    { id: 'hours',    label: 'Availability' },
    { id: 'services', label: 'Services'     },
    { id: 'faqs',     label: 'FAQs'         },
    { id: 'policies', label: 'Policies'     },
    { id: 'gallery',  label: 'Photos'       },
  ];

  const MISSING_LABELS = [
    ['Bio',        checks[0]],
    ['Tagline',    checks[1]],
    ['Rate',       checks[2]],
    ['Services',   checks[3]],
    ['FAQs',       checks[4]],
    ['Policies',   checks[5]],
    ['Photos',     checks[6]],
    ['Hours',      checks[7]],
  ].filter(([, done]) => !done).map(([label]) => label);

  if (loading) return <div className="py-16 text-center text-gray-500 text-sm">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* Completeness */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-white">Profile completeness</span>
          <span className={`text-sm font-bold ${pct === 100 ? 'text-emerald-400' : pct >= 60 ? 'text-orange-400' : 'text-red-400'}`}>{pct}%</span>
        </div>
        <ProgressBar pct={pct} color={pct === 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-orange-500' : 'bg-red-500'} />
        {MISSING_LABELS.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {MISSING_LABELS.map(label => (
              <span key={label} className="text-[11px] text-gray-500 bg-gray-800 rounded-lg px-2 py-1">Missing: {label}</span>
            ))}
          </div>
        )}
      </Card>

      {/* Section nav */}
      <div className="flex gap-2 flex-wrap">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${section === s.id ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Basic Info ──────────────────────────────────────────── */}
      {section === 'core' && (
        <Card>
          <CardHeader title="Basic Info" />
          <form onSubmit={saveCore} className="space-y-4">
            <Input label="Tagline / Headline" value={core.profile_headline}
              onChange={e => setCore({ ...core, profile_headline: e.target.value })}
              placeholder="e.g. Reliable handyman serving Austin, TX" maxLength={280} />
            <Textarea label="Bio" rows={5} value={core.bio_long}
              onChange={e => setCore({ ...core, bio_long: e.target.value })}
              placeholder="Tell customers about your experience and what you love doing." maxLength={1500} />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Min rate ($/hr)" type="number" min="0" value={core.hourly_rate_min}
                onChange={e => setCore({ ...core, hourly_rate_min: e.target.value })} placeholder="45" />
              <Input label="Max rate ($/hr)" type="number" min="0" value={core.hourly_rate_max}
                onChange={e => setCore({ ...core, hourly_rate_max: e.target.value })} placeholder="85" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="City" value={core.service_city}
                onChange={e => setCore({ ...core, service_city: e.target.value })} placeholder="Austin" />
              <Input label="State" value={core.service_state}
                onChange={e => setCore({ ...core, service_state: e.target.value })} placeholder="TX" maxLength={2} />
            </div>
            <Input label="Service radius (miles)" type="number" min="1" max="100"
              value={core.service_radius_miles}
              onChange={e => setCore({ ...core, service_radius_miles: e.target.value })} />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="avail-now" checked={!!core.is_available_now}
                onChange={e => setCore({ ...core, is_available_now: e.target.checked })}
                className="accent-orange-500" />
              <label htmlFor="avail-now" className="text-sm text-gray-300">Mark me as available right now</label>
            </div>
            <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Basic Info'}</Btn>
          </form>
        </Card>
      )}

      {/* ── Availability ────────────────────────────────────────── */}
      {section === 'hours' && (
        <Card>
          <CardHeader title="Business Hours" />
          <p className="text-xs text-gray-500 mb-4">Click a day to toggle it open/closed. Set hours for open days.</p>
          <div className="space-y-3 mb-4">
            {DAY_LABELS.map(day => {
              const d = core.availability_json[day] || { closed: true, start: '09:00', end: '17:00' };
              return (
                <div key={day} className="flex items-center gap-3">
                  <button type="button" onClick={() => toggleDay(day)}
                    className={`w-24 text-[11px] font-semibold rounded-lg px-2 py-1.5 transition text-center ${d.closed ? 'bg-gray-800 text-gray-500' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-800'}`}>
                    {day.charAt(0).toUpperCase() + day.slice(1, 3)} {d.closed ? 'Off' : 'Open'}
                  </button>
                  {!d.closed && (
                    <>
                      <input type="time" value={d.start || '09:00'}
                        onChange={e => setDayTime(day, 'start', e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none" />
                      <span className="text-gray-600 text-xs">to</span>
                      <input type="time" value={d.end || '17:00'}
                        onChange={e => setDayTime(day, 'end', e.target.value)}
                        className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1 text-sm text-white focus:border-orange-500 focus:outline-none" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <Btn onClick={() => saveCore()} disabled={saving}>{saving ? 'Saving…' : 'Save Hours'}</Btn>
        </Card>
      )}

      {/* ── Services ────────────────────────────────────────────── */}
      {section === 'services' && (
        <Card>
          <CardHeader title="Services & Pricing" />
          {services.length === 0 && <p className="text-gray-600 text-sm mb-4">No services yet — add your first one below.</p>}
          <div className="space-y-2 mb-5">
            {services.map(s => (
              <div key={s.id} className="flex items-center justify-between p-3 bg-gray-800 rounded-xl border border-gray-700">
                <div>
                  <p className="text-sm font-semibold text-white">{s.name}</p>
                  <p className="text-xs text-gray-500">{s.category} · ${s.price} / {s.price_unit}</p>
                </div>
                <Btn variant="danger" onClick={() => deleteService(s.id)}>Delete</Btn>
              </div>
            ))}
          </div>
          <form onSubmit={addService} className="space-y-3 border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add a service</p>
            <Input label="Service name" value={newSvc.name}
              onChange={e => setNewSvc({ ...newSvc, name: e.target.value })}
              placeholder="e.g. Lawn Mowing & Edging" required />
            <Textarea label="Description" rows={2} value={newSvc.description}
              onChange={e => setNewSvc({ ...newSvc, description: e.target.value })}
              placeholder="What's included?" />
            <div className="grid grid-cols-3 gap-3">
              <Input label="Price ($)" type="number" min="0" value={newSvc.price}
                onChange={e => setNewSvc({ ...newSvc, price: e.target.value })} />
              <Select label="Unit" value={newSvc.price_unit}
                onChange={e => setNewSvc({ ...newSvc, price_unit: e.target.value })}>
                <option value="flat">Flat</option>
                <option value="hour">Per hour</option>
                <option value="starting_at">Starting at</option>
                <option value="quote">Quote</option>
              </Select>
              <Input label="Duration" value={newSvc.duration}
                onChange={e => setNewSvc({ ...newSvc, duration: e.target.value })} placeholder="2 hrs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Category" value={newSvc.category}
                onChange={e => setNewSvc({ ...newSvc, category: e.target.value })} placeholder="e.g. Landscaping" />
              <div className="flex items-center gap-2 pt-5">
                <input type="checkbox" id="popular" checked={newSvc.popular}
                  onChange={e => setNewSvc({ ...newSvc, popular: e.target.checked })} className="accent-orange-500" />
                <label htmlFor="popular" className="text-sm text-gray-300">Mark as popular</label>
              </div>
            </div>
            <Btn type="submit">+ Add Service</Btn>
          </form>
        </Card>
      )}

      {/* ── FAQs ────────────────────────────────────────────────── */}
      {section === 'faqs' && (
        <Card>
          <CardHeader title="Frequently Asked Questions" />
          {faqs.length === 0 && <p className="text-gray-600 text-sm mb-4">No FAQs yet — add common questions customers ask.</p>}
          <div className="space-y-2 mb-5">
            {faqs.map(f => (
              <div key={f.id} className="p-3 bg-gray-800 rounded-xl border border-gray-700">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm font-semibold text-white">{f.question}</p>
                  <Btn variant="danger" onClick={() => deleteFaq(f.id)}>Delete</Btn>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{f.answer}</p>
              </div>
            ))}
          </div>
          <form onSubmit={addFaq} className="space-y-3 border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add a FAQ</p>
            <Input label="Question" value={newFaq.question}
              onChange={e => setNewFaq({ ...newFaq, question: e.target.value })}
              placeholder="e.g. Do you bring your own equipment?" required />
            <Textarea label="Answer" rows={3} value={newFaq.answer}
              onChange={e => setNewFaq({ ...newFaq, answer: e.target.value })} required />
            <Btn type="submit">+ Add FAQ</Btn>
          </form>
        </Card>
      )}

      {/* ── Policies ────────────────────────────────────────────── */}
      {section === 'policies' && (
        <Card>
          <CardHeader title="Policies" />
          {policies.length === 0 && <p className="text-gray-600 text-sm mb-4">No policies yet. Add your cancellation, payment, or materials policies.</p>}
          <div className="space-y-2 mb-5">
            {policies.map(p => (
              <div key={p.id} className="p-3 bg-gray-800 rounded-xl border border-gray-700">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm font-semibold text-white">{p.title}</p>
                  <Btn variant="danger" onClick={() => deletePolicy(p.id)}>Delete</Btn>
                </div>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{p.content}</p>
              </div>
            ))}
          </div>
          <form onSubmit={addPolicy} className="space-y-3 border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add a policy</p>
            <Input label="Title" value={newPol.title}
              onChange={e => setNewPol({ ...newPol, title: e.target.value })}
              placeholder="e.g. Cancellation Policy" required />
            <Textarea label="Details" rows={3} value={newPol.content}
              onChange={e => setNewPol({ ...newPol, content: e.target.value })} required />
            <Select label="Icon" value={newPol.icon}
              onChange={e => setNewPol({ ...newPol, icon: e.target.value })}>
              <option value="calendar-x">Cancellation</option>
              <option value="credit-card">Payment</option>
              <option value="shield-check">Safety / Guarantee</option>
              <option value="shield">General</option>
            </Select>
            <Btn type="submit">+ Add Policy</Btn>
          </form>
        </Card>
      )}

      {/* ── Gallery ─────────────────────────────────────────────── */}
      {section === 'gallery' && (
        <Card>
          <CardHeader title="Work Photos" />
          <p className="text-xs text-gray-500 mb-4">Add direct image URLs from your cloud storage, Imgur, or any public host.</p>
          {gallery.length === 0 && <p className="text-gray-600 text-sm mb-4">No photos yet — photos increase bookings significantly.</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            {gallery.map(g => (
              <div key={g.id} className="relative group rounded-xl overflow-hidden bg-gray-800 border border-gray-700 aspect-square">
                <img src={g.url} alt={g.caption || 'Work photo'} className="w-full h-full object-cover"
                  onError={e => { e.target.style.display = 'none'; }} />
                <button onClick={() => deleteImage(g.id)}
                  className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  ×
                </button>
                {g.caption && (
                  <p className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-2 py-1 truncate">{g.caption}</p>
                )}
              </div>
            ))}
          </div>
          <form onSubmit={addImage} className="space-y-3 border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Add a photo</p>
            <Input label="Image URL" type="url" value={newImg.url}
              onChange={e => setNewImg({ ...newImg, url: e.target.value })}
              placeholder="https://…" required />
            <Input label="Caption (optional)" value={newImg.caption}
              onChange={e => setNewImg({ ...newImg, caption: e.target.value })}
              placeholder="e.g. Completed lawn renovation" />
            <Btn type="submit">+ Add Photo</Btn>
          </form>
        </Card>
      )}
    </div>
  );
}
