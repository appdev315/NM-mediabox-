import React, { useEffect, useRef } from 'react';

export const ExoClickMainBanner = React.memo(function ExoClickMainBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const isMobile = window.innerWidth < 768;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      if (containerRef.current) {
        if (isMobile) {
          containerRef.current.innerHTML = '<ins class="eas6a97888e10" data-zoneid="5965686" style="display:inline-block;width:320px;height:50px;"></ins>';
        } else {
          containerRef.current.innerHTML = '<ins class="eas6a97888e2" data-zoneid="5965676" style="display:inline-block;width:728px;height:90px;"></ins>';
        }
      }

      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    const timer = setTimeout(loadAd, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [isMobile]);

  return (
    <div ref={wrapperRef} className="w-full mb-4 mt-4 relative z-10" style={{ minHeight: isMobile ? '50px' : '90px' }}>
      <style>{`
        .exo-container {
          width: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .exo-container ins {
          display: inline-block !important;
          max-width: 100%;
        }
      `}</style>
      <div ref={containerRef} className="exo-container"></div>
    </div>
  );
});
