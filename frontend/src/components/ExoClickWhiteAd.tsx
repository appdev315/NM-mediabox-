import React, { useEffect, useRef, useState } from 'react';
import { BannerAd } from './BannerAd';

const VALID_ZONE_IDS = ['5964976', '5965656', '5964558', '5965876'] as const;
type ValidZoneId = typeof VALID_ZONE_IDS[number];

interface ExoClickWhiteAdProps {
  className?: string;
  zoneId?: ValidZoneId;
}

function isValidZoneId(id: string): id is ValidZoneId {
  return VALID_ZONE_IDS.includes(id as ValidZoneId);
}

export default React.memo(function ExoClickWhiteAd({ className = 'exo-banner-movie-card', zoneId = '5964976' }: ExoClickWhiteAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Dynamically ensure ad-provider script exists
    if (!document.querySelector('script[src*="ad-provider.js"]')) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    const loadAd = () => {
      if (containerRef.current && isValidZoneId(zoneId)) {
        const ins = document.createElement('ins');
        ins.className = 'eas6a97888e20';
        ins.setAttribute('data-zoneid', zoneId);
        ins.style.display = 'block';
        ins.style.width = '100%';
        ins.style.minHeight = '120px';
        containerRef.current.appendChild(ins);
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };
    
    const timer = setTimeout(loadAd, 100);

    // Fallback detection: if blocked by adblock or empty after 2s, show internal BannerAd
    const fallbackTimer = setTimeout(() => {
      if (containerRef.current) {
        const ins = containerRef.current.querySelector('ins');
        if (!ins || ins.children.length === 0 || ins.offsetHeight === 0) {
          setShowFallback(true);
        }
      }
    }, 2000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallbackTimer);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [zoneId]);

  if (showFallback) {
    return <BannerAd variant="wide" type="mainbot" />;
  }

  return (
    <div ref={containerRef} className={className + " ad-slot flex justify-center items-center overflow-hidden"}>
    </div>
  );
});

