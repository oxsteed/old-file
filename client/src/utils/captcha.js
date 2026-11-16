// Pure helpers for verifyCaptcha-protected forms (see hooks/useCaptcha).

export function isCaptchaError(error) {
  const code = error?.response?.data?.error;
  return code === 'captcha_required' || code === 'captcha_failed';
}

export function captchaPayload(enabled, token) {
  return enabled && token ? { captchaToken: token } : {};
}
