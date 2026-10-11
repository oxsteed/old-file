import { ALL_COUNTRIES, getRegionsFor, requiresPostalCode, hasRegions, isValidPostal } from '../lib/countries';

// Mirrored by server/utils/signupValidation.js; regression tests assert parity.
export function isSignupPasswordValid(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) return false;
  return [/[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(rule => rule.test(value)).length >= 2;
}

export function isSignupPhoneValid(value, country) {
  const compact = String(value || '').trim().replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(compact) || String(value || '').trim().length > 20) return false;
  const digits = compact.replace(/^\+/, '').length;
  return country === 'US' ? digits === 10 || digits === 11 : digits >= 7 && digits <= 15;
}

export function normalizeSignupRegion(country, value) {
  const regions = getRegionsFor(country);
  const codeBased = Array.isArray(regions) && regions.every(region => /^[A-Z]{2,3}$/.test(region));
  return codeBased ? String(value || '').trim().toUpperCase() : String(value || '').trim();
}

export const SIGNUP_FIELD_KEYS = {
  defaultMode: 'modeError', firstName: 'firstNameError', lastName: 'lastNameError', email: 'emailError',
  phone: 'phoneError', country: 'countryError', addressLine1: 'addressError', city: 'cityError',
  state: 'stateError', zipCode: 'postalError', password: 'passwordError', ageConfirmed: 'ageError', termsAccepted: 'termsError',
};

export function validateSignup(form, modes) {
  const fields = {};
  const fail = field => { fields[field] = SIGNUP_FIELD_KEYS[field]; };
  if (!modes.includes(form.defaultMode)) fail('defaultMode');
  for (const [field, limit] of [['firstName', 100], ['lastName', 100], ['addressLine1', 255], ['city', 100]]) {
    const value = String(form[field] || '').trim();
    if (!value || value.length > limit || /<script|javascript:|on\w+\s*=/i.test(value)) fail(field);
  }
  const email = String(form.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) fail('email');
  if (!isSignupPhoneValid(form.phone, form.country)) fail('phone');
  if (!ALL_COUNTRIES[form.country]) fail('country');
  const region = normalizeSignupRegion(form.country, form.state);
  const regions = getRegionsFor(form.country);
  if ((hasRegions(form.country) && (!region || !regions.includes(region))) || region.length > 100 || /<script|javascript:|on\w+\s*=/i.test(region)) fail('state');
  const postal = String(form.zipCode || '').trim();
  if (postal.length > 20 || /<script|javascript:|on\w+\s*=/i.test(postal) || (requiresPostalCode(form.country) && (!postal || !isValidPostal(form.country, postal)))) fail('zipCode');
  if (!isSignupPasswordValid(form.password)) fail('password');
  if (form.ageConfirmed !== true) fail('ageConfirmed');
  if (form.termsAccepted !== true) fail('termsAccepted');
  return fields;
}
