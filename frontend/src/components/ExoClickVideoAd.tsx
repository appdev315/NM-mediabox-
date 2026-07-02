import { useEffect, useRef } from 'react';

export function ExoClickVideoAd() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scriptLoaded = document.querySelector('script[src*="a.pemsrv.com"]') || document.querySelector('script[src*="a.magsrv.com"]');
    
    if (!scriptLoaded) {
      const script = document.createElement('script');
      script.async = true;
      script.type = 'application/javascript';
      script.src = 'https://a.magsrv.com/ad-provider.js';
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
    <div ref={containerRef} className="flex justify-center w-full my-4">
      <ins className="eas6a97888e37" data-zoneid="5964652"></ins>
    </div>
  );
}
