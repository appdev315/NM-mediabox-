import { useEffect } from 'react';
import { WebApp } from '../telegram';

export const MonetagScript = () => {
  useEffect(() => {
    const isTelegram = !!WebApp.initDataUnsafe?.user;
    
    // We only load Monetag if NOT in Telegram
    if (!isTelegram) {
      // Prevent multiple injections if component re-mounts
      const scriptId = 'monetag-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.dataset.zone = '11214505';
        script.src = 'https://nap5k.com/tag.min.js';
        script.async = true;
        document.head.appendChild(script);
      }
    }
  }, []);

  return null;
};
