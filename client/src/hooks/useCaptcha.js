import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCaptchaConfig } from '../api/captcha';
import { captchaPayload, isCaptchaError } from '../utils/captcha';

// Shared state for a Turnstile-protected form. The widget renders only when
// the server says the check is enabled (so CAPTCHA_ENABLED=true never
// strands a form without a widget). Tokens are single-use: call consume()
// after every request that sent one.

export { isCaptchaError, captchaPayload };

export default function useCaptcha({ loadConfig = getCaptchaConfig } = {}) {
  const [config, setConfig] = useState(null);
  const [token, setToken] = useState('');
  const [failed, setFailed] = useState(false);
  const ref = useRef(null);

  const reload = useCallback(() => {
    Promise.resolve()
      .then(loadConfig)
      .then((next) => setConfig(next || null))
      .catch(() => setConfig(null));
  }, [loadConfig]);

  useEffect(() => { reload(); }, [reload]);

  const enabled = Boolean(config?.enabled);
  const siteKey = enabled ? config?.siteKey || null : null;

  const consume = useCallback(() => {
    setToken('');
    ref.current?.reset();
  }, []);

  const widgetProps = useMemo(() => ({
    ref,
    siteKey,
    onToken: (next) => { setToken(next); setFailed(false); },
    onExpire: () => setToken(''),
    onError: () => { setToken(''); setFailed(true); },
  }), [siteKey]);

  return {
    enabled,
    siteKey,
    token,
    failed,
    // Enabled but unusable: no site key configured, or the widget failed.
    unavailable: enabled && (!siteKey || failed),
    payload: captchaPayload(enabled, token),
    consume,
    reload,
    widgetProps,
  };
}
