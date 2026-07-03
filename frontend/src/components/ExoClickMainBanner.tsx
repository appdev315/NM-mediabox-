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
          containerRef.current.innerHTML = `
            <ins class="eas6a97888e10" data-zoneid="5965686" style="flex-shrink: 0;"></ins>
            <ins class="eas6a97888e10" data-zoneid="5965686" style="flex-shrink: 0;"></ins>
          `;
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
    <div className="w-full mb-4 mt-4 relative z-10" style={{ minHeight: isMobile ? '100px' : '250px' }}>
      <style>{`
        .exo-container {
          width: 90%;
          margin: 0 auto;
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          align-items: flex-start;
        }
        @media (min-width: 640px) {
          .exo-container { gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (min-width: 1024px) {
          .exo-container { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        .exo-container > * {
          width: 100%;
          max-width: 100%;
          overflow: hidden;
          display: flex;
          justify-content: center;
          border-radius: 12px;
        }
      `}</style>
      <div ref={containerRef} className="exo-container"></div>
    </div>
  );
}
