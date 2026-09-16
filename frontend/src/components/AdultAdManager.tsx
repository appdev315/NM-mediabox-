import React, { useEffect } from 'react';
import { WebApp } from '../telegram';

const SOCIAL_BAR_SRC = 'https://negotiatenapkin.com/ff/86/47/ff86478af4610b21f1c7b6ebf6ff8cac.js';
const POPUNDER_SRC = 'https://negotiatenapkin.com/05/75/89/057589b246ea2587e91f8217c30ff3e8.js';

// Social Bar: every 3-5 minutes (4 min = 240,000 ms), with 15s initial delay
const SOCIAL_BAR_INTERVAL_MS = 4 * 60 * 1000;
const SOCIAL_STORAGE_KEY = 'mb_adult_social_ts';

// Popunder: every 5-7 minutes (6 min = 360,000 ms)
const POPUNDER_CAP_MS = 6 * 60 * 1000;
const POPUNDER_STORAGE_KEY = 'mb_adult_pop_ts';

export const AdultAdManager: React.FC = () => {
  useEffect(() => {
    // 1. Social Bar bottom positioning enforcement (slide from bottom up)
    const isAdElement = (el: HTMLElement): boolean => {
      if (!el || !el.tagName) return false;
      if (el.tagName === 'IFRAME') {
        const src = el.getAttribute('src') || '';
        return !src || src.includes('negotiatenapkin') || src.includes('adsterra');
      }
      const className = typeof el.className === 'string' ? el.className : '';
      const id = typeof el.id === 'string' ? el.id : '';
      return (
        el.dataset?.adsterra === 'social-bar' ||
        className.includes('at-') ||
        className.includes('asg_') ||
        id.includes('at-') ||
        id.includes('asg_') ||
        id.includes('container-3208ff608ab1302402523bc766aa65a2')
      );
    };

    const fixPositioning = (el: HTMLElement) => {
      if (!el || !el.style || !isAdElement(el)) return;
      const computed = window.getComputedStyle(el);
      if (computed.position === 'fixed' || el.style.position === 'fixed' || el.tagName === 'IFRAME') {
        el.style.setProperty('top', 'auto', 'important');
        el.style.setProperty('bottom', 'calc(75px + env(safe-area-inset-bottom, 0px))', 'important');
      }
    };

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) {
            fixPositioning(node);
            const nested = node.querySelectorAll<HTMLElement>('iframe, div[class*="at-"], div[id*="asg_"]');
            nested.forEach(fixPositioning);
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 2. Controlled Social Bar mounting every 3-5 minutes
    const checkAndMountSocialBar = () => {
      const now = Date.now();
      const lastSocialTime = Number(localStorage.getItem(SOCIAL_STORAGE_KEY) || '0');
      const isEligible = !lastSocialTime || (now - lastSocialTime >= SOCIAL_BAR_INTERVAL_MS);

      if (isEligible) {
        const existingSocialBar = document.querySelector(`script[src="${SOCIAL_BAR_SRC}"]`);
        if (existingSocialBar) existingSocialBar.remove();

        const script = document.createElement('script');
        script.src = SOCIAL_BAR_SRC;
        script.async = true;
        script.dataset.adsterra = 'social-bar';
        document.body.appendChild(script);
        localStorage.setItem(SOCIAL_STORAGE_KEY, String(now));
      }
    };

    // 15-second initial delay after video/page opens to avoid instant popups
    const socialInitialTimer = setTimeout(checkAndMountSocialBar, 15000);
    const socialInterval = setInterval(checkAndMountSocialBar, 60000);

    // 3. Controlled Popunder: every 5-7 minutes (guarded against Telegram WebApp)
    const isTelegram = Boolean(WebApp?.platform && WebApp.platform !== 'unknown');
    let popunderTimer: any;
    let popunderInterval: any;

    if (!isTelegram) {
      const checkAndArmPopunder = () => {
        const now = Date.now();
        const lastPopTime = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
        const isEligible = !lastPopTime || (now - lastPopTime >= POPUNDER_CAP_MS);

        if (isEligible) {
          const existingPopunder = document.querySelector(`script[src="${POPUNDER_SRC}"]`);
          if (existingPopunder) existingPopunder.remove();

          const popScript = document.createElement('script');
          popScript.src = POPUNDER_SRC;
          popScript.async = true;
          popScript.dataset.adsterra = 'popunder';
          document.head.appendChild(popScript);
          localStorage.setItem(POPUNDER_STORAGE_KEY, String(now));
        }
      };

      popunderTimer = setTimeout(checkAndArmPopunder, 3000);
      popunderInterval = setInterval(checkAndArmPopunder, 60000);
    }

    return () => {
      observer.disconnect();
      clearTimeout(socialInitialTimer);
      clearInterval(socialInterval);
      if (popunderTimer) clearTimeout(popunderTimer);
      if (popunderInterval) clearInterval(popunderInterval);
    };
  }, []);

  return null;
};
