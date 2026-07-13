import React, { useEffect, useRef } from 'react';

interface ExoClickWhiteAdProps {
  className?: string; // Expecting 'exo-banner-movie-card' or 'exo-banner-tv-card'
  zoneId?: string;
}

export default React.memo(function ExoClickWhiteAd({ className = 'exo-banner-movie-card', zoneId = '5964976' }: ExoClickWhiteAdProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = `<ins class="eas6a97888e20" data-zoneid="${zoneId}" style="display:inline-block;width:100%;min-height:inherit;"></ins>`;
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
  }, []);

  return (
    <div ref={containerRef} className={className + " min-h-[50px] flex justify-center items-center overflow-hidden"}>
    </div>
  );
});
