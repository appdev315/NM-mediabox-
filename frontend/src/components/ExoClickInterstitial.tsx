import { useEffect, useRef } from 'react';

export function ExoClickInterstitial() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.pemsrv.com/ad-provider.js';
      document.head.appendChild(script);
    }

    const pushAd = () => {
      try {
        const w = window as any;
        w.AdProvider = w.AdProvider || [];
        w.AdProvider.push({"serve": {}});
      } catch (e) {
        console.error('ExoClick Ad Error:', e);
      }
    };

    pushAd();
  }, []);

  return (
    <div ref={containerRef}>
      <ins className="eas6a97888e33" data-zoneid="5964660" data-ex_av="name"></ins>
    </div>
  );
}
