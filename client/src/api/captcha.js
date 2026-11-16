import api from './axios';

// Public bot-check config from the server: { enabled, provider, siteKey }.
// Shared by every form whose server route uses verifyCaptcha.
export const getCaptchaConfig = () => api.get('/auth/captcha-config').then((response) => response.data?.captcha || null);
