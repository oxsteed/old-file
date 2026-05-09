import type { CapacitorConfig } from '@capacitor/cli';

const oxsteedUrl = process.env.OXSTEED_APP_URL || 'https://oxsteed.com';

const config: CapacitorConfig = {
  appId: 'com.oxsteed.app',
  appName: 'OxSteed',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    url: oxsteedUrl,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['oxsteed.com', 'www.oxsteed.com'],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#111827',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#111827',
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  ios: {
    contentInset: 'automatic',
  },
};

export default config;
