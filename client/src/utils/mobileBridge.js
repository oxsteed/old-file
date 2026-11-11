import api from '../api/axios';
import { readSessionStorage } from './sessionStorage';
import { readLocalStorage, writeLocalStorage } from './localStorage';

const TOKEN_SYNC_KEY = 'oxs:mobile_push_token_synced';

function getCapacitorPlugin(name) {
  return window.Capacitor?.Plugins?.[name] || null;
}

function isNativeApp() {
  if (!window.Capacitor) return false;
  if (typeof window.Capacitor.isNativePlatform === 'function') {
    return window.Capacitor.isNativePlatform();
  }
  return window.Capacitor.getPlatform?.() !== 'web';
}

function getAccessToken() {
  // Session presence check only; the actual token travels via the httpOnly
  // cookie. Impersonation sessions still expose their short-lived token.
  if (readSessionStorage('oxs:impersonation_token')) return 'impersonation';
  return readLocalStorage('user') ? 'cookie' : null;
}

function resolveNotificationUrl(data = {}) {
  const raw = data.url || data.deepLink || data.route || data.path;
  if (!raw || typeof raw !== 'string') return null;

  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function resolveAppUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'oxsteed:') {
      return `/${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (parsed.origin === window.location.origin) {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    if (parsed.hostname === 'oxsteed.com' || parsed.hostname === 'www.oxsteed.com') {
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return null;
  }

  return null;
}

async function getDeviceInfo() {
  const Device = getCapacitorPlugin('Device');
  if (!Device?.getInfo) return {};

  try {
    const [info, id] = await Promise.all([
      Device.getInfo(),
      Device.getId?.().catch(() => null),
    ]);

    return {
      platform: info.platform,
      model: info.model,
      operatingSystem: info.operatingSystem,
      osVersion: info.osVersion,
      manufacturer: info.manufacturer,
      deviceId: id?.identifier,
    };
  } catch {
    return {};
  }
}

async function registerPushToken(token) {
  const accessToken = getAccessToken();
  if (!accessToken || !token?.value) return;

  const lastSynced = readLocalStorage(TOKEN_SYNC_KEY);
  if (lastSynced === token.value) return;

  const device = await getDeviceInfo();
  await api.post('/mobile/push-token', {
    token: token.value,
    provider: device.platform === 'ios' ? 'apns' : 'fcm',
    platform: device.platform,
    device_id: device.deviceId,
    app_version: import.meta.env.VITE_APP_VERSION || null,
    device,
  });

  writeLocalStorage(TOKEN_SYNC_KEY, token.value);
}

async function requestAndRegisterPush() {
  const PushNotifications = getCapacitorPlugin('PushNotifications');
  if (!PushNotifications || !getAccessToken()) return;

  const permissions = await PushNotifications.requestPermissions();
  if (permissions.receive !== 'granted') return;

  await PushNotifications.register();
}

function installAuthTokenWatcher() {
  let storage;
  let originalSetItem;
  try {
    storage = window.localStorage;
    if (!storage || typeof storage.setItem !== 'function') return;
    originalSetItem = storage.setItem.bind(storage);
  } catch {
    return;
  }

  try {
    storage.setItem = (key, value) => {
    // A login persists the session user (the access token itself now lives
    // in an httpOnly cookie and is never written to localStorage). Only react
    // when a session starts, not on every profile refresh that rewrites it.
    const sessionStarted = key === 'user' && !readLocalStorage('user');
    originalSetItem(key, value);
    if (sessionStarted || key === 'accessToken') {
      window.setTimeout(() => {
        requestAndRegisterPush().catch(() => {});
      }, 250);
    }
    };
  } catch {
    // Some WebViews expose a read-only Storage implementation.
  }
}

export function initMobileBridge() {
  if (!isNativeApp()) return;

  const App = getCapacitorPlugin('App');
  const PushNotifications = getCapacitorPlugin('PushNotifications');

  App?.addListener?.('appUrlOpen', ({ url }) => {
    const route = resolveAppUrl(url);
    if (route) window.location.assign(route);
  });

  App?.addListener?.('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    App.exitApp?.();
  });

  if (!PushNotifications) return;

  PushNotifications.addListener?.('registration', (token) => {
    registerPushToken(token).catch(() => {});
  });

  PushNotifications.addListener?.('pushNotificationActionPerformed', (event) => {
    const url = resolveNotificationUrl(event?.notification?.data);
    if (url) window.location.assign(url);
  });

  installAuthTokenWatcher();
  requestAndRegisterPush().catch(() => {});
}
