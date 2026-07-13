import React, { useEffect, useRef } from 'react';

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = window.innerWidth < 768;
  const zoneId = isMobile ? "5965686" : "5965676";
  const className = isMobile ? "eas6a97888e10" : "eas6a97888e2";

  useEffect(() => {
    const loadAd = () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = `<ins class="${className}" data-zoneid="${zoneId}" style="display:inline-block;width:${isMobile ? '320px' : '728px'};height:${isMobile ? '50px' : '90px'};"></ins>`;
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({ "serve": {} });
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };
    
    const timer = setTimeout(loadAd, 200);
    return () => {
      clearTimeout(timer);
    };
  }, [isMobile, className, zoneId]);

  return (
    <div ref={containerRef} className="w-full mb-4 mt-4 flex justify-center items-center overflow-hidden" style={{ minHeight: isMobile ? '50px' : '90px' }}>
    </div>
  );
});
