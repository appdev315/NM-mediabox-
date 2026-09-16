import React, { useEffect } from 'react';

const POPUNDER_KEY = '057589b246ea2587e91f8217c30ff3e8';
const POPUNDER_SRC = `https://negotiatenapkin.com/05/75/89/${POPUNDER_KEY}.js`;

// Popunder: every 5-7 minutes (5.5 min = 330,000 ms)
const POPUNDER_CAP_MS = 5.5 * 60 * 1000;
const POPUNDER_STORAGE_KEY = 'mb_adult_pop_ts';

export const AdultAdManager: React.FC = () => {
  useEffect(() => {
    // 1. One-time purge of any lingering Social Bar artifacts and cookies
    try {
      document.querySelectorAll<HTMLElement>('script[data-adsterra="social-bar"], script[src*="ff86478af4610b21f1c7b6ebf6ff8cac"]').forEach(s => s.remove());
      document.querySelectorAll<HTMLElement>('[id*="ff86478af4610b21f1c7b6ebf6ff8cac"], [class*="asg_"], [class*="at-social"], [class*="at-custom"]').forEach(el => el.remove());
      localStorage.removeItem('mb_adult_social_ts');
      
      const sbCookies = ['sb_delay_', 'sb_count_', 'sb_page_', 'sb_onpage_', 'sb_main_', 'sb_idelay_'];
      sbCookies.forEach(prefix => {
        document.cookie = `${prefix}ff86478af4610b21f1c7b6ebf6ff8cac=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
    } catch (e) {
      console.debug('[AdultAdManager] initial Social Bar purge:', e);
    }

    // 2. Clear internal Adsterra Popunder limits
    const purgePopunderLimits = () => {
      try {
        const cookiesToPurge = [
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

    // 3. Popunder mount trigger
    const mountPopunder = () => {
      const now = Date.now();
      purgePopunderLimits();

      // Clean previous Popunder script tag
      document.querySelectorAll<HTMLElement>(`script[data-adsterra="popunder"], script[src*="${POPUNDER_KEY}"]`).forEach(s => s.remove());

      const popScript = document.createElement('script');
      popScript.src = `${POPUNDER_SRC}?_t=${now}`;
      popScript.async = true;
      popScript.dataset.adsterra = 'popunder';
      document.head.appendChild(popScript);

      localStorage.setItem(POPUNDER_STORAGE_KEY, String(now));
    };

    // 4. Initial Popunder schedule (after 6s or remaining interval)
    const initialNow = Date.now();
    const lastPopTime = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
    const initialPopDelay = (!lastPopTime || (initialNow - lastPopTime >= POPUNDER_CAP_MS))
      ? 6000 
      : Math.max(1000, POPUNDER_CAP_MS - (initialNow - lastPopTime));

    const initialPopTimer = setTimeout(mountPopunder, initialPopDelay);

    // 5. Persistent heartbeat check every 5 seconds
    const heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const currentPop = Number(localStorage.getItem(POPUNDER_STORAGE_KEY) || '0');
      if (!currentPop || (now - currentPop >= POPUNDER_CAP_MS)) {
        mountPopunder();
      }
    }, 5000);

    return () => {
      clearTimeout(initialPopTimer);
      clearInterval(heartbeatInterval);
    };
  }, []);

  return null;
};


