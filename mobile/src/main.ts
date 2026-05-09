import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import './style.css';

const SITE_URL = import.meta.env.VITE_OXSTEED_SITE_URL || 'https://oxsteed.com';

async function configureNativeChrome() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#111827' });
  } catch {
    // StatusBar is best-effort because iOS and Android differ by version/theme.
  }

  try {
    await SplashScreen.hide();
  } catch {
    // The splash screen may already be hidden.
  }
}

function installNativeLinkHandlers() {
  if (!Capacitor.isNativePlatform()) return;

  App.addListener('appUrlOpen', ({ url }) => {
    const parsed = toOxSteedUrl(url);
    if (parsed) window.location.href = parsed;
  });

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    App.exitApp();
  });
}

async function installNetworkFallback() {
  if (!Capacitor.isNativePlatform()) return;

  const status = await Network.getStatus();
  if (!status.connected) renderOfflineState();

  Network.addListener('networkStatusChange', (next) => {
    if (next.connected) {
      window.location.reload();
    } else {
      renderOfflineState();
    }
  });
}

function toOxSteedUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'oxsteed:') {
      return new URL(`${url.host}${url.pathname}${url.search}${url.hash}`, SITE_URL).toString();
    }
    if (url.hostname === 'oxsteed.com' || url.hostname === 'www.oxsteed.com') {
      return url.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function renderOfflineState() {
  document.body.innerHTML = `
    <main class="shell">
      <img src="/icon.svg" alt="" class="brand-mark" />
      <h1>OxSteed</h1>
      <p>You appear to be offline. Reconnect to keep booking jobs, messages, and marketplace updates flowing.</p>
      <button class="primary-link" type="button" id="retry">Try again</button>
    </main>
  `;
  document.getElementById('retry')?.addEventListener('click', () => window.location.reload());
}

async function openExternalLinksInSystemBrowser() {
  document.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    try {
      const href = new URL(anchor.href);
      if (href.hostname === 'oxsteed.com' || href.hostname === 'www.oxsteed.com') return;
      if (!Capacitor.isNativePlatform()) return;

      event.preventDefault();
      await Browser.open({ url: href.toString(), presentationStyle: 'popover' });
    } catch {
      // Leave malformed links to the browser.
    }
  });
}

configureNativeChrome();
installNativeLinkHandlers();
installNetworkFallback();
openExternalLinksInSystemBrowser();
