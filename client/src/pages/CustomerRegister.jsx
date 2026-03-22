import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle, X } from 'lucide-react';
import api from '../api/axios';

const TERMS_VERSION = '2026-03-20';

const TERMS_TEXT = `OxSteed Terms & Conditions — Version ${TERMS_VERSION}

1. NATURE OF SERVICE
OxSteed is a directory and bulletin board service that connects individuals seeking help ("Customers") with individuals offering services ("Helpers"). OxSteed is not a contractor, staffing agency, or employer. OxSteed does not perform, supervise, or guarantee any work.

2. NO GUARANTEE OF QUALITY
OxSteed makes no representations or warranties regarding the quality, safety, legality, or timeliness of services listed on the platform. Customers engage Helpers entirely at their own risk.

3. INDEPENDENT CONTRACTORS
All Helpers are independent individuals, not employees or agents of OxSteed. OxSteed is not liable for the acts, omissions, or conduct of any Helper.

4. BROKER IMMUNITY
OxSteed operates as a neutral broker and listing service. OxSteed does not control the means or manner of any work performed and expressly disclaims all liability arising from transactions between Customers and Helpers.

5. LIMITATION OF LIABILITY
To the maximum extent permitted by law, OxSteed's total liability to you for any claim arising out of or relating to these Terms or the Service shall not exceed $100 USD.

6. DISPUTE RESOLUTION
Any dispute arising from your use of OxSteed shall be resolved through binding arbitration in Clark County, Ohio, under the rules of the American Arbitration Association. You waive your right to a jury trial or class action.

7. INDEMNIFICATION
You agree to indemnify and hold harmless OxSteed LLC, its officers, directors, and employees from any claims, damages, or expenses arising from your use of the platform or violation of these Terms.

8. MODIFICATIONS
OxSteed may update these Terms at any time. Continued use of the platform after notice of changes constitutes acceptance of the updated Terms.

9. GOVERNING LAW
These Terms are governed by the laws of the State of Ohio, without regard to conflict of law principles.

10. CONTACT
OxSteed LLC — Springfield, Ohio
support@oxsteed.com`;

const PRIVACY_TEXT = `OxSteed Privacy Policy — Version ${TERMS_VERSION}

1. INFORMATION WE COLLECT
We collect your name, email, phone number, zip code, and usage data when you register and use our platform.

2. HOW WE USE YOUR INFORMATION
We use your information to operate the platform, verify your identity, send transactional communications, and improve our service. We do not sell your personal information to third parties.

3. DATA RETENTION
Account data is retained for 90 days after account deletion to resolve disputes and comply with tax obligations, then permanently deleted.

4. COOKIES
We use session cookies for authentication. We do not use third-party tracking cookies.

5. YOUR RIGHTS
You may request access to, correction of, or deletion of your personal data at any time by contacting support@oxsteed.com.

6. SECURITY
We use industry-standard encryption and access controls to protect your data. No system is 100% secure; use the platform at your own risk.

7. CONTACT
OxSteed LLC — Springfield, Ohio
support@oxsteed.com`;

