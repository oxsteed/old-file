import { lazy, Suspense, useState, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, Users, Briefcase, Check, ArrowRight, MapPin, Store, Truck, GraduationCap, ShieldCheck, Wrench, BarChart3, Utensils, Factory, Smartphone } from 'lucide-react';
import api from '../api/axios';
import { persistSessionPayload } from '../api/auth';
import { currentAuthEpoch, isCurrentAuthEpoch } from '../api/authSessionEpoch';
import Footer from '../components/Footer';
import AuthNavbar from '../components/AuthNavbar';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import { useCapabilities } from '../hooks/useCapabilities';
import OTPInput from '../components/registration/OTPInput';
import PasswordField from '../components/registration/PasswordField';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import PostalCodeInput from '../components/PostalCodeInput';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { detectCountryFromLocale, hasPostalCode, requiresPostalCode, hasRegions, getRegionLabel } from '../lib/countries';
import { listMyInvitations, acceptInvitation, declineInvitation } from '../api/businesses';
import { normalizeSignupRegion, validateSignup, SIGNUP_FIELD_KEYS } from '../utils/signupValidation';
import { COMMON_SIGNUP_PERSONAS, MORE_SIGNUP_PERSONAS, SIGNUP_INTENT_VALUES, signupPersonaForIntent, signupEntryForParams } from '../utils/signupPersonas';
import './JoinPage.css';

const DRAFT_KEY = 'oxsteed:join-draft:v1';

// G-3: an invitee who follows the team-invite email lands on /join with
// ?invite=<id>. After verification this panel surfaces the pending
// invitation (matched by id or invite email server-side) so joining works
// from the email + signup alone, with no Vortex code and no trip to
// BusinessHub. Invitations that are expired or already handled report
// that instead of a dead end.
function InvitationAcceptPanel({ inviteId }) {
  const { t } = useTranslation();
  const msg = (key, vars) => t(`signupUpgrade.${key}`, vars);
  const [state, setState] = useState({ status: 'loading', invitation: null });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    listMyInvitations()
      .then((invitations) => {
        if (cancelled) return;
        const found = (invitations || []).find((inv) => String(inv.id) === String(inviteId));
        setState(found ? { status: 'found', invitation: found } : { status: 'missing', invitation: null });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error', invitation: null }); });
    return () => { cancelled = true; };
  }, [inviteId]);
  const decide = async (action) => {
    if (busy || !state.invitation) return;
    setBusy(true);
    try {
      if (action === 'accept') await acceptInvitation(state.invitation.id);
      else await declineInvitation(state.invitation.id);
      setState({ status: action === 'accept' ? 'accepted' : 'declined', invitation: state.invitation });
    } catch {
      setState({ status: 'error', invitation: state.invitation });
    } finally {
      setBusy(false);
    }
  };
  if (state.status === 'loading') return <p role="status" className="signup-help">{msg('inviteLoading')}</p>;
  if (state.status === 'missing' || state.status === 'error') {
    return (
      <section className="signup-intent-confirmation" aria-labelledby="signup-invite-title">
        <h3 id="signup-invite-title">{msg('inviteTitle')}</h3>
        <p>{msg('inviteMissing')}</p>
        <Link className="signup-primary signup-primary-link" to="/settings/applications">{msg('viewNextStep')}</Link>
      </section>
    );
  }
  if (state.status === 'accepted') {
    return (
      <section className="signup-intent-confirmation" aria-labelledby="signup-invite-title">
        <h3 id="signup-invite-title">{msg('inviteTitle')}</h3>
        <p>{msg('inviteAccepted')}</p>
        <Link className="signup-primary signup-primary-link" to="/business-hub">{msg('inviteOpenWorkspace')}</Link>
      </section>
    );
  }
  if (state.status === 'declined') {
    return (
      <section className="signup-intent-confirmation" aria-labelledby="signup-invite-title">
        <h3 id="signup-invite-title">{msg('inviteTitle')}</h3>
        <p>{msg('inviteDeclined')}</p>
        <Link className="signup-primary signup-primary-link" to="/dashboard">{msg('continueToAccount')}</Link>
      </section>
    );
  }
  const inv = state.invitation;
  return (
    <section className="signup-intent-confirmation" aria-labelledby="signup-invite-title">
      <h3 id="signup-invite-title">{msg('inviteTitle')}</h3>
      <p>{msg('inviteFound', { business: inv.business_name || '', role: inv.role || '' })}</p>
      <div className="signup-invite-actions">
        <button type="button" className="signup-primary" disabled={busy} onClick={() => decide('accept')} data-track="ui.663f47c956.11">{msg('inviteAccept')}</button>
        <button type="button" className="signup-secondary" disabled={busy} onClick={() => decide('decline')} data-track="ui.663f47c956.12">{msg('inviteDecline')}</button>
      </div>
    </section>
  );
}
const ICONS = {
  customer: UserRound, helper: Users, business: Briefcase, team: Users, restaurant: Utensils,
  restaurantTeam: Store, logistics: Truck, consultant: GraduationCap, equipment: Wrench,
  franchise: Factory, investor: BarChart3, credit: Users, partner: Users,
  learning: GraduationCap, staff: ShieldCheck, device: Smartphone,
};
// Goals describe intent; every account is created as a customer. Supported
// deep links bypass discovery, while admission and access remain server-owned.
const SignupApplication = lazy(() => import('../components/registration/SignupApplication'));
const EMPTY = { firstName: '', lastName: '', email: '', phone: '', country: '', addressLine1: '',
  city: '', state: '', zipCode: '', signupIntent: 'find_help', ageConfirmed: false, termsAccepted: false, password: '' };
