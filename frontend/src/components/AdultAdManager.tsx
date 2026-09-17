import React, { useEffect } from 'react';

export const AdultAdManager: React.FC = () => {
  useEffect(() => {
    // 1. Purge any lingering Popunder & Social Bar scripts and artifacts
    try {
      document.querySelectorAll<HTMLElement>(
        'script[data-adsterra="popunder"], script[data-adsterra="social-bar"], script[src*="057589b246ea2587e91f8217c30ff3e8"], script[src*="negotiatenapkin.com"], script[src*="ff86478af4610b21f1c7b6ebf6ff8cac"]'
      ).forEach(s => s.remove());

      document.querySelectorAll<HTMLElement>(
        '[id*="ff86478af4610b21f1c7b6ebf6ff8cac"], [class*="asg_"], [class*="at-social"], [class*="at-custom"]'
      ).forEach(el => el.remove());

      localStorage.removeItem('mb_adult_social_ts');
      localStorage.removeItem('mb_adult_pop_ts');

      const cookiesToPurge = [
        'sb_delay_', 'sb_count_', 'sb_page_', 'sb_onpage_', 'sb_main_', 'sb_idelay_',
        'pp_delay_057589b246ea2587e91f8217c30ff3e8',
        'pp_clicks_057589b246ea2587e91f8217c30ff3e8',
        'pp_idelay_057589b246ea2587e91f8217c30ff3e8',
        'total_count_057589b246ea2587e91f8217c30ff3e8'
      ];

      const domainParts = window.location.hostname.split('.');
      const rootDomain = domainParts.length > 1 ? '.' + domainParts.slice(-2).join('.') : '';

      cookiesToPurge.forEach(prefix => {
        document.cookie = `${prefix}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        if (rootDomain) {
          document.cookie = `${prefix}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=${rootDomain};`;
        }
      });

      if ((window as any).placementKey) {
        try {
          delete (window as any).placementKey;
        } catch {}
      }
    } catch (e) {
      console.debug('[AdultAdManager] cleanup:', e);
    }
  }, []);

  return null;
};


