import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, Users, Briefcase, Check, ArrowRight, MapPin } from 'lucide-react';
import api from '../api/axios';
import { persistSessionPayload } from '../api/auth';
import Footer from '../components/Footer';
import AuthNavbar from '../components/AuthNavbar';
import PageMeta from '../components/PageMeta';
import { useAuth } from '../context/AuthContext';
import OTPInput from '../components/registration/OTPInput';
import PasswordField from '../components/registration/PasswordField';
import CountrySelect from '../components/CountrySelect';
import RegionInput from '../components/RegionInput';
import PostalCodeInput from '../components/PostalCodeInput';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { detectCountryFromLocale, hasPostalCode, requiresPostalCode, hasRegions, getRegionLabel } from '../lib/countries';
import { MODE_CATALOG, postSignupRouteForMode } from '../utils/modeRouter';
import { LAUNCH_SELF_SELECTABLE_MODES } from '../utils/launchScope';
import { normalizeSignupRegion, validateSignup, SIGNUP_FIELD_KEYS } from '../utils/signupValidation';
import './JoinPage.css';

const DRAFT_KEY = 'oxsteed:join-draft:v1';
const MODES = LAUNCH_SELF_SELECTABLE_MODES;
const ICONS = { customer: UserRound, helper: Users, business_owner: Briefcase };
const EMPTY = { firstName: '', lastName: '', email: '', phone: '', country: '', addressLine1: '',
  city: '', state: '', zipCode: '', defaultMode: 'customer', ageConfirmed: false, termsAccepted: false, password: '' };
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
  const navigate = useNavigate();
  const [pageParams] = useSearchParams();
  const params = embedded ? new URLSearchParams(embeddedSearch) : pageParams;
  const presetMode = params.get('mode');
  const referralRef = params.get('ref');
  const [draft] = useState(loadDraft);
  const [form, setForm] = useState(() => ({ ...EMPTY, country: detectCountryFromLocale(), ...draft?.form, password: '',
    defaultMode: MODES.includes(presetMode) ? presetMode : MODES.includes(draft?.form?.defaultMode) ? draft.form.defaultMode : 'customer' }));
  const [errors, setErrors] = useState({});
  const [registrationToken, setRegistrationToken] = useState(draft?.registrationToken || '');
  const [otpSent, setOtpSent] = useState(Boolean(draft?.otpSent && draft?.registrationToken));
  const [metadata, setMetadata] = useState(draft?.metadata || {});
  const [otpDigits, setOtpDigits] = useState(Array(6).fill(''));
  const [otpError, setOtpError] = useState('');
  const [notice, setNotice] = useState('');
  const [expired, setExpired] = useState(false);
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
    if (user?.email_verified && !completed.current) navigate(postSignupRouteForMode(user.default_mode || 'customer'), { replace: true });
  }, [user, navigate]);
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
  const recoveryMessage = error => {
    const data = error?.response?.data || {};
    mergeMetadata(data);
    if (data.code === 'registration_expired' || error?.response?.status === 404) {
      setExpired(true);
      setMetadata(previous => ({ ...previous, registrationExpiresAt: new Date().toISOString() }));
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
    if (operation.current) return;
    if (registrationExpired && registrationToken) { setErrors({ general: msg('registrationExpired') }); return; }
    const invalid = validateSignup(form, MODES);
    if (Object.keys(invalid).length) {
      setErrors(Object.fromEntries(Object.entries(invalid).map(([field, key]) => [field, msg(key)])));
      focusErrors(invalid); return;
    }
    operation.current = true; setBusy('submit'); setErrors({}); setNotice('');
    try {
      let token = registrationToken;
      if (!token) {
        const { data } = await api.post('/auth/register/start', {
          email: form.email.trim().toLowerCase(), password: form.password, firstName: form.firstName.trim(),
          lastName: form.lastName.trim(), phone: form.phone.trim(), country: form.country,
          addressLine1: form.addressLine1.trim(), city: form.city.trim(), state: normalizeSignupRegion(form.country, form.state),
          zip: form.zipCode.trim(), ageConfirmed: form.ageConfirmed, defaultMode: form.defaultMode,
          ...(referralRef ? { ref: referralRef } : {}),
        });
        if (!data?.token) throw new Error('Missing registration response');
        token = data.token; setRegistrationToken(token); mergeMetadata(data);
      }
      const { data } = await api.post('/auth/register/accept-terms', {
        token, termsAccepted: form.termsAccepted, privacyAccepted: form.termsAccepted, brokerAccepted: true,
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
          const field = wire === 'zip' ? 'zipCode' : wire === 'default_mode' ? 'defaultMode' : wire === 'address_line1' ? 'addressLine1' : wire;
          if (SIGNUP_FIELD_KEYS[field]) mapped[field] = msg(SIGNUP_FIELD_KEYS[field]);
        }
        setErrors(Object.keys(mapped).length ? mapped : { general: msg('requestFailed') });
        if (Object.keys(mapped).length) focusErrors(mapped);
      } else setErrors({ general: recoveryMessage(error) });
    } finally { operation.current = false; setBusy(''); }
  };
  const handleOtpComplete = async code => {
    if (operation.current || registrationExpired || lockedUntil > Date.now()) return;
    operation.current = true; setBusy('verify'); setOtpError(''); setNotice('');
    try {
      const { data } = await api.post('/auth/register/verify-otp', { token: registrationToken, otp: code });
      if (!data?.user) throw new Error('Missing verification response');
      persistSessionPayload(data); completed.current = true;
      try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* storage unavailable */ }
      setUser(data.user);
      navigate(postSignupRouteForMode(data.user.default_mode || form.defaultMode), { replace: true });
    } catch (error) { setOtpError(recoveryMessage(error)); setOtpDigits(Array(6).fill('')); }
    finally { operation.current = false; setBusy(''); }
  };
  const handleResend = async () => {
    if (operation.current || registrationExpired || waitSeconds > 0) return;
    operation.current = true; setBusy('resend'); setOtpError(''); setNotice('');
    try {
      const { data } = await api.post('/auth/register/resend-otp', { token: registrationToken });
      mergeMetadata(data);
      if (!data?.resendAvailableAt) setMetadata(previous => ({ ...previous, resendAvailableAt: new Date(Date.now() + 60000).toISOString() }));
      setOtpDigits(Array(6).fill('')); setNotice(msg('codeSent'));
    } catch (error) { setOtpError(recoveryMessage(error)); }
    finally { operation.current = false; setBusy(''); }
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
  const entries = Object.entries(errors).filter(([, value]) => value);
  return <div className={'signup-page' + (embedded ? ' signup-embedded media-auth-content' : '')}>
    {!embedded && <><PageMeta title={msg('title')} description={msg('intro')} url="https://oxsteed.com/join" />
      <AuthNavbar links={[{ to: '/how-it-works', label: t('nav.howItWorks'), hideOnSmall: true }]} cta={{ to: '/login', label: t('nav.signIn') }} /></>}
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
        {!otpSent ? <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={busy === 'submit'}>
          {entries.length > 0 && <div className="signup-error-summary" role="alert"><p>{msg('errorSummary')}</p><ul>{entries.map(([field, value]) => <li key={field}>
            {field === 'general' ? value : <button type="button" onClick={() => focusField(field)}>{value}</button>}
          </li>)}</ul>{errors.email === msg('emailTaken') && <Link to="/login">{t('nav.signIn')}</Link>}</div>}
          {registrationExpired && <button type="button" className="signup-secondary" onClick={editDetails}>{msg('restart')}</button>}
          <fieldset disabled={Boolean(busy)} className="signup-section signup-mode-section"><legend>{msg('modePrompt')}</legend>
            <div className="signup-mode-grid">{MODES.map((mode, index) => {
              const Icon = ICONS[mode] || UserRound;
              return <label className={'signup-mode-card' + (form.defaultMode === mode ? ' selected' : '')} key={mode}>
                <input type="radio" id={index === 0 ? 'defaultMode' : 'mode-' + mode} name="defaultMode" value={mode}
                  checked={form.defaultMode === mode} onChange={() => set('defaultMode', mode)}
                  aria-describedby="signup-mode-help" aria-invalid={Boolean(errors.defaultMode) || undefined} />
                <Icon size={27} aria-hidden="true" /><strong>{t(MODE_CATALOG[mode].labelKey)}</strong>
                <span className="signup-mode-description">{t(MODE_CATALOG[mode].hintKey)}</span>
                {form.defaultMode === mode && <Check className="signup-mode-check" size={16} aria-hidden="true" />}
              </label>;
            })}</div>
            <p id="signup-mode-help" className="signup-help">{msg('switcherNote')} <span>{msg('setupNote')}</span></p>{fieldError('defaultMode')}
          </fieldset>
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
              onChange={event => set('ageConfirmed', event.target.checked)} {...aria('ageConfirmed')} /><span>{msg('ageLabel')}</span></label>{fieldError('ageConfirmed')}
            <label className="signup-consent" htmlFor="termsAccepted"><input id="termsAccepted" type="checkbox" checked={form.termsAccepted}
              onChange={event => set('termsAccepted', event.target.checked)} {...aria('termsAccepted')} />
              <span>{msg('agreePrefix')} <Link to="/terms" target="_blank" rel="noopener noreferrer">{t('footer.terms')}</Link>
                {' '}{msg('and')}{' '}<Link to="/privacy" target="_blank" rel="noopener noreferrer">{t('footer.privacy')}</Link>.</span>
            </label>{fieldError('termsAccepted')}
          </fieldset>
          <button type="submit" className="signup-primary" disabled={Boolean(busy) || (Boolean(registrationToken) && waitSeconds > 0) || registrationExpired}>
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
          {registrationExpired ? <button type="button" className="signup-primary" onClick={editDetails} disabled={Boolean(busy)}>{msg('restart')}</button>
            : <><button type="button" className="signup-secondary" onClick={handleResend} disabled={Boolean(busy) || waitSeconds > 0}>
              {waitSeconds > 0 ? t('signupUpgrade.resendWait', { seconds: waitSeconds }) : t('join.resend')}</button>
              <button type="button" className="signup-text-button" onClick={editDetails} disabled={Boolean(busy)}>{t('join.editDetails')}</button></>}
        </section>}
        <p className="signup-signin">{msg('alreadyMember')} <Link to="/login">{t('nav.signIn')}</Link></p>
      </section>
    </Layout>
    {!embedded && <Footer />}
  </div>;
}
