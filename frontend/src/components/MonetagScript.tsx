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
        script.src = 'https://quge5.com/88/tag.min.js';
        script.setAttribute('data-zone', '254462');
        script.async = true;
        script.setAttribute('data-cfasync', 'false');
        document.head.appendChild(script);
      }
    }
  }, []);

  return null;
};