function StepIndicator({ current }) {
  const steps = ['Basic Info', 'Terms', 'Verify Email'];
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((label, i) => {
        const num = i + 1;
        const done = current > num;
        const active = current === num;
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                done ? 'bg-orange-500 text-white' :
                active ? 'bg-orange-500 text-white ring-4 ring-orange-500/30' :
                'bg-gray-800 text-gray-500 border border-gray-700'
              }`}>
                {done ? <CheckCircle size={16} /> : num}
              </div>
              <span className={`text-xs mt-1 font-medium ${active ? 'text-orange-400' : done ? 'text-gray-400' : 'text-gray-600'}`}>
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={`w-16 h-px mb-5 mx-1 ${current > num ? 'bg-orange-500' : 'bg-gray-800'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Modal({ title, content, onClose }) {
  const ref = useRef(null);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition"><X size={20} /></button>
        </div>
        <div ref={ref} className="overflow-y-auto p-6 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Basic Info ───────────────────────────────────────────────────────
function StepBasicInfo({ onNext }) {
  const [form, setForm] = useState({
    fullName: '', email: '', phone: '', zipcode: '', password: '', confirmPassword: '',
    ageConfirmed: false,
  });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [waitlisted, setWaitlisted] = useState(false);
  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistDone, setWaitlistDone] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const formatPhone = (val) => {
    const digits = val.replace(/\D/g, '').slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0,3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  };

  const checkEmail = async () => {
    if (!form.email || !form.email.includes('@')) return;
    try {
      const res = await api.get(`/auth/check-email?email=${encodeURIComponent(form.email)}`);
      if (res.data.taken) setEmailError('An account with this email already exists.');
      else setEmailError('');
    } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (emailError) return;
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (!form.ageConfirmed) { toast.error('You must confirm you are 18 or older'); return; }
    const digits = form.phone.replace(/\D/g, '');
    if (digits.length !== 10) { toast.error('Enter a valid 10-digit US phone number'); return; }
    if (form.zipcode.length !== 5) { toast.error('Enter a valid 5-digit zip code'); return; }
    setLoading(true);
    try {
      const res = await api.post('/auth/check-market', { zipcode: form.zipcode });
      if (!res.data.active) {
        setWaitlisted(true);
        setWaitlistEmail(form.email);
        setLoading(false);
        return;
      }
      onNext({ ...form, phone: `+1${form.phone.replace(/\D/g, '')}` });
    } catch {
      toast.error('Something went wrong. Please try again.');
    }
    setLoading(false);
  };

  const handleWaitlist = async (e) => {
    e.preventDefault();
    try {
      await api.post('/waitlist', { email: waitlistEmail, zipcode: form.zipcode, role: 'customer' });
      setWaitlistDone(true);
    } catch { toast.error('Could not add to waitlist.'); }
  };

  if (waitlisted) {
    return (
      <div className="text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto">
          <span className="text-3xl">📍</span>
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-2">OxSteed isn't in your area yet</h3>
          <p className="text-gray-400 text-sm">We're expanding. Enter your email and we'll notify you the moment OxSteed launches near zip code <span className="text-white font-medium">{form.zipcode}</span>.</p>
        </div>
        {!waitlistDone ? (
          <form onSubmit={handleWaitlist} className="space-y-3">
            <input
              type="email"
              value={waitlistEmail}
              onChange={e => setWaitlistEmail(e.target.value)}
              required
              className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
              placeholder="your@email.com"
            />
            <button type="submit" className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl transition">
              Notify me when you launch
            </button>
          </form>
        ) : (
          <div className="bg-green-900/30 border border-green-700 rounded-xl p-4">
            <p className="text-green-400 font-medium">You're on the list! We'll reach out when we launch near you.</p>
          </div>
        )}
        <button onClick={() => setWaitlisted(false)} className="text-gray-500 text-sm hover:text-gray-300 transition">← Try a different zip code</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        abel htmlFor="fullName" className="block text-sm font-medium text-gray-300 mb-1.5">Full legal name</label>
        <input id="fullName" type="text" required value={form.fullName}
          onChange={e => set('fullName', e.target.value)}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="Jane Smith" />
      </div>

      <div>
        abel htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">Email address</label>
        <input id="email" type="email" required value={form.email}
          onChange={e => { set('email', e.target.value); setEmailError(''); }}
          onBlur={checkEmail}
          className={`w-full px-4 py-3 bg-gray-900 border rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 ${emailError ? 'border-red-500' : 'border-gray-700'}`}
          placeholder="you@example.com" autoComplete="email" />
        {emailError && <p className="text-red-400 text-xs mt-1">{emailError}</p>}
      </div>

      <div>
        abel htmlFor="phone" className="block text-sm font-medium text-gray-300 mb-1.5">Phone number <span className="text-gray-500 font-normal">(US)</span></label>
        <div className="flex gap-2">
          <span className="flex items-center px-3 bg-gray-800 border border-gray-700 rounded-xl text-gray-400 text-sm shrink-0">+1</span>
          <input id="phone" type="tel" required value={form.phone}
            onChange={e => set('phone', formatPhone(e.target.value))}
            className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
            placeholder="(555) 555-5555" />
        </div>
      </div>

      <div>
        abel htmlFor="zipcode" className="block text-sm font-medium text-gray-300 mb-1.5">Zip code</label>
        <input id="zipcode" type="text" required maxLength={5} value={form.zipcode}
          onChange={e => set('zipcode', e.target.value.replace(/\D/g, '').slice(0,5))}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="45502" />
      </div>

      <div>
        abel htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">Password <span className="text-gray-500 font-normal">(min. 8 characters)</span></label>
        <div className="relative">
          <input id="password" type={showPw ? 'text' : 'password'} required value={form.password}
            onChange={e => set('password', e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 pr-12"
            placeholder="Minimum 8 characters" autoComplete="new-password" />
          <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
            {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </div>

      <div>
        abel htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-1.5">Confirm password</label>
        <input id="confirmPassword" type="password" required value={form.confirmPassword}
          onChange={e => set('confirmPassword', e.target.value)}
          className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500"
          autoComplete="new-password" />
      </div>

      abel className="flex items-start gap-3 cursor-pointer group">
        <input type="checkbox" checked={form.ageConfirmed} onChange={e => set('ageConfirmed', e.target.checked)}
          className="mt-0.5 w-4 h-4 rounded accent-orange-500 cursor-pointer shrink-0" />
        <span className="text-sm text-gray-300 group-hover:text-white transition">I confirm I am <strong>18 years of age or older</strong></span>
      </label>

      <button type="submit" disabled={loading || !!emailError}
        className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all">
        {loading ? <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">ircle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          : <><span>Continue</span><ArrowRight size={18} /></>}
      </button>
    </form>
  );
}

// ─── Step 2: Terms ────────────────────────────────────────────────────────────
function StepTerms({ onNext, onBack }) {
  const [checks, setChecks] = useState({ terms: false, privacy: false, directory: false, noGuarantee: false });
  const [modal, setModal] = useState(null);
  const termsRef = useRef(null);
  const allChecked = Object.values(checks).every(Boolean);

  const toggle = (k) => setChecks(p => ({ ...p, [k]: !p[k] }));

  return (
    <div className="space-y-6">
      {modal && <Modal title={modal === 'terms' ? 'Terms & Conditions' : 'Privacy Policy'} content={modal === 'terms' ? TERMS_TEXT : PRIVACY_TEXT} onClose={() => setModal(null)} />}

      {/* What OxSteed is */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
        <p className="text-xs font-semibold text-orange-400 uppercase tracking-wider mb-3">Before you continue — understand what OxSteed is</p>
        <ul className="space-y-2">
          {[
            '📋  OxSteed is a bulletin board that lists local helpers — nothing more.',
            '🚫  OxSteed is NOT a contractor and does NOT perform any work.',
            '⚠️  OxSteed does NOT screen, supervise, or guarantee any Helper\'s work quality.',
            '💸  OxSteed does NOT handle payments unless you opt into the voluntary escrow feature.',
            '🤝  You contact and hire Helpers directly, entirely at your own discretion.',
          ].map((item, i) => (
            >{item}</li>
          ))}
        </ul>
      </div>

      {/* Scrollable T&C excerpt */}
      <div>
        <p className="text-sm font-medium text-gray-300 mb-2">Terms & Conditions excerpt <button onClick={() => setModal('terms')} className="text-orange-400 hover:text-orange-300 underline text-xs ml-1">View full terms</button></p>
        <div ref={termsRef} className="bg-gray-900 border border-gray-700 rounded-xl p-4 h-36 overflow-y-auto text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
          {TERMS_TEXT.split('\n').slice(0, 20).join('\n')}
          <p className="text-orange-400 mt-2 text-center cursor-pointer hover:text-orange-300" onClick={() => setModal('terms')}>... Read full Terms & Conditions →</p>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="space-y-3">
        {[
          { key: 'terms', label: <>I have read and agree to the <button type="button" onClick={() => setModal('terms')} className="text-orange-400 underline">Terms & Conditions</button></> },
          { key: 'privacy', label: <>I have read and agree to the <button type="button" onClick={() => setModal('privacy')} className="text-orange-400 underline">Privacy Policy</button></> },
          { key: 'directory', label: 'I understand OxSteed is a directory service, not a contractor' },
          { key: 'noGuarantee', label: 'I understand OxSteed does not guarantee the quality of any work' },
        ].map(({ key, label }) => (
          abel key={key} className="flex items-start gap-3 cursor-pointer group p-3 rounded-xl border border-gray-800 hover:border-gray-700 transition">
            <div className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${checks[key] ? 'bg-orange-500 border-orange-500' : 'border-gray-600 bg-transparent'}`}>
              {checks[key] && <CheckCircle size={14} className="text-white" />}
            </div>
            <input type="checkbox" checked={checks[key]} onChange={() => toggle(key)} className="sr-only" />
            <span className="text-sm text-gray-300">{label}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 px-4 py-3 border border-gray-700 text-gray-400 rounded-xl hover:border-gray-500 hover:text-white transition text-sm font-medium">
          <ArrowLeft size={16} /> Back
        </button>
        <button onClick={() => allChecked && onNext()} disabled={!allChecked}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded-xl disabled:opacity-40 disabled:cursor-not-allowed transition-all">
          I Agree — Continue <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ─
