import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.romanbushuev.mediabox',
  appName: 'mediabox',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 0,
    }
  },
  server: {
    cleartext: true,
    allowNavigation: ['*']
  }
};

export default config;
