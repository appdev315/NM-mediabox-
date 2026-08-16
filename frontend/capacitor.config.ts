import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.romanbushuev.mediabox',
  appName: 'mediabox',
  webDir: 'dist',
  backgroundColor: '#17212b',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 0,
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true
    }
  },
  server: {
    url: 'https://media-box.xyz',
    cleartext: true,
    androidScheme: 'https'
  }
};

export default config;