const METADATA_KEYS = ['registrationExpiresAt', 'otpExpiresAt', 'resendAvailableAt', 'lockoutUntil'];
function loadDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft || typeof draft !== 'object') return null;
    const form = {};
    Object.keys(EMPTY).filter(key => key !== 'password').forEach(key => {
      if (typeof draft.form?.[key] === typeof EMPTY[key]) form[key] = draft.form[key];
    });
    return { form, registrationToken: typeof draft.registrationToken === 'string' ? draft.registrationToken : '',
      otpSent: draft.otpSent === true, metadata: draft.metadata || {} };
  } catch { return null; }
}
function milliseconds(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function JoinPage({ embedded = false, embeddedSearch } = {}) {
  const { t } = useTranslation();
  const { user, setUser } = useAuth();
  const { loading: capabilitiesLoading } = useCapabilities();
  const navigate = useNavigate();
  const [pageParams] = useSearchParams();
  const params = embedded ? new URLSearchParams(embeddedSearch) : pageParams;
  // Carry only the referral identifier understood by the signup API. Other
  // query parameters (including forged approval-style flags) never become
  // signup authority or application state.
  const rawReferralRef = params.get('ref');
  const referralRef = rawReferralRef && /^[A-Za-z0-9_-]{1,50}$/.test(rawReferralRef)
    ? rawReferralRef
    : null;
  // G-3: team-invite email CTA (?invite=<id>). Only the invitation id is
  // carried; it grants nothing until the signed-in accept call matches it
  // to this account by member id or invite email.
  const { inviteId, intent: presetIntent } = signupEntryForParams(params);
  const [draft] = useState(loadDraft);
  const initialIntent = presetIntent || (SIGNUP_INTENT_VALUES.includes(draft?.form?.signupIntent) ? draft.form.signupIntent : 'find_help');
  const [form, setForm] = useState(() => ({ ...EMPTY, country: detectCountryFromLocale(), ...draft?.form, password: '', signupIntent: initialIntent }));
  const [choosingGoal, setChoosingGoal] = useState(!presetIntent);
  const [moreGoalsOpen, setMoreGoalsOpen] = useState(() => MORE_SIGNUP_PERSONAS.some(({ intent }) => intent === initialIntent));
  const [errors, setErrors] = useState({});
  const draftMatchesGoal = !presetIntent || draft?.form?.signupIntent === presetIntent;
  const [registrationToken, setRegistrationToken] = useState(draftMatchesGoal ? draft?.registrationToken || '' : '');
  const [otpSent, setOtpSent] = useState(Boolean(draftMatchesGoal && draft?.otpSent && draft?.registrationToken));
  const [continuation, setContinuation] = useState(null);
  const [metadata, setMetadata] = useState(draftMatchesGoal ? draft?.metadata || {} : {});
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [otpError, setOtpError] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
  // G-31: resume a signup started on another device. The typed draft is
  // already server-side (pending_registrations); the emailed OTP code is
  // the proof that unlocks it here. The password is never restored.
  const [showResume, setShowResume] = useState(false);
  const [resumeEmail, setResumeEmail] = useState('');
  const [resumeCode, setResumeCode] = useState('');
  const [resumeError, setResumeError] = useState('');
  const [resumeBusy, setResumeBusy] = useState(false);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(Date.now);
  const operation = useRef(false);
  const completed = useRef(false);
  const formRef = useRef(null);

  const msg = key => t(`signupUpgrade.${key}`);
  const Layout = embedded ? 'div' : 'main';
  useEffect(() => {
    if (completed.current) return;
    try {
      const { password: omitted, ...safeForm } = form;
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ form: safeForm, registrationToken, otpSent, metadata }));
    } catch { /* Tab-scoped recovery is optional when storage is unavailable. */ }
  }, [form, registrationToken, otpSent, metadata]);
  useEffect(() => {
    if (user?.email_verified && !inviteId && (!completed.current || (continuation && !isCurrentAuthEpoch(continuation.epoch)))) {
      // WP-104: every account lands in the customer workspace; the intent
      // application (if any) is handled by the continuation panel, not by a
      // mode-specific landing route.
      navigate('/dashboard', { replace: true });
    }
  }, [user, navigate, continuation, inviteId]);
  useEffect(() => {
    if (!registrationToken) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [registrationToken]);

  const lockedUntil = milliseconds(metadata.lockoutUntil);
  const isLocked = lockedUntil > now;
  const resendAt = milliseconds(metadata.resendAvailableAt);
  const waitSeconds = Math.max(0, Math.ceil((Math.max(resendAt, lockedUntil) - now) / 1000));
  const registrationExpired = expired || Boolean(milliseconds(metadata.registrationExpiresAt) && milliseconds(metadata.registrationExpiresAt) <= now);
  const otpExpired = Boolean(milliseconds(metadata.otpExpiresAt) && milliseconds(metadata.otpExpiresAt) <= now);
  const focusField = field => {
    const control = formRef.current?.querySelector('[id="' + field + '"]');
    control?.focus();
    control?.scrollIntoView({ block: 'center', behavior: 'auto' });
  };
  const focusErrors = fields => requestAnimationFrame(() => focusField(Object.keys(fields)[0]));
  const set = useCallback((field, value) => {
    setForm(previous => ({ ...previous, [field]: value }));
    setErrors(previous => ({ ...previous, [field]: undefined, general: undefined }));
    // A pending registration belongs to the submitted details, not later edits.
    setRegistrationToken('');
    setMetadata({});
    setExpired(false);
    setNotice('');
  }, []);

  const mergeMetadata = data => {
    const values = {};
    for (const key of METADATA_KEYS) if (data?.[key]) values[key] = data[key];
    if (data?.retryAfterMs && data.code === 'resend_cooldown' && !values.resendAvailableAt) {
      values.resendAvailableAt = new Date(Date.now() + data.retryAfterMs).toISOString();
    }
    setMetadata(previous => ({ ...previous, ...values }));
    setNow(Date.now());
  };
  const recoveryMessage = (error, { registrationAttempt = false } = {}) => {
    const data = error?.response?.data || {};
    mergeMetadata(data);
    if (data.code === 'email_already_registered' || error?.response?.status === 409) {
      // The server recognised a signed decoy token: this email already has
      // an account. Point at sign-in instead of the expired-registration
      // dead end. The submit path also maps 409 to the email field directly.
      return msg('emailTaken');
    }
    // Only the server's own registration_expired code means the registration
    // expired. A bare 404 (for example a proxy 404 while the server is
    // restarting mid-deploy) is not an expired registration and must not be
    // reported as one; it falls through to the generic request failure.
    if (data.code === 'registration_expired') {
      // A stale tab or a transient expiry can happen before the OTP screen is
      // shown. Clear only the server token so the same form can immediately
      // start a fresh registration instead of leaving the user without a code
      // field or a path forward.
      if (registrationAttempt) {
        setRegistrationToken('');
        setOtpSent(false);
        setOtpDigits(Array(6).fill(''));
        setMetadata({});
        setExpired(false);
      } else {
        setExpired(true);
        setMetadata(previous => ({ ...previous, registrationExpiresAt: new Date().toISOString() }));
      }
      return msg('registrationExpired');
    }
    if (data.code === 'otp_locked' || /locked|too many/i.test(data.error || '')) {
      if (!data.lockoutUntil) setMetadata(previous => ({ ...previous, lockoutUntil: new Date(Date.now() + (data.retryAfterMs || 3600000)).toISOString() }));
      return msg('locked');
    }
    if (data.code === 'resend_cooldown' || error?.response?.status === 429) {
      if (!data.retryAfterMs && !data.resendAvailableAt) setMetadata(previous => ({ ...previous, resendAvailableAt: new Date(Date.now() + 60000).toISOString() }));
      return msg('cooldown');
    }
    if (data.code === 'otp_expired') return msg('otpExpired');
    if (data.code === 'otp_invalid' || /invalid.*otp|invalid.*code/i.test(data.error || '')) return msg('invalidCode');
    return msg(error?.response ? 'requestFailed' : 'networkError');
  };
  const handleSubmit = async event => {
    event.preventDefault();
    if (operation.current || capabilitiesLoading) return;
    // A draft-restored token whose 30-minute window already passed can never
    // verify. Drop it and start a fresh registration below instead of
    // failing every submit with the same expired-token error.
    let staleToken = false;
    if (registrationExpired && registrationToken) {
      setRegistrationToken('');
      setMetadata({});
      setExpired(false);
      staleToken = true;
    }
    const invalid = validateSignup(form, SIGNUP_INTENT_VALUES);
    if (Object.keys(invalid).length) {
      setErrors(Object.fromEntries(Object.entries(invalid).map(([field, key]) => [field, msg(key)])));
      focusErrors(invalid); return;
    }
    operation.current = true; setBusy('submit'); setErrors({}); setNotice('');
    try {
      let token = staleToken ? '' : registrationToken;
      if (!token) {
        const { data } = await api.post('/auth/register/start', {
          email: form.email.trim().toLowerCase(), password: form.password, firstName: form.firstName.trim(),
          lastName: form.lastName.trim(), phone: form.phone.trim(), country: form.country,
          addressLine1: form.addressLine1.trim(), city: form.city.trim(), state: normalizeSignupRegion(form.country, form.state),
          zip: form.zipCode.trim(), ageConfirmed: form.ageConfirmed,
          // Interest is not authority. The server creates the customer
          // account first and turns this into an application on the progressive
          // path. Keep the wire field stable for older clients as well.
          signupIntent: form.signupIntent,
          ...(referralRef ? { ref: referralRef } : {}),
        });
        if (!data?.token) throw new Error('Missing registration response');
        token = data.token; setRegistrationToken(token); mergeMetadata(data);
      }
      const { data } = await api.post('/auth/register/accept-terms', {
        token, email: form.email.trim().toLowerCase(), termsAccepted: form.termsAccepted, privacyAccepted: form.termsAccepted, brokerAccepted: true,
        electronicSignature: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), date: new Date().toISOString() },
      });
      mergeMetadata(data);
      if (!data?.resendAvailableAt) setMetadata(previous => ({ ...previous, resendAvailableAt: new Date(Date.now() + 60000).toISOString() }));
      setOtpSent(true); setOtpError(''); setNotice(msg('codeSent'));
    } catch (error) {
      const data = error?.response?.data || {};
      if (error?.response?.status === 409) {
        setErrors({ email: msg('emailTaken') }); focusErrors({ email: true });
      } else if (data.fields && typeof data.fields === 'object') {
        const mapped = {};
        for (const wire of Object.keys(data.fields)) {
          const field = wire === 'zip' ? 'zipCode' : wire === 'default_mode' || wire === 'signup_intent' ? 'signupIntent' : wire === 'address_line1' ? 'addressLine1' : wire;
          if (SIGNUP_FIELD_KEYS[field]) mapped[field] = msg(SIGNUP_FIELD_KEYS[field]);
        }
        setErrors(Object.keys(mapped).length ? mapped : { general: msg('requestFailed') });
        if (Object.keys(mapped).length) focusErrors(mapped);
      } else setErrors({ general: recoveryMessage(error, { registrationAttempt: true }) });
    } finally { operation.current = false; setBusy(''); }
  };
  const handleOtpComplete = async code => {
    if (operation.current || registrationExpired || lockedUntil > Date.now()) return;
    operation.current = true; setBusy('verify'); setOtpError(''); setNotice('');
    try {
      const { data } = await api.post('/auth/register/verify-otp', { token: registrationToken, otp: code, email: form.email.trim().toLowerCase() });
      if (!data?.user) throw new Error('Missing verification response');
      persistSessionPayload(data); completed.current = true;
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
      setUser(data.user);
      // Progressive access (WP-001..003): with customer-first signup the server
      // returns access.nextStep; an owner/helper intent continues as an
      // application on the customer account instead of a role switch.
      if (inviteId) {
        setContinuation({ step: { type: 'invitation' }, accountId: data.user.id, epoch: currentAuthEpoch() });
        return;
      }
      const nextStep = data.access?.nextStep;
      if (nextStep?.type === 'application') {
        setContinuation({ step: nextStep, accountId: data.user.id, epoch: currentAuthEpoch() });
        return;
      }
      if (nextStep?.type === 'none' && nextStep.intent && nextStep.intent !== 'find_help') {
        setContinuation({ step: nextStep, accountId: data.user.id, epoch: currentAuthEpoch() });
        return;
      }
      navigate('/dashboard', { replace: true });
    } catch (error) { setOtpError(recoveryMessage(error)); setOtpDigits(Array(6).fill('')); }
    finally { operation.current = false; setBusy(''); }
  };
  const handleResend = async () => {
    if (operation.current || registrationExpired || waitSeconds > 0) return;
    operation.current = true; setBusy('resend'); setOtpError(''); setNotice('');
    try {
      const { data } = await api.post('/auth/register/resend-otp', { token: registrationToken, email: form.email.trim().toLowerCase() });
      mergeMetadata(data);
      if (!data?.resendAvailableAt) setMetadata(previous => ({ ...previous, resendAvailableAt: new Date(Date.now() + 60000).toISOString() }));
      setOtpDigits(Array(6).fill('')); setNotice(msg('codeSent'));
    } catch (error) { setOtpError(recoveryMessage(error)); }
    finally { operation.current = false; setBusy(''); }
  };
  const handleResume = async (event) => {
    event.preventDefault();
    if (resumeBusy) return;
    setResumeBusy(true);
    setResumeError('');
    try {
      const { data } = await api.post('/auth/register/resume', {
        email: resumeEmail.trim().toLowerCase(),
        otp: resumeCode.trim(),
      });
      if (!data?.token || !data?.draft) throw new Error('Missing resume response');
      // Restore typed fields only; the password is never restored from a
      // draft and the code itself is not consumed, so the OTP screen below
      // still verifies with the same code.
      setForm((previous) => ({ ...previous, ...data.draft, password: '' }));
      setRegistrationToken(data.token);
      mergeMetadata(data);
      setOtpSent(true);
      setOtpDigits(Array(6).fill(''));
      setShowResume(false);
      setNotice(msg('resumeRestored'));
    } catch (error) {
      const code = error?.response?.data?.code;
      setResumeError(code === 'otp_locked' ? msg('locked') : msg('resumeFailed'));
    } finally {
      setResumeBusy(false);
    }
  };
  const editDetails = () => {
    if (operation.current) return;
    setOtpSent(false); setOtpDigits(Array(6).fill('')); setOtpError(''); setErrors({}); setNotice('');
    setRegistrationToken(''); setMetadata({}); setExpired(false);
    // Ordinary edits retain in-memory input. Expiry requires fresh credentials
    // and consent; neither password nor OTP is ever restored from a draft.
    if (registrationExpired) setForm(previous => ({ ...previous, password: '', ageConfirmed: false }));
    requestAnimationFrame(() => formRef.current?.querySelector('#firstName')?.focus());
  };
  const aria = field => ({ 'aria-invalid': Boolean(errors[field]) || undefined,
    'aria-describedby': errors[field] ? 'error-' + field : undefined });
  const fieldError = field => errors[field] ? <p id={'error-' + field} className="signup-field-error">{errors[field]}</p> : null;
  const input = (field, label, type = 'text', maxLength = 100, autoComplete) => <div className="signup-field">
    <label htmlFor={field}>{label}</label><input id={field} name={field} type={type} value={form[field]}
      onChange={event => set(field, event.target.value)} maxLength={maxLength} autoComplete={autoComplete}
      className="signup-input" required {...aria(field)} />{fieldError(field)}
  </div>;
  const personaCard = (persona) => {
    const Icon = ICONS[persona.icon] || UserRound;
    return <label className={'signup-mode-card' + (form.signupIntent === persona.intent ? ' selected' : '')} key={persona.intent}>
      <input type="radio" id={persona.intent === 'find_help' ? 'signupIntent' : 'intent-' + persona.intent} name="signupIntent" value={persona.intent}
        checked={form.signupIntent === persona.intent} onChange={() => set('signupIntent', persona.intent)}
        aria-describedby="signup-mode-help" aria-invalid={Boolean(errors.signupIntent) || undefined} data-track="ui.663f47c956.4" />
      <Icon size={27} aria-hidden="true" /><strong>{msg(`personas.${persona.copy}.title`)}</strong>
      <span className="signup-mode-description">{msg(`personas.${persona.copy}.description`)}</span>
      {form.signupIntent === persona.intent && <Check className="signup-mode-check" size={16} aria-hidden="true" />}
    </label>;
  };
  const entries = Object.entries(errors).filter(([, value]) => value);
  return <div className={'signup-page' + (embedded ? ' signup-embedded media-auth-content' : '')}>
    {!embedded && <><PageMeta title={msg('title')} description={msg('intro')} url="https://oxsteed.com/join" />
      <AuthNavbar links={[{ to: '/how-it-works', label: t('nav.howItWorks'), hideOnSmall: true }]}
        cta={continuation ? null : { to: '/login', label: t('nav.signIn') }} /></>}
    <Layout className="signup-layout">
      {!embedded && <aside className="signup-intro">
        <h1>{msg('headline')} <span>{msg('headlineAccent')}</span></h1>
        <p className="signup-intro-copy">{msg('intro')}</p>
        <p className="signup-mobile-intro">{msg('mobileIntro')}</p>
        <div className="signup-benefits">{[[Users, 'benefitHelp', 'benefitHelpText'], [UserRound, 'benefitSkills', 'benefitSkillsText'],
          [Briefcase, 'benefitBusiness', 'benefitBusinessText']].map(([Icon, title, description]) => <div className="signup-benefit" key={title}>
          <span><Icon size={26} aria-hidden="true" /></span><div><h2>{msg(title)}</h2><p>{msg(description)}</p></div>
        </div>)}</div>
      </aside>}
      <section className="signup-card" aria-labelledby={embedded ? 'media-link-title' : 'signup-title'}>
        <header className="signup-card-header">
          {!embedded && <h2 id="signup-title">{msg('title')}</h2>}
          <p>{msg('subtitle')}</p>
        </header>
        {continuation && isCurrentAuthEpoch(continuation.epoch) && continuation.step?.type === 'application' && (
          <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
            <SignupApplication continuation={continuation} serviceArea={{
              country: form.country, region: normalizeSignupRegion(form.country, form.state),
              city: form.city, postalCode: form.zipCode,
            }} />
          </Suspense>
        )}
        {continuation && isCurrentAuthEpoch(continuation.epoch) && continuation.step?.type === 'none' && (
          <section className="signup-intent-confirmation" aria-labelledby="signup-intent-confirmation-title">
            <h3 id="signup-intent-confirmation-title">{msg('intentConfirmed')}</h3>
            <p>{msg(`admission.${continuation.step.kind}`)}</p>
            <p className="signup-help">{msg('intentConfirmationNote')}</p>
            <Link className="signup-primary signup-primary-link" to={continuation.step.statusPath || '/dashboard'}>{msg('viewNextStep')}</Link>
          </section>
        )}
        {inviteId && (user?.email_verified || (continuation && isCurrentAuthEpoch(continuation.epoch))) && (
          <InvitationAcceptPanel key={`${user?.id || continuation?.accountId}:${currentAuthEpoch()}:${inviteId}`} inviteId={inviteId} />
        )}
        {!continuation && !user?.email_verified && (!otpSent ? <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={busy === 'submit'} data-track="ui.663f47c956.1" data-track-private>
          {entries.length > 0 && <div className="signup-error-summary" role="alert"><p>{msg('errorSummary')}</p><ul>{entries.map(([field, value]) => <li key={field}>
            {field === 'general' ? value : <button type="button" onClick={() => focusField(field)} data-track="ui.663f47c956.2">{value}</button>}
          </li>)}</ul>{errors.email === msg('emailTaken') && <Link to="/login">{t('nav.signIn')}</Link>}</div>}
          {registrationExpired && <button type="button" className="signup-secondary" onClick={editDetails} data-track="ui.663f47c956.3">{msg('restart')}</button>}
          {!capabilitiesLoading && <fieldset disabled={Boolean(busy)} className="signup-section signup-mode-section"><legend>{msg('modePrompt')}</legend>
            <p className="signup-help">{msg('intentNote')}</p>
            {(!choosingGoal || inviteId) ? <div className="signup-selected-goal">
              <strong>{msg(inviteId ? 'invitedGoal' : `personas.${signupPersonaForIntent(form.signupIntent).copy}.title`)}</strong>
              <p className="signup-help">{msg(inviteId ? 'invitedGoalHelp' : `personas.${signupPersonaForIntent(form.signupIntent).copy}.description`)}</p>
              {!inviteId && <button type="button" id="signupIntent" className="signup-text-button"
                onClick={() => { setMoreGoalsOpen(MORE_SIGNUP_PERSONAS.some(({ intent }) => intent === form.signupIntent)); setChoosingGoal(true);
                  requestAnimationFrame(() => formRef.current?.querySelector(`input[value="${form.signupIntent}"]`)?.focus()); }}>{msg('changeGoal')}</button>}
            </div> : <div id="signup-goal-choices">
              <div className="signup-mode-grid signup-common-goals">{COMMON_SIGNUP_PERSONAS.map(personaCard)}</div>
              <details className="signup-more-goals" open={moreGoalsOpen} onToggle={event => setMoreGoalsOpen(event.currentTarget.open)}>
                <summary>{msg('moreWays')}</summary>
                <div className="signup-mode-grid">{MORE_SIGNUP_PERSONAS.map(personaCard)}</div>
              </details>
            </div>}
            {(() => { const selected = signupPersonaForIntent(form.signupIntent); return <p id="signup-mode-help" aria-live="polite" className="signup-help signup-admission-help">{msg(`admission.${selected.admission}`)}</p>; })()}
            {fieldError('signupIntent')}
          </fieldset>}
          <fieldset disabled={Boolean(busy)} className="signup-section"><legend>{msg('personalTitle')}</legend>
            <p className="signup-help">{msg('contactHelp')} <Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</Link></p>
            <div className="signup-pair">{input('firstName', t('register.firstName'), 'text', 100, 'given-name')}{input('lastName', t('register.lastName'), 'text', 100, 'family-name')}</div>
            <div className="signup-pair">{input('email', t('register.emailAddress'), 'email', 254, 'email')}{input('phone', t('register.phone'), 'tel', 20, 'tel')}</div>
          </fieldset>
          <fieldset disabled={Boolean(busy)} className="signup-section"><legend>{msg('addressTitle')}</legend><p className="signup-help">{msg('locationHelp')}</p>
            <div className="signup-field"><label htmlFor="country">{t('register.country')}</label><CountrySelect id="country" value={form.country}
              onChange={value => { set('country', value); set('state', ''); set('zipCode', ''); }}
              className="signup-input" required {...aria('country')} />{fieldError('country')}</div>
            <div className="signup-field"><label htmlFor="addressLine1">{t('register.streetAddress')}</label><AddressAutocomplete
              id="addressLine1" name="addressLine1" value={form.addressLine1} onChange={value => set('addressLine1', value)}
              onSelect={place => { setForm(previous => ({ ...previous, addressLine1: place.addressLine1 || place.display,
                city: place.city || previous.city, state: place.state || previous.state, zipCode: place.zip || previous.zipCode,
                country: place.country || previous.country })); setRegistrationToken(''); setMetadata({}); setErrors({}); }}
              inputClassName="signup-input signup-address-input" ariaLabel={t('register.streetAddress')} required maxLength={255}
              ariaInvalid={Boolean(errors.addressLine1)} ariaDescribedBy={errors.addressLine1 ? 'error-addressLine1' : undefined}
              leading={<MapPin size={18} aria-hidden="true" />} />{fieldError('addressLine1')}</div>
            <div className="signup-pair">{input('city', t('register.city'), 'text', 100, 'address-level2')}
              <div className="signup-field"><label htmlFor="state">{hasRegions(form.country) ? msg(getRegionLabel(form.country).toLowerCase() + 'Label') : msg('optionalRegion')}</label>
                <RegionInput id="state" country={form.country} value={form.state} onChange={value => set('state', value)}
                  placeholder={hasRegions(form.country) ? msg(getRegionLabel(form.country).toLowerCase() + 'Label') : msg('optionalRegion')}
                  required={hasRegions(form.country)} maxLength={100} className="signup-input" {...aria('state')} />{fieldError('state')}</div>
            </div>
            {hasPostalCode(form.country) && <div className="signup-field"><label htmlFor="zipCode">{msg(!requiresPostalCode(form.country) ? 'optionalPostal' : form.country === 'US' ? 'zipLabel' : 'postalLabel')}</label>
              <PostalCodeInput id="zipCode" country={form.country} value={form.zipCode} onChange={value => set('zipCode', value)}
                required={requiresPostalCode(form.country)} maxLength={20} className="signup-input" {...aria('zipCode')} />{fieldError('zipCode')}</div>}
          </fieldset>
          <fieldset disabled={Boolean(busy)} className="signup-section"><legend>{msg('securityTitle')}</legend>
            <PasswordField value={form.password} onChange={value => set('password', value)} error={errors.password}
              signupPolicy inputClassName="signup-input signup-password-input" labelClassName="signup-label" />
            <label className="signup-consent" htmlFor="ageConfirmed"><input id="ageConfirmed" type="checkbox" checked={form.ageConfirmed}
              onChange={event => set('ageConfirmed', event.target.checked)} {...aria('ageConfirmed')} data-track="ui.663f47c956.5" /><span>{msg('ageLabel')}</span></label>{fieldError('ageConfirmed')}
            <label className="signup-consent" htmlFor="termsAccepted"><input id="termsAccepted" type="checkbox" checked={form.termsAccepted}
              onChange={event => set('termsAccepted', event.target.checked)} {...aria('termsAccepted')} data-track="ui.663f47c956.6" />
              <span>{msg('agreePrefix')} <Link to="/terms" target="_blank" rel="noopener noreferrer">{t('footer.terms')}</Link>
                {' '}{msg('and')}{' '}<Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</Link>.</span>
            </label>{fieldError('termsAccepted')}
          </fieldset>
          <button type="submit" className="signup-primary" disabled={capabilitiesLoading || Boolean(busy) || (Boolean(registrationToken) && waitSeconds > 0) || registrationExpired} data-track="ui.663f47c956.7">
            {busy === 'submit' ? msg('submitting') : waitSeconds > 0 && registrationToken ? t('signupUpgrade.resendWait', { seconds: waitSeconds }) : t('join.submit')}
            {!busy && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form> : <section className="signup-verification" aria-busy={Boolean(busy)} aria-labelledby="signup-otp-title">
          <h3 id="signup-otp-title">{t('join.otpTitle')}</h3><p id="signup-otp-help">{t('join.otpHint', { email: form.email })}</p>
          {(otpError || registrationExpired || otpExpired || isLocked) && <p id="signup-otp-error" className="signup-error-summary" role="alert">
            {registrationExpired ? msg('registrationExpired') : isLocked ? msg('locked') : otpError || msg('otpExpired')}</p>}
          <OTPInput value={otpDigits} onChange={setOtpDigits} onComplete={handleOtpComplete}
            disabled={Boolean(busy) || registrationExpired || isLocked}
            className="signup-input signup-otp-input" describedBy={'signup-otp-help' + (otpError || registrationExpired || otpExpired || isLocked ? ' signup-otp-error' : '')}
            invalid={Boolean(otpError || registrationExpired || otpExpired || isLocked)} />
          {notice && <p className="signup-notice" role="status">{notice}</p>}
          {busy && <p role="status">{msg(busy === 'verify' ? 'verifying' : 'sending')}</p>}
          {registrationExpired ? <button type="button" className="signup-primary" onClick={editDetails} disabled={Boolean(busy)} data-track="ui.663f47c956.8">{msg('restart')}</button>
            : <><button type="button" className="signup-secondary" onClick={handleResend} disabled={Boolean(busy) || waitSeconds > 0} data-track="ui.663f47c956.9">
              {waitSeconds > 0 ? t('signupUpgrade.resendWait', { seconds: waitSeconds }) : t('join.resend')}</button>
              <button type="button" className="signup-text-button" onClick={editDetails} disabled={Boolean(busy)} data-track="ui.663f47c956.10">{t('join.editDetails')}</button></>}
        </section>)}
        {!continuation && <p className="signup-signin">{msg('alreadyMember')} <Link to="/login">{t('nav.signIn')}</Link></p>}
        {!continuation && !otpSent && (
          <section className="signup-resume" aria-labelledby="signup-resume-title">
            <button type="button" className="signup-text-button" onClick={() => setShowResume((v) => !v)} data-track="ui.663f47c956.13">
              {msg('resumeTitle')}
            </button>
            {showResume && (
              <form onSubmit={handleResume} noValidate data-track="ui.663f47c956.15">
                <p className="signup-help">{msg('resumeHelp')}</p>
                <div className="signup-field">
                  <label htmlFor="resumeEmail">{t('register.emailAddress')}</label>
                  <input id="resumeEmail" name="resumeEmail" type="email" value={resumeEmail} onChange={(event) => setResumeEmail(event.target.value)} className="signup-input" required autoComplete="email" />
                </div>
                <div className="signup-field">
                  <label htmlFor="resumeCode">{msg('resumeCode')}</label>
                  <input id="resumeCode" name="resumeCode" type="text" inputMode="numeric" value={resumeCode} onChange={(event) => setResumeCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))} className="signup-input" required autoComplete="one-time-code" />
                </div>
                {resumeError && <p className="signup-field-error" role="alert">{resumeError}</p>}
                <button type="submit" className="signup-secondary" disabled={resumeBusy || resumeCode.length !== 6 || !resumeEmail.includes('@')} data-track="ui.663f47c956.14">
                  {resumeBusy ? msg('verifying') : msg('resumeSubmit')}
                </button>
              </form>
            )}
          </section>
        )}
      </section>
    </Layout>
    {!embedded && <Footer />}
  </div>;
}
