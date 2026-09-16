import React, { useEffect } from 'react';
import { WebApp } from '../telegram';

const SOCIAL_BAR_SRC = 'https://negotiatenapkin.com/ff/f6/47/fff6478af4610b21f1c7b6ebfbff8cac.js';
const POPUNDER_SRC = 'https://negotiatenapkin.com/05/75/89/057589b746ea2587e91f8217c30ff3e8.js';
const POPUNDER_CAP_MS = 8 * 60 * 60 * 1000; // 8 hours frequency capping
const POPUNDER_STORAGE_KEY = 'mb_adult_pop_ts';

export const AdultAdManager: React.FC = () => {
  useEffect(() => {
    // 1. Mount Social Bar (Async floating widget on adult pages)
    const existingSocialBar = document.querySelector(`script[src="${SOCIAL_BAR_SRC}"]`);
    if (!existingSocialBar) {
      const script = document.createElement('script');
      script.src = SOCIAL_BAR_SRC;
      script.async = true;
      script.dataset.adsterra = 'social-bar';
      document.body.appendChild(script);
    }

    // 2. Controlled Popunder: Strict 8-hour frequency capping & Telegram WebApp guard
    const isTelegram = Boolean(WebApp?.platform && WebApp.platform !== 'unknown');
    if (!isTelegram) {
      const now = Date.now();
      const lastPopTime = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
      const isEligible = !lastPopTime || (now - lastPopTime > POPUNDER_CAP_MS);

      if (isEligible) {
        // Delayed injection to prevent blocking initial video load
        const timer = setTimeout(() => {
          const existingPopunder = document.querySelector(`script[src="${POPUNDER_SRC}"]`);
          if (!existingPopunder) {
            const popScript = document.createElement('script');
            popScript.src = POPUNDER_SRC;
            popScript.async = true;
            popScript.dataset.adsterra = 'popunder';
            document.head.appendChild(popScript);
            localStorage.setItem(POPUNDER_STORAGE_KEY, String(now));
          }
        }, 1500);

        return () => clearTimeout(timer);
      }
    }
  }, []);

  return null;
};
