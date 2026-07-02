import { useEffect } from 'react';
import { WebApp } from '../telegram';

export const MonetagScript = () => {
  useEffect(() => {
    // Only load Monetag if NOT in Telegram (since TG uses Adsgram)
    if (WebApp.platform !== 'unknown') {
      return;
    }

    const script = document.createElement('script');
    script.dataset.zone = '11228087';
    script.src = 'https://n6wxm.com/vignette.min.js';
    
    // Monetag's vignette script attaches to a node. We'll append it to the body.
    document.body.appendChild(script);

    return () => {
      // Cleanup if component unmounts (though it's usually at app level)
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  return null;
};
