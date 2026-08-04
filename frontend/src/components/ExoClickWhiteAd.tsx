import React, { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      if (containerRef.current && isValidZoneId(zoneId)) {
        const ins = document.createElement('ins');
        ins.className = 'eas6a97888e20';
        ins.setAttribute('data-zoneid', zoneId);
        ins.style.display = 'inline-block';
        ins.style.width = '100%';
        ins.style.minHeight = 'inherit';
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
    
    const timer = setTimeout(loadAd, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [zoneId]);

  return (
    <div ref={containerRef} className={className + " min-h-[50px] flex justify-center items-center overflow-hidden"}>
    </div>
  );
});
