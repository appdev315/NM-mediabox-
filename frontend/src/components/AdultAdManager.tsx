import React, { useEffect } from 'react';

const SOCIAL_BAR_KEY = 'ff86478af4610b21f1c7b6ebf6ff8cac';
const POPUNDER_KEY = '057589b246ea2587e91f8217c30ff3e8';

const SOCIAL_BAR_SRC = `https://negotiatenapkin.com/ff/86/47/${SOCIAL_BAR_KEY}.js`;
const POPUNDER_SRC = `https://negotiatenapkin.com/05/75/89/${POPUNDER_KEY}.js`;

// Social Bar: every 3-5 minutes (3.5 min = 210,000 ms)
const SOCIAL_BAR_INTERVAL_MS = 3.5 * 60 * 1000;
const SOCIAL_STORAGE_KEY = 'mb_adult_social_ts';

// Popunder: every 5-7 minutes (5.5 min = 330,000 ms)
const POPUNDER_CAP_MS = 5.5 * 60 * 1000;
const POPUNDER_STORAGE_KEY = 'mb_adult_pop_ts';

export const AdultAdManager: React.FC = () => {
  useEffect(() => {
    // 1. Clear internal Adsterra frequency capping cookies & storage so recurring timers work
    const purgeAdsterraLimits = () => {
      try {
        const cookiesToPurge = [
          `sb_delay_${SOCIAL_BAR_KEY}`,
          `sb_count_${SOCIAL_BAR_KEY}`,
          `sb_page_${SOCIAL_BAR_KEY}`,
          `sb_onpage_${SOCIAL_BAR_KEY}`,
          `sb_main_${SOCIAL_BAR_KEY}`,
          `sb_idelay_${SOCIAL_BAR_KEY}`,
          `pp_delay_${POPUNDER_KEY}`,
          `pp_clicks_${POPUNDER_KEY}`,
          `pp_idelay_${POPUNDER_KEY}`,
          `total_count_${POPUNDER_KEY}`
        ];

        const domainParts = window.location.hostname.split('.');
        const rootDomain = domainParts.length > 1 ? '.' + domainParts.slice(-2).join('.') : '';

        cookiesToPurge.forEach((name) => {
          document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
          if (rootDomain) {
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${rootDomain};`;
          }
          try {
            localStorage.removeItem(name);
            sessionStorage.removeItem(name);
          } catch {}
        });

        if ((window as any).placementKey) {
          try {
            delete (window as any).placementKey;
          } catch {}
        }
      } catch (e) {
        console.debug('[AdultAdManager] purge error:', e);
      }
    };

    // 2. Social Bar bottom positioning enforcement (slide from bottom up)
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
        id.includes(SOCIAL_BAR_KEY)
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

    // 3. Social Bar mount trigger
    const mountSocialBar = () => {
      const now = Date.now();
      purgeAdsterraLimits();

      // Clean existing Social Bar elements and scripts
      document.querySelectorAll<HTMLElement>(`script[data-adsterra="social-bar"], script[src*="${SOCIAL_BAR_KEY}"]`).forEach(s => s.remove());
      document.querySelectorAll<HTMLElement>(`[id*="${SOCIAL_BAR_KEY}"], [class*="asg_"], [class*="at-social"]`).forEach(el => el.remove());

      const script = document.createElement('script');
      script.src = `${SOCIAL_BAR_SRC}?_t=${now}`;
      script.async = true;
      script.dataset.adsterra = 'social-bar';
      document.body.appendChild(script);

      localStorage.setItem(SOCIAL_STORAGE_KEY, String(now));
    };

    // 4. Popunder mount trigger
    const mountPopunder = () => {
      const now = Date.now();
      purgeAdsterraLimits();

      // Clean previous Popunder script tag
      document.querySelectorAll<HTMLElement>(`script[data-adsterra="popunder"], script[src*="${POPUNDER_KEY}"]`).forEach(s => s.remove());

      const popScript = document.createElement('script');
      popScript.src = `${POPUNDER_SRC}?_t=${now}`;
      popScript.async = true;
      popScript.dataset.adsterra = 'popunder';
      document.head.appendChild(popScript);

      localStorage.setItem(POPUNDER_STORAGE_KEY, String(now));
    };

    // 5. Initial mount orchestration (quick start after 3-5 seconds to capture traffic)
    const initialNow = Date.now();
    const lastSocialTime = Number(localStorage.getItem(SOCIAL_STORAGE_KEY) || '0');
    const initialSocialDelay = (!lastSocialTime || (initialNow - lastSocialTime >= SOCIAL_BAR_INTERVAL_MS))
      ? 3500 
      : Math.max(1000, SOCIAL_BAR_INTERVAL_MS - (initialNow - lastSocialTime));

    const lastPopTime = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
    const initialPopDelay = (!lastPopTime || (initialNow - lastPopTime >= POPUNDER_CAP_MS))
      ? 6000 
      : Math.max(1000, POPUNDER_CAP_MS - (initialNow - lastPopTime));

    const initialSocialTimer = setTimeout(mountSocialBar, initialSocialDelay);
    const initialPopTimer = setTimeout(mountPopunder, initialPopDelay);

    // 6. Persistent heartbeat check every 5 seconds to ensure timers fire precisely
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      
      const currentSocial = Number(localStorage.getItem(SOCIAL_STORAGE_KEY) || '0');
      if (!currentSocial || (now - currentSocial >= SOCIAL_BAR_INTERVAL_MS)) {
        mountSocialBar();
      }

      const currentPop = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
      if (!currentPop || (now - currentPop >= POPUNDER_CAP_MS)) {
        mountPopunder();
      }
    }, 5000);

    return () => {
      observer.disconnect();
      clearTimeout(initialSocialTimer);
      clearTimeout(initialPopTimer);
      clearInterval(heartbeatInterval);
    };
  }, []);

  return null;
};

