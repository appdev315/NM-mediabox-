import { useEffect, useRef } from 'react';

export function ExoClickMainBanner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);

  const isMobile = window.innerWidth < 768;

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const loadAd = () => {
      const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
      if (!scriptLoaded) {
        const script = document.createElement('script');
        script.async = true;
        script.type = 'application/javascript';
        script.src = 'https://a.magsrv.com/ad-provider.js';
        document.head.appendChild(script);
      }

      if (containerRef.current) {
        if (isMobile) {
          containerRef.current.innerHTML = '<ins class="eas6a97888e10" data-zoneid="5965686"></ins>';
        } else {
          containerRef.current.innerHTML = '<ins class="eas6a97888e2" data-zoneid="5965676"></ins>';
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
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full mb-6 relative z-10" style={{ minHeight: isMobile ? '100px' : '250px' }}>
      <style>{`
        .eas6a97888e10 { 
          display: flex !important; 
          flex-direction: row !important; 
          overflow-x: auto !important; 
          gap: 8px;
          padding-bottom: 4px;
        }
        .eas6a97888e10::-webkit-scrollbar { display: none; }
      `}</style>
      <div ref={containerRef} className="flex justify-center items-center w-full h-full">
      </div>
    </div>
  );
}
